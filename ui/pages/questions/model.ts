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
export const bucket = (g: QuestionGroup, now = Date.now()) => BUCKETS.find(([, ms]) => now - g.openedAt > ms)?.[0] ?? "Opened today";

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

export const drafts = new Map<string, string>();
