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
export const recoveryMode = (jobId: number): "verify" | "fill" | null => (isVerifying(jobId) ? "verify" : isRecovering(jobId) ? "fill" : null);

export const authorizeSubmit = (jobId: number) => {
  put(jobId, { submitting: true });
};
export const beginAttempt = (jobId: number) => {
  put(jobId, { recovering: false });
};
export const queueDraftRecovery = (jobId: number) => {
  put(jobId, { verifying: false, recovering: true });
};
export const queueVerification = (jobId: number) => {
  put(jobId, { submitting: true, verifying: true, recovering: true });
};
export const endVerification = (jobId: number) => {
  put(jobId, { verifying: false, recovering: false });
};
export const confirmNotSubmitted = (jobId: number) => {
  put(jobId, { submitting: false, verifying: false, recovering: true });
};
export const clearFillFlags = (jobId: number) => {
  put(jobId, { submitting: false, verifying: false, recovering: false });
};

export const lastSlot = (jobId: number): number | null => read(jobId)?.slot ?? null;
export const rememberSlot = (jobId: number, slot: number) => {
  db.query("INSERT INTO fill_state (job_id, slot) VALUES (?, ?) ON CONFLICT(job_id) DO UPDATE SET slot = excluded.slot").run(jobId, slot);
};

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
export const dropManualLease = (jobId: number, gateId: string) => {
  if (manualLeaseGate(jobId) === gateId) clearManualLease(jobId);
};
