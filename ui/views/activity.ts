// Activity: the counts, the manual runs, and the feed of what the agents and the user did.
import type { Highlight } from "../../src/api-types";
import { ACTIVITY_FILTERS, activeTest, filterBar } from "../filters";
import { state, ui } from "../store";
import { cap, esc, linkify, when } from "../util";
import { eventRow, notices, title } from "./common";

const USER_ACTS: Record<string, (note: string) => string> = {
  approve: () => "You approved it.",
  reject: () => "You rejected it.",
  retry: () => "You sent it back to the queue.",
  redo: note => `You asked for changes: ${note}`,
  mark_submitted: () => "You marked it as submitted.",
  respond: note => (note === "approve" ? "You confirmed the submit." : `You replied: ${note}`),
};
// Turn raw log entries into plain sentences for the feed; null drops the entry.
function plain(e: Highlight) {
  const m = e.message.replace(/\bTab job-\d+:\s*/g, ""),
    cut = (s: string) => s.replace(/^\w+:\s*/, "");
  if (/^Chrome started|^Gmail connected/.test(m)) return null;
  if (e.kind === "gate")
    return m.startsWith("question")
      ? `Asked you: ${cut(m)}`
      : m.startsWith("cover_letter")
        ? "Asked you for a cover letter."
        : m.startsWith("confirm_submit")
          ? "Filled in the form and is waiting for you to confirm."
          : `Got stuck: ${cut(m)}`;
  if (e.kind === "user") {
    const [act = "", ...rest] = m.split(": ");
    return USER_ACTS[act]?.(rest.join(": ")) ?? cap(m);
  }
  return m;
}

type Triage = [kept: number, held: number, of: number];
interface FeedItem extends Highlight {
  text: string;
  triage: Triage | null;
}
// Collapse a run of triage batches into one line.
function feed(): FeedItem[] {
  const out: FeedItem[] = [];
  for (const e of state().highlights) {
    const t = /^Triage: kept (\d+), held (\d+) of (\d+)/.exec(e.message),
      prev = out.at(-1);
    const triage: Triage | null = t && [Number(t[1]), Number(t[2]), Number(t[3])];
    if (triage && prev?.triage) {
      prev.triage = [prev.triage[0] + triage[0], prev.triage[1] + triage[1], prev.triage[2] + triage[2]];
      continue;
    }
    const text = triage ? "" : plain(e);
    if (text === null) continue;
    out.push({ ...e, text, triage });
  }
  return out.map(e => {
    if (!e.triage) return e;
    const [kept, held, of] = e.triage;
    return { ...e, text: `Checked ${of} new postings: kept ${kept}${held ? `, held ${held}` : ""}.` };
  });
}

export function activityHtml() {
  const S = state(),
    c = S.counts,
    n = (...ks: string[]) => ks.reduce((t, k) => t + (c[k] ?? 0), 0);
  const stats: [label: string, value: number][] = [
    ["Postings seen", Object.values(c).reduce((a, b) => a + b, 0)],
    ["Skipped", n("skipped")],
    ["Applied", n("submitted", "interview", "offer", "rejected_by_company")],
    ["Interviews", n("interview", "offer")],
  ];
  const items = feed(),
    keep = activeTest(ACTIVITY_FILTERS, "activity") ?? (() => true);
  const rows = ui.feedAll
    ? S.events.map(eventRow)
    : items
        .filter(keep)
        .map(
          e =>
            `<div class="ev k-${esc(e.kind)}"><time>${when(e.at)}</time><div>${e.company ? `<a href="#" data-open="${e.job_id ?? ""}" class="who">${esc(e.company)}</a> ` : ""}<span class="msg" data-clamp="1">${linkify(esc(e.text))}</span></div></div>`,
        );
  return `<div class="doc page">${title("Activity")}${notices()}
    <div class="stats">${stats.map(([l, v]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="actions"><button class="btn" data-run="scan" ${S.running.scan ? "disabled" : ""}>${S.running.scan ? "Scanning…" : "Scan"}</button><button class="btn" data-run="discover" ${S.running.scan ? "disabled" : ""}>Find companies</button><button class="btn" data-run="track" ${S.running.track ? "disabled" : ""}>Check mail</button></div>
    <p class="hint" style="margin-top:8px">${S.lastScan ? `Scanned ${when(S.lastScan)}` : "Not scanned yet"}${S.scanMinutes ? `, every ${S.scanMinutes} min across ${S.boards} sources` : ""} · ${S.lastTrack ? `mail checked ${when(S.lastTrack)}` : "mail not checked yet"}</p>
    <div class="section"><div class="label" style="display:flex;justify-content:space-between;align-items:center">Recent<button class="btn sm quiet" data-feed="1">${ui.feedAll ? "Highlights only" : "Every agent step"}</button></div>
      ${ui.feedAll ? "" : filterBar(items, ACTIVITY_FILTERS, "activity")}
      ${rows.join("") || `<div class="empty">${items.length && !ui.feedAll ? "Nothing matches this filter." : "No activity yet."}</div>`}</div>
  </div>`;
}
