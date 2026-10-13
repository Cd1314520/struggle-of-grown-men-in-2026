// Quick filters per section: [key, label, test]. The first entry of each is "All".
import type { ListedJob } from "../src/api-types";
import type { Status } from "../src/status";
import { state, ui } from "./store";
import { esc } from "./util";
import { STUCK, type ViewKey } from "./views";

export type Filter<T> = readonly [key: string, label: string | null, test?: (item: T) => boolean];
type JobFilter = Filter<ListedJob>;

export const HOUR = 36e5;
export const age = (j: { opened_at: number }) => Date.now() - j.opened_at; // opened_at: the server's estimate of when the posting opened

const all = ["all", "All"] as const;
const is =
  (...statuses: Status[]) =>
  (j: ListedJob) =>
    statuses.includes(j.status);
const high: JobFilter = ["top", "80+", j => (j.score ?? 0) >= 80];
const isRemote: JobFilter = ["remote", "Remote", j => /remote|anywhere/i.test(j.location ?? "")];
const fresh: JobFilter = ["new", "Last 24h", j => age(j) < 24 * HOUR];
// Near home: found by the local LinkedIn/Indeed search, or the location names the city. The label is the city.
const near: JobFilter = [
  "near",
  null,
  j => {
    const home = state().home;
    return !!home && (["linkedin", "indeed"].includes(j.source) || (j.location ?? "").toLowerCase().includes(home.toLowerCase()));
  },
];
export const JOB_FILTERS: Partial<Record<ViewKey, readonly JobFilter[]>> = {
  review: [all, high, fresh, near, isRemote],
  progress: [
    all,
    ["stuck", "Needs you", is(...STUCK)],
    ["applying", "Applying", is("filling", "approved")],
    ["assessing", "Assessing", is("prepping", "triaged", "locating")],
    ["failed", "Failed", is("failed")],
  ],
  applied: [
    all,
    ["waiting", "Awaiting reply", is("submitted")],
    ["interview", "Interview", is("interview", "offer")],
    ["declined", "Declined", is("rejected_by_company")],
  ],
  held: [all, high, near, isRemote],
  rejected: [all, high, near, isRemote],
};
export const ACTIVITY_FILTERS: readonly Filter<{ kind: string }>[] = [
  all,
  ["gate", "Needs you", e => e.kind === "gate"],
  ["user", "You", e => e.kind === "user"],
  ["error", "Errors", e => e.kind === "error"],
  ["system", "Scans", e => e.kind === "system"],
];

// The test of the chip chosen in a section, or null when that is "All".
export const activeTest = <T>(filters: readonly Filter<T>[], k: ViewKey) => filters.find(f => f[0] === ui.filt[k] && f[2])?.[2] ?? null;

// Chips with a count; ones that would show nothing are left out, and so is the bar when only "All" remains.
export function filterBar<T>(items: readonly T[], filters: readonly Filter<T>[], k: ViewKey) {
  const chips = filters
    .map(([key, label, test]) => ({ key, label, n: test ? items.filter(test).length : items.length }))
    .filter(({ key, n }, i) => i === 0 || (n > 0 && n < items.length) || key === ui.filt[k]);
  const on = filters.find(f => f[0] === ui.filt[k] && f[2])?.[0] ?? "all";
  if (chips.length < 2) return "";
  const chip = ({ key, label, n }: (typeof chips)[number]) =>
    `<button class="fchip ${key === on ? "on" : ""}" data-filter="${key}" aria-pressed="${String(key === on)}">${label ?? `Near ${esc(state().home)}`}<i>${n}</i></button>`;
  return `<div class="filters" role="toolbar" aria-label="Filter">${chips.map(chip).join("")}</div>`;
}
