// Where a job stands, and what each move between statuses writes. Every status a job is given is
// written through `to`, so the columns that go with a status (who approved it, when it was submitted,
// the gate it is parked on) are decided here and nowhere else. Bulk moves in SQL stay in db.ts.
import type { Job, JobFields } from "./db";

/*
 * found             scanned, not yet triaged
 * locating          title looked relevant, but it was found on LinkedIn/Indeed: looking for the employer's own posting
 * triaged           title looked relevant, waiting for scoring + resume
 * prepping          prep worker running
 * awaiting_approval gate 1: waiting for the user
 * approved          approved by the user or by auto apply (approved_by), waiting for the fill worker
 * filling           fill worker running
 * needs_input       parked on a question or a cover letter
 * awaiting_submit   gate 2: form filled, waiting for the user
 * needs_manual      parked on something a person must do or inspect (captcha, odd flow, ambiguous submit)
 * submitted         application sent
 * interview / offer / rejected_by_company   outcomes seen in mail
 * held              good match set aside during the practice phase; released later
 * skipped           triage or score said no
 * rejected          user said no
 * failed            worker errored; can be retried
 */
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
  | "held"
  | "skipped"
  | "rejected"
  | "failed";

// ---- groups

// Not yet read in full: another listing of the same job may still widen its location or supply its text.
export const UNASSESSED: readonly Status[] = ["found", "locating", "triaged"];
// Nothing has been sent or filled in for it: its posting may still be swapped for the employer's own.
export const NOT_STARTED: readonly Status[] = [...UNASSESSED, "held", "skipped", "awaiting_approval"];
// Waiting on a person under an open gate.
export type ParkedStatus = "needs_input" | "awaiting_submit" | "needs_manual";
export const PARKED: readonly Status[] = ["needs_input", "awaiting_submit", "needs_manual"] satisfies ParkedStatus[];
// Everything between gate 1 and a recorded outcome, plus failures that may have left a draft behind.
export const FILL_STAGE: readonly Status[] = ["approved", "filling", ...PARKED, "failed"];
// No fill worker will run for it again unless the user brings it back.
const SETTLED: readonly Status[] = ["submitted", "interview", "offer", "rejected_by_company", "rejected", "skipped", "held"];
// What the user may send back into the pipeline.
export const RETRYABLE: readonly Status[] = ["failed", "rejected", "skipped", "held"];
// Sent, with more still to hear: what the mailbox is watched for.
export const AWAITING_OUTCOME: readonly Status[] = ["submitted", "interview"];
// Never shown on the board: not yet triaged, or turned down by triage or the score.
export const OFF_BOARD: readonly Status[] = ["found", "skipped"];
// What a message in the mailbox can say about an application that was sent.
export const MAIL_OUTCOMES = ["submitted", "interview", "offer", "rejected_by_company"] as const satisfies readonly Status[];

// The application went out: its status is an outcome, or it was sent before the user set it aside.
export const wasSent = (job: Pick<Job, "status" | "submitted_at">) => (MAIL_OUTCOMES as readonly Status[]).includes(job.status) || !!job.submitted_at;
export const isSettled = (job: Pick<Job, "status" | "submitted_at">) => SETTLED.includes(job.status) || !!job.submitted_at;

// ---- moves. Each returns the columns to write; the caller passes them to updateJob, or to writeJob
// inside a transaction, along with anything else it records at the same time.

// Leaves the fill stage or never entered it: nothing is pending.
const settle = (status: Status, note: string | null): JobFields => ({ status, pending: null, note });

export const to = {
  locating: (): JobFields => ({ status: "locating", note: null }),
  triaged: (note: string | null = null) => settle("triaged", note),
  prepping: (): JobFields => ({ status: "prepping", note: null }),
  held: (note: string) => settle("held", note),
  skipped: (note: string) => settle("skipped", note),
  failed: (note: string) => settle("failed", note),
  rejected: (note: string | null) => settle("rejected", note),
  // Gate 1 is open. `note` says why auto apply left it to the user, when it did.
  awaitingApproval: (note: string | null): JobFields => ({ status: "awaiting_approval", note }),
  // Gate 1 is given.
  approved: (by: "user" | "auto"): JobFields => ({ status: "approved", approved_by: by, note: null }),
  // Back in the fill queue with gate 1 still standing. `pending` is the answered gate the next worker picks up.
  resumeFill: (note: string, pending: string | null = null): JobFields => ({ status: "approved", pending, note }),
  filling: (): JobFields => ({ status: "filling", pending: null }),
  // Stopped under an open gate; `pending` describes it.
  parked: (status: ParkedStatus, pending: string): JobFields => ({ status, pending }),
  // The application was sent, by a worker or by hand. The one place submitted_at is written.
  submitted: (note: string): JobFields => ({ ...settle("submitted", note), submitted_at: new Date().toISOString() }),
  // What the mailbox says happened to an application that was already sent.
  outcome: (status: (typeof MAIL_OUTCOMES)[number], note: string): JobFields => ({ status, note }),
};
