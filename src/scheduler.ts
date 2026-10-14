// The scheduler: what runs when. It holds everything that is only true while this process is up (which
// workers are running, which job has which browser) and starts whatever work is waiting. The workers
// themselves live in scan.ts, locate.ts, prep.ts, fill.ts and track.ts.
import * as chrome from "./chrome";
import { browserCount, config } from "./config";
import {
  dedupeExisting,
  getJob,
  jobsByStatus,
  jobsInStatuses,
  kvGet,
  kvSet,
  logEvent,
  nextToPrep,
  notifyJobChange,
  pruneChatter,
  requeueInterruptedPrep,
  updateJob,
  type Job,
} from "./db";
import { checkAutoApprovedPractice } from "./auto";
import { forgetDeferredApproval, pumpDeferredApprovals } from "./deferred-approvals";
import { tickQuestionDigest } from "./digest";
import { errorMessage } from "./errors";
import { fill } from "./fill";
import { defaultCheckpoint, endSession, ownsFill, stopFailedFill, type Browser, type FillRuntime, type FillSession } from "./fill-session";
import { beginAttempt, dropManualLease, endVerification, isRecovering, isSubmitting, isVerifying, lastSlot, manualLeaseGate } from "./fill-state";
import { countOne, due, usedToday } from "./limits";
import { preferUsListings } from "./listings";
import { locateEmployerPostings, locatePerDay } from "./locate";
import { runWorker, type RunWorker } from "./omp";
import { needsJudgment, parsePracticeAssessment } from "./practice";
import { prep } from "./prep";
import { profileProblems } from "./profile";
import {
  cancelJobGates,
  clearQueuedQuestions,
  getOpenGate,
  manualLeases,
  parkGate,
  queueRecovery,
  readCheckpoint,
  recordCheckpoint,
  releaseManualLease,
  reserveManualLease,
  type FillCheckpoint,
} from "./questions";
import { scanSources } from "./scan";
import { FILL_STAGE, PARKED, to } from "./status";
import { trackMailbox } from "./track";

// The outside world a scheduler acts on. The defaults are the real agent runner and the real browsers.
export interface SchedulerDeps {
  runWorker: RunWorker;
  browser: Browser;
}

interface FillCandidate {
  job: Job;
  verify: boolean;
  recovering: boolean;
}
interface FillStart {
  job: Job;
  checkpoint: FillCheckpoint | null;
  // A new application, not one already started: only these count toward limits.applyPerDay.
  isNew: boolean;
}

const employerOf = (job: Job) => job.company_key ?? job.company;

// Jobs a fill worker could be started for, in the order they should be tried: verification of an
// ambiguous submit first, then draft recovery, then jobs with a saved draft, then oldest.
function fillQueue(): FillCandidate[] {
  const rank = (c: FillCandidate) => (c.verify ? 4 : 0) + (c.recovering ? 2 : 0) + (c.job.fill_checkpoint === null ? 0 : 1);
  return jobsInStatuses(["approved", "needs_manual"])
    .map(job => ({ job, verify: isVerifying(job.id), recovering: isRecovering(job.id) }))
    .filter(c => c.job.status === "approved" || c.verify)
    .sort((a, b) => rank(b) - rank(a) || a.job.id - b.job.id);
}

// Auto-approvals waiting for a browser are held to the rules as they stand now, before one is spent
// on them: the rules may have changed since prep approved the job. One whose stored assessment only
// lacks a judgment the rules now ask for goes back to prep to get it; any other that no longer
// qualifies is held for the user. Applications already started are left to the check at fill start.
export function reviewStandingApprovals() {
  for (const job of jobsByStatus("approved")) {
    if (job.approved_by !== "auto" || job.resume_sha || job.fill_checkpoint) continue;
    const guard = checkAutoApprovedPractice(job);
    if (guard.ok) continue;
    forgetDeferredApproval(job.id);
    if (needsJudgment(parsePracticeAssessment(job.practice_assessment))) {
      updateJob(job.id, { ...to.triaged("assessing again: the practice rules now judge the employer, not the pay or location"), approved_by: null });
      logEvent("auto", "Auto-approval withdrawn for a fresh assessment under the current practice rules", job.id);
    } else {
      updateJob(job.id, { ...to.held(`needs your review: ${guard.reason ?? "no longer a practice job"}`), approved_by: null });
      logEvent("auto", `Auto-approval withdrawn and job held: ${guard.reason ?? "no longer a practice job"}`, job.id);
    }
  }
}

