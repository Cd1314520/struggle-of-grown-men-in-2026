// Quick filters per section: [key, label, test]. The first entry of each is "All".
import type { ListedJob } from "../src/api-types";
import { state, ui } from "./store";
import { esc } from "./util";
import type { ViewKey } from "./views";

export type Filter<T> = readonly [key: string, label: string | null, test?: (item: T) => boolean];
type JobFilter = Filter<ListedJob>;

export const HOUR = 36e5;
export const age = (j: { opened_at: number }) => Date.now() - j.opened_at; // opened_at: the server's estimate of when the posting opened

const all = ["all", "All"] as const;
const high: JobFilter = ["top", "80+", j => (j.score ?? 0) >= 80];
const isRemote: JobFilter = ["remote", "Remote", j => /remote|anywhere/i.test(j.location ?? "")];
// Near home: found by the local LinkedIn/Indeed search, or the location names the city. The label is the city.
const near: JobFilter = [
  "near",
  null,
  j => {
    const home = state().home;
    return !!home && (["linkedin", "indeed"].includes(j.source) || (j.location ?? "").toLowerCase().includes(home.toLowerCase()));
  },
];
// Only where they cut across the section's own groups: In progress and Applied are grouped by what each job
// waits on, To review by age, so chips for those would only repeat the headers.
export const JOB_FILTERS: Partial<Record<ViewKey, readonly JobFilter[]>> = {
  review: [all, high, near, isRemote],
  held: [all, near, isRemote],
};
export const ACTIVITY_FILTERS: readonly Filter<{ kind: string }>[] = [
  all,
  ["gate", "Needs you", e => e.kind === "gate"],
  ["user", "You", e => e.kind === "user"],
  ["error", "Errors", e => e.kind === "error"],
  ["system", "System", e => e.kind === "system"],
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
    `<button class="fchip ${key === on ? "on" : ""} ${key === "error" ? "bad" : ""}" data-filter="${key}" aria-pressed="${String(key === on)}">${label ?? `Near ${esc(state().home)}`}<i>${n}</i></button>`;
  return `<div class="filters" role="toolbar" aria-label="Filter">${chips.map(chip).join("")}</div>`;
}
