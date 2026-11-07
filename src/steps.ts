import { db, getJob, moveJob, notifyJobChange, type Job } from "./db";
import { canMove, SENT, to, type Status } from "./status";

export const STEP_KINDS = ["questionnaire", "assessment", "schedule", "interview", "info_request", "other"] as const;
export type StepKind = (typeof STEP_KINDS)[number];
export const STEP_STATES = ["todo", "done", "scheduled", "closed", "expired", "cancelled"] as const;
export type StepState = (typeof STEP_STATES)[number];
const OPEN: readonly StepState[] = ["todo", "done", "scheduled"];
const IN_PROCESS: readonly Status[] = ["submitted", "interview", "offer"];
export const QUIET_DAYS = 7;

export interface Step {
  id: number;
  job_id: number;
  kind: StepKind;
  title: string;
  state: StepState;
  due_at: string | null;
  scheduled_at: string | null;
  link: string | null;
  detail: string | null;
  source: "mail" | "user";
  message_id: string | null;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  done_note: string | null;
  closed_at: string | null;
}

export const stepMs = (s: string) => (s.length === 10 ? Date.parse(`${s}T23:59:59Z`) : Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`));
export function normalizeWhen(value: string): string {
  const v = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v))) return v;
  const at = Date.parse(v);
  if (Number.isNaN(at)) throw new Error(`not a date or time: ${value}`);
  return new Date(at).toISOString();
}

export const jobSteps = (jobId: number) => db.query<Step, [number]>("SELECT * FROM application_steps WHERE job_id = ? ORDER BY id").all(jobId);
export const getStep = (id: number) => db.query<Step, [number]>("SELECT * FROM application_steps WHERE id = ?").get(id);
export const openSteps = (jobIds: readonly number[]) =>
  db
    .query<Step, [string, string]>(
      "SELECT * FROM application_steps WHERE job_id IN (SELECT value FROM json_each(?)) AND state IN (SELECT value FROM json_each(?)) ORDER BY job_id, id",
    )
    .all(JSON.stringify(jobIds), JSON.stringify(OPEN));

export interface NewStep {
  kind: StepKind;
  title: string;
  due_at?: string | null;
  link?: string | null;
  detail?: string | null;
  source: "mail" | "user";
  message_id?: string | null;
}
export function addStep(job: Pick<Job, "id" | "status">, step: NewStep): { id: number; added: boolean } {
  if (!IN_PROCESS.includes(job.status)) throw new Error(`steps can only be added while an application is in process, not ${job.status}`);
  const title = step.title.trim();
  if (!title) throw new Error("a step needs a title");
  const due = step.due_at ? normalizeWhen(step.due_at) : null;
  const result = db
    .transaction(() => {
      const inserted = db
        .query<{ id: number }, [number, string, string, string | null, string | null, string | null, string, string | null]>(
          `
          INSERT INTO application_steps (job_id, kind, title, due_at, link, detail, source, message_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (job_id, message_id, kind) WHERE message_id IS NOT NULL DO NOTHING
          RETURNING id`,
        )
        .get(job.id, step.kind, title, due, step.link?.trim() || null, step.detail?.trim() || null, step.source, step.message_id ?? null);
      if (!inserted) {
        const existing = db
          .query<{ id: number }, [number, string, string]>("SELECT id FROM application_steps WHERE job_id = ? AND message_id = ? AND kind = ?")
          .get(job.id, step.message_id ?? "", step.kind);
        return { id: existing?.id ?? 0, added: false };
      }
      if (job.status === "submitted" && !moveJob(job.id, "submitted", to.outcome("interview", title), { quiet: true })) return { id: inserted.id, added: true };
      return { id: inserted.id, added: true };
    })
    .immediate();
  if (result.added) notifyJobChange(job.id);
  return result;
}

export interface StepChange {
  state?: StepState;
  note?: string | null;
  scheduled_at?: string | null;
  kind?: StepKind;
  title?: string;
  due_at?: string | null;
  link?: string | null;
  detail?: string | null;
}
export function changeStep(id: number, change: StepChange): Step {
  const step = getStep(id);
  if (!step) throw new Error("no such step");
  const now = new Date().toISOString();
  const next: Step = { ...step };
  if (change.kind !== undefined) next.kind = change.kind;
  if (change.title !== undefined) {
    if (!change.title.trim()) throw new Error("a step needs a title");
    next.title = change.title.trim();
  }
  if (change.due_at !== undefined) next.due_at = change.due_at ? normalizeWhen(change.due_at) : null;
  if (change.link !== undefined) next.link = change.link?.trim() || null;
  if (change.detail !== undefined) next.detail = change.detail?.trim() || null;
  if (change.scheduled_at !== undefined) next.scheduled_at = change.scheduled_at ? normalizeWhen(change.scheduled_at) : null;
  if (change.state !== undefined && change.state !== step.state) {
    next.state = change.state;
    if (change.state === "todo") {
      next.done_at = null;
      next.closed_at = null;
    } else if (change.state === "done") {
      next.done_at = now;
      next.closed_at = null;
    } else if (change.state === "scheduled") next.closed_at = null;
    else next.closed_at = now;
  }
  if (change.state === "done" && change.note !== undefined) next.done_note = change.note?.trim() || null;
  if (next.state === "scheduled" && !next.scheduled_at) throw new Error("a booked step needs its time");
  db.query(
    `
    UPDATE application_steps SET kind = ?, title = ?, state = ?, due_at = ?, scheduled_at = ?, link = ?, detail = ?,
      done_at = ?, done_note = ?, closed_at = ?, updated_at = datetime('now')
    WHERE id = ?`,
  ).run(next.kind, next.title, next.state, next.due_at, next.scheduled_at, next.link, next.detail, next.done_at, next.done_note, next.closed_at, id);
  notifyJobChange(step.job_id);
  return getStep(id) ?? next;
}

export function removeStep(id: number) {
  const step = getStep(id);
  if (!step) return;
  db.transaction(() => {
    db.query("DELETE FROM application_steps WHERE id = ?").run(id);
    if (getJob(step.job_id)?.status === "interview" && !jobSteps(step.job_id).length)
      moveJob(step.job_id, "interview", to.outcome("submitted", `removed: ${step.title}`), { quiet: true });
  }).immediate();
  notifyJobChange(step.job_id);
}

const CLOSED_OUTCOMES: readonly Status[] = ["offer", "rejected_by_company", "withdrawn"];

export function recordOutcome(jobId: number, outcome: "reopen" | "offer" | "rejected_by_company" | "withdrawn", note: string): boolean {
  const moved = db
    .transaction(() => {
      if (outcome === "reopen") return moveJob(jobId, CLOSED_OUTCOMES, to.outcome(jobSteps(jobId).length ? "interview" : "submitted", note), { quiet: true });
      if (
        !moveJob(
          jobId,
          SENT.filter(s => canMove(s, outcome)),
          to.outcome(outcome, note),
          { quiet: true },
        )
      )
        return false;
      db.query(
        "UPDATE application_steps SET state = ?, closed_at = ?, updated_at = datetime('now') WHERE job_id = ? AND state IN (SELECT value FROM json_each(?))",
      ).run(outcome === "withdrawn" ? "cancelled" : "closed", new Date().toISOString(), jobId, JSON.stringify(OPEN));
      return true;
    })
    .immediate();
  if (moved) notifyJobChange(jobId);
  return moved;
}

export interface NextStep {
  whose: "you" | "upcoming" | "them";
  at: string;
  due: boolean;
  kind: StepKind;
  label: string;
  quiet: boolean;
}
export function nextStepOf(steps: readonly Step[], now = Date.now()): NextStep | null {
  const pick = (s: Step, whose: NextStep["whose"], at: string, due = false): NextStep => ({
    whose,
    at,
    due,
    kind: s.kind,
    label: s.title,
    quiet: whose === "them" && now - stepMs(at) >= QUIET_DAYS * 86400_000,
  });
  const todo = steps
    .filter(s => s.state === "todo")
    .sort((a, b) => (a.due_at ? stepMs(a.due_at) : Infinity) - (b.due_at ? stepMs(b.due_at) : Infinity) || a.id - b.id)[0];
  if (todo) return pick(todo, "you", todo.due_at ?? todo.created_at, !!todo.due_at);
  const booked = steps.filter(s => s.state === "scheduled" && s.scheduled_at && stepMs(s.scheduled_at) > now);
  const soonest = booked.sort((a, b) => stepMs(a.scheduled_at ?? "") - stepMs(b.scheduled_at ?? ""))[0];
  if (soonest?.scheduled_at) return pick(soonest, "upcoming", soonest.scheduled_at);
  const since = (s: Step) => (s.state === "done" ? s.done_at : s.state === "scheduled" ? s.scheduled_at : (s.closed_at ?? s.updated_at)) ?? s.updated_at;
  const latest = (rows: Step[]) => rows.sort((a, b) => stepMs(since(b)) - stepMs(since(a)))[0];
  const waiting = latest(steps.filter(s => s.state === "done" || s.state === "scheduled")) ?? latest([...steps]);
  return waiting ? pick(waiting, "them", since(waiting)) : null;
}

export function nextSteps(now = Date.now()): Map<number, NextStep> {
  const rows = db
    .query<Step, [string]>(
      "SELECT s.* FROM application_steps s JOIN jobs j ON j.id = s.job_id WHERE j.status IN (SELECT value FROM json_each(?)) ORDER BY s.job_id, s.id",
    )
    .all(JSON.stringify(IN_PROCESS));
  const by = new Map<number, Step[]>();
  for (const s of rows) by.set(s.job_id, [...(by.get(s.job_id) ?? []), s]);
  const out = new Map<number, NextStep>();
  for (const [jobId, steps] of by) {
    const next = nextStepOf(steps, now);
    if (next) out.set(jobId, next);
  }
  return out;
}

export type DueStep = Step & { company: string; title_of_job: string };
export function dueSoon(hours = 48, now = Date.now()): DueStep[] {
  return db
    .query<DueStep, [string]>(
      `
      SELECT s.*, j.company, j.title AS title_of_job
      FROM application_steps s JOIN jobs j ON j.id = s.job_id
      WHERE s.state = 'todo' AND s.due_at IS NOT NULL AND j.status IN (SELECT value FROM json_each(?))
      ORDER BY s.due_at, s.id`,
    )
    .all(JSON.stringify(IN_PROCESS))
    .filter(s => s.due_at && stepMs(s.due_at) - now <= hours * 3600_000);
}

export const stepOf = (jobId: number, stepId: number) => {
  const step = getStep(stepId);
  return step?.job_id === jobId ? step : null;
};
