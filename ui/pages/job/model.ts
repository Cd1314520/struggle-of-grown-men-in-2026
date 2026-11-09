import type { JobDetail, Summary } from "../../../src/api-types";
import { parsePracticeAssessment, practiceVerdict, rubricOf as rubricOfAssessment } from "../../../src/practice";
import { setAsideReason, type Reason } from "../../../src/reasons";
import type { Answer, ChecklistItem } from "../../../src/rubric";
import { SENT, type Status } from "../../../src/status";
import type { Step } from "../../../src/steps";
import { ago, brief, cap, DAY, dateTime, parseAt } from "../../lib/format";
import { GATE, STATUS, type Tone } from "../../lib/labels";

export type Phase = "practice" | "real";

export const rubricOf = (j: { practice_assessment?: string | null }, describing: boolean): Phase =>
  rubricOfAssessment(parsePracticeAssessment(j.practice_assessment), describing);
export const thresholdOf = (rubric: Phase, summary: Summary | undefined) => summary?.thresholds?.[rubric] ?? null;

export const parsePending = (raw: string | null | undefined): { gateId?: string; context?: string } | null => {
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const { gateId, context } = p as Record<string, unknown>;
    return { ...(typeof gateId === "string" && { gateId }), ...(typeof context === "string" && { context }) };
  } catch {
    return null;
  }
};
export const gateIdOf = (j: Pick<JobDetail, "gate" | "pending">) => j.gate?.id ?? parsePending(j.pending)?.gateId;

export const ENDED: readonly Status[] = ["rejected_by_company", "withdrawn"];
export const IN_PROGRESS: readonly Status[] = ["filling", "prepping", "locating"];
const RUNNING: readonly Status[] = [...IN_PROGRESS, "approved", "triaged"];

export type DecisionKind =
  | "verify"
  | "ambiguous"
  | "review"
  | "question"
  | "cover_letter"
  | "confirm_submit"
  | "manual"
  | "failed"
  | "held"
  | "rejected"
  | "skipped"
  | "running"
  | "process";
export function decisionOf(j: Pick<JobDetail, "status" | "gate" | "submissionAmbiguous" | "recoveryMode">): DecisionKind | null {
  const verify = j.recoveryMode ?? (j.submissionAmbiguous && !j.gate && (j.status === "filling" || j.status === "needs_manual") ? "verify" : null);
  if (verify === "verify") return "verify";
  if (j.submissionAmbiguous && !SENT.includes(j.status) && j.status !== "rejected") return "ambiguous";
  if (j.status === "awaiting_approval") return "review";
  const kind = j.gate?.kind;
  if (kind === "question" || kind === "cover_letter" || kind === "confirm_submit" || kind === "manual") return kind;
  if (j.status === "failed") return "failed";
  if (j.status === "held") return "held";
  if (j.status === "rejected") return "rejected";
  if (j.status === "skipped") return "skipped";
  if (RUNNING.includes(j.status)) return "running";
  if (SENT.includes(j.status) && !j.gate) return "process";
  return null;
}
export const fitLeads = (kind: DecisionKind | null) => kind === "review" || kind === "held" || kind === "rejected" || kind === "skipped" || !kind;

export function headerStatus(j: Pick<JobDetail, "status" | "gate" | "submissionAmbiguous">): { label: string; tone: Tone; pulse: boolean } {
  if (j.submissionAmbiguous && j.status !== "rejected" && !SENT.includes(j.status)) return { label: "Outcome unknown", tone: "warning", pulse: false };
  const [label, tone] = STATUS[j.status];
  if (j.status === "awaiting_approval") return { label, tone: "neutral", pulse: false };
  return { label: j.gate ? GATE[j.gate.kind] : label, tone, pulse: IN_PROGRESS.includes(j.status) };
}

export const setAsideOf = (j: Pick<JobDetail, "note" | "history" | "hold_reason">): Reason | null =>
  setAsideReason(j.note, j.history.at(-1)?.from_status ?? null, j.hold_reason);

