// How each section is laid out: named parts in order, `of` picks a job's part, and `key` ranks jobs inside one
// (higher first). Applying in a posting's first hours matters most, so the lists to decide on lead with age.
// The long tails (the machine's backlog, declined applications, the bulk of Held) start collapsed, and an open
// part shows at most CAP rows, so a section of 2,000 jobs still opens on what needs the user.
import type { ListedJob } from "../src/api-types";
import type { Status } from "../src/status";
import { activeTest, age, HOUR, JOB_FILTERS } from "./filters";
import { state, ui } from "./store";
import { VIEWS, type ViewKey } from "./views";

interface PartSpec {
  label: string;
  hint?: string;
  cls?: string;
  collapsed?: boolean; // starts as a one-line header
  statuses?: readonly Status[]; // exactly what the part holds, so its header can give the true total
  link?: readonly [href: string, text: string]; // where this kind of job is better dealt with
}
interface Section {
  parts: readonly PartSpec[];
  of: (j: ListedJob) => number;
  key: (j: ListedJob) => number;
  runs?: boolean; // keep an employer's roles together (and fold long runs); off for chronological lists
}
const BANDS: readonly (readonly [label: string, hours: number, hint?: string])[] = [
  ["Just opened", 6, "last 6 hours"],
  ["Today", 24, "last 24 hours"],
  ["This week", 168],
  ["Older", Infinity],
];
// A time the server wrote, as ISO or as SQLite's "YYYY-MM-DD HH:MM:SS" in UTC, in ms. A bare day (a step's deadline) is its start.
export const stamp = (s: string | null | undefined) => (s ? Date.parse(s.length === 10 || s.includes("T") ? s : s.replace(" ", "T") + "Z") : 0);
export const sentAt = (j: ListedJob) => stamp(j.submitted_at ?? j.updated_at);

// What a stuck job waits for, from its open gate: a needs_input job may want a letter rather than an answer.
const KIND_LABEL: Record<string, string> = {
  question: "Question",
  cover_letter: "Cover letter",
  confirm_submit: "Confirm submit",
  manual: "Browser hand-off",
  submission_ambiguous: "Check if it was sent",
};
let kinds: { from: unknown; by: Map<number, string> } = { from: null, by: new Map() };
export const gateLabel = (j: Pick<ListedJob, "id">) => {
  const groups = state().questionGroups;
  if (kinds.from !== groups) kinds = { from: groups, by: new Map(groups.flatMap(g => g.jobs.map(x => [x.id, g.kind] as const))) };
  const k = kinds.by.get(j.id);
  return k ? (KIND_LABEL[k] ?? null) : null;
};

const QUEUED: readonly Status[] = ["approved", "filling"],
  UNASSESSED: readonly Status[] = ["triaged", "locating", "prepping"];
const SECTIONS: Partial<Record<ViewKey, Section>> = {
  review: {
    parts: BANDS.map(([label, , hint], i) => ({ label, ...(hint ? { hint } : {}), ...(i ? {} : { cls: "new" }) })),
    of: j => BANDS.findIndex(b => age(j) < b[1] * HOUR),
    key: j => j.score ?? -1,
    runs: true,
  },
  // What waits on the user, by what it waits for; the machine's own queues stay folded underneath.
  progress: {
    parts: [
      { label: "Confirm submit", cls: "hot" },
      { label: "Browser hand-off", cls: "hot" },
      { label: "Cover letter", cls: "hot" },
      { label: "Questions", cls: "hot", link: ["#questions", "Answer in Questions"] },
      { label: "Failed", cls: "bad" },
      { label: "Queued to apply", collapsed: true, statuses: QUEUED },
      { label: "Waiting to be assessed", collapsed: true, statuses: UNASSESSED },
    ],
    of: j =>
      j.status === "awaiting_submit"
        ? 0
        : j.status === "needs_manual"
          ? 1
          : j.status === "needs_input"
            ? gateLabel(j) === "Cover letter"
              ? 2
              : 3
            : j.status === "failed"
              ? 4
              : QUEUED.includes(j.status)
                ? 5
                : 6,
    // Stuck: longest waiting first. Queued: best first. Not assessed yet: newest posting first.
    key: j => (QUEUED.includes(j.status) ? (j.score ?? -1) : UNASSESSED.includes(j.status) ? j.opened_at : -stamp(j.updated_at)),
  },
  // Sent applications by whose move it is (from their steps): the user's first, then what is booked, then
  // what waits on the employer, the longest quiet first.
  applied: {
    parts: [
      { label: "Offers", cls: "hot", statuses: ["offer"] },
      { label: "Your move", cls: "hot", hint: "soonest due first" },
      { label: "Upcoming", hint: "soonest first" },
      { label: "Waiting on them", hint: "longest quiet first" },
      { label: "Awaiting first reply", hint: "newest first" },
      { label: "Declined or withdrawn", collapsed: true, statuses: ["rejected_by_company", "withdrawn"] },
    ],
    of: j =>
      j.status === "offer"
        ? 0
        : j.status === "rejected_by_company" || j.status === "withdrawn"
          ? 5
          : j.next?.whose === "you"
            ? 1
            : j.next?.whose === "upcoming"
              ? 2
              : j.next || j.status === "interview"
                ? 3
                : 4,
    key: j => (j.status === "rejected_by_company" || j.status === "withdrawn" ? stamp(j.updated_at) : j.next ? -stamp(j.next.at) : sentAt(j)),
  },
  // An archive: the strong matches are worth a look, the rest stay folded away.
  held: {
    parts: [
      { label: "Strong match", hint: "80+" },
      { label: "Everything else", collapsed: true },
    ],
    of: j => ((j.score ?? 0) >= 80 ? 0 : 1),
    key: j => j.score ?? -1,
    runs: true,
  },
  rejected: { parts: [{ label: "" }], of: () => 0, key: j => stamp(j.updated_at) },
};
const PLAIN: Section = { parts: [{ label: "" }], of: () => 0, key: j => j.score ?? -1 };

