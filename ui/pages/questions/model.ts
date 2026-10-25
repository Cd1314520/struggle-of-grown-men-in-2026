// What the Questions page shows, worked out from the open gates: no React here.
import type { GateKind, QuestionGroup } from "../../../src/questions";
import { DAY } from "../../lib/format";

export type Job = QuestionGroup["jobs"][number];

// Only questions are answered here; the other gates are dealt with on their application in Pipeline.
export const isQuestion = (g: QuestionGroup) => g.kind === "question";

// Fixed choices few enough to number: one keypress answers.
export const MAX_KEYED = 8;

// Forms list a "Select…" entry first; picking it would answer nothing.
const PLACEHOLDER = /^\W*(select|choose|please (select|choose))( an?| one)?( option| answer)?\W*$|^\W*no answer\W*$|^\W*$/i;
export const choices = (g: QuestionGroup) => g.options.filter(o => !PLACEHOLDER.test(o));

// Forms mark required fields with a trailing asterisk; the question reads better without it.
export const questionText = (text: string) => text.replace(/\s*\*+\s*$/, "").trim();

// Lines every form carries that say nothing about this question.
const BOILERPLATE =
  /^\**\s*(\(?required( field| question| information| free-text (field|question))?\)?\s*(\(\*\))?|(the )?fields marked with (an )?(\*|asterisk \(\*?\)) are (required|mandatory)|(indicates|denotes) (a )?required( field)?|this (info|information|field) is required|please (answer|complete) the following( questions| questionnaire)?[.:]?)\.?$/i;

// The form's wording around the question, without the line that repeats the question itself.
export function contextText(g: QuestionGroup) {
  const norm = (s: string) => questionText(s).replace(/\s+/g, " ").toLowerCase();
  const q = norm(g.text);
  return g.context
    .split("\n")
    .map(line => line.trim())
    .filter(line => norm(line) !== q && !BOILERPLATE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// A search over the queue: the question, the employer, the role.
export const matches = (g: QuestionGroup, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean),
    hay = [g.text, ...g.jobs.flatMap(j => [j.company, j.title])].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
};

// How long ago the newest posting asking it opened: an answer is worth most while the posting is new.
const BUCKETS = [
  ["Older", 7 * DAY],
  ["This week", DAY],
] as const;
export const bucket = (g: QuestionGroup, now = Date.now()) => BUCKETS.find(([, ms]) => now - g.openedAt > ms)?.[0] ?? "Opened today";

// The queue in server order (newest posting first), cut where the bucket changes.
export function sections(groups: readonly QuestionGroup[]) {
  const out: { label: string; groups: QuestionGroup[] }[] = [];
  for (const g of groups) {
    const label = bucket(g),
      last = out.at(-1);
    if (last?.label === label) last.groups.push(g);
    else out.push({ label, groups: [g] });
  }
  return out;
}

// After an answer, where to go: this question while other applications still ask it, then the next question the
// same application asks (it is still blocked), then the next in order, then the first.
export function nextAfter(answered: QuestionGroup, before: readonly string[], left: readonly QuestionGroup[]) {
  const at = before.indexOf(answered.key),
    jobs = new Set(answered.jobs.map(j => j.id));
  return (
    left.find(g => g.key === answered.key) ??
    left.find(g => !before.includes(g.key) && g.jobs.some(j => jobs.has(j.id))) ??
    left.find(g => before.indexOf(g.key) > at) ??
    left[0]
  );
}

// The gates handled in Pipeline, counted by application, in the order they read.
const ELSEWHERE: readonly (readonly [GateKind, string, string])[] = [
  ["confirm_submit", "submit to confirm", "submits to confirm"],
  ["submission_ambiguous", "submission to check", "submissions to check"],
  ["manual", "browser hand-off", "browser hand-offs"],
  ["cover_letter", "cover letter", "cover letters"],
];
export function elsewhere(groups: readonly QuestionGroup[]) {
  const n = new Map<GateKind, number>();
  for (const g of groups) if (!isQuestion(g)) n.set(g.kind, (n.get(g.kind) ?? 0) + g.jobs.length);
  const parts = ELSEWHERE.flatMap(([kind, one, many]) => {
    const c = n.get(kind) ?? 0;
    return c ? [`${c} ${c === 1 ? one : many}`] : [];
  });
  const total = [...n.values()].reduce((a, b) => a + b, 0);
  return { total, text: parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1) ?? ""}` : (parts[0] ?? "") };
}

// What the owner typed, per question, while they move around the queue. Kept for the visit.
export const drafts = new Map<string, string>();
