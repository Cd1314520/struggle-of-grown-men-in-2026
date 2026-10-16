// The list of jobs in a section, in its parts. Each row is the title, then status (only where a part mixes
// kinds), employer and place, with one number on the right that matters for the section: the posting's age and
// score while deciding, how long a stuck job has waited on the user, when an application went out.
import type { ListedJob } from "../../src/api-types";
import { age, filterBar, HOUR, JOB_FILTERS } from "../filters";
import { CAP, gateLabel, KEEP, layout, type Part, sentAt, stamp } from "../layout";
import { state, ui } from "../store";
import { dateTime, esc, span } from "../util";
import { SENT, statusOf, STUCK, VIEWS } from "../views";

// The status as words; a stuck job says what it waits for (a needs_input job may want a cover letter).
const label = (j: Pick<ListedJob, "id" | "status">) => (STUCK.includes(j.status) && gateLabel(j)) || statusOf(j.status)[1];
export const tag = (j: Pick<ListedJob, "id" | "status">) => `<span class="tag ${statusOf(j.status)[0]}">${label(j)}</span>`;

const UNASSESSED = ["triaged", "locating", "prepping"];
const n = (x: number) => x.toLocaleString();

// Where the user's attention can go when To review is empty.
export function elsewhere(cls = "") {
  const S = state(),
    asks = S.questionGroups.filter(g => g.kind === "question").length,
    stuck = S.jobs.filter(j => STUCK.includes(j.status) && gateLabel(j) !== "Question").length;
  const links = [
    asks ? `<a href="#questions" data-view="questions">${n(asks)} question${asks === 1 ? "" : "s"} to answer ›</a>` : "",
    stuck ? `<a href="#progress" data-view="progress">${n(stuck)} application${stuck === 1 ? "" : "s"} in progress need you ›</a>` : "",
  ].filter(Boolean);
  return links.length ? `<div class="nextup ${cls}">${links.join("")}</div>` : "";
}

