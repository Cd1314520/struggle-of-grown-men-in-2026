import * as chrome from "./chrome";
import { browserCount, config, describing } from "./config";
import {
  dedupeExisting,
  employerApplications,
  getJob,
  jobsByStatus,
  jobsInStatuses,
  kvGet,
  kvSet,
  logEvent,
  moveJob,
  nextToPrep,
  openedAt,
  notifyJobChange,
  pruneChatter,
  requeueInterruptedPrep,
  type Job,
} from "./db";
import { autoApply, checkAutoApprovedPractice, employerCapNote } from "./auto";
import { jobBlockers, type BlockerCause } from "./blockers";
import { forgetDeferredApproval, pumpDeferredApprovals } from "./deferred-approvals";
import { tickQuestionDigest } from "./digest";
import { errorMessage, isCapacityError } from "./errors";
import { fill } from "./fill";
import { defaultCheckpoint, endSession, ownsFill, stopFailedFill, type Browser, type FillRuntime, type FillSession } from "./fill-session";
import { beginAttempt, dropManualLease, fillPhase, isRecovering, isSubmitting, isVerifying, lastSlot, manualLeaseGate, markAmbiguous } from "./fill-state";
import { backedOff, backOff, clearBackoff, countOne, due, usedToday } from "./limits";
import { preferUsListings } from "./listings";
import { locateEmployerPostings, locatePerDay } from "./locate";
import { runWorker, type RunWorker } from "./worker";
import { needsJudgment, parsePracticeAssessment } from "./practice";
import { prep } from "./prep";
import { profileProblems } from "./profile";
import { bankDue, fileKeptAnswers } from "./answer-bank";
import { recheckDue, recheckOpenQuestions } from "./recheck";
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
import { interruptedImport, runImport, type ImportRun } from "./resume-import";
import { scanSources } from "./scan";
import { applicationStarted, FILL_STAGE, PARKED, to } from "./status";
import { trackMailbox } from "./track";

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
  isNew: boolean;
}

const employerOf = (job: Job) => job.company_key ?? job.company;

const FRESH_MS = 24 * 3600_000;
const isFresh = (job: Job) => Date.now() - openedAt(job) < FRESH_MS;
function newApplicationGap(): number {
  const hours = config.limits.applySpreadHours ?? 24;
  const cap = config.limits.applyPerDay;
  return hours > 0 && cap > 0 ? (hours * 3600_000) / cap : 0;
}

function employersWithOpenApplication(): Set<string> {
  const open = new Set<string>();
  for (const job of jobsInStatuses(["approved", "filling", ...PARKED])) if (job.status !== "approved" || applicationStarted(job)) open.add(employerOf(job));
  return open;
}

function watchCapacity(run: RunWorker): RunWorker {
  return options => {
    const handle = run(options);
    void handle.done.then(result => {
      if (result.status === "completed" && !result.error) clearBackoff();
      else if (isCapacityError(result.error)) {
        const until = backOff();
        if (until) logEvent("system", `Model provider at capacity (${options.name} worker): no new agent work until ${new Date(until).toISOString()}`);
      }
    });
    return handle;
  };
}

function requeueCapacityFailures() {
  let requeued = 0;
  for (const job of jobsByStatus("failed", 100_000))
    if (
      job.note?.startsWith("prep did not finish") &&
      isCapacityError(job.note) &&
      moveJob(job.id, "failed", to.triaged("assessing again: the model provider was at capacity"))
    )
      requeued++;
  if (requeued) logEvent("system", `Requeued ${requeued} assessments the model provider refused for capacity`);
}

function recoverCapacityHandoffs() {
  for (const job of jobsByStatus("needs_manual")) {
    const gate = getOpenGate(job.id);
    if (gate?.kind !== "manual" || !isCapacityError(gate.text) || isSubmitting(job.id) || !readCheckpoint(job.id)) continue;
    queueRecovery(job.id, gate.id);
    logEvent("system", "Fill stopped by model provider capacity: resuming the same draft", job.id);
  }
}

