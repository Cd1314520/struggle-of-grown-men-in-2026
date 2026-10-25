// Blockers: every time an application stopped short of being sent, and why, kept after the job is cleared
// away. Filtered by cause, so the stops a site outage caused can be found again and retried.
import type { BlockerCause, ListedBlocker } from "../../src/blockers";
import { activeTest, filterBar, type Filter } from "../filters";
import { ui } from "../store";
import { esc, linkify } from "../util";
import { statusOf, viewOf } from "../views";
import { byDay } from "./activity";
import { title } from "./common";

export const CAUSE_LABEL: Record<BlockerCause, string> = {
  site_down: "Site down",
  login: "Can't log in",
  captcha: "CAPTCHA",
  email_code: "Emailed code",
  no_form: "No online form",
  needs_you: "Needs you",
  browser: "Browser glitch",
  no_response: "No response to submit",
  unknown: "Stopped without reporting",
  other: "Other",
};
const FILTERS: readonly Filter<ListedBlocker>[] = [
  ["all", "All"],
  ...(Object.entries(CAUSE_LABEL) as [BlockerCause, string][]).map(([cause, label]): Filter<ListedBlocker> => [cause, label, b => b.cause === cause]),
];

export const causeChip = (cause: BlockerCause) => `<span class="chip ${cause === "site_down" ? "no" : ""}">${esc(CAUSE_LABEL[cause])}</span>`;

export function blockersHtml() {
  const items = ui.blockers;
  if (!items) return `<div class="doc page">${title("Blockers")}<div class="empty">Loading…</div></div>`;
  const keep = activeTest(FILTERS, "blockers") ?? (() => true);
  const rows = byDay(items.filter(keep), (b, time) => {
    const [cls, label] = statusOf(b.status);
    return `<div class="ev">${time}<div><a href="#" data-open="${b.job_id}" data-open-view="${viewOf(b.status)}" class="who">${esc(b.company)}</a> <span class="sub">· ${esc(b.title)}</span>
      <div class="blockerline">${causeChip(b.cause)}<span class="pill ${cls}">${esc(label)}</span><a href="${esc(b.url)}" target="_blank" rel="noopener">Posting ↗</a></div>
      <span class="msg" data-clamp="1">${linkify(esc(b.detail))}</span></div></div>`;
  });
  return `<div class="doc page">${title("Blockers")}
    <p class="hint">Every time an application stopped short of being sent, and why. They stay here after the job is cleared away, so the ones a site outage caused can be looked at again.</p>
    <div class="section">${filterBar(items, FILTERS, "blockers")}
      ${rows || `<div class="empty">${items.length ? "Nothing matches this filter." : "Nothing has been blocked yet."}</div>`}</div>
  </div>`;
}
