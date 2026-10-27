// The highlights feed as sentences: raw log entries reworded, scan and triage batches summed per day,
// repeats collapsed. Pure, so the page can rebuild it from every page loaded so far.
import type { ActivityItem } from "../../../src/api-types";
import type { BlockerCause } from "../../../src/blockers";
import type { GateKind } from "../../../src/questions";
import { cap, dayLabel, num, plural } from "../../lib/format";
import { CAUSE, GATE, STATUS } from "../../lib/labels";

export interface FeedJob {
  id: number;
  company: string | null;
  title: string | null;
}
export interface FeedRow {
  key: string;
  kind: string;
  day: string;
  at: string; // the newest entry the row stands for
  text: string;
  detail: string | null; // a quieter second line
  url: string | null; // a page the sentence is about, shown as its host
  job: FeedJob | null;
  jobs: FeedJob[]; // more than one when the same thing happened to several jobs that day
  boards: string[]; // job boards a read error hit
  n: number; // how many times the same entry repeated that day
}

// "Cleared: site_down (see Blockers)" is a bulk clear-out by cause.
const rejected = (note: string) => {
  const cleared = /^cleared: (.+?)(?: \(see Blockers\))?$/i.exec(note)?.[1];
  if (cleared) return `You cleared it away: ${cleared in CAUSE ? CAUSE[cleared as BlockerCause] : gateWords(cleared)}.`;
  return note ? `You rejected it: ${note}` : "You rejected it.";
};
// "stuck on a confirm_submit gate" reads "stuck on a confirm submit gate".
const gateWords = (s: string) => s.replace(/\b(\w+) gate\b/g, (m, k: string) => (k in GATE ? `${GATE[k as GateKind].toLowerCase()} gate` : m));

const USER_ACTS: Record<string, (note: string) => string> = {
  approve: () => "You approved it.",
  reject: rejected,
  hold: note => (!note ? "You held it for later." : /^held\b/i.test(note) ? `You held it ${note.replace(/^held\s*/i, "")}` : `You held it: ${note}`),
  mark_declined: () => "You marked it declined.",
  confirmed_not_submitted: () => "You confirmed it wasn't sent.",
  "step done": note => `You marked a step done: ${note}`,
  retry: () => "You sent it back to the queue.",
  redo: note => `You asked for changes: ${note}`,
  mark_submitted: () => "You marked it as submitted.",
  respond: note => (note === "approve" ? "You confirmed the submit." : `You replied: ${note}`),
};

// The workers' run reports lead with their name; the feed leads with what was done.
const LEADS: Record<string, string> = {
  Track: "Checked mail",
  Locate: "Looked for the employer's posting",
  Discover: "Looked for new companies",
  Recheck: "Rechecked open questions",
};

