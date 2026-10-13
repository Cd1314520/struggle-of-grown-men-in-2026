// The sidebar (the tab bar on a phone) and the "More" page behind its last tab.
import { state, ui } from "../store";
import { cap, when } from "../util";
import { STUCK, VIEW_KEYS, VIEWS, type ViewKey } from "../views";

const jobCount = (k: ViewKey) => {
  const statuses = VIEWS[k].statuses;
  return statuses ? state().jobs.filter(j => statuses.includes(j.status)).length : 0;
};

export function sideHtml() {
  const S = state();
  const count = (k: ViewKey) => (k === "questions" ? S.questionGroups.length : jobCount(k));
  const stuck = S.jobs.filter(j => STUCK.includes(j.status)).length;
  // The badge counts what is waiting on the user: everything to review, and the stuck applications in progress.
  const badge = (k: ViewKey) =>
    k === "progress" && stuck
      ? `<span class="n hot stuck" title="Need you">${stuck}</span>`
      : count(k)
        ? `<span class="n ${k === "review" || k === "questions" ? "hot" : ""}">${count(k)}</span>`
        : "";
  const item = (k: ViewKey) => {
    const v = VIEWS[k];
    return `${v.group ? `<div class="navgroup">${v.group}</div>` : ""}<button class="nav ${v.primary ? "" : "d-only"} ${k === ui.view ? "on" : ""}" data-view="${k}" ${k === ui.view ? 'aria-current="page"' : ""}>${v.label}${badge(k)}</button>`;
  };
  const onMore = !VIEWS[ui.view].primary;
  return `<div class="brand">Auto Apply</div>${VIEW_KEYS.filter(k => !VIEWS[k].hidden)
    .map(item)
    .join("")}
    <button class="nav m-only ${onMore ? "on" : ""}" data-view="more">More</button>
    <div class="sidefoot"><div class="keys"><span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>/</kbd> search</span><span><kbd>A</kbd> approve</span><span><kbd>X</kbd> reject</span></div><div>${cap(S.phase)} · ${S.running.scan ? "scanning…" : `scanned ${when(S.lastScan) || "never"}`}</div>
    <button class="btn sm" data-run="scan" ${S.running.scan ? "disabled" : ""}>Scan now</button></div>`;
}

const MORE: readonly ViewKey[] = ["held", "rejected", "activity", "profile", "settings"];
export const moreHtml = () =>
  `<div class="morelist">${MORE.map(k => `<button class="nav" data-view="${k}">${VIEWS[k].label}<span>${jobCount(k) || ""} ›</span></button>`).join("")}</div>`;
