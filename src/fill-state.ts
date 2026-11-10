import { db } from "./db";

export const FILL_PHASES = ["idle", "draft_recovery", "submitting", "ambiguous", "verify_queued", "verifying"] as const;
export type FillPhase = (typeof FILL_PHASES)[number];

interface FillState {
  phase: FillPhase;
  slot: number | null;
  manual_gate: string | null;
}

const read = (jobId: number) => db.query<FillState, [number]>("SELECT phase, slot, manual_gate FROM fill_state WHERE job_id = ?").get(jobId);
const cas = (jobId: number, to: FillPhase, from: readonly FillPhase[]) => {
  db.query("INSERT INTO fill_state (job_id) VALUES (?) ON CONFLICT(job_id) DO NOTHING").run(jobId);
  return (
    db.query("UPDATE fill_state SET phase = ? WHERE job_id = ? AND phase IN (SELECT value FROM json_each(?))").run(to, jobId, JSON.stringify(from)).changes > 0
  );
};

export const fillPhase = (jobId: number): FillPhase => read(jobId)?.phase ?? "idle";
export const isSubmitting = (jobId: number) => ["submitting", "ambiguous", "verify_queued", "verifying"].includes(fillPhase(jobId));
export const isAmbiguous = (jobId: number) => ["ambiguous", "verify_queued", "verifying"].includes(fillPhase(jobId));
export const isVerifying = (jobId: number) => ["verify_queued", "verifying"].includes(fillPhase(jobId));
export const isRecovering = (jobId: number) => ["draft_recovery", "verify_queued"].includes(fillPhase(jobId));
export const recoveryMode = (jobId: number): "verify" | "fill" | null =>
  isVerifying(jobId) ? "verify" : fillPhase(jobId) === "draft_recovery" ? "fill" : null;

export const authorizeSubmit = (jobId: number) => cas(jobId, "submitting", ["idle"]);
export const refuseSubmit = (jobId: number) => cas(jobId, "idle", ["submitting"]);
export const beginAttempt = (jobId: number): FillPhase => {
  cas(jobId, "idle", ["draft_recovery"]);
  cas(jobId, "verifying", ["verify_queued"]);
  return fillPhase(jobId);
};
export const markAmbiguous = (jobId: number) => cas(jobId, "ambiguous", ["idle", "draft_recovery", "submitting", "verifying", "verify_queued"]);
export const queueVerification = (jobId: number) => cas(jobId, "verify_queued", ["ambiguous", "verifying"]);
export const confirmNotSubmitted = (jobId: number) => cas(jobId, "draft_recovery", ["ambiguous", "verify_queued", "verifying"]);
export const queueDraftRecovery = (jobId: number) => cas(jobId, "draft_recovery", ["idle", "draft_recovery"]);
export const resetFillPhase = (jobId: number) => {
  db.query("INSERT INTO fill_state (job_id) VALUES (?) ON CONFLICT(job_id) DO UPDATE SET phase = 'idle'").run(jobId);
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
