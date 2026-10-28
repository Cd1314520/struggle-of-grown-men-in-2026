import type { ListedJob } from "./api-types";
import { config, describing } from "./config";
import { countByCompany, lastMovedFrom, listedJobs, openedAt } from "./db";
import { homeOf, nearHome } from "./home";
import { openGateKinds, type GateKind } from "./questions";
import { parsePracticeAssessment, rubricOf } from "./practice";
import { setAsideReason, type Reason } from "./reasons";
import type { Status } from "./status";
import { nextSteps, type NextStep } from "./steps";

export const LIST_VIEWS = ["review", "pipeline", "applications", "held", "rejected"] as const;
export type ListView = (typeof LIST_VIEWS)[number];
export const isListView = (v: unknown): v is ListView => LIST_VIEWS.includes(v as ListView);

export const SENT: readonly Status[] = ["submitted", "interview", "offer", "rejected_by_company", "withdrawn"];
const VIEW_STATUSES: Record<ListView, readonly Status[]> = {
  review: ["awaiting_approval"],
  pipeline: ["awaiting_submit", "needs_input", "needs_manual", "failed", "filling", "approved", "prepping", "locating", "triaged"],
  applications: ["offer", "interview", "submitted", "rejected_by_company", "withdrawn"],
  held: ["held"],
  rejected: ["rejected"],
};

export interface ListRow extends ListedJob {
  group: string;
  gate: GateKind | null;
  appliedThere: number;
  companyCount: number;
  reason: Reason | null;
  rubric: "practice" | "real";
}
export interface ListGroup {
  key: string;
  label: string;
  count: number;
}
export interface ListResult {
  view: ListView;
  rows: ListRow[];
  total: number;
  offset: number;
  limit: number;
  groups: ListGroup[];
  filters: ListGroup[];
  all: number;
  focusIndex: number | null;
  focusGroup: string | null;
}
export interface ListQuery {
  view: ListView;
  group?: string | null;
  q?: string | null;
  filters?: readonly string[];
  sort?: string | null;
  offset?: number;
  limit?: number;
  focus?: number | null;
}

const HOUR = 3600_000;
const stamp = (s: string | null | undefined) => (s ? Date.parse(s.length === 10 || s.includes("T") ? s : s.replace(" ", "T") + "Z") : 0);

interface Spec {
  groups: readonly (readonly [key: string, label: string])[];
  of: (j: ListRow) => string;
  sorts: Record<string, (a: ListRow, b: ListRow) => number>;
}
const byScore = (a: ListRow, b: ListRow) => (b.score ?? -1) - (a.score ?? -1) || b.opened_at - a.opened_at;
const byNewest = (a: ListRow, b: ListRow) => b.opened_at - a.opened_at;
const byUpdated = (a: ListRow, b: ListRow) => stamp(b.updated_at) - stamp(a.updated_at);
const byCompany = (a: ListRow, b: ListRow) => a.company.localeCompare(b.company) || byScore(a, b);
const sentAt = (j: ListRow) => stamp(j.submitted_at ?? j.updated_at);

const QUEUED: readonly Status[] = ["approved", "filling"];
const UNASSESSED: readonly Status[] = ["triaged", "locating", "prepping"];
const CLOSED: readonly Status[] = ["rejected_by_company", "withdrawn"];

const SPECS: Record<ListView, Spec> = {
  review: {
    groups: [
      ["new", "Just opened"],
      ["today", "Today"],
      ["week", "This week"],
      ["older", "Older"],
    ],
    of: j => {
      const age = Date.now() - j.opened_at;
      return age < 6 * HOUR ? "new" : age < 24 * HOUR ? "today" : age < 168 * HOUR ? "week" : "older";
    },
    sorts: { newest: byNewest, score: byScore, company: byCompany },
  },
  pipeline: {
    groups: [
      ["needs_you", "Needs you"],
      ["questions", "Waiting on answers"],
      ["failed", "Failed"],
      ["applying", "Applying"],
      ["assessing", "Assessing"],
    ],
    of: j =>
      j.status === "failed"
        ? "failed"
        : j.status === "needs_input" && j.gate === "question"
          ? "questions"
          : ["awaiting_submit", "needs_input", "needs_manual"].includes(j.status)
            ? "needs_you"
            : QUEUED.includes(j.status)
              ? "applying"
              : "assessing",
    sorts: {
      default: (a, b) =>
        (QUEUED.includes(a.status) && QUEUED.includes(b.status)) || (UNASSESSED.includes(a.status) && UNASSESSED.includes(b.status))
          ? byNewest(a, b)
          : stamp(a.updated_at) - stamp(b.updated_at),
      newest: byNewest,
      updated: byUpdated,
      score: byScore,
    },
  },
  applications: {
    groups: [
      ["offer", "Offers"],
      ["your_move", "Your move"],
      ["upcoming", "Upcoming"],
      ["waiting", "Waiting on them"],
      ["no_reply", "No reply yet"],
      ["closed", "Closed"],
    ],
    of: j =>
      j.status === "offer"
        ? "offer"
        : CLOSED.includes(j.status)
          ? "closed"
          : j.next?.whose === "you"
            ? "your_move"
            : j.next?.whose === "upcoming"
              ? "upcoming"
              : j.next || j.status === "interview"
                ? "waiting"
                : "no_reply",
    sorts: {
      default: (a, b) => {
        if (a.next && b.next && a.next.whose !== "them" && b.next.whose !== "them") return stamp(a.next.at) - stamp(b.next.at);
        return (b.next ? stamp(b.next.at) : sentAt(b)) - (a.next ? stamp(a.next.at) : sentAt(a));
      },
      sent: (a, b) => sentAt(b) - sentAt(a),
      updated: byUpdated,
      company: byCompany,
    },
  },
  held: {
    groups: [
      ["strong", "Strong match"],
      ["other", "Everything else"],
    ],
    of: j => ((j.score ?? 0) >= 80 ? "strong" : "other"),
    sorts: { score: byScore, newest: byNewest, company: byCompany },
  },
  rejected: {
    groups: [["all", "Rejected"]],
    of: () => "all",
    sorts: { updated: byUpdated, score: byScore, company: byCompany },
  },
};

