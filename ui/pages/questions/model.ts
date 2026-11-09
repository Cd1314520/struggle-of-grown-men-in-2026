import type { GateKind, QuestionGroup } from "../../../src/questions";
import { DAY } from "../../lib/format";

export type Job = QuestionGroup["jobs"][number];

export const isQuestion = (g: QuestionGroup) => g.kind === "question";

export const MAX_KEYED = 8;

const PLACEHOLDER = /^\W*(select|choose|please (select|choose))( an?| one)?( option| answer)?\W*$|^\W*no answer\W*$|^\W*$/i;
export const choices = (g: QuestionGroup) => g.options.filter(o => !PLACEHOLDER.test(o));

export const questionText = (text: string) => text.replace(/\s*\*+\s*$/, "").trim();

const BOILERPLATE =
  /^\**\s*(\(?required( field| question| information| free-text (field|question))?\)?\s*(\(\*\))?|(the )?fields marked with (an )?(\*|asterisk \(\*?\)) are (required|mandatory)|(indicates|denotes) (a )?required( field)?|this (info|information|field) is required|please (answer|complete) the following( questions| questionnaire)?[.:]?)\.?$/i;

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

export const matches = (g: QuestionGroup, q: string) => {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean),
    hay = [g.text, ...g.jobs.flatMap(j => [j.company, j.title])].join(" ").toLowerCase();
  return words.every(w => hay.includes(w));
};

const BUCKETS = [
  ["Older", 7 * DAY],
  ["This week", DAY],
] as const;
const askedAt = (g: QuestionGroup) => Date.parse(g.createdAt);
export const byAsked = (groups: readonly QuestionGroup[]) => [...groups].sort((a, b) => askedAt(b) - askedAt(a));
export const bucket = (g: QuestionGroup, now = Date.now()) => BUCKETS.find(([, ms]) => now - askedAt(g) > ms)?.[0] ?? "Today";

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

const ELSEWHERE: readonly (readonly [GateKind, string, string])[] = [
  ["submission_ambiguous", "to check", "to check"],
  ["confirm_submit", "to confirm", "to confirm"],
  ["manual", "hand\u2011off", "hand\u2011offs"],
  ["cover_letter", "cover letter", "cover letters"],
];
export function elsewhere(groups: readonly QuestionGroup[]) {
  const n = new Map<GateKind, number>();
  for (const g of groups) if (!isQuestion(g)) n.set(g.kind, (n.get(g.kind) ?? 0) + g.jobs.length);
  const parts = ELSEWHERE.flatMap(([kind, one, many]) => {
    const c = n.get(kind) ?? 0;
    return c ? [`${c} ${c === 1 ? one : many}`.replace(/ /g, "\u00a0")] : [];
  });
  const total = [...n.values()].reduce((a, b) => a + b, 0);
  return { total, text: parts.join(" · ") };
}

export const stale = (g: QuestionGroup, now = Date.now()) => bucket(g, now) === "Older";

export const queuedAfter = (g: QuestionGroup) => Math.max(0, ...g.jobs.map(j => j.queuedAfter));

export function employers(g: QuestionGroup, max = 3) {
  const names = [...new Set(g.jobs.map(j => j.company))];
  if (names.length <= max) return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}` : (names[0] ?? "");
  return `${names.slice(0, max - 1).join(", ")} and ${names.length - max + 1} more`;
}

const YES_NO = /^(yes|no)$/i;
export function shape(g: QuestionGroup) {
  const opts = choices(g);
  if (opts.length === 2 && opts.every(o => YES_NO.test(o.trim()))) return "Yes / No";
  if (opts.length === 1) return "One option";
  if (opts.length) return `Pick 1 of ${opts.length}`;
  return "Free text";
}

const COMMON = new Set(["whet", "when", "what", "whic", "that", "this", "with", "from", "have", "your", "they", "their", "there"]);
const stems = (s: string) => new Set((s.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).map(w => w.slice(0, 5)).filter(w => !COMMON.has(w.slice(0, 4))));
export function addsToQuestion(g: QuestionGroup) {
  if (!g.missing) return false;
  const q = stems(g.text),
    m = [...stems(g.missing)];
  return m.filter(w => !q.has(w)).length >= Math.max(3, m.length / 2);
}

const PRIVATE: readonly QuestionGroup["why"][] = ["agreement", "sensitive_id"];
export function bankByDefault(g: QuestionGroup) {
  if (g.kind !== "question" || PRIVATE.includes(g.why)) return false;
  const names = g.jobs
    .map(j =>
      j.company
        .toLowerCase()
        .replace(/\s*\(.*\)\s*/g, "")
        .trim(),
    )
    .filter(n => n.length > 2);
  return !choices(g).some(o => names.some(n => o.toLowerCase().includes(n)));
}

export const drafts = new Map<string, string>();