// Long agent reports cut to what was decided; the full text stays in the full log and on the job.
const SHORTER: [RegExp, (m: RegExpExecArray) => Said][] = [
  [
    /^Approved by (reconsidered )?auto apply: (.+?); score (\d+) \(threshold \d+\)$/s,
    m => ({ text: `Approved by auto apply at fit ${m[3] ?? ""}.`, detail: reason(m[2] ?? "") }),
  ],
  [/^(Final|Automatic) submission authorized\b/, () => ({ text: "Auto apply authorized the final submit." })],
  [/^Found the employer's posting: (https?:\S+)$/, m => ({ text: "Found the employer's posting.", url: m[1] ?? null })],
  [
    /^Answered question \((application|standing)\); queued applications/,
    m => ({ text: m[1] === "standing" ? "You answered a question and kept it as a standing answer." : "You answered a question." }),
  ],
  [/^edited profile\/(.+)$/, m => ({ text: `You edited ${m[1] ?? "a profile file"}.` })],
];
// "practice: IT services or consultancy (Deloitte is a …)" reads as "Practice: IT services or consultancy".
const reason = (s: string) => cap(s.replace(/\s*\(.*\)\s*$/s, "").replace(/^(\w+): /, "$1, "));

interface Said {
  text: string;
  detail?: string;
  url?: string | null;
}

// One entry as a sentence; null drops it.
function said(e: Pick<ActivityItem, "kind" | "message">): Said | null {
  for (const [re, f] of SHORTER) {
    const m = re.exec(e.message);
    if (m) return f(m);
  }
  const text = plain(e);
  return text === null ? null : { text };
}

// Ids nobody reads: "(Claude Code session 3fe752b7-…)" after a worker's report, a bare UUID in a list.
const IDS = /\s*\(Claude Code session [\w-]+\)|\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function plain(e: Pick<ActivityItem, "kind" | "message">) {
  const m = e.message.replace(/\bTab job-\d+:\s*/g, "").replace(IDS, ""),
    cut = (s: string) => s.replace(/^\w+:\s*/, "");
  // Housekeeping: a worker that ends because it parked at a gate (the gate has its own entry), a tab closed for memory.
  if (/^Chrome started|^Gmail connected|^\w+ worker aborted:\s*$|^Closed this application's parked browser tab/.test(m)) return null;
  const worker = /^(\w+) worker (aborted|error): (.+)$/s.exec(m);
  if (worker) return `The ${worker[1] ?? ""} worker ${worker[2] === "error" ? "failed" : "stopped"}: ${worker[3] ?? ""}`;
  const lead = /^(\w+): /.exec(m);
  if (e.kind === "mail") {
    // "BDO Careers <join-our-team@careers.bdo.com> requests…" reads as "BDO Careers requests…". Mail matched to an
    // application leads with the status it moved to, which the sentence says anyway.
    const text = m.replace(/ ?(<[^\s<>@]+@[^\s<>]+>|\([^\s()@]+@[^\s()]+\))/g, "");
    return lead?.[1] && lead[1] in STATUS ? text.slice(lead[0].length) : text;
  }
  if (e.kind === "system" && lead?.[1] && LEADS[lead[1]]) return `${LEADS[lead[1]] ?? ""}: ${m.slice(lead[0].length)}`;
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

// Paths in error text become their file name: "ENOENT … '/home/…/rubric.yml'" reads as "… rubric.yml".
const shorten = (s: string) => s.replace(/'?\/[^\s']+\/([^/\s']+)'?/g, "$1");

const SCAN = /^Scan: (\d+) new postings?/;
const SCREENED = /^Triage: screened out (\d+) of (\d+)/;
const TRIAGE = /^Triage: kept (\d+), held (\d+) of (\d+)/;
const FEED_ERROR = /^feed (\S+): (.+)$/s;

interface Batch {
  row: FeedRow;
  scans: number;
  found: number;
  screened: number;
  kept: number;
  held: number;
  checked: number;
}
// A day's batch may be cut off by the page boundary, so any of the three counts can be missing.
function batchText(b: Batch) {
  const screened = b.screened ? `${num(b.screened)} screened out before reading` : "";
  if (b.checked) {
    b.row.text = `Checked ${plural(b.checked, "new posting")}: kept ${num(b.kept)}${b.held ? `, held ${num(b.held)}` : ""}.`;
    b.row.detail = b.scans ? `${plural(b.scans, "scan")} found ${plural(b.found, "posting")}${screened ? `; ${screened}` : ""}.` : null;
  } else if (b.scans) {
    b.row.text = `Found ${plural(b.found, "new posting")} in ${plural(b.scans, "scan")}.`;
    b.row.detail = screened ? `${cap(screened)}.` : null;
  } else b.row.text = `Screened out ${plural(b.screened, "posting")} before reading.`;
}

export function feed(items: readonly ActivityItem[]): FeedRow[] {
  const out: FeedRow[] = [],
    batches = new Map<string, Batch>(), // per day: the scan and triage lines summed
    boardErrors = new Map<string, FeedRow>(), // per day and error: the job boards it hit
    twins = new Map<string, FeedRow>(); // per day and wording: the row it went into
  const row = (e: ActivityItem, day: string, text: string): FeedRow => ({
    key: String(e.id),
    kind: e.kind,
    day,
    at: e.at,
    text,
    detail: null,
    url: null,
    job: e.job_id ? { id: e.job_id, company: e.company, title: e.title } : null,
    jobs: [],
    boards: [],
    n: 1,
  });
  for (const e of items) {
    const day = dayLabel(e.at);
    const scan = SCAN.exec(e.message),
      screened = SCREENED.exec(e.message),
      triage = TRIAGE.exec(e.message);
    if (e.kind === "system" && (scan || screened || triage)) {
      let b = batches.get(day);
      if (!b) {
        b = { row: row(e, day, ""), scans: 0, found: 0, screened: 0, kept: 0, held: 0, checked: 0 };
        batches.set(day, b);
        out.push(b.row);
      }
      if (scan) {
        b.scans++;
        b.found += Number(scan[1]);
      } else if (screened) b.screened += Number(screened[1]);
      else if (triage) {
        b.kept += Number(triage[1]);
        b.held += Number(triage[2]);
        b.checked += Number(triage[3]);
      }
      continue;
    }
    const board = e.kind === "error" ? FEED_ERROR.exec(e.message) : null;
    if (board) {
      const [, name = "", reason = ""] = board,
        key = `${day}|${reason}`,
        seen = boardErrors.get(key);
      if (seen) {
        if (!seen.boards.includes(name)) seen.boards.push(name);
        seen.n++;
      } else {
        const r = row(e, day, reason);
        r.boards.push(name);
        boardErrors.set(key, r);
        out.push(r);
      }
      continue;
    }
    const s = said(e);
    if (s === null) continue;
    const text = e.kind === "error" ? shorten(s.text) : s.text;
    // The same thing on the same day reads as one row: repeats count up, and the other jobs it happened to (a bulk
    // reject, a migration) list under it. Errors repeat with only a number changed: those count as the same error.
    const same = e.kind === "error" ? text.toLowerCase().replace(/\d+/g, "#") : text,
      key = `${day}|${e.kind}|${same}|${s.detail ?? ""}`,
      twin = twins.get(key);
    if (twin) {
      const id = e.job_id;
      if (!id || !twin.job || twin.job.id === id || twin.jobs.some(j => j.id === id))
        twin.n++; // newest first, so the row keeps the latest time
      else {
        if (!twin.jobs.length) twin.jobs.push(twin.job);
        twin.jobs.push({ id, company: e.company, title: e.title });
        twin.url = null; // each job has its own; the job pages show them
      }
      continue;
    }
    const r = row(e, day, text);
    r.detail = s.detail ?? null;
    r.url = s.url ?? null;
    twins.set(key, r);
    out.push(r);
  }
  for (const b of batches.values()) batchText(b);
  for (const r of boardErrors.values())
    r.text = r.boards.length === 1 ? `Couldn't read the ${r.boards[0] ?? ""} board: ${r.text}` : `Couldn't read ${num(r.boards.length)} job boards: ${r.text}`;
  return out;
}

// The highlight filters and the kinds of entry each asks the server for.
export const KIND_FILTERS = {
  all: { label: "All", kinds: [] },
  gate: { label: "Needs you", kinds: ["gate"] },
  user: { label: "You", kinds: ["user"] },
  error: { label: "Errors", kinds: ["error"] },
  system: { label: "System", kinds: ["system", "auto", "recheck", "migration"] },
  mail: { label: "Mail", kinds: ["mail"] },
} as const satisfies Record<string, { label: string; kinds: readonly string[] }>;
export type KindFilter = keyof typeof KIND_FILTERS;
export const isKindFilter = (k: string | null): k is KindFilter => !!k && k in KIND_FILTERS;