type Filter = readonly [key: string, label: string, test: (j: ListRow) => boolean];
function filtersOf(view: ListView): Filter[] {
  const home = homeOf(config.boards?.location);
  const out: Filter[] = [];
  if (view === "review" || view === "held") out.push(["top", "Score 80+", j => (j.score ?? 0) >= 80]);
  out.push(["remote", "Remote", j => /remote|anywhere/i.test(j.location ?? "")]);
  if (home && view !== "applications") {
    const near = nearHome(home);
    out.push(["near", near.label, j => near.test(j.location, j.source)]);
  }
  if (view === "review" || view === "held") out.push(["first", "First at employer", j => j.appliedThere === 0]);
  return out;
}

function viewRows(view: ListView): ListRow[] {
  const jobs = listedJobs(VIEW_STATUSES[view]);
  const gates = openGateKinds(),
    applied = countByCompany(SENT),
    next: Map<number, NextStep> = view === "applications" ? nextSteps() : new Map<number, NextStep>();
  const here = new Map<string, number>();
  for (const j of jobs) here.set(j.company, (here.get(j.company) ?? 0) + 1);
  const from = view === "held" || view === "rejected" ? lastMovedFrom(jobs.filter(j => !j.note).map(j => j.id)) : null;
  const spec = SPECS[view];
  return jobs.map(({ practice_assessment, ...j }) => {
    const row: ListRow = {
      ...j,
      rubric: rubricOf(parsePracticeAssessment(practice_assessment), describing()),
      opened_at: openedAt(j),
      next: next.get(j.id) ?? null,
      gate: gates.get(j.id) ?? null,
      appliedThere: applied.get(j.company) ?? 0,
      companyCount: here.get(j.company) ?? 1,
      reason: from ? setAsideReason(j.note, from.get(j.id) ?? null) : null,
      group: "",
    };
    row.group = spec.of(row);
    return row;
  });
}

export function listJobs(query: ListQuery): ListResult {
  const { view } = query,
    spec = SPECS[view],
    offset = Math.max(0, query.offset ?? 0),
    limit = Math.min(500, Math.max(1, query.limit ?? 50));
  const all = viewRows(view);
  const terms = (query.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = terms.length
    ? all.filter(j => terms.every(w => `${j.title} ${j.company} ${j.location ?? ""} ${j.source} ${j.reason?.label ?? ""}`.toLowerCase().includes(w)))
    : all;
  const filters = filtersOf(view),
    active = filters.filter(f => query.filters?.includes(f[0]));
  const filtered = found.filter(j => active.every(f => f[2](j)));
  const group = spec.groups.some(([k]) => k === query.group) ? query.group : null;
  const inGroup = group ? filtered.filter(j => j.group === group) : filtered;
  const sort = spec.sorts[query.sort ?? ""] ?? Object.values(spec.sorts)[0] ?? byNewest;
  const order = new Map(spec.groups.map(([k], i) => [k, i]));
  const sorted = inGroup.sort((a, b) => (group || query.sort ? 0 : (order.get(a.group) ?? 0) - (order.get(b.group) ?? 0)) || sort(a, b));
  const inGroupOf = (rows: ListRow[]) => (group ? rows.filter(j => j.group === group) : rows);
  const focus = query.focus ? sorted.findIndex(j => j.id === query.focus) : -1;
  const start = focus >= 0 ? focus - (focus % limit) : offset;
  return {
    view,
    rows: sorted.slice(start, start + limit),
    total: sorted.length,
    offset: start,
    limit,
    groups: spec.groups.map(([key, label]) => ({ key, label, count: filtered.filter(j => j.group === key).length })),
    filters: filters.map(([key, label, test]) => ({ key, label, count: inGroupOf(found).filter(test).length })),
    all: all.length,
    focusIndex: focus >= 0 ? focus : null,
    focusGroup: query.focus ? (all.find(j => j.id === query.focus)?.group ?? null) : null,
  };
}
