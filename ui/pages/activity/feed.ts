import type { ActivityItem } from "../../../src/api-types";
import type { BlockerCause } from "../../../src/blockers";
import type { GateKind } from "../../../src/questions";
import type { Status } from "../../../src/status";
import { cap, dayLabel, num, plural } from "../../lib/format";
import { CAUSE, GATE, STATUS } from "../../lib/labels";

export interface FeedJob {
  id: number;
  company: string | null;
  title: string | null;
}
export interface FeedBoard {
  name: string;
  reason: string;
  lasting: boolean;
}
export type FeedWeight = "high" | "normal" | "low";
export interface FeedRow {
  key: string;
  kind: string;
  day: string;
  at: string;
  text: string;
  detail: string | null;
  url: string | null;
  job: FeedJob | null;
  jobs: FeedJob[];
  boards: FeedBoard[];
  n: number;
  outcome: Status | null;
  flag: boolean;
  weight: FeedWeight;
  go: { label: string; href: string } | null;
}

const rejected = (note: string) => {
  const cleared = /^cleared: (.+?)(?: \(see Blockers\))?$/i.exec(note)?.[1];
  if (cleared) return `You cleared it away: ${cleared in CAUSE ? CAUSE[cleared as BlockerCause] : gateWords(cleared)}.`;
  return note ? `You rejected it: ${note}` : "You rejected it.";
};
const gateWords = (s: string) => s.replace(/\b(\w+) gate\b/g, (m, k: string) => (k in GATE ? `${GATE[k as GateKind].toLowerCase()} gate` : m));

const USER_ACTS: Record<string, (note: string) => string> = {
  approve: () => "You approved it.",
  reject: rejected,
  hold: note => (!note ? "You held it for later." : /^held\b/i.test(note) ? `You held it ${note.replace(/^held\s*/i, "")}` : `You held it: ${note}`),
  mark_declined: () => "You marked it declined.",
  withdraw: () => "You withdrew it.",
  confirmed_not_submitted: () => "You confirmed it wasn't sent.",
  "step done": note => `You marked a step done: ${note}`,
  retry: () => "You sent it back to the queue.",
  redo: note => `You asked for changes: ${note}`,
  mark_submitted: () => "You marked it as submitted.",
  respond: note => (note === "approve" ? "You confirmed the submit." : `You replied: ${note}`),
};

const LEADS: Record<string, string> = {
  Track: "Checked mail",
  Locate: "Looked for the employer's posting",
  Discover: "Looked for new companies",
  Recheck: "Rechecked open questions",
  Answers: "Added to your answers",
};

