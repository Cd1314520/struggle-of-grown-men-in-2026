import { createHash, randomUUID } from "node:crypto";
import { db, getJob, moveJob, notifyJobChange, openedAt, writeJob, type Job } from "./db";
import {
  clearManualLease,
  confirmNotSubmitted,
  isAmbiguous,
  isSubmitting,
  isVerifying,
  manualLeaseGate,
  markAmbiguous,
  queueDraftRecovery,
  queueVerification,
  resetFillPhase,
  setManualLease,
} from "./fill-state";
import { FILL_STAGE, isSettled, PARKED, to, type ParkedStatus, type Status } from "./status";

export type GateKind = "question" | "cover_letter" | "confirm_submit" | "manual" | "submission_ambiguous";
// "bank": the candidate also keeps the answer for the answer bank, profile/answers.md (see answer-bank.ts).
export type AnswerScope = "application" | "bank";
export const QUESTION_REASONS = ["agreement", "fact_missing", "skill_not_on_resume", "free_text", "sensitive_id", "history_detail", "other"] as const;
export type QuestionReason = (typeof QUESTION_REASONS)[number];
export interface GateInput {
  kind: GateKind;
  text: string;
  context?: string;
  options?: string[];
  shot?: number | null;
  why?: QuestionReason | null;
  missing?: string | null;
}
export interface FillCheckpoint {
  version: 1;
  slot: number;
  tabId: string | null;
  url: string | null;
  step: string;
  notes: string;
  resumeSha: string | null;
  savedAt: string;
}
export interface Gate {
  id: string;
  jobId: number;
  kind: GateKind;
  groupKey: string;
  text: string;
  context: string;
  options: string[];
  state: "open" | "answered" | "closed";
  answer: string | null;
  scope: AnswerScope | null;
  createdAt: string;
  answeredAt: string | null;
  shot: number | null;
  why: QuestionReason | null;
  missing: string | null;
}
export interface QuestionGroup {
  key: string;
  kind: GateKind;
  text: string;
  context: string;
  options: string[];
  why: QuestionReason | null;
  missing: string | null;
  // askedAt: when this application asked. queuedAfter: questions it found on the same page that are still
  // unanswered, so answering this one opens the next instead of resuming the application.
  jobs: { id: number; company: string; title: string; gateId: string; askedAt: string; queuedAfter: number }[];
  createdAt: string;
  // When the most recently opened of those postings opened, in ms (see openedAt).
  openedAt: number;
}
export interface HandoffRecord {
  kind: "manual" | "submission_ambiguous";
  text: string;
  context: string | null;
  createdAt: string;
}
export interface ResumeContext {
  checkpoint: FillCheckpoint | null;
  answers: { kind: GateKind; question: string; context: string; options: string[]; answer: string }[];
  approvedSummary: string | null;
  changeRequests: string[];
  handoffHistory: HandoffRecord[];
}

interface GateRow {
  id: string;
  job_id: number;
  kind: GateKind;
  group_key: string;
  match_key: string;
  employer: string;
  text: string;
  context: string;
  options: string;
  state: Gate["state"];
  answer: string | null;
  scope: AnswerScope | null;
  created_at: string;
  answered_at: string | null;
  shot: number | null;
  why: QuestionReason | null;
  missing: string | null;
}
// ---- statements used in more than one place. Nothing outside this module touches these tables.
const gateRow = (gateId: string) => db.query<GateRow, [string]>("SELECT * FROM question_gates WHERE id = ?").get(gateId);
// At most one: question_gates_open_job is unique.
const openGateRow = (jobId: number) => db.query<GateRow, [number]>("SELECT * FROM question_gates WHERE job_id = ? AND state = 'open'").get(jobId);
const closeGate = (gateId: string) => db.query("UPDATE question_gates SET state = 'closed' WHERE id = ?").run(gateId);
const closeOpenGate = (jobId: number) => db.query("UPDATE question_gates SET state = 'closed' WHERE job_id = ? AND state = 'open'").run(jobId);
const unconsumedApproval = (jobId: number) =>
  db.query<{ summary: string }, [number]>("SELECT summary FROM submit_approvals WHERE job_id = ? AND consumed_at IS NULL").get(jobId);