// How long agents' step-by-step records are kept when config.yml does not say.
const CHATTER_DAYS = 30;
// Once a day, drop the step-by-step records that have aged out.
function pruneOldChatter() {
  if (!due("last.prune", 24 * 60)) return;
  kvSet("last.prune", new Date().toISOString());
  const days = config.retention?.chatterDays ?? CHATTER_DAYS;
  const removed = pruneChatter(days);
  if (removed) logEvent("system", `Removed ${removed} agent step records older than ${days} days`);
}

// What a restart finds in the fill stage. Open gates remain parked; answered gates remain queued. A
// marker is never cleared by startup, generic retry, or the act of requesting approval.
function recoverInterruptedFills() {
  for (const j of jobsInStatuses(FILL_STAGE)) {
    const checkpoint = readCheckpoint(j.id) ?? defaultCheckpoint(j, lastSlot(j.id) ?? 0);
    const gate = getOpenGate(j.id);
    if (isSubmitting(j.id)) {
      endVerification(j.id);
      if (gate?.kind !== "submission_ambiguous")
        parkGate(
          j.id,
          {
            kind: "submission_ambiguous",
            text: "Restart after final submission authorization. Inspect the exact application and mailbox; explicitly mark submitted, confirmed not submitted, or reject.",
          },
          checkpoint,
        );
    } else if (gate) {
      if (!readCheckpoint(j.id)) recordCheckpoint(j.id, checkpoint);
    } else if (j.status === "filling") {
      recordCheckpoint(j.id, checkpoint);
      updateJob(j.id, to.resumeFill("Recovering the same interrupted draft after restart"));
      logEvent("system", "Interrupted fill queued for exact draft recovery with frozen resume", j.id);
    } else if (PARKED.includes(j.status)) {
      parkGate(j.id, { kind: "manual", text: "Interrupted wait has no recoverable gate. Inspect the exact draft before returning control." }, checkpoint);
    }
  }
}

export class Scheduler {
  private readonly run: RunWorker;
  private readonly rt: FillRuntime;
  private readonly running = new Set<string>();
  private prepActive = 0;
  // One application per browser: filling[n] is the job in browser n. A browser rests between applications,
  // and no two applications start close together. Both times are kept across restarts.
  private readonly filling: (FillSession | null)[];
  private readonly restUntil: number[];
  private nextFillAt: number;
  // Activation is asynchronous; keep ownership even if the gate is resolved meanwhile.
  private readonly manualActivations = new Map<number, number>();

  constructor(deps: Partial<SchedulerDeps> = {}) {
    this.run = deps.runWorker ?? runWorker;
    this.rt = { sessions: new Map(), runWorker: this.run, browser: deps.browser ?? chrome };
    this.filling = Array.from({ length: browserCount() }, () => null);
    this.restUntil = this.filling.map((_, slot) => Number(kvGet(`fill.rest.${slot}`) ?? 0));
    this.nextFillAt = Number(kvGet("fill.nextAt") ?? 0);
  }

  // ---- workers that run one at a time

  isRunning(name: string) {
    return this.running.has(name);
  }

  private async exclusive(name: string, fn: () => Promise<void>) {
    if (this.running.has(name)) return;
    this.running.add(name);
    try {
      await fn();
    } catch (err) {
      logEvent("error", `${name}: ${errorMessage(err)}`);
    } finally {
      this.running.delete(name);
    }
  }

  scan(opts: { discover?: boolean } = {}) {
    return this.exclusive("scan", async () => {
      await scanSources(this.run, opts);
      this.pump();
    });
  }