const SHORTER: [RegExp, (m: RegExpExecArray) => Said][] = [
  [
    /^Approved by (reconsidered )?auto apply: (.+?); score (\d+) \(threshold \d+\)$/s,
    m => ({ text: `Approved by auto apply at fit ${m[3] ?? ""}.`, detail: reason(m[2] ?? "") }),
  ],
  [/^(Final|Automatic) submission authorized\b/, () => ({ text: "Auto apply authorized the final submit." })],
  [/^Found the employer's posting: (https?:\S+)$/, m => ({ text: "Found the employer's posting.", url: m[1] ?? null })],
  [
    /^Answered question \((application|standing|bank)\); queued applications/,
    m => ({
      text:
        m[1] === "bank"
          ? "You answered a question and added it to your answers."
          : m[1] === "standing"
            ? "You answered a question and kept it as a standing answer."
            : "You answered a question.",
    }),
  ],
  [/^edited profile\/(.+)$/, m => ({ text: `You edited ${m[1] ?? "a profile file"}.` })],
];
const reason = (s: string) => cap(s.replace(/\s*\(.*\)\s*$/s, "").replace(/^(\w+): /, "$1, "));

interface Said {
  text: string;
  detail?: string;
  url?: string | null;
}

function said(e: Pick<ActivityItem, "kind" | "message">): Said | null {
  for (const [re, f] of SHORTER) {
    const m = re.exec(e.message);
    if (m) return f(m);
  }
  const text = plain(e);
  return text === null ? null : { text };
}

const IDS = /\s*\(Claude Code session [\w-]+\)|\s*\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function plain(e: Pick<ActivityItem, "kind" | "message">) {
  const m = e.message.replace(/\bTab job-\d+:\s*/g, "").replace(IDS, ""),
    cut = (s: string) => s.replace(/^\w+:\s*/, "");
  if (
    /^Chrome started|^Gmail connected|^\w+ worker aborted:\s*$|^Closed this application's parked browser tab|^Folded \d+ duplicate|^Removed \d+ agent step records/.test(
      m,
    )
  )
    return null;
  const worker = /^(\w+) worker (aborted|error|stopped): (.+)$/s.exec(m);
  if (worker) return `The ${worker[1] ?? ""} worker ${worker[2] === "error" ? "failed" : "stopped"}: ${worker[3] ?? ""}`;
  const lead = /^(\w+): /.exec(m);
  if (e.kind === "mail") {
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

const shorten = (s: string) => s.replace(/'?\/[^\s']+\/([^/\s']+)'?/g, "$1");

const SCAN = /^Scan: (\d+) new postings?/;
const SCREENED = /^Triage: screened out (\d+) of (\d+)/;
const TRIAGE = /^Triage: kept (\d+), held (\d+) of (\d+)/;
const FEED_ERROR = /^feed (\S+): (.+)$/s;
const RESULT = /^fill worker stopped: result reported: (submitted|closed)\b/;
const AUTHORIZED = /^(Final|Automatic) submission authorized\b/;
const QUIET_TRACK = /No mail arrived|nothing recorded\.?$/;
const RECHECK = /^Recheck: (.+)$/s;
const PARKED_ON = /^fill worker stopped: parked on \w+ gate\b/;
const UNMATCHED = /matches no listed application/i;

const lasting = (reason: string) => {
  const code = Number(/\b(\d{3})\b/.exec(reason)?.[1] ?? 0);
  return code >= 400 && code < 500 && code !== 408 && code !== 429;
};
const codes = (bs: readonly FeedBoard[]) => {
  const seen = [...new Set(bs.flatMap(b => /\b\d{3}\b/.exec(b.reason)?.[0] ?? []))];
  return seen.length ? ` (${seen.join(", ")})` : "";
};

interface Batch {
  row: FeedRow;
  scans: number;
  found: number;
  screened: number;
  kept: number;
  held: number;
  checked: number;
}
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

interface Recheck {
  row: FeedRow;
  left: number;
  answered: number;
  notes: string[];
}
function recheckText(r: Recheck) {
  const parts = [r.answered && `answered ${num(r.answered)}`, r.left && `left ${plural(r.left, "question")} for you`].filter(Boolean);
  r.row.text = parts.length ? `Rechecked open questions: ${parts.join(", ")}.` : "Rechecked open questions.";
  r.row.detail = r.notes.length ? r.notes.map(n => cap(n.trim().replace(/\.?$/, "."))).join(" ") : null;
  if (r.left) r.row.go = { label: "Answer them in Questions", href: "#questions" };
}

function boardText(r: FeedRow) {
  const gone = r.boards.filter(b => b.lasting),
    brief = r.boards.filter(b => !b.lasting);
  r.text = r.boards.length === 1 ? `Couldn't read the ${r.boards[0]?.name ?? ""} board` : `Couldn't read ${num(r.boards.length)} job boards`;
  r.detail = [
    gone.length && `${num(gone.length)} may be gone or moved${codes(gone)}; fix or remove ${gone.length === 1 ? "it" : "them"}`,
    brief.length && `${num(brief.length)} temporary${codes(brief)}`,
  ]
    .filter(Boolean)
    .join("; ")
    .concat(".");
  r.boards.sort((a, b) => Number(b.lasting) - Number(a.lasting));
  r.weight = gone.length ? "high" : "normal";
}

function resultText(r: FeedRow, outcome: string) {
  const n = Math.max(r.jobs.length, 1);
  r.text =
    outcome === "submitted"
      ? n === 1
        ? "Submitted the application."
        : `Submitted ${num(n)} applications.`
      : n === 1
        ? "Found the posting closed."
        : `Found ${num(n)} postings closed.`;
}

const LOW = new Set(["system", "auto", "migration"]);
const HIGH = new Set(["error", "gate", "mail"]);

export function feed(items: readonly ActivityItem[]): FeedRow[] {
  const out: FeedRow[] = [],
    batches = new Map<string, Batch>(),
    boardErrors = new Map<string, FeedRow>(),
    rechecks = new Map<string, Recheck>(),
    results = new Map<FeedRow, string>(),
    twins = new Map<string, FeedRow>();
  const mailDays = new Set<string>(),
    sent = new Set<string>(),
    asked = new Set<string>(),
    answered = new Map<string, number>();
  for (const e of items) {
    const day = dayLabel(e.at);
    if (e.kind === "mail") mailDays.add(day);
    if (e.kind === "recheck" && e.message.startsWith("Answered from the profile: ")) answered.set(day, (answered.get(day) ?? 0) + 1);
    if (e.job_id && e.kind === "gate") asked.add(`${day}|${e.job_id}`);
    if (e.job_id && RESULT.exec(e.message)?.[1] === "submitted") sent.add(`${day}|${e.job_id}`);
  }
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
    outcome: null,
    flag: false,
    weight: HIGH.has(e.kind) ? "high" : LOW.has(e.kind) ? "low" : "normal",
    go: null,
  });
  const addJob = (r: FeedRow, e: ActivityItem) => {
    const id = e.job_id;
    if (!id) return;
    if (r.job && !r.jobs.length) r.jobs.push(r.job);
    if (!r.jobs.some(j => j.id === id)) r.jobs.push({ id, company: e.company, title: e.title });
    r.job ??= r.jobs[0] ?? null;
  };
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
    if (e.kind === "system" && e.message.startsWith("Track: ") && (QUIET_TRACK.test(e.message) || mailDays.has(day))) continue;
    if (e.kind === "system" && e.job_id && PARKED_ON.test(e.message) && asked.has(`${day}|${e.job_id}`)) continue;
    if (e.kind === "auto" && e.job_id && AUTHORIZED.test(e.message) && sent.has(`${day}|${e.job_id}`)) continue;
    const recheck = e.kind === "system" ? RECHECK.exec(e.message) : null,
      left = e.kind === "recheck" && e.message.startsWith("Left for you: ");
    if (recheck || left) {
      let r = rechecks.get(day);
      if (!r) {
        const first = row(e, day, "");
        first.kind = "recheck";
        first.job = null;
        first.weight = "normal";
        r = { row: first, left: 0, answered: answered.get(day) ?? 0, notes: [] };
        rechecks.set(day, r);
        out.push(r.row);
      }
      if (recheck) r.notes.push(recheck[1] ?? "");
      else {
        r.left++;
        addJob(r.row, e);
      }
      continue;
    }
    const board = e.kind === "error" ? FEED_ERROR.exec(e.message) : null;
    if (board) {
      const [, name = "", reason = ""] = board,
        seen = boardErrors.get(day);
      if (seen) {
        if (!seen.boards.some(b => b.name === name)) seen.boards.push({ name, reason, lasting: lasting(reason) });
        seen.n++;
      } else {
        const r = row(e, day, "");
        r.boards.push({ name, reason, lasting: lasting(reason) });
        boardErrors.set(day, r);
        out.push(r);
      }
      continue;
    }
    const result = e.kind === "system" ? RESULT.exec(e.message.replace(IDS, "")) : null;
    if (result) {
      const outcome = result[1] ?? "",
        key = `${day}|result|${outcome}`,
        twin = twins.get(key);
      if (twin) addJob(twin, e);
      else {
        const r = row(e, day, "");
        r.kind = "result";
        r.outcome = outcome === "submitted" ? "submitted" : null;
        r.weight = outcome === "submitted" ? "high" : "low";
        twins.set(key, r);
        results.set(r, outcome);
        out.push(r);
      }
      continue;
    }
    const s = said(e);
    if (s === null) continue;
    const text = e.kind === "error" ? shorten(s.text) : s.text;
    const same = e.kind === "error" ? text.toLowerCase().replace(/\d+/g, "#") : text,
      key = `${day}|${e.kind}|${same}|${s.detail ?? ""}`,
      twin = twins.get(key);
    if (twin) {
      const id = e.job_id;
      if (!id || !twin.job || twin.job.id === id || twin.jobs.some(j => j.id === id)) twin.n++;
      else {
        addJob(twin, e);
        twin.url = null;
      }
      continue;
    }
    const r = row(e, day, text);
    r.detail = s.detail ?? null;
    r.url = s.url ?? null;
    if (e.message.startsWith("Track: ")) r.weight = "normal";
    if (e.kind === "mail") {
      const lead = /^(\w+): /.exec(e.message)?.[1];
      r.outcome = lead && lead in STATUS ? (lead as Status) : null;
      r.flag = UNMATCHED.test(e.message);
    }
    twins.set(key, r);
    out.push(r);
  }
  for (const b of batches.values()) batchText(b);
  for (const r of rechecks.values()) recheckText(r);
  for (const r of boardErrors.values()) boardText(r);
  for (const [r, outcome] of results) resultText(r, outcome);
  return out;
}

export const KIND_FILTERS = {
  all: { label: "All", kinds: [] },
  gate: { label: "Asked you", kinds: ["gate"] },
  user: { label: "You", kinds: ["user"] },
  error: { label: "Errors", kinds: ["error"] },
  system: { label: "System", kinds: ["system", "auto", "recheck", "migration"] },
  mail: { label: "Mail", kinds: ["mail"] },
} as const satisfies Record<string, { label: string; kinds: readonly string[] }>;
export type KindFilter = keyof typeof KIND_FILTERS;
export const isKindFilter = (k: string | null): k is KindFilter => !!k && k in KIND_FILTERS;