const RETRIED: Partial<Record<BlockerCause, { afterMs: number; tries: number }>> = {
  browser: { afterMs: 0, tries: 1 },
  site_down: { afterMs: 3 * 60 * 60 * 1000, tries: 2 },
};
export function retryPassingHandoffs() {
  for (const job of jobsByStatus("needs_manual")) {
    const gate = getOpenGate(job.id);
    if (gate?.kind !== "manual" || isSubmitting(job.id) || manualLeaseGate(job.id) || !readCheckpoint(job.id)) continue;
    const blockers = jobBlockers(job.id);
    const last = blockers.at(-1);
    const rule = last && RETRIED[last.cause];
    if (!last || !rule || last.gate_id !== gate.id) continue;
    const parkedAt = Date.parse(gate.createdAt);
    const tried = blockers.filter(b => b.cause === last.cause).length - 1;
    if (tried >= rule.tries || Date.now() - parkedAt < rule.afterMs) continue;
    try {
      queueRecovery(job.id, gate.id);
      logEvent("system", `Stopped by ${last.cause.replace("_", " ")}: retrying the same draft (try ${tried + 1} of ${rule.tries})`, job.id);
    } catch (err) {
      logEvent("error", `Automatic retry: ${errorMessage(err)}`, job.id);
    }
  }
}

function fillQueue(): FillCandidate[] {
  const rank = (c: FillCandidate) => (c.verify ? 4 : 0) + (c.recovering ? 2 : 0) + (applicationStarted(c.job) ? 1 : 0);
  return jobsInStatuses(["approved", "needs_manual"])
    .map(job => ({ job, verify: isVerifying(job.id), recovering: isRecovering(job.id) }))
    .filter(c => c.job.status === "approved" || c.verify)
    .sort((a, b) => rank(b) - rank(a) || openedAt(b.job) - openedAt(a.job) || a.job.id - b.job.id);
}

export function reviewStandingApprovals() {
  for (const job of jobsByStatus("approved")) {
    if (job.approved_by !== "auto" || applicationStarted(job)) continue;
    const guard = checkAutoApprovedPractice(job);
    if (guard.ok) continue;
    if (needsJudgment(parsePracticeAssessment(job.practice_assessment), describing())) {
      if (
        !moveJob(job.id, "approved", {
          ...to.triaged("assessing again: the practice rules now judge the employer, not the pay or location"),
          approved_by: null,
        })
      )
        continue;
      forgetDeferredApproval(job.id);
      logEvent("auto", "Auto-approval withdrawn for a fresh assessment under the current practice rules", job.id);
    } else {
      if (!moveJob(job.id, "approved", { ...to.held(`needs your review: ${guard.reason ?? "no longer a practice job"}`, "review"), approved_by: null }))
        continue;
      forgetDeferredApproval(job.id);
      logEvent("auto", `Auto-approval withdrawn and job held: ${guard.reason ?? "no longer a practice job"}`, job.id);
    }
  }
}

export function trimEmployerApprovals() {
  const queued = jobsByStatus("approved")
    .filter(job => job.approved_by === "auto" && !applicationStarted(job))
    .sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || b.id - a.id);
  for (const job of queued) {
    const others = employerApplications(job);
    if (others < autoApply().perEmployer) continue;
    if (!moveJob(job.id, "approved", { ...to.awaitingApproval(`needs your review: ${employerCapNote(others)}`), approved_by: null })) continue;
    forgetDeferredApproval(job.id);
    logEvent("auto", `Auto-approval withdrawn: ${employerCapNote(others)}`, job.id);
  }
}