  locate() {
    return this.exclusive("locate", async () => {
      await locateEmployerPostings(this.run);
      this.pump();
    });
  }

  track() {
    return this.exclusive("track", () => trackMailbox(this.run));
  }

  // ---- fill sessions and the browsers they hold

  abortFill(jobId: number) {
    const session = this.rt.sessions.get(jobId);
    if (session) endSession(session);
    cancelJobGates(jobId);
  }

  activeFillSession(jobId: number): boolean {
    return this.rt.sessions.has(jobId);
  }

  manualBrowserReserved(jobId: number): boolean {
    for (const [slot, owner] of manualLeases()) if (owner === jobId && !this.manualActivations.has(slot)) return true;
    return false;
  }

  // A live link is valid only while this job owns the browser, not merely because it used it once.
  fillSlot(jobId: number): number | null {
    const session = this.rt.sessions.get(jobId);
    if (session && ownsFill(this.rt, session)) return session.slot;
    for (const [slot, owner] of manualLeases()) if (owner === jobId && !this.manualActivations.has(slot)) return slot;
    return null;
  }

  // Jobs whose employer account is in use: by a current worker, or by a person inspecting a browser.
  private busyOwners(leases: Map<number, number>) {
    return [...this.rt.sessions.keys(), ...leases.values(), ...this.manualActivations.values()];
  }

  async reserveBrowser(jobId: number, gateId: string): Promise<void> {
    const job = getJob(jobId);
    const checkpoint = readCheckpoint(jobId);
    if (!job || !checkpoint?.tabId || checkpoint.slot >= this.filling.length) throw new Error("No usable saved browser; request application recovery instead");
    const { slot, tabId } = checkpoint;
    if (this.filling[slot] || this.manualActivations.has(slot)) throw new Error("This browser is busy; wait for its current worker to stop");
    for (const owner of this.busyOwners(manualLeases())) {
      if (owner === jobId) continue;
      const other = getJob(owner);
      if (other && employerOf(other) === employerOf(job)) throw new Error("Another application is currently using this employer account");
    }
    this.manualActivations.set(slot, jobId);
    let activated = false;
    try {
      reserveManualLease(jobId, gateId);
      await this.rt.browser.activateApplicationTab(slot, tabId);
      if (getOpenGate(jobId)?.id !== gateId || manualLeaseGate(jobId) !== gateId || readCheckpoint(jobId)?.tabId !== tabId)
        throw new Error("This handoff changed while opening its browser");
      activated = true;
    } finally {
      if (!activated) dropManualLease(jobId, gateId);
      this.manualActivations.delete(slot);
      notifyJobChange(jobId);
      this.pump();
    }
  }

  releaseBrowser(jobId: number, gateId: string): void {
    if ([...this.manualActivations.values()].includes(jobId)) throw new Error("Browser inspection is still opening");
    releaseManualLease(jobId, gateId);
    this.pump();
  }

  scheduleRecovery(jobId: number, gateId: string): void {
    if (this.activeFillSession(jobId)) throw new Error("An active worker is already running for this application");
    queueRecovery(jobId, gateId);
    this.pump();
  }

  // ---- starting work

  // Start whatever work is waiting. Safe to call any time state changes.
  pump() {
    if (!this.isRunning("locate") && usedToday("locate") < locatePerDay() && jobsByStatus("locating", 1).length) void this.locate();
    if (profileProblems().length === 0) {
      pumpDeferredApprovals();
      while (this.prepActive < config.concurrency.prep && usedToday("prep") < config.limits.prepPerDay) {
        const job = nextToPrep();
        if (!job) break;
        this.startPrep(job);
      }
    }
    const leases = manualLeases();
    let queue: FillCandidate[] | undefined;
    for (let slot = 0; slot < this.filling.length; slot++) {
      if (this.filling[slot] || leases.has(slot) || this.manualActivations.has(slot) || Date.now() < Math.max(this.nextFillAt, this.restUntil[slot] ?? 0))
        continue;
      const next = this.pickFill(slot, (queue ??= fillQueue()), leases);
      if (next) this.startFill(slot, next);
    }
  }

