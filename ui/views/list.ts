// The list of jobs in a section, grouped by employer.
import type { ListedJob } from "../../src/api-types";
import { age, filterBar, HOUR, JOB_FILTERS } from "../filters";
import { KEEP, layout } from "../layout";
import { state, ui } from "../store";
import { esc, when } from "../util";
import { SENT, statusOf, STUCK, VIEWS } from "../views";

export const tag = (j: Pick<ListedJob, "status">) => {
  const [cls, label] = statusOf(j.status);
  return `<span class="tag ${cls}">${label}</span>`;
};

export function listHtml() {
  const S = state(),
    v = VIEWS[ui.view],
    statuses = v.statuses ?? [];
  const { parts } = layout(),
    all = layout(ui.view, false).all,
    total = S.jobs.filter(j => statuses.includes(j.status)).length,
    q = ui.query[ui.view] ?? "";
  const search =
    total > 8 || q
      ? `<div class="search"><input type="text" id="q" placeholder="Search title, company or place" value="${esc(q)}" aria-label="Search this section"></div>`
      : "";
  const head = `<div class="head"><h1>${v.label}</h1><span class="count">${q ? `${all.length} of ${total}` : total || ""}</span></div>${search}${filterBar(all, JOB_FILTERS[ui.view] ?? [], ui.view)}`;
  if (!parts.length) return head + `<div class="empty">${total ? "Nothing matches." : (v.empty ?? "")}</div>`;
  const applied = new Map<string, number>(); // employer -> applications already sent there
  for (const x of S.jobs) if (SENT.includes(x.status) && !statuses.includes(x.status)) applied.set(x.company, (applied.get(x.company) ?? 0) + 1);
  const aged = ui.view !== "applied" && ui.view !== "rejected",
    waiting = ["triaged", "locating", "prepping"];
  const row = (j: ListedJob) => {
    const a = age(j),
      old = a >= 24 * HOUR,
      stuck = STUCK.includes(j.status);
    const ageHtml = aged
      ? `<span class="age ${a < 6 * HOUR ? "hot" : old ? "" : "today"}" title="Opened ${when(new Date(j.opened_at).toISOString())}">${a < HOUR ? `${Math.max(1, Math.trunc(a / 6e4))}m` : old ? `${Math.trunc(a / 864e5)}d` : `${Math.trunc(a / HOUR)}h`}</span>`
      : "";
    // A score from before a job went back to be assessed again says nothing yet.
    const score =
      j.score == null || waiting.includes(j.status) ? "" : `<span class="score ${S.threshold != null && j.score < S.threshold ? "low" : ""}">${j.score}</span>`;
    const sentThere = applied.get(j.company);
    const meta = [
      stuck ? tag(j) : "",
      `<b>${esc(j.company)}</b>${sentThere ? ` (${sentThere} applied)` : ""}`,
      ui.view === "applied" && j.submitted_at ? `applied ${when(j.submitted_at)}` : "",
      esc(j.location ?? ""),
    ]
      .filter(Boolean)
      .join(" · ");
    return `<div class="row ${stuck ? `stuck ${j.status}` : ""} ${j.id === ui.selected ? "sel" : ""}" data-job="${j.id}" tabindex="0" role="link"><div class="t">${esc(j.title)}</div><span class="side">${ageHtml}${score}</span><div class="m">${meta}</div></div>`;
  };
  let out = head;
  for (const p of parts) {
    if (p.label) out += `<div class="group ${p.cls ?? ""}"><b>${p.label}</b>${p.hint ? `<span>${p.hint}</span>` : ""}<i>${p.n}</i></div>`;
    for (const r of p.runs) {
      out += r.shown.map(row).join("");
      if (r.long)
        out += `<button class="fold" data-fold="${esc(r.id)}">${r.open ? `Show fewer from ${esc(r.company)}` : `+ ${r.jobs.length - KEEP} more from ${esc(r.company)}`}</button>`;
    }
  }
  return out;
}
