// The scheduler: what runs when. It holds everything that is only true while this process is up (which
// workers are running, which job has which browser) and starts whatever work is waiting. The workers
// themselves live in scan.ts, locate.ts, prep.ts, fill.ts and track.ts.
import * as chrome from "./chrome";
import { browserCount, config, describing } from "./config";
import {
  db,
  dedupeExisting,
  getJob,
  jobsByStatus,
  jobsInStatuses,
  kvGet,
  kvSet,
  logEvent,
  moveJob,
  openedAt,
  notifyJobChange,
  pruneChatter,
  requeueInterruptedPrep,
  type Job,
} from "./db";
import { checkAutoApprovedPractice, employerHold } from "./auto";
import { jobBlockers, type BlockerCause } from "./blockers";
import { deferApproval, forgetDeferredApproval, pumpDeferredApprovals } from "./deferred-approvals";
import { tickQuestionDigest } from "./digest";
import { errorMessage, isCapacityError, limitResetsAt } from "./errors";
import { fill } from "./fill";
import { defaultCheckpoint, endSession, ownsFill, stopFailedFill, type Browser, type FillRuntime, type FillSession } from "./fill-session";
import {
  beginAttempt,
  dropManualLease,
  fillPhase,
  isRecovering,
  isSubmitting,
  isVerifying,
  lastSlot,
  manualLeaseGate,
  markAmbiguous,
  resetFillPhase,
} from "./fill-state";
import { backedOff, backOff, clearBackoff, countOne, due, usedToday } from "./limits";
import { briefInterviews } from "./interview-prep";
import { preferUsListings } from "./listings";
import { locateEmployerPostings, locatePerDay } from "./locate";
import { runWorker, stageOf, type RunWorker } from "./worker";
import { needsJudgment, parsePracticeAssessment } from "./practice";
import { prep } from "./prep";
import { hitLimit, providerOf, withFallback } from "./providers";
import { nextToPrep } from "./priority";
import { profileProblems } from "./profile";
import { bankDue, fileKeptAnswers } from "./answer-bank";
import { writePrepNote } from "./interview";
import type { Step } from "./steps";
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
  verificationsTried,
  type FillCheckpoint,
  type Gate,
} from "./questions";
import { interruptedImport, runImport, type ImportRun } from "./resume-import";
import { scanSources } from "./scan";
import { applicationStarted, FILL_STAGE, PARKED, to } from "./status";
import { trackMailbox } from "./track";
import { gmailStatus } from "./gmail";
import { syncReferralMail } from "./outreach";
import { syncOutreachMail } from "./outreach-leads-api";
import { closeQuiet, runFollowUps, runScout, shouldFollowUp, shouldScout } from "./outreach-scout";
import { stepsNeedingBrief } from "./steps";

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

const REFERRAL_MAIL_MINUTES = 120;
// New applications are spread over limits.applySpreadHours instead of all starting when the daily
// cap resets: a posting found mid-day is applied to within the gap, and no site sees a burst.
// Resumes and verifications are not paced, and neither is a posting opened within FRESH_MS: the first
// hours are when an application counts, and the gap would hold a scan's batch of new ones for hours.
// Such a start still restarts the gap for the older postings behind it.
const FRESH_MS = 24 * 3600_000;
const isFresh = (job: Job) => Date.now() - openedAt(job) < FRESH_MS;
function newApplicationGap(): number {
  const hours = config.limits.applySpreadHours ?? 24;
  const cap = config.limits.applyPerDay;
  return hours > 0 && cap > 0 ? (hours * 3600_000) / cap : 0;
}

// Employers with an application that is started but not finished: parked on a question, a final
// review or a handoff, or queued to resume its draft. A new application to one of them waits for that
// one to finish, so one site's quirk or one unanswered question stalls a single application, not every
// role at the employer.
function employersWithOpenApplication(): Set<string> {
  const open = new Set<string>();
  for (const job of jobsInStatuses(["approved", "filling", ...PARKED])) if (job.status !== "approved" || applicationStarted(job)) open.add(employerOf(job));
  return open;
}