export function listHtml() {
  const S = state(),
    k = ui.view,
    v = VIEWS[k],
    statuses = v.statuses ?? [];
  const { parts } = layout(),
    all = layout(k, false).all,
    loaded = S.jobs.filter(j => statuses.includes(j.status)).length,
    // The server sends only the most recently touched of the long backlogs; its counts are the true totals.
    total = Math.max(
      loaded,
      statuses.reduce((t, s) => t + (S.counts[s] ?? 0), 0),
    ),
    q = ui.query[k] ?? "";
  const search =
    total > 8 || q
      ? `<div class="search"><input type="text" id="q" placeholder="Search title, company or place" value="${esc(q)}" aria-label="Search this section"></div>`
      : "";
  const c = (...ss: string[]) => ss.reduce((t, s) => t + (S.counts[s] ?? 0), 0);
  const intro =
    k === "held" && total
      ? `<div class="intro"><p>Kept back by you or the phase rules. Releasing sends them all to be assessed again.</p><button class="btn sm danger" data-run="release_held">Release ${n(c("held") || total)} held job${(c("held") || total) === 1 ? "" : "s"}…</button></div>`
      : // What has gone out and what came back, as one line in place of the count beside the title.
        k === "applied" && total
        ? `<p class="intro tally">${[
            `<b>${n(c("submitted", "interview", "offer", "rejected_by_company"))}</b> sent`,
            `<b>${n(c("submitted"))}</b> awaiting reply`,
            `<b>${n(c("interview", "offer"))}</b> interview${c("interview", "offer") === 1 ? "" : "s"}`,
            `<b>${n(c("rejected_by_company"))}</b> declined`,
          ].join(" · ")}</p>`
        : "";
  // In progress holds the machine's queues too: say how many of its jobs wait on the user, as its badge does.
  const needYou = k === "progress" ? S.jobs.filter(j => STUCK.includes(j.status) && gateLabel(j) !== "Question").length : 0;
  const count = q ? `${all.length} of ${n(loaded)}` : total && k !== "applied" ? (needYou ? `${n(needYou)} need you · ${n(total)} in all` : n(total)) : "";
  // A phone reaches the archive through More, whose tab stays lit: these pages say where they are, with a way back.
  const back = v.primary ? "" : `<button class="btn quiet back" data-view="more">← More</button>`;
  const head = `${back}<div class="head ${v.primary ? "" : "keep"}"><h1>${v.label}</h1><span class="count">${count}</span></div>${intro}${search}${filterBar(all, JOB_FILTERS[k] ?? [], k)}`;
  if (!parts.length)
    return head + `<div class="empty">${loaded ? "Nothing matches." : (v.empty ?? "")}</div>${!loaded && k === "review" ? elsewhere("m-only") : ""}`;

  const applied = new Map<string, number>(); // employer -> applications already sent there
  if (k === "review") for (const x of S.jobs) if (SENT.includes(x.status)) applied.set(x.company, (applied.get(x.company) ?? 0) + 1);
  const ago = (ms: number, title: string, cls = "") => `<span class="age ${cls}" title="${esc(title)}">${span(Date.now() - ms)}</span>`;
  // The one number on the right.
  const side = (j: ListedJob) => {
    const score = j.score == null ? "" : `<span class="score ${S.threshold != null && j.score < S.threshold ? "low" : ""}">${j.score}</span>`;
    if (k === "applied") {
      const at = j.status === "rejected_by_company" ? stamp(j.updated_at) : sentAt(j);
      return ago(at, `${j.status === "rejected_by_company" ? "Declined" : "Sent"} ${dateTime(at)}`);
    }
    if (k === "rejected") return ago(stamp(j.updated_at), `Rejected ${dateTime(stamp(j.updated_at))}`);
    if (STUCK.includes(j.status)) {
      const at = stamp(j.updated_at);
      return ago(at, `Waiting on you since ${dateTime(at)}`, Date.now() - at > 24 * HOUR ? "late" : "");
    }
    const a = age(j),
      opened = `Opened ${dateTime(j.opened_at)}`;
    // A score from before a job went back to be assessed again says nothing yet.
    if (UNASSESSED.includes(j.status)) return ago(j.opened_at, opened);
    if (k === "review") return ago(j.opened_at, opened, a < 6 * HOUR ? "new" : a < 24 * HOUR ? "today" : "") + score;
    return score;
  };
  const row = (p: Part, mixed: boolean) => (j: ListedJob) => {
    const sentThere = applied.get(j.company);
    const meta = [
      mixed ? tag(j) : "",
      `<b>${esc(j.company)}</b>${sentThere ? `<span class="faint"> · ${sentThere} applied</span>` : ""}`,
      esc(j.location ?? ""),
    ]
      .filter(Boolean)
      .join(" · ");
    const cls = [STUCK.includes(j.status) ? `stuck ${j.status}` : "", p.label === "Declined" ? "closed" : "", j.id === ui.selected ? "sel" : ""];
    return `<div class="row ${cls.join(" ")}" data-job="${j.id}" tabindex="0" role="link"><div class="t">${esc(j.title)}</div><span class="side">${side(j)}</span><div class="m">${meta}</div></div>`;
  };
  // A collapsible part's header is a button; a summary says what is folded away.
  const header = (p: Part) => {
    if (!p.label) return "";
    const collapsible = !!p.collapsed || p.n > 12,
      folded = collapsible && !p.open;
    const newest = Math.max(...p.runs.flatMap(r => r.jobs.map(j => (UNASSESSED.includes(j.status) ? j.opened_at : stamp(j.updated_at)))));
    const hint = folded && Number.isFinite(newest) ? `newest ${span(Date.now() - newest)} ago` : (p.hint ?? "");
    const inner = `${collapsible ? `<span class="caret" aria-hidden="true">${p.open ? "▾" : "▸"}</span>` : ""}<b>${p.label}</b>${hint ? `<span>${hint}</span>` : ""}<i>${n(p.total)}</i>`;
    const link = p.link && p.open ? `<a class="glink" href="${p.link[0]}">${p.link[1]} ›</a>` : "";
    return collapsible
      ? `<div class="group ${p.cls ?? ""}"><button class="gbtn" data-part="${esc(p.id)}" aria-expanded="${String(p.open)}">${inner}</button>${link}</div>`
      : `<div class="group ${p.cls ?? ""}">${inner}${link}</div>`;
  };
  let out = head;
  for (const p of parts) {
    out += header(p);
    if (!p.open) continue;
    const mixed = new Set(p.runs.flatMap(r => r.jobs.map(label))).size > 1;
    for (const r of p.runs) {
      out += r.shown.map(row(p, mixed)).join("");
      if (r.long && r.shown.length)
        out += `<button class="fold" data-fold="${esc(r.id)}">${r.open ? `Show fewer from ${esc(r.company)}` : `+ ${r.jobs.length - KEEP} more from ${esc(r.company)}`}</button>`;
    }
    if (p.hidden)
      out += `<button class="fold" data-cap="${esc(p.id)}">${p.hidden > CAP ? `Show ${CAP} more · ${n(p.hidden)} not shown` : `Show the other ${n(p.hidden)}`}</button>`;
    if (p.total > p.n) out += `<div class="note">Showing the ${n(p.n)} most recently touched of ${n(p.total)}.</div>`;
  }
  // Long backlogs arrive cut short; say so rather than let the list look complete.
  if (!q && total > loaded && !parts.some(p => p.total > p.n)) out += `<div class="note">Showing the ${n(loaded)} most recently touched of ${n(total)}.</div>`;
  return out;
}