export const KEEP = 2; // roles shown per employer in one part before the rest fold away
export const CAP = 50; // rows an open part shows before "Show more"
const unfolded = new Set<string>();
export const toggleFold = (id: string) => {
  if (!unfolded.delete(id)) unfolded.add(id);
};
const flipped = new Set<string>(); // parts the user opened or closed against their default
const more = new Map<string, number>(); // part -> rows it shows, once raised past CAP
export const togglePart = (id: string) => {
  if (!flipped.delete(id)) flipped.add(id);
  more.delete(id);
};
export const showMore = (id: string) => more.set(id, (more.get(id) ?? CAP) + CAP);

// One employer's roles inside a part (a single job when the section does not group by employer).
interface Run {
  id: string;
  company: string;
  jobs: ListedJob[];
  long: boolean;
  open: boolean;
  shown: ListedJob[];
}
export interface Part extends PartSpec {
  id: string;
  n: number; // jobs in the part, as loaded and filtered
  total: number; // the true total when the part is a set of statuses and nothing narrows it, else n
  open: boolean;
  hidden: number; // rows held back by the cap
  runs: Run[];
}

// A view's jobs, in parts; inside a part an employer's roles sit together, best first, and a long run folds.
export function layout(k: ViewKey = ui.view, filtered = true): { parts: Part[]; all: ListedJob[] } {
  const statuses = VIEWS[k].statuses;
  if (!statuses) return { parts: [], all: [] };
  const S = state(),
    test = filtered ? activeTest(JOB_FILTERS[k] ?? [], k) : null,
    keep = test ?? (() => true);
  const terms = (ui.query[k] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = (j: ListedJob) => terms.every(w => `${j.title} ${j.company} ${j.location ?? ""} ${j.source}`.toLowerCase().includes(w));
  const all = S.jobs.filter(j => statuses.includes(j.status) && found(j) && keep(j));
  const sec = SECTIONS[k] ?? PLAIN;
  const groups = sec.parts.map(() => new Map<string, ListedJob[]>());
  for (const j of all) {
    const by = groups[sec.of(j)];
    if (!by) continue;
    const key = sec.runs ? j.company : String(j.id);
    const jobs = by.get(key);
    if (jobs) jobs.push(j);
    else by.set(key, [j]);
  }
  const parts = sec.parts.map((spec, i): Part => {
    const id = `${k}|${spec.label}`,
      lists = [...(groups[i]?.values() ?? [])],
      n = lists.reduce((n, jobs) => n + jobs.length, 0);
    const runs = lists
      .flatMap(jobs => {
        jobs.sort((a, b) => sec.key(b) - sec.key(a));
        const best = jobs[0];
        if (!best) return [];
        const rid = `${id}|${best.company}`,
          long = !!sec.runs && jobs.length > KEEP + 1 && !terms.length;
        const open = !long || unfolded.has(rid) || jobs.slice(KEEP).some(j => j.id === ui.selected);
        return [{ id: rid, company: best.company, jobs, long, open, shown: open ? jobs : jobs.slice(0, KEEP), rank: sec.key(best) }];
      })
      .sort((a, b) => b.rank - a.rank || (b.jobs[0]?.id ?? 0) - (a.jobs[0]?.id ?? 0) || a.company.localeCompare(b.company, undefined, { numeric: true }));
    // A search opens every part, and so does holding the open job: what is asked for should be on screen.
    const open = terms.length > 0 || runs.some(r => r.jobs.some(j => j.id === ui.selected)) || !spec.collapsed !== flipped.has(id);
    // Cap the rows, cutting between runs; the open job's run always makes it in.
    let room = more.get(id) ?? CAP,
      hidden = 0;
    for (const r of runs) {
      if (!open) r.shown = [];
      else if (room <= 0 && !r.jobs.some(j => j.id === ui.selected)) {
        hidden += r.shown.length;
        r.shown = [];
      } else room -= r.shown.length;
    }
    const counted = spec.statuses && !terms.length && !test ? spec.statuses.reduce((t, s) => t + (S.counts[s] ?? 0), 0) : 0;
    return { ...spec, id, n, total: Math.max(n, counted), open, hidden, runs };
  });
  return { parts: parts.filter(p => p.n), all };
}
// What J/K and "next" walk through: the rows on screen, so folded, collapsed and capped-away roles are skipped.
export const ordered = (k: ViewKey = ui.view, filtered = true) => layout(k, filtered).parts.flatMap(p => p.runs.flatMap(r => r.shown));