// Every worker's result says whether the provider that served it is taking work. A capacity refusal
// marks that provider (Codex, one Claude account, omp) out until the reset it names, or for 5 minutes
// (src/providers.ts). While another model or account in the stage's chain is not out it is no pause:
// the work moves there (withFallback, src/fill.ts). When every one is, the app waits for the first of
// them to come back.
function watchCapacity(run: RunWorker): RunWorker {
  return options => {
    const handle = run(options);
    void handle.done.then(result => {
      if (result.status === "completed" && !result.error) clearBackoff();
      else if (isCapacityError(result.error)) {
        const provider = providerOf(options.model, options.env);
        const resets = hitLimit(stageOf(options), options.model, provider, limitResetsAt(result.error));
        if (resets === null) {
          logEvent("system", `${provider} refused the ${options.name} worker for capacity: the next model or account takes the work`);
          return;
        }
        const until = backOff(resets);
        if (until) logEvent("system", `Model provider at capacity (${options.name} worker): no new agent work until ${new Date(until).toISOString()}`);
      }
    });
    return handle;
  };
}

// Assessments a capacity refusal ended before the back-off existed were marked failed; they never ran.
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

// Fill workers a capacity refusal stopped before final submit was authorized resume their drafts.
function recoverCapacityHandoffs() {
  for (const job of jobsByStatus("needs_manual")) {
    const gate = getOpenGate(job.id);
    if (gate?.kind !== "manual" || !isCapacityError(gate.text) || isSubmitting(job.id) || !readCheckpoint(job.id)) continue;
    queueRecovery(job.id, gate.id);
    logEvent("system", "Fill stopped by model provider capacity: resuming the same draft", job.id);
  }
}

// Hand-offs that a fresh try usually clears, and the wait before each try a job gets before the hand-off
// waits for the user: a browser that stopped taking input gets a new worker and tab at once and once more an
// hour later; an employer's site that was down gets another look a few hours later.
const HOUR = 60 * 60 * 1000;
const RETRIED: Partial<Record<BlockerCause, readonly number[]>> = {
  browser: [0, HOUR, 6 * HOUR],
  site_down: [3 * HOUR, 6 * HOUR, 12 * HOUR, 24 * HOUR],
  blocked: [24 * HOUR],
  unknown: [HOUR / 2, 3 * HOUR],
};
const GIVEN_UP: readonly BlockerCause[] = ["browser", "site_down", "unknown"];
const VERIFIED_AFTER = [HOUR / 2, 24 * HOUR];

function giveUp(job: Job, cause: BlockerCause, tries: number, detail: string) {
  const failed = db.transaction(() => {
    if (!moveJob(job.id, "needs_manual", to.failed(`gave up after ${tries} tries (${cause.replace("_", " ")}): ${detail}`), { quiet: true })) return false;
    cancelJobGates(job.id);
    resetFillPhase(job.id);
    return true;
  })();
  if (!failed) return;
  notifyJobChange(job.id);
  logEvent("system", `Stopped by ${cause.replace("_", " ")} on every retry: marked failed`, job.id);
}

function verifyAmbiguous(job: Job, gate: Gate) {
  if (fillPhase(job.id) !== "ambiguous") return;
  const tried = verificationsTried(job.id);
  const wait = VERIFIED_AFTER[tried];
  if (wait === undefined || Date.now() - Date.parse(gate.createdAt) < wait) return;
  try {
    queueRecovery(job.id, gate.id);
    logEvent("system", `Unclear whether it was sent: checking the site and mailbox (check ${tried + 1} of ${VERIFIED_AFTER.length})`, job.id);
  } catch (err) {
    logEvent("error", `Automatic verification: ${errorMessage(err)}`, job.id);
  }
}

export function retryPassingHandoffs() {
  for (const job of jobsByStatus("needs_manual")) {
    const gate = getOpenGate(job.id);
    if (!gate || manualLeaseGate(job.id) || !readCheckpoint(job.id)) continue;
    if (gate.kind === "submission_ambiguous") {
      verifyAmbiguous(job, gate);
      continue;
    }
    if (gate.kind !== "manual" || isSubmitting(job.id)) continue;
    // The worker records the cause just before it parks; a gate without its own blocker is not retried.
    const blockers = jobBlockers(job.id);
    const last = blockers.at(-1);
    const waits = last && RETRIED[last.cause];
    if (!last || !waits || last.gate_id !== gate.id) continue;
    const parkedAt = Date.parse(gate.createdAt);
    const tried = blockers.filter(b => b.cause === last.cause).length - 1;
    const wait = waits[tried];
    if (wait === undefined) {
      if (GIVEN_UP.includes(last.cause)) giveUp(job, last.cause, tried + 1, last.detail);
      continue;
    }
    if (Date.now() - parkedAt < wait) continue;
    try {
      queueRecovery(job.id, gate.id);
      logEvent("system", `Stopped by ${last.cause.replace("_", " ")}: retrying the same draft (try ${tried + 1} of ${waits.length})`, job.id);
    } catch (err) {
      logEvent("error", `Automatic retry: ${errorMessage(err)}`, job.id);
    }
  }
}