const NOISE = /compil|pdfinfo|typst|page count|one page|metadata/i;

export type Item = Omit<ChecklistItem, "label"> & { label?: string };
export const checklistOf = (j: Pick<JobDetail, "checklist">): Item[] => {
  if (!j.checklist) return [];
  try {
    const items: unknown = JSON.parse(j.checklist);
    return Array.isArray(items) ? (items as Item[]) : [];
  } catch {
    return [];
  }
};
export const itemLabel = (i: Item) => cap(i.label ?? (i.key.split(".")[1] ?? "").replace(/_/g, " "));

export function verdictOf(items: readonly Item[]) {
  const scored = items.filter(i => !i.required).sort((a, b) => b.weight - a.weight);
  return {
    misses: [...items.filter(i => i.required && i.answer === "no"), ...scored.filter(i => i.answer === "no")],
    hits: scored.filter(i => i.answer === "yes"),
  };
}

const ORDER: Record<Answer, number> = { no: 0, unclear: 1, yes: 2 };
export function groupsOf(items: readonly Item[]) {
  const sorted = [...items].sort((a, b) => ORDER[a.answer] - ORDER[b.answer] || Number(b.required) - Number(a.required) || b.weight - a.weight);
  return {
    missed: sorted.filter(i => i.answer === "no"),
    unclear: sorted.filter(i => i.answer === "unclear"),
    met: sorted.filter(i => i.answer === "yes"),
  };
}
export const tally = (items: readonly Item[]) => ({
  points: items.reduce((n, i) => n + i.points, 0),
  of: items.reduce((n, i) => n + Math.max(0, i.weight), 0),
});

export const risksOf = (concerns: string | null) =>
  (concerns ?? "")
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map(s => s.replace(/^[-•\s]+/, "").trim())
    .filter(s => s && !NOISE.test(s));

export const resumeChangesOf = (changes: string | null) =>
  (changes ?? "")
    .split("\n")
    .map(l => l.replace(/^[-•\s]+/, "").trim())
    .filter(l => l && !NOISE.test(l));

export function resumeNote(j: Pick<JobDetail, "resumeFrozen" | "submitted_at" | "resume_changes">) {
  if (j.resumeFrozen) return j.submitted_at ? "As submitted" : "Locked for this application";
  const n = resumeChangesOf(j.resume_changes).length;
  return n ? `${n} ${n === 1 ? "change" : "changes"} from your base resume` : "Your base resume";
}

const AGENTS = { yes: "Agent-native", no: "Behind on agent adoption", unclear: "Not clear from the posting" };
const LISTED = { frontier: "On your frontier list", practice: "On your practice list" };

export interface Practice {
  verdict: "Eligible" | "Not eligible" | "Not assessed";
  qualifies: boolean;
  reason: string;
  rows: (readonly [label: string, value: string, evidence: string])[];
}
export function practiceOf(j: Pick<JobDetail, "practice_assessment">, targets: Summary["targets"]): Practice | null {
  if (!targets.holdBack && !j.practice_assessment) return null;
  const pa = parsePracticeAssessment(j.practice_assessment);
  if (!pa)
    return {
      verdict: "Not assessed",
      qualifies: false,
      reason: "No valid practice assessment is recorded, so this job is treated as not for practice until it is assessed again",
      rows: [],
    };
  const { qualifies, reason } = practiceVerdict(pa, !!targets.describe);
  return {
    verdict: qualifies ? "Eligible" : "Not eligible",
    qualifies,
    reason: cap(reason.replace(/^practice: /, "")),
    rows: [
      ...(pa.listed ? [["Your lists", LISTED[pa.listed], ""] as const] : []),
      [
        "Employer",
        pa.target === "yes"
          ? "A target employer"
          : pa.target === "no"
            ? "Not a target employer"
            : pa.employerEvidence
              ? "Not judged against targets"
              : "Not judged",
        pa.employerEvidence,
      ],
      ["Agent adoption", pa.agentNative ? AGENTS[pa.agentNative] : "Not judged", pa.agentNativeEvidence],
    ],
  };
}