const CHATTER_DAYS = 30;
function pruneOldChatter() {
  if (!due("last.prune", 24 * 60)) return;
  kvSet("last.prune", new Date().toISOString());
  const days = config.retention?.chatterDays ?? CHATTER_DAYS;
  const removed = pruneChatter(days);
  if (removed) logEvent("system", `Removed ${removed} agent step records older than ${days} days`);
}

function recoverInterruptedFills() {
  for (const j of jobsInStatuses(FILL_STAGE)) {
    if (fillPhase(j.id) === "verify_queued") continue;
    const checkpoint = readCheckpoint(j.id) ?? defaultCheckpoint(j, lastSlot(j.id) ?? 0);
    const gate = getOpenGate(j.id);
    if (isSubmitting(j.id)) {
      markAmbiguous(j.id);
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
      if (moveJob(j.id, "filling", to.resumeFill("Recovering the same interrupted draft after restart")))
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
  private readonly filling: (FillSession | null)[];
  private readonly restUntil: number[];
  private nextFillAt: number;
  private nextNewAt: number;
  private readonly manualActivations = new Map<number, number>();
  private importRun: ImportRun | null = null;
  private tickTimer: Timer | null = null;

  constructor(deps: Partial<SchedulerDeps> = {}) {
    this.run = watchCapacity(deps.runWorker ?? runWorker);
    this.rt = { sessions: new Map(), runWorker: this.run, browser: deps.browser ?? chrome };
    this.filling = Array.from({ length: browserCount() }, () => null);
    this.restUntil = this.filling.map((_, slot) => Number(kvGet(`fill.rest.${slot}`) ?? 0));
    this.nextFillAt = Number(kvGet("fill.nextAt") ?? 0);
    this.nextNewAt = Number(kvGet("fill.nextNewAt") ?? 0);
  }

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

  recheck() {
    return this.exclusive("recheck", async () => {
      const filed = bankDue() && (await fileKeptAnswers(this.run));
      if (filed || recheckDue()) await recheckOpenQuestions(this.run);
      this.pump();
    });
  }

  importResume() {
    return this.exclusive("import", async () => {
      const control: ImportRun = { handle: null, cancelled: false };
      this.importRun = control;
      try {
        await runImport(this.run, control);
      } finally {
        this.importRun = null;
      }
    });
  }

  cancelImport(): boolean {
    if (!this.importRun?.handle) return false;
    this.importRun.cancelled = true;
    this.importRun.handle.abort("import cancelled");
    return true;
  }

  abortFill(jobId: number, reason: string) {
    const session = this.rt.sessions.get(jobId);
    if (session) endSession(session, reason);
    cancelJobGates(jobId);
  }

  activeFillSession(jobId: number): boolean {
    return this.rt.sessions.has(jobId);
  }

  manualBrowserReserved(jobId: number): boolean {
    for (const [slot, owner] of manualLeases()) if (owner === jobId && !this.manualActivations.has(slot)) return true;
    return false;
  }

  fillSlot(jobId: number): number | null {
    const session = this.rt.sessions.get(jobId);
    if (session && ownsFill(this.rt, session)) return session.slot;
    for (const [slot, owner] of manualLeases()) if (owner === jobId && !this.manualActivations.has(slot)) return slot;
    return null;
  }

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

  pump() {
    if (backedOff()) return;
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
    let started: Set<string> | undefined;
    for (let slot = 0; slot < this.filling.length; slot++) {
      if (this.filling[slot] || leases.has(slot) || this.manualActivations.has(slot) || Date.now() < Math.max(this.nextFillAt, this.restUntil[slot] ?? 0))
        continue;
      const next = this.pickFill(slot, (queue ??= fillQueue()), leases, (started ??= employersWithOpenApplication()));
      if (next) this.startFill(slot, next);
    }
  }

  private startPrep(job: Job) {
    if (!moveJob(job.id, "triaged", to.prepping())) return;
    this.prepActive++;
    countOne("prep");
    void prep(job, this.run)
      .catch((err: unknown) => {
        moveJob(job.id, "prepping", to.failed(`prep: ${errorMessage(err)}`));
      })
      .finally(() => {
        this.prepActive--;
        this.pump();
      });
  }

  private pickFill(slot: number, queue: FillCandidate[], leases: Map<number, number>, started: Set<string>): FillStart | null {
    const employers = new Set<string>();
    for (const owner of this.busyOwners(leases)) {
      const activeJob = getJob(owner);
      if (activeJob) employers.add(employerOf(activeJob));
    }
    for (const { job: candidate, verify } of queue) {
      if (this.rt.sessions.has(candidate.id) || employers.has(employerOf(candidate)) || getOpenGate(candidate.id)) continue;
      const saved = readCheckpoint(candidate.id);
      const isNew = !verify && !saved && !applicationStarted(candidate);
      if (
        isNew &&
        (usedToday("fill") >= config.limits.applyPerDay || (Date.now() < this.nextNewAt && !isFresh(candidate)) || started.has(employerOf(candidate)))
      )
        continue;
      if (saved ? saved.slot !== slot : applicationStarted(candidate) && lastSlot(candidate.id) !== slot) continue;
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
    if (isNew) {
      countOne("fill");
      this.nextNewAt = Date.now() + newApplicationGap();
      kvSet("fill.nextNewAt", String(this.nextNewAt));
    }
    this.nextFillAt = Date.now() + min * 1000;
    kvSet("fill.nextAt", String(this.nextFillAt));
    fill(this.rt, job, session)
      .catch(async (err: unknown) => {
        stopFailedFill(this.rt, session, `fill: ${errorMessage(err)}`);
        if (session.handle) {
          session.handle.abort("fill crashed; parked for manual recovery");
          await session.handle.done;
        }
      })
      .finally(() => {
        try {
          try {
            session.browser?.close();
          } catch (err) {
            logEvent("error", `fill: closing the browser failed: ${errorMessage(err)}`, job.id);
          }
          if (this.rt.sessions.get(job.id) === session) this.rt.sessions.delete(job.id);
          if (this.filling[slot] === session) {
            this.filling[slot] = null;
            this.restUntil[slot] = Date.now() + (min + Math.random() * (max - min)) * 1000;
            kvSet(`fill.rest.${slot}`, String(this.restUntil[slot]));
          }
        } finally {
          this.pump();
        }
      });
  }

  start() {
    if (this.tickTimer) return;
    interruptedImport();
    dedupeExisting();
    preferUsListings();
    requeueInterruptedPrep();
    requeueCapacityFailures();
    recoverInterruptedFills();
    recoverCapacityHandoffs();
    reviewStandingApprovals();
    trimEmployerApprovals();
    let digestError: string | null = null;
    const tick = () => {
      pruneOldChatter();
      void tickQuestionDigest().then(
        () => (digestError = null),
        (err: unknown) => {
          const msg = `Question digest: ${errorMessage(err)}`;
          if (msg !== digestError) logEvent("error", msg);
          digestError = msg;
        },
      );
      if (backedOff()) return;
      if (due("last.scan", config.schedule.scanMinutes) && !profileProblems(["targets.md"]).length)
        void this.scan({ discover: due("last.discover", config.schedule.discoverMinutes) });
      if (due("last.track", config.schedule.trackMinutes) && !kvGet("last.track.attempt")?.startsWith(new Date().toISOString().slice(0, 13))) {
        kvSet("last.track.attempt", new Date().toISOString());
        void this.track();
      }
      if (!this.isRunning("recheck") && !profileProblems().length && (bankDue() || recheckDue())) void this.recheck();
      retryPassingHandoffs();
      this.pump();
    };
    this.tickTimer = setInterval(tick, 30_000);
    tick();
  }

  stop() {
    if (!this.tickTimer) return;
    clearInterval(this.tickTimer);
    this.tickTimer = null;
  }
}
