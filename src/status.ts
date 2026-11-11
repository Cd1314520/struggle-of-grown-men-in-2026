import type { Job, Move } from "./db";

export const STATUSES = [
  "found",
  "locating",
  "triaged",
  "prepping",
  "awaiting_approval",
  "approved",
  "filling",
  "needs_input",
  "awaiting_submit",
  "needs_manual",
  "submitted",
  "interview",
  "offer",
  "rejected_by_company",
  "withdrawn",
  "held",
  "skipped",
  "rejected",
  "failed",
] as const;
export type Status = (typeof STATUSES)[number];

export type HoldReason = "triage" | "target" | "review" | "user";

export const UNASSESSED: readonly Status[] = ["found", "locating", "triaged"];
export const ASSESSING: readonly Status[] = ["triaged", "locating", "prepping"];
export const NOT_STARTED: readonly Status[] = [...UNASSESSED, "held", "skipped", "awaiting_approval"];
export type ParkedStatus = "needs_input" | "awaiting_submit" | "needs_manual";
export const PARKED: readonly Status[] = ["needs_input", "awaiting_submit", "needs_manual"] satisfies ParkedStatus[];
export const FILL_STAGE: readonly Status[] = ["approved", "filling", ...PARKED, "failed"];
export const SENT: readonly Status[] = ["submitted", "interview", "offer", "rejected_by_company", "withdrawn"];
const SETTLED: readonly Status[] = [...SENT, "rejected", "skipped", "held"];
export const RETRYABLE: readonly Status[] = ["failed", "rejected", "skipped", "held"];
export const AWAITING_OUTCOME: readonly Status[] = ["submitted", "interview"];
export const OFF_BOARD: readonly Status[] = ["found", "skipped"];
export const MAIL_OUTCOMES = ["submitted", "interview", "offer", "rejected_by_company"] as const satisfies readonly Status[];

export const USER_OUTCOMES = ["interview", "offer", "rejected_by_company", "withdrawn"] as const satisfies readonly Status[];

export const TRANSITIONS: Readonly<Record<Status, readonly Status[]>> = {
  found: ["found", "locating", "triaged", "held", "skipped", "rejected", "submitted"],
  locating: ["found", "triaged", "skipped", "held", "rejected", "submitted"],
  triaged: ["found", "prepping", "held", "rejected", "submitted"],
  prepping: ["triaged", "awaiting_approval", "approved", "held", "skipped", "rejected", "failed", "submitted"],
  awaiting_approval: ["found", "triaged", "approved", "held", "rejected", "submitted"],
  approved: ["triaged", "awaiting_approval", "filling", "needs_manual", "held", "skipped", "rejected", "submitted"],
  filling: ["approved", "needs_input", "awaiting_submit", "needs_manual", "held", "skipped", "rejected", "failed", "submitted"],
  needs_input: ["approved", "needs_input", "needs_manual", "held", "rejected", "submitted"],
  awaiting_submit: ["approved", "needs_manual", "held", "rejected", "submitted"],
  needs_manual: ["approved", "filling", "needs_manual", "held", "rejected", "failed", "submitted"],
  submitted: ["interview", "offer", "rejected_by_company", "withdrawn"],
  interview: ["submitted", "offer", "rejected_by_company", "withdrawn"],
  offer: ["submitted", "interview", "rejected_by_company", "withdrawn"],
  rejected_by_company: ["submitted", "interview", "offer", "withdrawn"],
  withdrawn: ["submitted", "interview", "offer", "rejected_by_company"],
  held: ["found", "locating", "triaged", "awaiting_approval", "rejected", "submitted"],
  skipped: ["found", "locating", "triaged", "awaiting_approval", "held", "rejected", "submitted"],
  rejected: ["locating", "triaged", "awaiting_approval", "submitted"],
  failed: ["locating", "triaged", "awaiting_approval", "needs_manual", "held", "rejected", "submitted"],
};

export const canMove = (from: Status, to: Status) => TRANSITIONS[from].includes(to);

export const applicationStarted = (job: Pick<Job, "resume_sha" | "resume_frozen_at" | "fill_checkpoint" | "submitted_at">) =>
  !!(job.resume_sha || job.resume_frozen_at || job.fill_checkpoint || job.submitted_at);

export const wasSent = (job: Pick<Job, "status" | "submitted_at">) => SENT.includes(job.status) || !!job.submitted_at;
export const isSettled = (job: Pick<Job, "status" | "submitted_at">) => SETTLED.includes(job.status) || !!job.submitted_at;

const settle = (status: Status, note: string | null): Move => ({ status, pending: null, note });

export const to = {
  locating: (): Move => ({ status: "locating", note: null }),
  triaged: (note: string | null = null) => settle("triaged", note),
  prepping: (): Move => ({ status: "prepping", note: null }),
  held: (note: string, reason: HoldReason): Move => ({ ...settle("held", note), hold_reason: reason }),
  skipped: (note: string) => settle("skipped", note),
  failed: (note: string) => settle("failed", note),
  rejected: (note: string | null) => settle("rejected", note),
  awaitingApproval: (note: string | null): Move => ({ status: "awaiting_approval", note }),
  approved: (by: "user" | "auto"): Move => ({ status: "approved", approved_by: by, note: null }),
  resumeFill: (note: string, pending: string | null = null): Move => ({ status: "approved", pending, note }),
  filling: (): Move => ({ status: "filling", pending: null }),
  verifyAgain: (note: string): Move => ({ status: "needs_manual", pending: null, note }),
  parked: (status: ParkedStatus, pending: string): Move => ({ status, pending }),
  submitted: (note: string): Move => ({ ...settle("submitted", note), submitted_at: new Date().toISOString() }),
  outcome: (status: (typeof MAIL_OUTCOMES)[number] | (typeof USER_OUTCOMES)[number], note: string): Move => ({ status, note }),
};