  private startPrep(job: Job) {
    this.prepActive++;
    countOne("prep");
    updateJob(job.id, to.prepping());
    void prep(job, this.run)
      .catch((err: unknown) => {
        if (getJob(job.id)?.status === "prepping") updateJob(job.id, to.failed(`prep: ${errorMessage(err)}`));
      })
      .finally(() => {
        this.prepActive--;
        this.pump();
      });
  }

  // The first queued job that browser `slot` can take now.
  private pickFill(slot: number, queue: FillCandidate[], leases: Map<number, number>): FillStart | null {
    // Only current workers and explicit human inspection own employer sessions.
    const employers = new Set<string>();
    for (const owner of this.busyOwners(leases)) {
      const activeJob = getJob(owner);
      if (activeJob) employers.add(employerOf(activeJob));
    }
    // Recovery is priority, not ownership: skipped candidates cannot block the slot.
    // Multiple parked/recovering applications may share a persistent profile.
    for (const { job: candidate, verify } of queue) {
      if (this.rt.sessions.has(candidate.id) || employers.has(employerOf(candidate)) || getOpenGate(candidate.id)) continue;
      const saved = readCheckpoint(candidate.id);
      // Resuming an application already started finishes work the cap was spent on; it does not wait for tomorrow's.
      const isNew = !verify && !saved && !candidate.resume_sha;
      if (isNew && usedToday("fill") >= config.limits.applyPerDay) continue;
      if (saved ? saved.slot !== slot : candidate.resume_sha && lastSlot(candidate.id) !== slot) continue;
      return { job: candidate, checkpoint: saved, isNew };
    }
    return null;
  }

  private startFill(slot: number, { job, checkpoint, isNew }: FillStart) {
    const [min, max] = config.fillPauseSeconds;
    const session: FillSession = { jobId: job.id, slot, active: true, checkpoint: checkpoint ?? defaultCheckpoint(job, slot) };
    this.filling[slot] = session;
    this.rt.sessions.set(job.id, session);
    beginAttempt(job.id);
    clearQueuedQuestions(job.id);
    if (isNew) countOne("fill");
    this.nextFillAt = Date.now() + min * 1000;
    kvSet("fill.nextAt", String(this.nextFillAt));
    fill(this.rt, job, session)
      .catch(async (err: unknown) => {
        stopFailedFill(this.rt, session, `fill: ${errorMessage(err)}`);
        // A thrown callback cannot free a still-running worker's slot.
        if (session.handle) {
          session.handle.abort();
          await session.handle.done;
        }
      })
      .finally(() => {
        session.browser?.close();
        if (this.rt.sessions.get(job.id) === session) this.rt.sessions.delete(job.id);
        if (this.filling[slot] !== session) return;
        this.filling[slot] = null;
        this.restUntil[slot] = Date.now() + (min + Math.random() * (max - min)) * 1000;
        kvSet(`fill.rest.${slot}`, String(this.restUntil[slot]));
        this.pump();
      });
  }

  // Puts right what a restart interrupted, then keeps the schedule.
  start() {
    dedupeExisting();
    preferUsListings();
    requeueInterruptedPrep();
    recoverInterruptedFills();
    reviewStandingApprovals();
    const tick = () => {
      if (due("last.scan", config.schedule.scanMinutes) && !profileProblems(["targets.md"]).length)
        void this.scan({ discover: due("last.discover", config.schedule.discoverMinutes) });
      if (due("last.track", config.schedule.trackMinutes) && !kvGet("last.track.attempt")?.startsWith(new Date().toISOString().slice(0, 13))) {
        kvSet("last.track.attempt", new Date().toISOString());
        void this.track();
      }
      pruneOldChatter();
      void tickQuestionDigest().catch((err: unknown) => {
        logEvent("error", `Question digest: ${errorMessage(err)}`);
      });
      this.pump();
    };
    setInterval(tick, 30_000);
    tick();
  }
}
