// How each section is laid out: named parts in order, `of` picks a job's part, and `key` ranks jobs inside one
// (higher first). Applying in a posting's first hours matters most, so the lists to decide on lead with age.
import type { ListedJob } from "../src/api-types";
import { activeTest, age, HOUR, JOB_FILTERS } from "./filters";
import { state, ui } from "./store";
import { STUCK, VIEWS, type ViewKey } from "./views";

interface Section {
  parts: readonly (readonly [label: string, hint?: string | undefined, cls?: string])[];
  of: (j: ListedJob) => number;
  key: (j: ListedJob) => number;
}
const BANDS: readonly (readonly [label: string, hours: number, hint?: string])[] = [
  ["Just opened", 6, "last 6 hours"],
  ["Today", 24, "last 24 hours"],
  ["This week", 168],
  ["Older", Infinity],
];
const byAge: Section = {
  parts: BANDS.map(([label, , hint], i) => [label, hint, i ? "" : "hot"] as const),
  of: j => BANDS.findIndex(b => age(j) < b[1] * HOUR),
  key: j => j.score ?? -1,
};
const sent = (j: ListedJob) => Date.parse(j.submitted_at ?? j.updated_at.replace(" ", "T") + "Z");
const SECTIONS: Partial<Record<ViewKey, Section>> = {
  review: byAge,
  held: byAge,
  progress: {
    parts: [["Needs you", "", "hot"], ["Applying"], ["Assessing"], ["Waiting to be assessed", "newest first"]],
    of: j => (STUCK.includes(j.status) ? 0 : ["filling", "approved"].includes(j.status) ? 1 : j.status === "triaged" ? 3 : 2),
    key: j => (j.status === "triaged" ? j.opened_at : (j.score ?? -1)),
  },
  applied: {
    parts: [["Interviews and offers"], ["Awaiting reply"], ["Declined"]],
    of: j => (["offer", "interview"].includes(j.status) ? 0 : j.status === "submitted" ? 1 : 2),
    key: sent,
  },
};
const PLAIN: Section = { parts: [[""]], of: () => 0, key: j => j.score ?? -1 };

export const KEEP = 2; // roles shown per employer in one part before the rest fold away
const unfolded = new Set<string>();
export const toggleFold = (id: string) => {
  if (!unfolded.delete(id)) unfolded.add(id);
};

// One employer's roles inside a part.
interface Run {
  id: string;
  company: string;
  jobs: ListedJob[];
  long: boolean;
  open: boolean;
  shown: ListedJob[];
}
interface Part {
  label: string;
  hint: string | undefined;
  cls: string | undefined;
  n: number;
  runs: Run[];
}

// A view's jobs, in parts; inside a part an employer's roles sit together, best first, and a long run folds.
export function layout(k: ViewKey = ui.view, filtered = true): { parts: Part[]; all: ListedJob[] } {
  const statuses = VIEWS[k].statuses;
  if (!statuses) return { parts: [], all: [] };
  const keep = (filtered ? activeTest(JOB_FILTERS[k] ?? [], k) : null) ?? (() => true);
  const terms = (ui.query[k] ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const found = (j: ListedJob) => terms.every(w => `${j.title} ${j.company} ${j.location ?? ""} ${j.source}`.toLowerCase().includes(w));
  const all = state().jobs.filter(j => statuses.includes(j.status) && found(j) && keep(j));
  const sec = SECTIONS[k] ?? PLAIN;
  const byEmployer = sec.parts.map(() => new Map<string, ListedJob[]>());
  for (const j of all) {
    const by = byEmployer[sec.of(j)];
    if (!by) continue;
    const jobs = by.get(j.company);
    if (jobs) jobs.push(j);
    else by.set(j.company, [j]);
  }
  const parts = sec.parts.map(([label, hint, cls], i): Part => {
    const groups = [...(byEmployer[i]?.values() ?? [])];
    const runs = groups
      .flatMap(jobs => {
        jobs.sort((a, b) => sec.key(b) - sec.key(a));
        const best = jobs[0];
        if (!best) return [];
        const id = `${k}|${label}|${best.company}`,
          long = jobs.length > KEEP + 1 && !terms.length;
        const open = !long || unfolded.has(id) || jobs.slice(KEEP).some(j => j.id === ui.selected);
        return [{ id, company: best.company, jobs, long, open, shown: open ? jobs : jobs.slice(0, KEEP), rank: sec.key(best) }];
      })
      .sort((a, b) => b.rank - a.rank || a.company.localeCompare(b.company));
    return { label, hint, cls, n: groups.reduce((n, jobs) => n + jobs.length, 0), runs };
  });
  return { parts: parts.filter(p => p.n), all };
}
// What J/K and "next" walk through: the rows on screen, so folded roles are skipped.
export const ordered = (k: ViewKey = ui.view, filtered = true) => layout(k, filtered).parts.flatMap(p => p.runs.flatMap(r => r.shown));
