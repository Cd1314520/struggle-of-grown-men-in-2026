// Numbers for the Overview: how the pipeline is doing over time. Read-only aggregates over jobs and
// status_changes. Rows are counted by UTC hour in SQL and put on local days here, which keeps
// daylight saving right and is far cheaper than SQLite's 'localtime' on every row.
import { db, onChange } from "./db";
import type { Status } from "./status";

export const STATS_DAYS = 30;
// The employer answered: a next step, an offer, or a no.
const RESPONDED: readonly Status[] = ["interview", "offer", "rejected_by_company"];
// Not past the assessment yet, or turned down by it.
const NOT_RECOMMENDED: readonly Status[] = ["found", "locating", "triaged", "prepping", "skipped"];

export interface Funnel {
  found: number; // postings found in the window
  assessed: number; // of those, scored by the assessment
  recommended: number; // ...and passed it: sent for review, held, or decided on since
  approved: number; // ...and approved, by the owner or by auto apply
  applied: number; // ...and sent
  responded: number; // ...and answered by the employer
}
export interface Stats {
  days: string[]; // the last STATS_DAYS local days as YYYY-MM-DD, oldest first; each series lines up with it
  found: number[]; // postings found
  applied: number[]; // applications sent
  responses: number[]; // applications the employer answered, each counted once a day
  funnel: Funnel; // the postings found in the window, by how far they got
  response: { sent: number; heard: number }; // applications sent in the window, and how many were answered
  approvals: { auto: number; user: number }; // jobs approved in the window, by who gave gate 1
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// SQLite's own "YYYY-MM-DD HH:MM:SS" in UTC, as found_at and status_changes.at are written.
const sqliteTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
// "YYYY-MM-DD HH", a UTC hour, to the local day it falls on.
const dayOf = (hour: string) => localDay(new Date(`${hour.slice(0, 10)}T${hour.slice(11, 13)}:00:00Z`));

// One group per (hour found, hour sent): every posting found in the window and every application ever
// sent, in a single pass over jobs. The stage columns are each a subset of the one before, so the
// funnel never widens.
interface JobGroup {
  found_hour: string;
  sent_hour: string | null;
  n: number;
  assessed: number;
  recommended: number;
  approved: number;
  applied: number;
  heard: number; // through every stage, and answered
  answered: number; // answered, whatever the stages say
}

export function computeStats(now = Date.now()): Stats {
  const first = new Date(now);
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() - (STATS_DAYS - 1));
  const days = Array.from({ length: STATS_DAYS }, (_, i) => localDay(new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)));
  const since = sqliteTime(first.getTime()),
    sinceHour = since.slice(0, 13);
  const responded = JSON.stringify(RESPONDED);

  const groups = db
    .query<JobGroup, [string, string, string]>(
      `SELECT found_hour, sent_hour, count(*) AS n, sum(assessed) AS assessed, sum(recommended) AS recommended,
        sum(approved) AS approved, sum(applied) AS applied, sum(applied AND answered) AS heard,
        sum(answered) AS answered
      FROM (
        SELECT found_hour, sent_hour, answered, assessed, recommended, approved, approved AND sent_hour IS NOT NULL AS applied
        FROM (
          SELECT found_hour, sent_hour, answered, assessed, recommended, recommended AND (approved_by IS NOT NULL OR sent_hour IS NOT NULL) AS approved
          FROM (
            SELECT substr(found_at, 1, 13) AS found_hour, substr(datetime(submitted_at), 1, 13) AS sent_hour, approved_by,
              status IN (SELECT value FROM json_each(?1)) AS answered,
              score IS NOT NULL AS assessed,
              score IS NOT NULL AND status NOT IN (SELECT value FROM json_each(?2)) AS recommended
            FROM jobs WHERE found_at >= ?3 OR submitted_at IS NOT NULL
          )
        )
      )
      GROUP BY found_hour, sent_hour`,
    )
    .all(responded, JSON.stringify(NOT_RECOMMENDED), since);

  const index = new Map(days.map((d, i) => [d, i]));
  const found = days.map(() => 0),
    applied = days.map(() => 0),
    responses = days.map(() => 0);
  const funnel: Funnel = { found: 0, assessed: 0, recommended: 0, approved: 0, applied: 0, responded: 0 };
  const response = { sent: 0, heard: 0 };
  for (const g of groups) {
    const f = index.get(dayOf(g.found_hour));
    if (g.found_hour >= sinceHour && f !== undefined) {
      found[f] = (found[f] ?? 0) + g.n;
      funnel.found += g.n;
      funnel.assessed += g.assessed;
      funnel.recommended += g.recommended;
      funnel.approved += g.approved;
      funnel.applied += g.applied;
      funnel.responded += g.heard;
    }
    // Any sent job counts as sent, whatever the assessment columns say about it.
    const s = g.sent_hour === null ? undefined : index.get(dayOf(g.sent_hour));
    if (s !== undefined) {
      applied[s] = (applied[s] ?? 0) + g.n;
      response.sent += g.n;
      response.heard += g.answered;
    }
  }

  // An application moving on twice in a day (an interview, then an offer) is one answer that day.
  const answers = db
    .query<{ hour: string; job_id: number }, [string, string]>(
      "SELECT DISTINCT substr(at, 1, 13) AS hour, job_id FROM status_changes WHERE at >= ? AND to_status IN (SELECT value FROM json_each(?))",
    )
    .all(since, responded);
  for (const key of new Set(answers.map(a => `${dayOf(a.hour)}|${a.job_id}`))) {
    const r = index.get(key.slice(0, 10));
    if (r !== undefined) responses[r] = (responses[r] ?? 0) + 1;
  }

  const approvals = { auto: 0, user: 0 };
  const approvers = db
    .query<{ by: string | null; n: number }, [string]>(
      "SELECT approved_by AS by, count(DISTINCT job_id) AS n FROM status_changes WHERE to_status = 'approved' AND at >= ? GROUP BY approved_by",
    )
    .all(since);
  for (const r of approvers) if (r.by === "auto" || r.by === "user") approvals[r.by] = r.n;

  return { days, found, applied, responses, funnel, response, approvals };
}

// The pass over jobs reads every posting's row, descriptions and all (~150ms on 80k), and the Overview
// refetches on every change the server streams. So the numbers are kept until a job changes, and then
// for at least FRESH_MS more: a day's chart can trail the event that moved it by that much.
const FRESH_MS = 20_000;
let kept: { stats: Stats; at: number; day: string } | null = null,
  changed = false;
onChange(change => {
  if (change.type === "job") changed = true;
});
export function stats(now = Date.now()): Stats {
  const day = localDay(new Date(now));
  if (kept?.day === day && (!changed || now - kept.at < FRESH_MS)) return kept.stats;
  changed = false;
  kept = { stats: computeStats(now), at: now, day };
  return kept.stats;
}