const kinds: GateKind[] = ["question", "cover_letter", "confirm_submit", "manual", "submission_ambiguous"];
const parkedStatus: Record<GateKind, ParkedStatus> = {
  question: "needs_input",
  cover_letter: "needs_input",
  confirm_submit: "awaiting_submit",
  manual: "needs_manual",
  submission_ambiguous: "needs_manual",
};
const parkFrom: Record<GateKind, readonly Status[]> = {
  question: ["filling"],
  cover_letter: ["filling"],
  confirm_submit: ["filling"],
  manual: ["filling", ...PARKED],
  submission_ambiguous: FILL_STAGE,
};
const now = () => new Date().toISOString();
function requireJob(jobId: number): Job {
  const job = getJob(jobId);
  if (!job) throw new Error(`Job ${jobId} does not exist`);
  return job;
}
function pending(job: Job): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(job.pending ?? "null");
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
function validateInput(input: GateInput) {
  if (!kinds.includes(input.kind) || typeof input.text !== "string" || !input.text.trim()) throw new Error("A gate requires a kind and nonblank text");
  if (input.context !== undefined && typeof input.context !== "string") throw new Error("Gate context must be text");
  if (input.options !== undefined && (!Array.isArray(input.options) || !input.options.every(option => typeof option === "string")))
    throw new Error("Gate options must be strings");
}
// No case, punctuation, Unicode, employer-suffix, or choice-order normalization: consent and legal prompts must not broaden scope.
function identity(job: Job, input: GateInput) {
  validateInput(input);
  const context = input.context ?? "",
    options = input.options ?? [];
  const structured = !!job.company.trim() && !!context.trim() && Array.isArray(input.options);
  // The same employer asking the same thing on several applications is one question to the candidate.
  const shared = input.kind === "question" && structured;
  // The trailing false stood for gates imported from before gates were stored. Nothing creates those
  // any more, but it stays in the key so stored gates and answers keep matching.
  const matchKey = createHash("sha256")
    .update(JSON.stringify([job.company, input.kind, input.text, context, options, Array.isArray(input.options), false]))
    .digest("hex");
  const groupKey = shared ? `employer:${matchKey}` : `job:${job.id}:${matchKey}`;
  return { context, options, matchKey, groupKey };
}
function gate(row: GateRow): Gate {
  return {
    id: row.id,
    jobId: row.job_id,
    kind: row.kind,
    groupKey: row.group_key,
    text: row.text,
    context: row.context,
    options: JSON.parse(row.options) as string[],
    state: row.state,
    answer: row.answer,
    scope: row.scope,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
    shot: row.shot,
    why: row.why,
    missing: row.missing,
  };
}
function isCurrent(row: GateRow, job: Job): boolean {
  const p = pending(job);
  return row.state === "open" && job.status === parkedStatus[row.kind] && p?.["version"] === 1 && p["gateId"] === row.id && p["state"] === "open";
}
function payload(value: Gate) {
  return JSON.stringify({
    version: 1,
    gateId: value.id,
    kind: value.kind,
    text: value.text,
    context: value.context,
    options: value.options,
    shot: value.shot,
    state: value.state,
  });
}
function invalidateApproval(jobId: number) {
  db.query("DELETE FROM submit_approvals WHERE job_id = ?").run(jobId);
}
function isCheckpoint(value: unknown): value is FillCheckpoint {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<keyof FillCheckpoint, unknown>;
  return (
    v.version === 1 &&
    typeof v.slot === "number" &&
    Number.isInteger(v.slot) &&
    v.slot >= 0 &&
    [v.tabId, v.url, v.resumeSha].every(x => x === null || typeof x === "string") &&
    typeof v.step === "string" &&
    typeof v.notes === "string" &&
    typeof v.savedAt === "string" &&
    Number.isFinite(Date.parse(v.savedAt))
  );
}
function validateCheckpoint(value: unknown, job: Job): asserts value is FillCheckpoint {
  if (!isCheckpoint(value)) throw new Error("Invalid version 1 fill checkpoint");
  if (job.resume_sha && value.resumeSha !== job.resume_sha) throw new Error("Checkpoint must refer to the immutable frozen resume");
}
function writeCheckpoint(job: Job, checkpoint: FillCheckpoint) {
  validateCheckpoint(checkpoint, job);
  // Select declared fields only; never persist arbitrary worker tool arguments.
  const { version, slot, tabId, url, step, notes, resumeSha, savedAt } = checkpoint;
  writeJob(job.id, { fill_checkpoint: JSON.stringify({ version, slot, tabId, url, step, notes, resumeSha, savedAt }) });
}
export function recordCheckpoint(jobId: number, checkpoint: FillCheckpoint): void {
  db.transaction(() => {
    writeCheckpoint(requireJob(jobId), checkpoint);
  }).immediate();
  notifyJobChange(jobId);
}
export function readCheckpoint(jobId: number): FillCheckpoint | null {
  const job = requireJob(jobId);
  if (!job.fill_checkpoint) return null;
  const checkpoint: unknown = JSON.parse(job.fill_checkpoint);
  validateCheckpoint(checkpoint, job);
  return checkpoint;
}
export function getGate(gateId: string): Gate | null {
  const row = gateRow(gateId);
  return row ? gate(row) : null;
}
export function getOpenGate(jobId: number): Gate | null {
  const job = getJob(jobId);
  if (!job) return null;
  const row = openGateRow(jobId);
  return row && isCurrent(row, job) ? gate(row) : null;
}
function park(jobId: number, input: GateInput, checkpoint: FillCheckpoint | null, from: Status | readonly Status[] = parkFrom[input.kind]): Gate {
  const job = requireJob(jobId),
    key = identity(job, input);
  if (isSettled(job)) throw new Error("Cannot park a terminal application");
  if (isSubmitting(jobId) && input.kind !== "submission_ambiguous") throw new Error("Submission may have occurred; explicit inspection is required");
  const existing = openGateRow(jobId);
  if (existing?.kind === "submission_ambiguous" && input.kind !== "submission_ambiguous")
    throw new Error("Resolve submission ambiguity before parking another gate");
  if ((input.kind === "manual" || input.kind === "submission_ambiguous") && !checkpoint && !job.fill_checkpoint)
    throw new Error("Interactive gates require a browser checkpoint");
  if (checkpoint) writeCheckpoint(job, checkpoint);
  if (input.kind === "submission_ambiguous") markAmbiguous(jobId);
  if (existing && isCurrent(existing, job) && existing.match_key === key.matchKey) return gate(existing);
  closeOpenGate(jobId);
  clearManualLease(jobId);
  if (input.kind !== "manual") invalidateApproval(jobId);
  const value: Gate = {
    id: randomUUID(),
    jobId,
    kind: input.kind,
    groupKey: key.groupKey,
    text: input.text,
    context: key.context,
    options: key.options,
    state: "open",
    answer: null,
    scope: null,
    createdAt: now(),
    answeredAt: null,
    shot: input.shot ?? null,
    why: input.why ?? null,
    missing: input.missing ?? null,
  };
  db.query(
    `
      INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, shot, why, missing, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
  ).run(
    value.id,
    jobId,
    input.kind,
    key.groupKey,
    key.matchKey,
    job.company,
    input.text,
    key.context,
    JSON.stringify(key.options),
    value.shot,
    value.why,
    value.missing,
    value.createdAt,
  );
  if (!moveJob(jobId, from, to.parked(parkedStatus[input.kind], payload(value)), { quiet: true }))
    throw new Error(`Cannot park a ${input.kind} gate while the application is ${job.status}`);
  return value;
}
export function parkGate(jobId: number, input: GateInput, checkpoint: FillCheckpoint | null): Gate {
  const value = db.transaction(() => park(jobId, input, checkpoint)).immediate();
  notifyJobChange(jobId);
  return value;
}
export function findStoredAnswer(jobId: number, input: GateInput): string | null {
  const job = requireJob(jobId),
    key = identity(job, input);
  if (input.kind !== "question" && input.kind !== "cover_letter") return null;
  if (!job.company.trim() || !key.context.trim() || !Array.isArray(input.options)) return null;
  const local = db
    .query<{ answer: string }, [number, string]>("SELECT answer FROM application_answers WHERE job_id = ? AND match_key = ?")
    .get(jobId, key.matchKey);
  return local?.answer ?? null;
}
// The letter the candidate approved for this application, the latest if they changed it.
export const approvedCoverLetter = (jobId: number) =>
  db
    .query<{ answer: string }, [number]>("SELECT answer FROM application_answers WHERE job_id = ? AND kind = 'cover_letter' ORDER BY answered_at DESC LIMIT 1")
    .get(jobId)?.answer ?? null;
// ---- questions a worker found together. It queues every unknown question on a page and parks once,
// on the first still unanswered; answering that one opens the next instead of starting a worker for it.
export function queueQuestion(jobId: number, input: GateInput) {
  const key = identity(requireJob(jobId), input);
  db.query("INSERT OR IGNORE INTO queued_questions (job_id, match_key, text, context, options, why, missing, queued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
    jobId,
    key.matchKey,
    input.text,
    key.context,
    JSON.stringify(key.options),
    input.why ?? null,
    input.missing ?? null,
    now(),
  );
}
// The first queued question this application has not had answered yet.
// Answered here is enough: a question without context has no stored answer findStoredAnswer would reuse.
export function nextQueuedQuestion(jobId: number): GateInput | null {
  const row = db
    .query<{ text: string; context: string; options: string; why: QuestionReason | null; missing: string | null }, [number]>(
      `
        SELECT text, context, options, why, missing FROM queued_questions q
        WHERE job_id = ? AND NOT EXISTS (SELECT 1 FROM application_answers a WHERE a.job_id = q.job_id AND a.match_key = q.match_key)
        ORDER BY queued_at, rowid`,
    )
    .get(jobId);
  return row
    ? { kind: "question", text: row.text, context: row.context, options: JSON.parse(row.options) as string[], why: row.why, missing: row.missing }
    : null;
}
// A worker starting on the application re-observes the form and asks again whatever it still needs.
export function clearQueuedQuestions(jobId: number) {
  db.query("DELETE FROM queued_questions WHERE job_id = ?").run(jobId);
}
// The queued questions still unanswered besides the one this gate asks.
function queuedAfter(row: GateRow): number {
  if (row.kind !== "question") return 0;
  return (
    db
      .query<{ n: number }, [number, string]>(
        `
          SELECT COUNT(*) AS n FROM queued_questions q
          WHERE job_id = ? AND match_key != ?
            AND NOT EXISTS (SELECT 1 FROM application_answers a WHERE a.job_id = q.job_id AND a.match_key = q.match_key)`,
      )
      .get(row.job_id, row.match_key)?.n ?? 0
  );
}
// Open gates grouped by what they ask, the group with the most recently opened posting first: an
// answer is worth most to an application while its posting is new.
// The kind of gate each parked job waits on.
export const openGateKinds = () =>
  new Map(
    db
      .query<{ job_id: number; kind: GateKind }, []>(
        "SELECT g.job_id, g.kind FROM question_gates g JOIN jobs j ON j.id = g.job_id AND j.status = CASE g.kind WHEN 'question' THEN 'needs_input' WHEN 'cover_letter' THEN 'needs_input' WHEN 'confirm_submit' THEN 'awaiting_submit' WHEN 'manual' THEN 'needs_manual' WHEN 'submission_ambiguous' THEN 'needs_manual' END WHERE g.state = 'open'",
      )
      .all()
      .map(r => [r.job_id, r.kind]),
  );

export function listQuestionGroups(): QuestionGroup[] {
  const groups = new Map<string, QuestionGroup>();
  for (const row of db
    .query<GateRow, []>(
      "SELECT g.* FROM question_gates g JOIN jobs j ON j.id = g.job_id AND j.status = CASE g.kind WHEN 'question' THEN 'needs_input' WHEN 'cover_letter' THEN 'needs_input' WHEN 'confirm_submit' THEN 'awaiting_submit' WHEN 'manual' THEN 'needs_manual' WHEN 'submission_ambiguous' THEN 'needs_manual' END WHERE g.state = 'open' ORDER BY g.created_at, g.id",
    )
    .all()) {
    const job = getJob(row.job_id);
    if (!job || !isCurrent(row, job)) continue;
    let group = groups.get(row.group_key);
    if (!group) {
      group = {
        key: row.group_key,
        kind: row.kind,
        text: row.text,
        context: row.context,
        why: row.why,
        missing: row.missing,
        options: JSON.parse(row.options) as string[],
        jobs: [],
        createdAt: row.created_at,
        openedAt: 0,
      };
      groups.set(row.group_key, group);
    }
    group.jobs.push({ id: job.id, company: job.company, title: job.title, gateId: row.id, askedAt: row.created_at, queuedAfter: queuedAfter(row) });
    group.openedAt = Math.max(group.openedAt, openedAt(job));
  }
  return [...groups.values()].sort((a, b) => b.openedAt - a.openedAt);
}
function saveAnswer(row: GateRow, answer: string, scope: AnswerScope, at: string) {
  if (row.kind === "question" || row.kind === "cover_letter") {
    invalidateApproval(row.job_id);
    db.query(
      `
        INSERT INTO application_answers (job_id, match_key, kind, question, context, options, answer, answered_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(job_id, match_key) DO UPDATE SET answer = excluded.answer, answered_at = excluded.answered_at`,
    ).run(row.job_id, row.match_key, row.kind, row.text, row.context, row.options, answer, at);
    db.query("DELETE FROM queued_questions WHERE job_id = ? AND match_key = ?").run(row.job_id, row.match_key);
  } else {
    invalidateApproval(row.job_id);
    if (answer === "approve")
      db.query("INSERT INTO submit_approvals (job_id, gate_id, summary, created_at) VALUES (?, ?, ?, ?)").run(row.job_id, row.id, row.text, at);
  }
  db.query("UPDATE question_gates SET state = 'answered', answer = ?, scope = ?, answered_at = ? WHERE id = ? AND state = 'open'").run(
    answer,
    scope,
    at,
    row.id,
  );
  // Another question found on the same page is still open: ask it now rather than spend a worker finding it again.
  const next = row.kind === "question" || row.kind === "cover_letter" ? nextQueuedQuestion(row.job_id) : null;
  if (next) return void park(row.job_id, next, null, parkedStatus[row.kind]);
  const value = gate(row);
  value.state = "answered";
  if (!moveJob(row.job_id, parkedStatus[row.kind], to.resumeFill("Answer saved; queued to resume the existing application", payload(value)), { quiet: true }))
    throw new Error("Gate is stale or already answered");
}
export function answerGate(gateId: string, answer: string, scope: AnswerScope): { jobIds: number[] } {
  if (typeof answer !== "string" || !answer.trim()) throw new Error("Answer must be nonblank text");
  const jobIds = db
    .transaction(() => {
      const row = gateRow(gateId);
      if (!row || !isCurrent(row, requireJob(row.job_id))) throw new Error("Gate is stale or already answered");
      if (row.kind === "manual" || row.kind === "submission_ambiguous" || isSubmitting(row.job_id))
        throw new Error("This gate requires explicit manual resolution");
      if (scope === "bank" && row.kind !== "question") throw new Error("Only answers to questions go to the answer bank");
      const at = now(),
        affected: number[] = [];
      // Kept for the answer bank: the agent that files it decides what it says beyond this application.
      if (scope === "bank")
        db.query(
          `
          INSERT INTO banked_answers (job_id, employer, title, question, context, options, answer, answered_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(row.job_id, row.employer, requireJob(row.job_id).title, row.text, row.context, row.options, answer, at);
      // Every application in its group asks exactly this, so the answer goes to all of them now; others
      // asking it in other words wait for the answer bank to cover them (see recheck.ts).
      const targets =
        scope === "application"
          ? [row]
          : db.query<GateRow, [string]>("SELECT * FROM question_gates WHERE group_key = ? AND state = 'open' ORDER BY job_id").all(row.group_key);
      for (const target of targets) {
        const job = getJob(target.job_id);
        if (!job || !isCurrent(target, job) || isSubmitting(job.id)) continue;
        saveAnswer(target, answer, scope, at);
        affected.push(job.id);
      }
      return affected;
    })
    .immediate();
  for (const jobId of jobIds) notifyJobChange(jobId);
  return { jobIds };
}
// ---- answers kept for the answer bank, waiting for answer-bank.ts to file them into answers.md.
export interface BankedAnswer {
  id: number;
  employer: string;
  title: string;
  question: string;
  context: string;
  options: string[];
  answer: string;
  answeredAt: string;
}
export function unfiledAnswers(limit: number): BankedAnswer[] {
  return db
    .query<{ id: number; employer: string; title: string; question: string; context: string; options: string; answer: string; answered_at: string }, [number]>(
      "SELECT id, employer, title, question, context, options, answer, answered_at FROM banked_answers WHERE filed_at IS NULL ORDER BY answered_at, id LIMIT ?",
    )
    .all(limit)
    .map(r => ({ ...r, options: JSON.parse(r.options) as string[], answeredAt: r.answered_at }));
}
export function markFiled(ids: readonly number[]) {
  const at = now();
  db.transaction(() => {
    for (const id of ids) db.query("UPDATE banked_answers SET filed_at = ? WHERE id = ?").run(at, id);
  })();
}
export function resumeContext(jobId: number): ResumeContext {
  requireJob(jobId);
  const rows = db
    .query<{ kind: GateKind; question: string; context: string; options: string; answer: string }, [number]>(
      `
      SELECT kind, question, context, options, answer
      FROM application_answers
      WHERE job_id = ?
      ORDER BY answered_at, match_key`,
    )
    .all(jobId);
  const answers = rows.map(row => ({
    kind: row.kind,
    question: row.question,
    context: row.context,
    options: JSON.parse(row.options) as string[],
    answer: row.answer,
  }));
  const approval = unconsumedApproval(jobId);
  const lastConfirmation = db
    .query<{ answer: string | null }, [number]>(
      `
      SELECT answer
      FROM question_gates
      WHERE job_id = ? AND kind = 'confirm_submit' AND state != 'closed'
      ORDER BY rowid DESC
      LIMIT 1`,
    )
    .get(jobId);
  const handoffRows = db
    .query<{ kind: "manual" | "submission_ambiguous"; text: string; context: string; created_at: string }, [number]>(
      `
      SELECT kind, text, context, created_at
      FROM question_gates
      WHERE job_id = ? AND kind IN ('manual', 'submission_ambiguous')
      ORDER BY created_at ASC, rowid ASC`,
    )
    .all(jobId);
  let handoffHistory: HandoffRecord[];
  if (handoffRows.length <= 6) {
    handoffHistory = handoffRows.map(r => ({ kind: r.kind, text: r.text, context: r.context.trim() || null, createdAt: r.created_at }));
  } else {
    const oldest = handoffRows.slice(0, 2);
    const newest = handoffRows.slice(-4);
    handoffHistory = [...oldest, ...newest].map(r => ({ kind: r.kind, text: r.text, context: r.context.trim() || null, createdAt: r.created_at }));
  }
  return {
    checkpoint: readCheckpoint(jobId),
    answers,
    approvedSummary: approval?.summary ?? null,
    changeRequests: lastConfirmation?.answer && lastConfirmation.answer !== "approve" ? [lastConfirmation.answer] : [],
    handoffHistory,
  };
}
// Answers the ordinary gate a job is parked on. For a manual gate the answer is the note that hands
// control back. An ambiguous submit never takes an ordinary answer.
export function respond(jobId: number, answer: string): boolean {
  const gate = getOpenGate(jobId);
  if (!gate || gate.kind === "submission_ambiguous" || isSubmitting(jobId)) return false;
  if (gate.kind === "manual") return returnManualControl(jobId, gate.id, answer);
  try {
    answerGate(gate.id, answer, "application");
    return true;
  } catch {
    return false;
  }
}
export function consumeSubmitApproval(jobId: number, summary: string): boolean {
  const consumed = db
    .transaction(() => {
      const job = requireJob(jobId);
      if (!["approved", "filling"].includes(job.status) || isSubmitting(jobId) || getOpenGate(jobId)) return false;
      const approval = unconsumedApproval(jobId);
      if (!approval) return false;
      if (approval.summary.replace(/\s+/g, " ").trim() !== summary.replace(/\s+/g, " ").trim()) {
        invalidateApproval(jobId);
        return false;
      }
      db.query("UPDATE submit_approvals SET consumed_at = ? WHERE job_id = ? AND consumed_at IS NULL").run(now(), jobId);
      return true;
    })
    .immediate();
  return consumed;
}
export function returnManualControl(jobId: number, gateId: string, answer: string): boolean {
  const returned = db
    .transaction(() => {
      const job = getJob(jobId);
      const row = gateRow(gateId);
      if (!job || row?.job_id !== jobId || row.kind !== "manual" || !isCurrent(row, job) || isSubmitting(jobId)) return false;
      const note = answer.trim() ? `Manual control returned: ${answer.trim()}` : job.note?.trim() || "Manual control returned: done";
      if (!moveJob(jobId, "needs_manual", to.resumeFill(note), { quiet: true })) return false;
      if (!queueDraftRecovery(jobId)) throw new Error("Submission may have occurred; manual control requires explicit inspection");
      return true;
    })
    .immediate();
  if (returned) notifyJobChange(jobId);
  return returned;
}
export function cancelJobGates(jobId: number): void {
  db.transaction(() => {
    requireJob(jobId);
    db.query("UPDATE question_gates SET state = 'closed' WHERE job_id = ? AND state != 'closed'").run(jobId);
    clearManualLease(jobId);
    invalidateApproval(jobId);
    writeJob(jobId, { pending: null });
  }).immediate();
  notifyJobChange(jobId);
}
// The resolution is spelled out by the caller so nothing clears an ambiguity by default.
export function resolveAmbiguous(jobId: number, resolution: string): void {
  if (resolution !== "not_submitted") throw new Error("Explicit confirmed-not-submitted resolution required");
  db.transaction(() => {
    const current = getOpenGate(jobId);
    if (current?.kind !== "submission_ambiguous" || !isAmbiguous(jobId)) throw new Error("No current submission ambiguity to resolve");
    invalidateApproval(jobId);
    if (!confirmNotSubmitted(jobId)) throw new Error("No current submission ambiguity to resolve");
    if (!moveJob(jobId, "needs_manual", to.resumeFill("Explicit inspection confirmed not submitted; queued to resume existing draft"), { quiet: true }))
      throw new Error("No current submission ambiguity to resolve");
  }).immediate();
  notifyJobChange(jobId);
}
// Applications whose final submit left no confirmation on the page (an open submission_ambiguous
// hand-off). The employer's receipt in the mailbox settles them: see confirmSubmittedByMail.
export const unconfirmedSubmissions = () =>
  db
    .query<Job, []>(
      "SELECT jobs.* FROM jobs JOIN question_gates g ON g.job_id = jobs.id WHERE g.state = 'open' AND g.kind = 'submission_ambiguous' ORDER BY jobs.id",
    )
    .all();

// The employer's receipt for an application in unconfirmedSubmissions: it was sent after all.
export function confirmSubmittedByMail(jobId: number, messageId: string, note: string): void {
  db.transaction(() => {
    const job = requireJob(jobId);
    if (isSettled(job)) throw new Error("This application is already settled");
    if (job.status === "filling") throw new Error("This application is being worked on now; leave it to that worker");
    const current = getOpenGate(jobId);
    if (current?.kind !== "submission_ambiguous") throw new Error("This application has no unclear submission to settle");
    if (!messageId.trim()) throw new Error("message_id of the receipt is required");
    closeGate(current.id);
    clearManualLease(jobId);
    invalidateApproval(jobId);
    resetFillPhase(jobId);
    if (!moveJob(jobId, job.status, to.submitted(`${note.trim()} [confirmation email msg=${messageId.trim()}]`), { quiet: true }))
      throw new Error("This application changed while its receipt was being recorded");
  }).immediate();
  notifyJobChange(jobId);
}

export interface AmbiguityEvidence {
  notes: string;
  requisitionId: string;
  source: "portal" | "confirmation_email" | "submission_error";
  status: "submitted" | "not_submitted" | "draft" | "incomplete" | "rejected";
  messageId?: string;
  checkpoint: FillCheckpoint;
}

// Why this evidence does not settle the outcome it is offered for, or null when it does. Worded for
// the verification worker, which reads it as the reply to verify_status.
export function evidenceProblem(outcome: "submitted" | "not_submitted", evidence: Pick<AmbiguityEvidence, "source" | "status" | "messageId">): string | null {
  if (outcome === "submitted") {
    if (evidence.source !== "portal" && evidence.source !== "confirmation_email") return "submitted outcome requires source 'portal' or 'confirmation_email'.";
    if (evidence.source === "confirmation_email" && !evidence.messageId?.trim()) return "confirmation_email requires message_id from gmail.";
    if (evidence.status !== "submitted") return "submitted outcome requires status 'submitted'.";
    return null;
  }
  const valid =
    (evidence.source === "portal" && ["not_submitted", "draft", "incomplete"].includes(evidence.status)) ||
    (evidence.source === "submission_error" && evidence.status === "rejected");
  return valid
    ? null
    : "not_submitted requires source 'portal' with status 'not_submitted'|'draft'|'incomplete', or source 'submission_error' with status 'rejected'.";
}

export function resolveAmbiguityWithEvidence(jobId: number, outcome: "submitted" | "not_submitted", evidence: AmbiguityEvidence): void {
  db.transaction(() => {
    const job = requireJob(jobId);
    if (isSettled(job)) throw new Error("Cannot resolve ambiguity on a terminal application");
    if (job.status !== "filling") {
      throw new Error("Application must be in active filling status to resolve ambiguity");
    }
    if (!isVerifying(jobId)) {
      throw new Error("Application is not in verified ambiguous submission state");
    }
    if (evidence.notes.trim().length < 5) {
      throw new Error("Conclusive evidence text is required");
    }
    if (!evidence.requisitionId.trim()) {
      throw new Error("Exact matching requisition ID is required");
    }
    const problem = evidenceProblem(outcome, evidence);
    if (problem) throw new Error(problem);

    const durableNote = [
      evidence.notes.trim(),
      `[verification: req=${evidence.requisitionId.trim()} source=${evidence.source} status=${evidence.status}${evidence.messageId ? ` msg=${evidence.messageId.trim()}` : ""}]`,
    ].join(" ");

    writeCheckpoint(job, evidence.checkpoint);
    invalidateApproval(jobId);

    if (outcome === "submitted") {
      resetFillPhase(jobId);
      if (!moveJob(jobId, "filling", to.submitted(durableNote), { quiet: true }))
        throw new Error("Application must be in active filling status to resolve ambiguity");
    } else {
      if (!confirmNotSubmitted(jobId)) throw new Error("Application is not in verified ambiguous submission state");
      if (!moveJob(jobId, "filling", to.resumeFill(durableNote), { quiet: true }))
        throw new Error("Application must be in active filling status to resolve ambiguity");
    }
  }).immediate();
  notifyJobChange(jobId);
}
export function queueRecovery(jobId: number, gateId: string): { mode: "fill" | "verify"; slot: number } {
  const result = db
    .transaction(() => {
      const job = requireJob(jobId);
      if (isSettled(job)) throw new Error("Cannot recover a terminal application");
      const current = getOpenGate(jobId);
      if (current?.id !== gateId) throw new Error("Gate is stale or already answered");
      if (current.kind !== "manual" && current.kind !== "submission_ambiguous")
        throw new Error("Only manual handoffs and ambiguous submissions can be recovered");
      const checkpoint = readCheckpoint(jobId);
      if (!checkpoint) throw new Error("Recovery requires a saved browser checkpoint");

      if (current.kind === "manual") {
        const note = current.text.trim() || job.note?.trim() || "Manual recovery queued";
        if (!moveJob(jobId, "needs_manual", to.resumeFill(note), { quiet: true })) throw new Error("Gate is stale or already answered");
        if (!queueDraftRecovery(jobId)) throw new Error("Submission may have occurred; manual recovery requires explicit inspection");
        return { mode: "fill" as const, slot: checkpoint.slot };
      }
      const originalReason = current.context.trim();
      const note =
        originalReason && originalReason !== current.text ? originalReason : current.text.trim() || job.note?.trim() || "Ambiguous verification queued";
      closeGate(current.id);
      clearManualLease(jobId);
      if (!moveJob(jobId, "needs_manual", to.verifyAgain(note), { quiet: true })) throw new Error("Gate is stale or already answered");
      if (!queueVerification(jobId)) throw new Error("Submission is not ambiguous; nothing to verify");
      return { mode: "verify" as const, slot: checkpoint.slot };
    })
    .immediate();
  notifyJobChange(jobId);
  return result;
}
// A parked gate is not a lease. Only an explicit, current human reservation is.
export function manualLeases(): Map<number, number> {
  const leases = new Map<number, number>();
  for (const row of db.query<GateRow, []>("SELECT * FROM question_gates WHERE state = 'open' AND kind IN ('manual','submission_ambiguous')").all()) {
    if (manualLeaseGate(row.job_id) !== row.id) continue;
    const job = getJob(row.job_id);
    if (!job || !isCurrent(row, job)) continue;
    const checkpoint = readCheckpoint(job.id);
    if (!checkpoint) continue;
    if (leases.has(checkpoint.slot)) throw new Error(`Conflicting explicit browser reservations in slot ${checkpoint.slot}`);
    leases.set(checkpoint.slot, job.id);
  }
  return leases;
}

export function reserveManualLease(jobId: number, gateId: string): FillCheckpoint {
  const checkpoint = db
    .transaction(() => {
      const current = getOpenGate(jobId);
      if (current?.id !== gateId || !["manual", "submission_ambiguous"].includes(current.kind)) throw new Error("This browser handoff is no longer current");
      const saved = readCheckpoint(jobId);
      if (!saved?.tabId) throw new Error("No saved browser tab; request application recovery instead");
      const owner = manualLeases().get(saved.slot);
      if (owner !== undefined && owner !== jobId) throw new Error("This browser is reserved for another application");
      setManualLease(jobId, gateId);
      return saved;
    })
    .immediate();
  notifyJobChange(jobId);
  return checkpoint;
}

export function releaseManualLease(jobId: number, gateId: string): void {
  db.transaction(() => {
    if (getOpenGate(jobId)?.id !== gateId || manualLeaseGate(jobId) !== gateId) throw new Error("This browser reservation is no longer current");
    clearManualLease(jobId);
  }).immediate();
  notifyJobChange(jobId);
}
