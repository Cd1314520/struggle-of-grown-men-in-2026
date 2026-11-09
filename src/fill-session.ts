import { join } from "node:path";
import { confirmsSubmit } from "./auto";
import { recordBlocker, type BlockerCause } from "./blockers";
import type * as chrome from "./chrome";
import type { JobBrowser } from "./chrome";
import { jobDir } from "./config";
import { getJob, logEvent, type Job } from "./db";
import { errorMessage } from "./errors";
import { authorizeSubmit, isSubmitting } from "./fill-state";
import { S, type RunWorker, type WorkerHandle } from "./worker";
import { consumeSubmitApproval, parkGate, recordCheckpoint, type FillCheckpoint, type GateInput } from "./questions";
import { frozenResume } from "./resume";

export interface FillSession {
  jobId: number;
  slot: number;
  active: boolean;
  handle?: WorkerHandle;
  browser?: JobBrowser;
  checkpoint: FillCheckpoint;
}

export type Browser = Pick<typeof chrome, "ensureChrome" | "pruneTabs" | "prepareJobBrowser" | "tabs" | "screenshot" | "activateApplicationTab">;

export interface FillRuntime {
  sessions: Map<number, FillSession>;
  runWorker: RunWorker;
  browser: Browser;
}

export function endSession(session: FillSession) {
  session.active = false;
  session.browser?.revoke();
  session.handle?.abort();
}

export function ownsFill(rt: FillRuntime, session: FillSession) {
  return session.active && rt.sessions.get(session.jobId) === session && getJob(session.jobId)?.status === "filling";
}

export function defaultCheckpoint(job: Job, slot: number): FillCheckpoint {
  return {
    version: 1,
    slot,
    tabId: null,
    url: null,
    step: "recover exact application",
    notes: "",
    resumeSha: job.resume_sha,
    savedAt: new Date().toISOString(),
  };
}

export const navigationFields = {
  tab_id: S.str("Exact CDP tab id from the current browser; not a tab nickname"),
  url: S.str("Current application URL, without credentials, tokens, or personal data"),
  step: S.str("Current form step and exact requisition identity"),
  notes: S.str("Draft recovery/navigation evidence only; no credentials or answer values"),
};

export async function checkpointFrom(rt: FillRuntime, session: FillSession, args: Record<string, unknown>): Promise<FillCheckpoint> {
  for (const key of Object.keys(navigationFields)) {
    const value = args[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`checkpoint ${key} is required`);
  }
  if (!ownsFill(rt, session)) throw new Error("stale fill worker");
  if (!session.browser?.ownsTarget(String(args["tab_id"]))) throw new Error("checkpoint tab is outside this application's browser scope");
  const tab = (await rt.browser.tabs(session.slot)).find(t => t.id === String(args["tab_id"]));
  if (!tab) throw new Error("current application tab id not found; re-observe before parking");
  const url = new URL(String(args["url"]));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error("checkpoint URL must omit credentials, query strings and fragments");
  const observed = new URL(tab.url);
  if (url.origin !== observed.origin || url.pathname !== observed.pathname) throw new Error("checkpoint URL does not match the current application tab");
  if (!ownsFill(rt, session)) throw new Error("stale fill worker");
  const checkpoint: FillCheckpoint = {
    version: 1,
    slot: session.slot,
    tabId: tab.id,
    url: url.href,
    step: String(args["step"]),
    notes: String(args["notes"]),
    resumeSha: session.checkpoint.resumeSha,
    savedAt: new Date().toISOString(),
  };
  session.checkpoint = checkpoint;
  recordCheckpoint(session.jobId, checkpoint);
  return checkpoint;
}

export async function parkFill(rt: FillRuntime, session: FillSession, input: GateInput, checkpoint = session.checkpoint): Promise<string> {
  if (!ownsFill(rt, session)) throw new Error("stale fill worker");
  const shot = checkpoint.tabId ? await rt.browser.screenshot(session.slot, checkpoint.tabId).catch(() => null) : null;
  if (!ownsFill(rt, session)) throw new Error("stale fill worker");
  if (shot) await Bun.write(join(jobDir(session.jobId), "gate.png"), shot);
  if (!ownsFill(rt, session)) throw new Error("stale fill worker");
  if (isSubmitting(session.jobId)) {
    const reason = input.text.trim();
    input = {
      kind: "submission_ambiguous",
      text: reason
        ? `Final submission was authorized (${reason}). Inspect the exact application before resolving it; do not retry.`
        : "Final submission was authorized. Inspect the exact application before resolving it; do not retry.",
      context: input.context || input.text,
    };
  }
  parkGate(session.jobId, { ...input, shot: shot ? Date.now() : null }, checkpoint);
  endSession(session);
  logEvent("gate", `${input.kind}: ${input.text}`, session.jobId, "fill");
  await session.handle?.done;
  return "PARKED. This worker has exited.";
}

export async function confirmSubmission(rt: FillRuntime, session: FillSession, summary: string): Promise<string> {
  const jobId = session.jobId;
  const job = getJob(jobId);
  if (!job || !ownsFill(rt, session)) return "ERROR: no current fill worker.";
  if (isSubmitting(jobId))
    return parkFill(rt, session, { kind: "submission_ambiguous", text: "Submission already authorized; inspect before any further submit attempt." });
  try {
    if (!job.resume_sha || frozenResume(jobId, job.resume_sha).sha !== session.checkpoint.resumeSha) throw new Error("frozen resume identity changed");
  } catch (err) {
    return parkFill(rt, session, { kind: "manual", text: `Frozen resume verification failed; do not submit. ${errorMessage(err)}` });
  }
  if (!confirmsSubmit(job) || consumeSubmitApproval(jobId, summary)) {
    authorizeSubmit(jobId);
    logEvent("auto", `Final submission authorized after re-observation: ${summary}`, jobId, "fill");
    return "APPROVED. Click the final submit button now and see the application through to the site's confirmation. Submit again when the site says it is not submitted yet; do not when you cannot tell.";
  }
  return parkFill(rt, session, { kind: "confirm_submit", text: summary });
}

export function stopFailedFill(rt: FillRuntime, session: FillSession, message: string, cause: BlockerCause = "unknown") {
  if (!ownsFill(rt, session)) return;
  recordBlocker(session.jobId, cause, message);
  const ambiguous = isSubmitting(session.jobId);
  parkGate(
    session.jobId,
    {
      kind: ambiguous ? "submission_ambiguous" : "manual",
      text: ambiguous
        ? `Final submission may have happened. Inspect this application and mailbox; never retry without confirmed-not-submitted resolution. ${message}`
        : `Fill stopped. Inspect/recover the exact draft before returning browser control. ${message}`,
    },
    session.checkpoint,
  );
  endSession(session);
}
