import type { Job, JobFields } from "./db";

export type Status =
  | "found"
  | "locating"
  | "triaged"
  | "prepping"
  | "awaiting_approval"
  | "approved"
  | "filling"
  | "needs_input"
  | "awaiting_submit"
  | "needs_manual"
  | "submitted"
  | "interview"
  | "offer"
  | "rejected_by_company"
  | "withdrawn"
  | "held"
  | "skipped"
  | "rejected"
  | "failed";

export const UNASSESSED: readonly Status[] = ["found", "locating", "triaged"];
export const NOT_STARTED: readonly Status[] = [...UNASSESSED, "held", "skipped", "awaiting_approval"];
export type ParkedStatus = "needs_input" | "awaiting_submit" | "needs_manual";
export const PARKED: readonly Status[] = ["needs_input", "awaiting_submit", "needs_manual"] satisfies ParkedStatus[];
export const FILL_STAGE: readonly Status[] = ["approved", "filling", ...PARKED, "failed"];
const SETTLED: readonly Status[] = ["submitted", "interview", "offer", "rejected_by_company", "withdrawn", "rejected", "skipped", "held"];
export const RETRYABLE: readonly Status[] = ["failed", "rejected", "skipped", "held"];
export const AWAITING_OUTCOME: readonly Status[] = ["submitted", "interview"];
export const OFF_BOARD: readonly Status[] = ["found", "skipped"];
export const MAIL_OUTCOMES = ["submitted", "interview", "offer", "rejected_by_company"] as const satisfies readonly Status[];

export const USER_OUTCOMES = ["interview", "offer", "rejected_by_company", "withdrawn"] as const satisfies readonly Status[];

export const wasSent = (job: Pick<Job, "status" | "submitted_at">) => (MAIL_OUTCOMES as readonly Status[]).includes(job.status) || !!job.submitted_at;
export const isSettled = (job: Pick<Job, "status" | "submitted_at">) => SETTLED.includes(job.status) || !!job.submitted_at;

const settle = (status: Status, note: string | null): JobFields => ({ status, pending: null, note });

export const to = {
  locating: (): JobFields => ({ status: "locating", note: null }),
  triaged: (note: string | null = null) => settle("triaged", note),
  prepping: (): JobFields => ({ status: "prepping", note: null }),
  held: (note: string) => settle("held", note),
  skipped: (note: string) => settle("skipped", note),
  failed: (note: string) => settle("failed", note),
  rejected: (note: string | null) => settle("rejected", note),
  awaitingApproval: (note: string | null): JobFields => ({ status: "awaiting_approval", note }),
  approved: (by: "user" | "auto"): JobFields => ({ status: "approved", approved_by: by, note: null }),
  resumeFill: (note: string, pending: string | null = null): JobFields => ({ status: "approved", pending, note }),
  filling: (): JobFields => ({ status: "filling", pending: null }),
  verifyAgain: (note: string): JobFields => ({ status: "needs_manual", pending: null, note }),
  parked: (status: ParkedStatus, pending: string): JobFields => ({ status, pending }),
  submitted: (note: string): JobFields => ({ ...settle("submitted", note), submitted_at: new Date().toISOString() }),
  outcome: (status: (typeof MAIL_OUTCOMES)[number] | (typeof USER_OUTCOMES)[number], note: string): JobFields => ({ status, note }),
};