// Jobs a fill worker could be started for, in the order they should be tried: verification of an
// ambiguous submit first, then draft recovery, then jobs with a saved draft, then the most recently
// opened posting, as prep takes them: applying in its first hours matters most.
function fillQueue(): FillCandidate[] {
  const rank = (c: FillCandidate) => (c.verify ? 4 : 0) + (c.recovering ? 2 : 0) + (applicationStarted(c.job) ? 1 : 0);
  return jobsInStatuses(["approved", "needs_manual"])
    .map(job => ({ job, verify: isVerifying(job.id), recovering: isRecovering(job.id) }))
    .filter(c => c.job.status === "approved" || c.verify)
    .sort((a, b) => rank(b) - rank(a) || openedAt(b.job) - openedAt(a.job) || a.job.id - b.job.id);
}

// Auto-approvals waiting for a browser are held to the rules as they stand now, before one is spent
// on them: the rules may have changed since prep approved the job. One whose stored assessment only
// lacks a judgment the rules now ask for goes back to prep to get it; any other that no longer
// qualifies is held for the user. Applications already started are left to the check at fill start.
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

// Auto-approvals not yet started, past the employer's allowance (autoApply.perEmployer), go back to the
// user. Worst first, so when none has started it is the employer's best-scored role that stays.
export function trimEmployerApprovals() {
  const queued = jobsByStatus("approved")
    .filter(job => job.approved_by === "auto" && !applicationStarted(job))
    .sort((a, b) => (a.score ?? -1) - (b.score ?? -1) || b.id - a.id);
  for (const job of queued) {
    const hold = employerHold(job);
    if (!hold) continue;
    if (!moveJob(job.id, "approved", { ...to.awaitingApproval(`needs your review: ${hold}`), approved_by: null })) continue;
    deferApproval(job.id);
    logEvent("auto", `Auto-approval withdrawn: ${hold}`, job.id);
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
  // One application per browser: filling[n] is the job in browser n. A browser rests between applications,
  // and no two applications start close together. Both times are kept across restarts.
  private readonly filling: (FillSession | null)[];
  private readonly restUntil: number[];
  private nextFillAt: number;
  // When the next new application may start (see newApplicationGap). Kept across restarts.
  private nextNewAt: number;
  // Activation is asynchronous; keep ownership even if the gate is resolved meanwhile.
  private readonly manualActivations = new Map<number, number>();
  // The resume import under way, if any.
  private importRun: ImportRun | null = null;
  private tickTimer: Timer | null = null;

  constructor(deps: Partial<SchedulerDeps> = {}) {
    this.run = withFallback(watchCapacity(deps.runWorker ?? runWorker));
    this.rt = { sessions: new Map(), runWorker: this.run, browser: deps.browser ?? chrome };
    this.filling = Array.from({ length: browserCount() }, () => null);
    this.restUntil = this.filling.map((_, slot) => Number(kvGet(`fill.rest.${slot}`) ?? 0));
    this.nextFillAt = Number(kvGet("fill.nextAt") ?? 0);
    this.nextNewAt = Number(kvGet("fill.nextNewAt") ?? 0);
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

  // Early outreach's scout, now (the page's "Find leads now", or the tick when drafts run short).
  outreach() {
    return this.exclusive("outreach", () => runScout(this.run));
  }

  locate() {
    return this.exclusive("locate", async () => {
      await locateEmployerPostings(this.run);
      this.pump();
    });
  }

  async track() {
    await this.exclusive("track", () => trackMailbox(this.run));
    await this.interviewPrep();
  }

  interviewPrep() {
    if (backedOff() || !stepsNeedingBrief(1).length) return Promise.resolve();
    return this.exclusive("interview-prep", () => briefInterviews(this.run));
  }

  // Answers kept for the answer bank go into answers.md first, so the recheck answers what they now settle.
  recheck() {
    return this.exclusive("recheck", async () => {
      const filed = bankDue() && (await fileKeptAnswers(this.run));
      if (filed || recheckDue()) await recheckOpenQuestions(this.run);
      this.pump();
    });
  }

  // Turns the files readied by beginImport or reviseImport into a draft resume (src/resume-import.ts).
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

  // An interview prep note for one application, written in the background (src/interview.ts).
  // Returns what stopped it, or null once it has started.
  writePrepNote(job: Job, steps: readonly Step[]): string | null {
    return writePrepNote(this.run, job, steps);
  }

  // ---- fill sessions and the browsers they hold

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
      await this.rt.browser.showWindows?.(slot, true);
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
    const slot = [...manualLeases()].find(([, owner]) => owner === jobId)?.[0];
    releaseManualLease(jobId, gateId);
    if (slot !== undefined) void this.rt.browser.showWindows?.(slot, false);
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

  // The first queued job that browser `slot` can take now.
  private pickFill(slot: number, queue: FillCandidate[], leases: Map<number, number>, started: Set<string>): FillStart | null {
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
      const isNew = !verify && !saved && !applicationStarted(candidate);
      if (
        isNew &&
        (usedToday("fill") >= config.limits.applyPerDay || (Date.now() < this.nextNewAt && !isFresh(candidate)) || started.has(employerOf(candidate)))
      )
        continue;
      // A draft resumes in the browser profile that holds its site session. A profile beyond
      // concurrency.fill (lowered since the draft was parked) never opens again, so any browser takes it.
      const home = saved ? saved.slot : applicationStarted(candidate) ? lastSlot(candidate.id) : slot;
      if (home !== slot && (home === null || home < this.filling.length)) continue;
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
        // A thrown callback cannot free a still-running worker's slot.
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

  // Puts right what a restart interrupted, then keeps the schedule.
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
    // A digest that keeps failing the same way is logged once, not once a tick; Settings shows its last error.
    let digestError: string | null = null,
      referralError: string | null = null;
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
      // Scans end in triage, and tracking is an agent too: both wait out a capacity pause.
      if (backedOff()) return;
      if (due("last.scan", config.schedule.scanMinutes) && !profileProblems(["targets.md"]).length)
        void this.scan({ discover: due("last.discover", config.schedule.discoverMinutes) });
      if (due("last.track", config.schedule.trackMinutes) && !kvGet("last.track.attempt")?.startsWith(new Date().toISOString().slice(0, 13))) {
        kvSet("last.track.attempt", new Date().toISOString());
        void this.track();
      }
      if (!this.isRunning("recheck") && !profileProblems().length && (bankDue() || recheckDue())) void this.recheck();
      // Referral contacts: their news in the mailbox, read only, every two hours.
      if (gmailStatus().connected && due("last.referralMail", REFERRAL_MAIL_MINUTES)) {
        kvSet("last.referralMail", new Date().toISOString());
        void syncReferralMail().then(
          () => (referralError = null),
          (err: unknown) => {
            const msg = `Referral mail check: ${errorMessage(err)}`;
            if (msg !== referralError) logEvent("error", msg);
            referralError = msg;
          },
        );
      }
      // Early outreach replies, read only, every two hours like the referral check.
      if (gmailStatus().connected && due("last.outreachMail", REFERRAL_MAIL_MINUTES)) {
        kvSet("last.outreachMail", new Date().toISOString());
        void syncOutreachMail().catch((err: unknown) => {
          logEvent("error", `Outreach mail check: ${errorMessage(err)}`);
        });
      }
      // Early outreach: once a day, people followed up with no reply are closed as no response.
      if (due("last.outreachClose", 24 * 60)) {
        kvSet("last.outreachClose", new Date().toISOString());
        closeQuiet();
      }
      // Early outreach: the scout when drafts run short, and one follow-up run a day (src/outreach-scout.ts).
      if (!this.isRunning("outreach") && !profileProblems(["targets.md"]).length && shouldScout()) void this.outreach();
      if (!this.isRunning("outreach-followup") && shouldFollowUp()) void this.exclusive("outreach-followup", () => runFollowUps(this.run));
      if (!this.isRunning("interview-prep") && stepsNeedingBrief(1).length) void this.interviewPrep();
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
