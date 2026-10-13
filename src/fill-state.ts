// Where one application stands between "approved" and a recorded outcome, beyond what jobs.status says.
// Every read and every transition of that state goes through here; nothing else touches fill_state.
//
//   submitting  the final click was authorized and no outcome has been recorded since. While it is set,
//               nothing may submit, answer or retry: the application must be inspected first.
//   verifying   a verification-only worker is queued or running to settle a `submitting` application.
//               Only ever set together with `submitting`; the table refuses anything else.
//   recovering  the next attempt resumes an existing draft and goes ahead of fresh applications.
//
// A job with no row has none of these set.
import { db } from "./db";

type Flag = "submitting" | "verifying" | "recovering";
interface FillState {
  submitting: number;
  verifying: number;
  recovering: number;
  slot: number | null;
  manual_gate: string | null;
}

const read = (jobId: number) =>
  db.query<FillState, [number]>("SELECT submitting, verifying, recovering, slot, manual_gate FROM fill_state WHERE job_id = ?").get(jobId);
// Sets the given flags and leaves the others as they are. One statement, so the table's constraints
// judge the state it ends in.
const put = (jobId: number, flags: Partial<Record<Flag, boolean>>) => {
  const value = (flag: Flag) => (flags[flag] === undefined ? null : Number(flags[flag]));
  db.query(
    `
      INSERT INTO fill_state (job_id, submitting, verifying, recovering)
      VALUES (?1, COALESCE(?2, 0), COALESCE(?3, 0), COALESCE(?4, 0))
      ON CONFLICT(job_id) DO UPDATE SET
        submitting = COALESCE(?2, submitting),
        verifying = COALESCE(?3, verifying),
        recovering = COALESCE(?4, recovering)`,
  ).run(jobId, value("submitting"), value("verifying"), value("recovering"));
};

export const isSubmitting = (jobId: number) => read(jobId)?.submitting === 1;
export const isVerifying = (jobId: number) => read(jobId)?.verifying === 1;
export const isRecovering = (jobId: number) => read(jobId)?.recovering === 1;
// What the next worker for this job will do, when it is not a plain first attempt.
export const recoveryMode = (jobId: number): "verify" | "fill" | null => (isVerifying(jobId) ? "verify" : isRecovering(jobId) ? "fill" : null);

// ---- transitions. Callers that change job or gate rows alongside wrap both in one db.transaction.

// The worker was told to click final submit once.
export const authorizeSubmit = (jobId: number) => {
  put(jobId, { submitting: true });
};
// A worker is being started for this job: its place in the queue is used up.
export const beginAttempt = (jobId: number) => {
  put(jobId, { recovering: false });
};
// Resume the existing draft with an ordinary fill worker.
export const queueDraftRecovery = (jobId: number) => {
  put(jobId, { verifying: false, recovering: true });
};
// Send a verification-only worker to find out whether the authorized submit went through.
export const queueVerification = (jobId: number) => {
  put(jobId, { submitting: true, verifying: true, recovering: true });
};
// Verification stopped without an answer: still ambiguous, back to a human.
export const endVerification = (jobId: number) => {
  put(jobId, { verifying: false, recovering: false });
};
// Evidence or the user says the authorized submit did not happen: the draft may be filled again.
export const confirmNotSubmitted = (jobId: number) => {
  put(jobId, { submitting: false, verifying: false, recovering: true });
};
// An outcome is recorded (submitted, closed, failed before any authorization): nothing is pending.
export const clearFillFlags = (jobId: number) => {
  put(jobId, { submitting: false, verifying: false, recovering: false });
};

// ---- which browser holds this job's draft, for jobs frozen before checkpoints carried the slot.

export const lastSlot = (jobId: number): number | null => read(jobId)?.slot ?? null;
export const rememberSlot = (jobId: number, slot: number) => {
  db.query("INSERT INTO fill_state (job_id, slot) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET slot = excluded.slot").run(jobId, slot);
};

// ---- manual lease: the open gate under which a person has explicitly reserved the job's browser.

export const manualLeaseGate = (jobId: number): string | null => read(jobId)?.manual_gate ?? null;
export const setManualLease = (jobId: number, gateId: string) => {
  db.query("INSERT INTO fill_state (job_id, manual_gate) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET manual_gate = excluded.manual_gate").run(
    jobId,
    gateId,
  );
};
export const clearManualLease = (jobId: number) => {
  db.query("UPDATE fill_state SET manual_gate = NULL WHERE job_id = ?").run(jobId);
};
// Drops the lease only if it is still the one taken under `gateId`.
export const dropManualLease = (jobId: number, gateId: string) => {
  if (manualLeaseGate(jobId) === gateId) clearManualLease(jobId);
};
