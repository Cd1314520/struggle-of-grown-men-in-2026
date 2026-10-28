import { db, onChange } from "./db";
import type { Status } from "./status";

export const STATS_DAYS = 30;
const RESPONDED: readonly Status[] = ["interview", "offer", "rejected_by_company"];
const NOT_RECOMMENDED: readonly Status[] = ["found", "locating", "triaged", "prepping", "skipped"];

export interface Funnel {
  found: number;
  assessed: number;
  recommended: number;
  approved: number;
  applied: number;
  responded: number;
}
export interface Stats {
  days: string[];
  found: number[];
  applied: number[];
  responses: number[];
  funnel: Funnel;
  response: { sent: number; heard: number };
  approvals: { auto: number; user: number };
}

const pad = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const sqliteTime = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");
const dayOf = (hour: string) => localDay(new Date(`${hour.slice(0, 10)}T${hour.slice(11, 13)}:00:00Z`));

interface JobGroup {
  found_hour: string;
  sent_hour: string | null;
  n: number;
  assessed: number;
  recommended: number;
  approved: number;
  applied: number;
  heard: number;
  answered: number;
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
    const s = g.sent_hour === null ? undefined : index.get(dayOf(g.sent_hour));
    if (s !== undefined) {
      applied[s] = (applied[s] ?? 0) + g.n;
      response.sent += g.n;
      response.heard += g.answered;
    }
  }

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
