// Activity: is the pipeline healthy and what happened since the last look. The runs the owner can start by
// hand, what has gone out, and the feed of what the agents and the owner did, by day.
import type { Highlight } from "../../src/api-types";
import { ACTIVITY_FILTERS, activeTest, filterBar } from "../filters";
import { state, ui } from "../store";
import { cap, clock, dayLabel, esc, linkify, parseAt, when } from "../util";
import { notices, title } from "./common";

const USER_ACTS: Record<string, (note: string) => string> = {
  approve: () => "You approved it.",
  reject: () => "You rejected it.",
  hold: () => "You held it for later.",
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
  n: number; // how many entries this row stands for
}
// Paths in error text become their file name: "ENOENT … '/home/…/rubric.yml'" reads as "… rubric.yml".
const shorten = (s: string) => s.replace(/'?\/[^\s']+\/([^/\s']+)'?/g, "$1");
// Errors repeat with only a number or a path changed: those count as the same error.
const sameKey = (e: { kind: string; job_id: number | null; text: string; at: string }) =>
  `${dayLabel(e.at)}|${e.kind}|${e.job_id ?? ""}|${e.kind === "error" ? e.text.toLowerCase().replace(/\d+/g, "#") : e.text}`;

// Collapse a run of triage batches into one line, and the same entry repeated within a day into one row
// with a count, so one noisy error cannot push everything else out of the window.
function feed(): FeedItem[] {
  const out: FeedItem[] = [],
    seen = new Map<string, FeedItem>();
  for (const e of state().highlights) {
    const t = /^Triage: kept (\d+), held (\d+) of (\d+)/.exec(e.message),
      prev = out.at(-1);
    const triage: Triage | null = t && [Number(t[1]), Number(t[2]), Number(t[3])];
    if (triage && prev?.triage && dayLabel(prev.at) === dayLabel(e.at)) {
      prev.triage = [prev.triage[0] + triage[0], prev.triage[1] + triage[1], prev.triage[2] + triage[2]];
      continue;
    }
    const said = triage ? "" : plain(e);
    if (said === null) continue;
    const item: FeedItem = { ...e, text: e.kind === "error" ? shorten(said) : said, triage, n: 1 };
    const key = triage ? null : sameKey(item),
      twin = key ? seen.get(key) : undefined;
    if (twin) {
      twin.n++; // highlights come newest first, so the row keeps the latest time
      continue;
    }
    if (key) seen.set(key, item);
    out.push(item);
  }
  return out.map(e => {
    if (!e.triage) return e;
    const [kept, held, of] = e.triage;
    return { ...e, text: `Checked ${of} new postings: kept ${kept}${held ? `, held ${held}` : ""}.` };
  });
}

// Rows under a header per local day, each with its clock time; the relative age stays in the tooltip.
function byDay<T extends { at: string }>(items: readonly T[], row: (e: T, time: string) => string) {
  let day = "";
  return items
    .map(e => {
      const d = dayLabel(e.at),
        head = d === day ? "" : `<div class="group feedday"><b>${esc(d)}</b></div>`;
      day = d;
      return head + row(e, `<time datetime="${esc(new Date(parseAt(e.at)).toISOString())}" title="${esc(when(e.at))}">${clock(e.at)}</time>`);
    })
    .join("");
}

const num = (n: number) => n.toLocaleString();

export function activityHtml() {
  const S = state();
  const seen = Object.values(S.counts).reduce((a, b) => a + b, 0);
  const run = (what: string, label: string, busy: boolean, busyLabel = label, quiet = false) =>
    `<button class="btn sm ${quiet ? "quiet" : ""}" data-run="${what}" ${busy ? "disabled" : ""}>${busy ? busyLabel : label}</button>`;
  const runs = [
    [
      "Scan",
      `${S.running.scan ? "Scanning now" : S.lastScan ? `Last ${when(S.lastScan)}` : "Not scanned yet"}${S.scanMinutes ? ` · every ${S.scanMinutes} min · ${num(S.boards)} sources` : ""} · ${num(seen)} postings seen`,
      run("scan", "Scan now", S.running.scan, "Scanning…"),
    ],
    [
      "Mail",
      S.running.track ? "Checking now" : S.lastTrack ? `Checked ${when(S.lastTrack)}` : "Not checked yet",
      run("track", "Check mail", S.running.track, "Checking…"),
    ],
    ["Discovery", "Find new companies to watch", run("discover", "Find companies", S.running.scan, "Find companies", true)],
  ];

  const items = feed(),
    keep = activeTest(ACTIVITY_FILTERS, "activity") ?? (() => true);
  const rows = ui.feedAll
    ? byDay(
        S.events,
        (e, time) =>
          `<div class="ev k-${esc(e.kind)}">${time}<div><span class="who">${esc(cap(e.worker ?? e.kind))}</span> <span class="msg" data-clamp="1">${linkify(esc(e.message))}</span></div></div>`,
      )
    : byDay(
        items.filter(keep),
        (e, time) =>
          `<div class="ev k-${esc(e.kind)}">${time}<div>${e.company ? `<a href="#" data-open="${e.job_id ?? ""}" class="who">${esc(e.company)}</a>${e.title ? ` <span class="sub">· ${esc(e.title)}</span>` : ""} ` : ""}<span class="msg" data-clamp="1">${linkify(esc(e.text))}</span></div>${e.n > 1 ? `<span class="chip" title="${e.n} times this day">×${e.n}</span>` : ""}</div>`,
      );
  const seg = (all: boolean, label: string) =>
    `<button class="fchip ${ui.feedAll === all ? "on" : ""}" data-feed="${all ? "all" : "highlights"}" aria-pressed="${String(ui.feedAll === all)}">${label}</button>`;
  return `<div class="doc page">${title("Activity")}${notices()}
    <div class="runs">${runs.map(([name, info, btn]) => `<div class="runline"><b>${name}</b><span class="hint">${info}</span>${btn}</div>`).join("")}</div>
    <div class="section"><div class="feedhead"><div class="label" style="margin:0">Recent</div><div class="seg" role="group" aria-label="Feed">${seg(false, "Highlights")}${seg(true, "Full log")}</div></div>
      ${ui.feedAll ? "" : filterBar(items, ACTIVITY_FILTERS, "activity")}
      ${rows || `<div class="empty">${items.length && !ui.feedAll ? "Nothing matches this filter." : "No activity yet."}</div>`}</div>
  </div>`;
}
