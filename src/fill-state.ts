// Where one application stands between "approved" and a recorded outcome, beyond what jobs.status says.
// Every read and every transition of that state goes through here; nothing else touches the keys.
//
//   submitting  the final click was authorized and no outcome has been recorded since. While it is set,
//               nothing may submit, answer or retry: the application must be inspected first.
//   verifying   a verification-only worker is queued or running to settle a `submitting` application.
//               Only ever set together with `submitting`.
//   recovering  the next attempt resumes an existing draft and goes ahead of fresh applications.
//
// Kept in kv under the keys the first version used, so a database written by older code reads the same.
import { kvDelete, kvGet, kvSet } from "./db";

type Flag = "submitting" | "verify" | "recovery";
const key = (flag: Flag | "slot" | "manual", jobId: number) => `fill.${flag}.${jobId}`;
const isSet = (flag: Flag, jobId: number) => kvGet(key(flag, jobId)) === "1";
const put = (jobId: number, flags: Partial<Record<Flag, boolean>>) => {
  for (const flag of ["submitting", "verify", "recovery"] as const) {
    const value = flags[flag];
    if (value !== undefined) kvSet(key(flag, jobId), value ? "1" : "0");
  }
};

export const isSubmitting = (jobId: number) => isSet("submitting", jobId);
export const isVerifying = (jobId: number) => isSet("verify", jobId);
export const isRecovering = (jobId: number) => isSet("recovery", jobId);
// What the next worker for this job will do, when it is not a plain first attempt.
export const recoveryMode = (jobId: number): "verify" | "fill" | null => (isVerifying(jobId) ? "verify" : isRecovering(jobId) ? "fill" : null);

// ---- transitions. Callers that change job or gate rows alongside wrap both in one db.transaction.

// The worker was told to click final submit once.
export const authorizeSubmit = (jobId: number) => { put(jobId, { submitting: true }); };
// A worker is being started for this job: its place in the queue is used up.
export const beginAttempt = (jobId: number) => { put(jobId, { recovery: false }); };
// Resume the existing draft with an ordinary fill worker.
export const queueDraftRecovery = (jobId: number) => { put(jobId, { verify: false, recovery: true }); };
// Send a verification-only worker to find out whether the authorized submit went through.
export const queueVerification = (jobId: number) => { put(jobId, { submitting: true, verify: true, recovery: true }); };
// Verification stopped without an answer: still ambiguous, back to a human.
export const endVerification = (jobId: number) => { put(jobId, { verify: false, recovery: false }); };
// Evidence or the user says the authorized submit did not happen: the draft may be filled again.
export const confirmNotSubmitted = (jobId: number) => { put(jobId, { submitting: false, verify: false, recovery: true }); };
// An outcome is recorded (submitted, closed, failed before any authorization): nothing is pending.
export const clearFillFlags = (jobId: number) => { put(jobId, { submitting: false, verify: false, recovery: false }); };

// ---- which browser holds this job's draft, for jobs frozen before checkpoints carried the slot.

export const lastSlot = (jobId: number): number | null => {
  const value = kvGet(key("slot", jobId));
  return value === null ? null : Number(value);
};
export const rememberSlot = (jobId: number, slot: number) => { kvSet(key("slot", jobId), String(slot)); };

// ---- manual lease: the open gate under which a person has explicitly reserved the job's browser.

export const manualLeaseGate = (jobId: number) => kvGet(key("manual", jobId));
export const setManualLease = (jobId: number, gateId: string) => { kvSet(key("manual", jobId), gateId); };
export const clearManualLease = (jobId: number) => { kvDelete(key("manual", jobId)); };
// Drops the lease only if it is still the one taken under `gateId`.
export const dropManualLease = (jobId: number, gateId: string) => {
  if (manualLeaseGate(jobId) === gateId) clearManualLease(jobId);
};