export function enteredOf(raw: string): { rows: (readonly [label: string, value: string])[] } | { text: string } {
  const text = raw.replace(/\/\S*\/data\/jobs\/\S*\/([^/\s]+)/g, "$1");
  let lines = text.split("\n").filter(l => l.trim());
  const prose = lines.length < 3;
  if (prose)
    lines = text
      .split(/(?<=[^A-Z.]\.)\s+(?=[A-Z"])/)
      .filter(l => l.trim())
      .map(l => l.replace(/\.$/, ""));
  const rows: [string, string][] = [];
  for (const line of lines) {
    const m = /^([^:]{2,60}):\s+(.*)$/s.exec(line),
      last = rows.at(-1);
    if (m) rows.push([m[1] ?? "", m[2] ?? ""]);
    else if (last && !prose) last[1] += "\n" + line;
    else rows.push(["", line]);
  }
  return rows.length < 3 ? { text } : { rows: rows.map(([k, v]) => [k, v.trim()] as const) };
}

const day = (s: string) => new Date(`${s}T00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
export const stepAt = (s: string) => (s.length === 10 ? day(s) : dateTime(parseAt(s)));
export const stepMs = (s: string) => (s.length === 10 ? Date.parse(`${s}T23:59:59`) : parseAt(s));
export const localInput = (s: string | null) => {
  if (!s || s.length === 10) return "";
  const d = new Date(parseAt(s));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const isOpenStep = (s: Pick<Step, "state">) => s.state === "todo" || s.state === "done" || s.state === "scheduled";
export function stepStateOf(s: Pick<Step, "state" | "due_at" | "scheduled_at">, now = Date.now()): { label: string; tone: Tone; waiting?: true } {
  if (s.state === "todo") return s.due_at && stepMs(s.due_at) < now ? { label: "Overdue", tone: "danger" } : { label: "To do", tone: "warning" };
  if (s.state === "done") return { label: "Done", tone: "success", waiting: true };
  if (s.state === "scheduled")
    return s.scheduled_at && stepMs(s.scheduled_at) > now ? { label: "Booked", tone: "info" } : { label: "Held", tone: "success", waiting: true };
  return s.state === "expired" ? { label: "Expired", tone: "danger" } : { label: cap(s.state), tone: "neutral" };
}

export function leadOf(j: Pick<JobDetail, "status" | "note" | "updated_at" | "submitted_at" | "next" | "company" | "steps">, now = Date.now()) {
  const n = j.next;
  const which = n && j.steps.filter(isOpenStep).length > 1 ? `: ${brief(n.label, j.company)}` : "";
  const note = j.note ? `: ${j.note}` : "";
  if (j.status === "offer") return { tone: "success" as Tone, text: `Offer${note}` };
  if (ENDED.includes(j.status)) return { tone: "neutral" as Tone, text: `${j.status === "withdrawn" ? "Withdrawn" : "Declined"} ${ago(j.updated_at)}${note}` };
  if (!n) return { tone: "neutral" as Tone, text: `Sent ${ago(j.submitted_at)}. No reply yet.` };
  if (n.whose === "you") return { tone: "warning" as Tone, text: `Your move${which}${n.due ? `, due ${stepAt(n.at)}` : ""}` };
  if (n.whose === "upcoming") return { tone: "info" as Tone, text: `Booked for ${stepAt(n.at)}${which}` };
  const days = Math.floor((now - stepMs(n.at)) / DAY);
  if (n.quiet) return { tone: "warning" as Tone, text: `No reply from ${j.company} for ${days} days since ${stepAt(n.at)}. Worth a nudge?` };
  return { tone: "neutral" as Tone, text: `Waiting on ${j.company} since ${stepAt(n.at)}` };
}

const ACTED: Record<string, string> = {
  approve: "You approved it",
  reject: "You rejected it",
  hold: "You held it for later",
  redo: "You asked for a new resume",
  retry: "You sent it back to the queue",
  respond: "You responded",
  mark_submitted: "You marked it submitted",
  confirmed_not_submitted: "You verified it was not submitted",
  mark_offer: "You marked an offer",
  mark_declined: "You marked it declined",
  withdraw: "You withdrew",
  reopen_application: "You put it back in process",
};
const WORKER: Record<string, string> = {
  fill: "Application agent",
  prep: "Assessment",
  screen: "Screening",
  track: "Mailbox",
  locate: "Locator",
  recheck: "Recheck",
  interview: "Interview prep",
};
export const workerName = (w: string | null) => (w ? (WORKER[w] ?? cap(w)) : "App");

export type Entry =
  | { type: "status"; at: number; from: Status; to: Status; note: string | null; auto: boolean }
  | { type: "blocker"; at: number; cause: JobDetail["blockers"][number]["cause"]; detail: string }
  | { type: "event"; at: number; title: string; detail: string; tone: Tone }
  | { type: "run"; at: number; from: number; worker: string; steps: string[] };

export function timelineOf(j: Pick<JobDetail, "history" | "blockers" | "events">): Entry[] {
  const raw: (Entry | { type: "step"; at: number; worker: string; message: string })[] = [
    ...j.history.map(h => ({ type: "status" as const, at: parseAt(h.at), from: h.from_status, to: h.to_status, note: h.note, auto: h.approved_by === "auto" })),
    ...j.blockers.map(b => ({ type: "blocker" as const, at: parseAt(b.at), cause: b.cause, detail: b.detail })),
  ];
  for (const e of j.events) {
    const at = parseAt(e.at);
    if (e.kind === "tool") continue;
    if (e.kind === "step") {
      raw.push({ type: "step", at, worker: e.worker ?? "", message: e.message });
      continue;
    }
    if (e.kind === "user") {
      const [, action = "", text = ""] = /^(\w+)(?::\s*(.*))?$/s.exec(e.message) ?? [];
      const title = ACTED[action];
      raw.push(title ? { type: "event", at, title, detail: text, tone: "accent" } : { type: "event", at, title: "You", detail: e.message, tone: "accent" });
      continue;
    }
    if (/^\w+ worker aborted:\s*$/.test(e.message)) continue;
    const tone: Tone = e.kind === "error" ? "danger" : e.kind === "gate" ? "warning" : e.kind === "mail" ? "info" : "neutral";
    const title = e.kind === "mail" ? "Email from the employer" : e.kind === "gate" ? "Stopped to ask you" : workerName(e.worker);
    const detail = e.kind === "mail" || e.kind === "gate" ? e.message.replace(/^\w+:\s*/, "") : e.message;
    raw.push({ type: "event", at, title, detail, tone });
  }
  const said = (e: (typeof raw)[number]) => (e.type === "status" ? (e.note ?? "") : e.type === "blocker" || e.type === "event" ? e.detail : "");
  const twin = (a: (typeof raw)[number], b: (typeof raw)[number]) => a !== b && Math.abs(a.at - b.at) <= 2000 && !!said(a) && said(a) === said(b);
  const mine = (e: (typeof raw)[number]) => e.type === "event" && e.tone === "accent";
  const kept = raw.filter(e =>
    e.type === "event"
      ? mine(e) || !raw.some(o => (o.type === "status" || o.type === "blocker") && twin(e, o))
      : e.type !== "status" || !raw.some(o => mine(o) && twin(e, o)),
  );
  kept.sort((a, b) => b.at - a.at || Number(b.type === "status") - Number(a.type === "status"));
  const out: Entry[] = [];
  for (const e of kept) {
    if (e.type !== "step") {
      out.push(e);
      continue;
    }
    const last = out.at(-1);
    if (last?.type === "run" && last.worker === e.worker) {
      last.steps.push(e.message);
      last.from = e.at;
    } else out.push({ type: "run", at: e.at, from: e.at, worker: e.worker, steps: [e.message] });
  }
  return out;
}
