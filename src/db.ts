import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import { placeOf } from "./location";
import { connectDatabase, migrate } from "./schema";
import { applicationStarted, AWAITING_OUTCOME, canMove, NOT_STARTED, OFF_BOARD, PARKED, to, UNASSESSED, type HoldReason, type Status } from "./status";

export function refuseLiveDataUnderTest(env: Record<string, string | undefined> = process.env) {
  if (env["NODE_ENV"] === "test" && !env["AUTO_APPLY_DATA"])
    throw new Error(
      "Refusing to open the live database from a test run: AUTO_APPLY_DATA is not set. Run `bun test` from the repository root so tests/setup.ts is loaded.",
    );
}
refuseLiveDataUnderTest();

const DB_PATH = join(DATA, "app.db");
const dbExisted = existsSync(DB_PATH);
export const db = connectDatabase(DB_PATH, "create");
const appliedMigrations = migrate(db);

export interface Job {
  id: number;
  url: string;
  source: string;
  company: string;
  title: string;
  location: string | null;
  description: string | null;
  status: Status;
  score: number | null;
  rationale: string | null;
  concerns: string | null;
  resume_changes: string | null;
  pending: string | null;
  note: string | null;
  found_at: string;
  posted_at: string | null;
  updated_at: string;
  submitted_at: string | null;
  resume_sha: string | null;
  resume_frozen_at: string | null;
  dedupe_key: string | null;
  company_key: string | null;
  approved_by: "user" | "auto" | null;
  checklist: string | null;
  practice_assessment: string | null;
  fill_checkpoint: string | null;
  hold_reason: HoldReason | null;
  feedback: string | null;
  hand_picked: 0 | 1;
  locate_tries: number;
  deferred_at: string | null;
}

type Listener = (change: { type: "job" | "event"; jobId?: number }) => void;
const listeners = new Set<Listener>();
export const onChange = (fn: Listener) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit: Listener = change => {
  for (const fn of listeners) fn(change);
};

export const notifyJobChange = (jobId: number) => {
  emit({ type: "job", jobId });
};

export const getJob = (id: number) => db.query<Job, [number]>("SELECT * FROM jobs WHERE id = ?").get(id);

export function openedAt(j: Pick<Job, "posted_at" | "found_at">): number {
  const found = Date.parse(j.found_at.replace(" ", "T") + "Z");
  const said = j.posted_at ? Date.parse(j.posted_at) : NaN;
  if (!j.posted_at || Number.isNaN(said)) return found;
  if (j.posted_at.length === 10) return found - said < 36 * 3600_000 ? found : said + 12 * 3600_000;
  return Math.min(said, found);
}

export const nextToPrep = () => jobsByStatus("triaged").sort((a, b) => openedAt(b) - openedAt(a))[0];

export const jobsByStatus = (status: Status, limit = 1000) =>
  db.query<Job, [string, number]>("SELECT * FROM jobs WHERE status = ? ORDER BY id LIMIT ?").all(status, limit);

export const jobsInStatuses = (statuses: readonly Status[]) =>
  db.query<Job, [string]>("SELECT * FROM jobs WHERE status IN (SELECT value FROM json_each(?)) ORDER BY id").all(JSON.stringify(statuses));

export const jobsWithCheckpoint = () => db.query<Job, []>("SELECT * FROM jobs WHERE fill_checkpoint IS NOT NULL").all();

export const applicationsAwaitingOutcome = (limit = 300) =>
  db
    .query<Job, [string, number]>("SELECT * FROM jobs WHERE status IN (SELECT value FROM json_each(?)) ORDER BY submitted_at DESC LIMIT ?")
    .all(JSON.stringify(AWAITING_OUTCOME), limit);

export type BoardJob = Pick<
  Job,
  | "id"
  | "url"
  | "source"
  | "company"
  | "title"
  | "location"
  | "status"
  | "score"
  | "pending"
  | "note"
  | "found_at"
  | "posted_at"
  | "updated_at"
  | "submitted_at"
>;
export const listedJobs = (statuses: readonly Status[]) =>
  db
    .query<BoardJob & Pick<Job, "practice_assessment" | "hold_reason">, [string]>(
      `SELECT id, url, source, company, title, location, status, score, pending, note, found_at, posted_at, updated_at, submitted_at, practice_assessment, hold_reason
      FROM jobs WHERE status IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(statuses));
export const countByCompany = (statuses: readonly Status[]) =>
  new Map(
    db
      .query<{ company: string; n: number }, [string]>(
        "SELECT company, count(*) AS n FROM jobs WHERE status IN (SELECT value FROM json_each(?)) GROUP BY company",
      )
      .all(JSON.stringify(statuses))
      .map(r => [r.company, r.n]),
  );
const BACKLOG: readonly Status[] = ["locating", "triaged", "held", "rejected", "failed"];
export const boardJobs = (limit = 500) =>
  db
    .query<BoardJob, [string, string, number]>(
      `
      SELECT id, url, source, company, title, location, status, score, pending, note, found_at, posted_at, updated_at, submitted_at
      FROM jobs
      WHERE status NOT IN (SELECT value FROM json_each(?1)) AND status NOT IN (SELECT value FROM json_each(?2))
      UNION ALL
      SELECT * FROM (
        SELECT id, url, source, company, title, location, status, score, pending, note, found_at, posted_at, updated_at, submitted_at
        FROM jobs WHERE status IN (SELECT value FROM json_each(?2)) ORDER BY updated_at DESC LIMIT ?3
      )
      ORDER BY updated_at DESC`,
    )
    .all(JSON.stringify(OFF_BOARD), JSON.stringify(BACKLOG), limit);

export const statusCounts = (): Record<string, number> =>
  Object.fromEntries(
    db
      .query<{ status: string; n: number }, []>("SELECT status, count(*) AS n FROM jobs GROUP BY status")
      .all()
      .map(r => [r.status, r.n]),
  );

const APPLICATIONS: readonly Status[] = [
  "approved",
  "filling",
  "needs_input",
  "awaiting_submit",
  "needs_manual",
  "submitted",
  "interview",
  "offer",
  "rejected_by_company",
  "withdrawn",
];
export const employerApplications = (job: Pick<Job, "id" | "company_key">) =>
  job.company_key
    ? (db
        .query<{ n: number }, [number, string, string]>(
          "SELECT count(*) AS n FROM jobs WHERE id != ? AND company_key = ? AND (status IN (SELECT value FROM json_each(?)) OR submitted_at IS NOT NULL)",
        )
        .get(job.id, job.company_key, JSON.stringify(APPLICATIONS))?.n ?? 0)
    : 0;

export const employerAssessments = (job: Pick<Job, "id" | "company_key">) =>
  job.company_key
    ? db
        .query<{ id: number; practice_assessment: string }, [number, string]>(
          "SELECT id, practice_assessment FROM jobs WHERE id != ? AND company_key = ? AND practice_assessment IS NOT NULL AND checklist IS NOT NULL ORDER BY id DESC",
        )
        .all(job.id, job.company_key)
    : [];

export const siblingJobs = (job: Pick<Job, "id" | "company_key">, limit = 20) =>
  db
    .query<Pick<Job, "id" | "title" | "status">, [number, string, string, number]>(
      `
      SELECT id, title, status
      FROM jobs
      WHERE id != ? AND status NOT IN (SELECT value FROM json_each(?)) AND company_key = ?
      ORDER BY updated_at DESC
      LIMIT ?`,
    )
    .all(job.id, JSON.stringify(OFF_BOARD), job.company_key ?? "", limit);

export const jobSources = (jobId: number) =>
  db.query<{ url: string; source: string; location: string | null }, [number]>("SELECT url, source, location FROM job_sources WHERE job_id = ?").all(jobId);

const COMPANY_NOISE = new Set([
  "inc",
  "incorporated",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "holdings",
  "group",
  "the",
  "and",
]);
const TITLE_STOP = new Set(["and", "the", "of", "for", "a", "an", "in", "at", "to", "with", "or"]);
const TITLE_SYNONYMS: Record<string, string> = {
  sr: "senior",
  snr: "senior",
  jr: "junior",
  jnr: "junior",
  eng: "engineer",
  engr: "engineer",
  dev: "developer",
  swe: "software engineer",
  sde: "software engineer",
  mgr: "manager",
  i: "1",
  ii: "2",
  iii: "3",
  iv: "4",
  v: "5",
  ml: "machine learning",
  backend: "back end",
  frontend: "front end",
  fullstack: "full stack",
  devops: "dev ops",
  qa: "quality assurance",
  ai: "artificial intelligence",
};
const LEVEL = new Set(["1", "2", "3", "4", "5", "senior", "junior", "staff", "principal", "lead", "manager", "intern", "associate", "director"]);
const TITLE_TAGS = /[([][^)\]]*\b(remote|hybrid|onsite|on-site|usa?|united states|contract|full[- ]time|part[- ]time|req|r-?\d+|jr\d+|\d{4,})\b[^)\]]*[)\]]/gi;
const squash = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();

export const companyKey = (company: string) =>
  squash(company)
    .split(" ")
    .filter(w => w && !COMPANY_NOISE.has(w))
    .join("") || squash(company).replace(/ /g, "");

export function titleTokens(title: string) {
  const words = squash(title.replace(TITLE_TAGS, " "))
    .split(" ")
    .flatMap(w => (TITLE_SYNONYMS[w] ?? w).split(" "));
  return [...new Set(words.filter(w => w && !TITLE_STOP.has(w)))].sort();
}
export const dedupeKey = (company: string, title: string) => `${companyKey(company)}|${titleTokens(title).join(" ")}`;

const jaccard = (a: Set<string>, b: Set<string>) => {
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both || 1);
};
function shingles(text: string) {
  const words = squash(text.slice(0, 4000)).split(" ");
  const out = new Set<string>();
  for (let i = 0; i + 4 <= words.length; i++) out.add(words.slice(i, i + 4).join(" "));
  return out;
}

type Twinnable = Pick<Job, "company" | "title" | "description">;
export const UNTITLED = "(untitled posting)";
export function findTwin(j: Twinnable, candidates?: Job[]): Job | null {
  if (j.title === UNTITLED) return null;
  const pool = candidates ?? db.query<Job, [string]>("SELECT * FROM jobs WHERE company_key = ? ORDER BY id").all(companyKey(j.company));
  if (!pool.length) return null;
  const tokens = new Set(titleTokens(j.title)),
    key = [...tokens].join(" ");
  let text: Set<string> | null = null;
  for (const c of pool) {
    if (c.title === UNTITLED) continue;
    const theirs = new Set(titleTokens(c.title));
    if ([...theirs].join(" ") === key) return c;
    const overlap = jaccard(tokens, theirs);
    if (overlap < 0.5) continue;
    const differing = [...tokens].filter(t => !theirs.has(t)).concat([...theirs].filter(t => !tokens.has(t)));
    if (differing.some(t => LEVEL.has(t))) continue;
    const mine = j.description ?? "",
      other = c.description ?? "";
    if (mine.length <= 400 || other.length <= 400) {
      if (overlap >= 0.8) return c;
      continue;
    }
    if (jaccard((text ??= shingles(mine)), shingles(other)) >= (overlap >= 0.8 ? 0.6 : 0.85)) return c;
  }
  return null;
}

export function normalizeUrl(raw: string) {
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|ref$|source$|src$|gh_src$|lever-source)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return raw;
  }
}
const jobIdForUrl = (url: string) =>
  db.query<{ id: number }, [string, string]>("SELECT id FROM jobs WHERE url = ? UNION SELECT job_id FROM job_sources WHERE url = ?").get(url, url)?.id ?? null;
export const knownJobId = (raw: string) => jobIdForUrl(normalizeUrl(raw));
export const knownUrl = (raw: string) => knownJobId(raw) !== null;

const addSource = (jobId: number, url: string, source: string, location: string | null) =>
  db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(jobId, url, source, location);
const moveSources = (from: number, to: number) => db.query("UPDATE job_sources SET job_id = ? WHERE job_id = ?").run(to, from);

const mergeLocation = (existing: string | null, extra: string | null) => {
  if (!extra) return existing;
  if (!existing) return extra;
  return existing.toLowerCase().includes(extra.toLowerCase()) ? existing : `${existing} | ${extra}`.slice(0, 300);
};

const AGGREGATORS = new Set(["remotive", "jobicy", "remoteok", "linkedin", "indeed"]);

export const appliedLocation = (job: Pick<Job, "location">) => job.location?.split(" | ")[0] ?? null;

export function applyThrough(job: Pick<Job, "id" | "url" | "source" | "location">, url: string, source: string, location: string | null) {
  addSource(job.id, job.url, job.source, appliedLocation(job));
  db.query("DELETE FROM job_sources WHERE url = ?").run(url);
  const places = location ? [location, ...(job.location?.split(" | ") ?? []).filter(place => place !== location)].join(" | ") : job.location;
  db.query("UPDATE jobs SET url = ?, source = ?, location = ? WHERE id = ?").run(url, source, places, job.id);
}

export function betterListing(job: Pick<Job, "source" | "location">, listing: { source: string; location: string | null }) {
  const aggregated = AGGREGATORS.has(job.source);
  if (aggregated !== AGGREGATORS.has(listing.source)) return aggregated;
  return placeOf(listing.location) === "us" && placeOf(appliedLocation(job)) === "abroad";
}

function fold(into: Job, url: string, source: string, location: string | null, description: string | null) {
  if (NOT_STARTED.includes(into.status) && !applicationStarted(into) && betterListing(into, { source, location })) {
    const cameHome = AGGREGATORS.has(into.source) === AGGREGATORS.has(source);
    applyThrough(into, url, source, location);
    if (cameHome && !UNASSESSED.includes(into.status)) moveJob(into.id, NOT_STARTED, { status: "found", note: null });
  } else addSource(into.id, url, source, location);
  if (UNASSESSED.includes(into.status))
    db.query("UPDATE jobs SET location = ?, description = COALESCE(description, ?) WHERE id = ?").run(
      mergeLocation(into.location, location),
      description,
      into.id,
    );
}

export function insertJob(
  j: Pick<Job, "url" | "source" | "company" | "title" | "location" | "description"> & { posted?: string | null },
  status: Status = "found",
) {
  const url = normalizeUrl(j.url);
  if (knownUrl(url)) {
    if (j.posted) db.query("UPDATE jobs SET posted_at = ? WHERE url = ? AND posted_at IS NULL").run(j.posted, url);
    return null;
  }
  const twin = findTwin(j);
  if (twin) return (fold(twin, url, j.source, j.location, j.description), null);
  const res = db
    .query(
      `
      INSERT INTO jobs (url, source, company, title, location, description, status, dedupe_key, company_key, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(url, j.source, j.company, j.title, j.location, j.description, status, dedupeKey(j.company, j.title), companyKey(j.company), j.posted ?? null);
  emit({ type: "job", jobId: Number(res.lastInsertRowid) });
  return Number(res.lastInsertRowid);
}

function deleteJob(id: number) {
  db.query("DELETE FROM events WHERE job_id = ?").run(id);
  db.query("DELETE FROM jobs WHERE id = ?").run(id);
}

export function relocateJob(job: Job, rawUrl: string, description: string | null): "moved" | "merged" | "stale" {
  const url = normalizeUrl(rawUrl);
  const other = jobIdForUrl(url);
  if (other !== null && other !== job.id) {
    addSource(other, job.url, job.source, job.location);
    moveSources(job.id, other);
    deleteJob(job.id);
    emit({ type: "job", jobId: other });
    return "merged";
  }
  const moved = db.transaction(() => {
    if (!moveJob(job.id, "locating", { ...to.triaged(), url, description: description || job.description }, { quiet: true })) return false;
    addSource(job.id, job.url, job.source, job.location);
    return true;
  })();
  if (!moved) return "stale";
  notifyJobChange(job.id);
  return "moved";
}

const DEDUPE_VERSION = "2";
export function dedupeExisting() {
  const stale = kvGet("dedupe.version") !== DEDUPE_VERSION;
  const unkeyed = stale ? db.query<Job, []>("SELECT * FROM jobs").all() : db.query<Job, []>("SELECT * FROM jobs WHERE company_key IS NULL").all();
  for (const j of unkeyed)
    db.query("UPDATE jobs SET dedupe_key = ?, company_key = ? WHERE id = ?").run(dedupeKey(j.company, j.title), companyKey(j.company), j.id);
  kvSet("dedupe.version", DEDUPE_VERSION);
  const rank = (st: Status) => (st === "skipped" ? 0 : st === "found" ? 1 : st === "held" ? 2 : UNASSESSED.includes(st) ? 3 : 9);
  let merged = 0;
  for (const g of db.query<{ company_key: string }, []>("SELECT company_key FROM jobs GROUP BY company_key HAVING count(*) > 1").all()) {
    const rows = db
      .query<Job, [string]>("SELECT * FROM jobs WHERE company_key = ?")
      .all(g.company_key)
      .sort((a, b) => rank(b.status) - rank(a.status) || a.id - b.id);
    const kept: Job[] = [];
    for (const r of rows) {
      const twin = rank(r.status) === 9 ? null : findTwin(r, kept);
      if (!twin) {
        kept.push(r);
        continue;
      }
      moveSources(r.id, twin.id);
      deleteJob(r.id);
      fold(twin, r.url, r.source, r.location, r.description);
      merged++;
    }
  }
  if (merged) logEvent("system", `Folded ${merged} duplicate postings into existing jobs`);
}

export type JobFields = Partial<Omit<Job, "id" | "updated_at" | "status">> & { status?: never };
export type Move = Omit<JobFields, "status"> & { status: Status };
const WRITABLE_JOB_COLUMNS: Record<Exclude<keyof JobFields, "status">, true> = {
  url: true,
  source: true,
  company: true,
  title: true,
  location: true,
  description: true,
  score: true,
  rationale: true,
  concerns: true,
  resume_changes: true,
  pending: true,
  note: true,
  found_at: true,
  posted_at: true,
  submitted_at: true,
  resume_sha: true,
  resume_frozen_at: true,
  dedupe_key: true,
  company_key: true,
  approved_by: true,
  checklist: true,
  practice_assessment: true,
  fill_checkpoint: true,
  hold_reason: true,
  feedback: true,
  hand_picked: true,
  locate_tries: true,
  deferred_at: true,
};

function writableKeys(fields: object) {
  const keys = Object.keys(fields);
  if (keys.includes("status")) throw new Error("jobs.status can only change through moveJob");
  const unknown = keys.filter(k => !Object.hasOwn(WRITABLE_JOB_COLUMNS, k));
  if (unknown.length) throw new Error(`Not a writable jobs column: ${unknown.join(", ")}`);
  return keys as (keyof JobFields)[];
}

export function writeJob(id: number, fields: JobFields) {
  const keys = writableKeys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(", ");
  db.query(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => fields[k] ?? null), id);
}

export function updateJob(id: number, fields: JobFields) {
  if (!Object.keys(fields).length) return;
  writeJob(id, fields);
  emit({ type: "job", jobId: id });
}

const closeGates = (ids: readonly number[]) => {
  const list = JSON.stringify(ids);
  db.query("UPDATE question_gates SET state = 'closed' WHERE state = 'open' AND job_id IN (SELECT value FROM json_each(?))").run(list);
  db.query("UPDATE fill_state SET manual_gate = NULL WHERE manual_gate IS NOT NULL AND job_id IN (SELECT value FROM json_each(?))").run(list);
};

export function moveJob(id: number, from: Status | readonly Status[], move: Move, opts: { quiet?: boolean } = {}): boolean {
  const sources: readonly Status[] = typeof from === "string" ? [from] : from;
  const { status: target, ...columns } = move;
  for (const source of sources) if (!canMove(source, target)) throw new Error(`illegal job transition ${source} → ${target}`);
  if (target === "held" && !columns.hold_reason) throw new Error("a held job needs a hold_reason");
  const fields: JobFields = { ...columns, hold_reason: target === "held" ? (columns.hold_reason ?? null) : null };
  const keys = writableKeys(fields);
  const sets = ["status = ?", ...keys.map(k => `${k} = ?`)].join(", ");
  const moved = db.transaction(() => {
    const row = db
      .query<{ id: number }, (string | number | null)[]>(
        `UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ? AND status IN (SELECT value FROM json_each(?)) RETURNING id`,
      )
      .get(target, ...keys.map(k => fields[k] ?? null), id, JSON.stringify(sources));
    if (!row) return false;
    if (!PARKED.includes(target)) closeGates([id]);
    return true;
  })();
  if (moved && !opts.quiet) emit({ type: "job", jobId: id });
  return moved;
}

function moveWhere(from: Status, target: Status, sql: string): number {
  if (!canMove(from, target)) throw new Error(`illegal job transition ${from} → ${target}`);
  return db.transaction(() => {
    const ids = db
      .query<{ id: number }, [string, string]>(sql)
      .all(target, from)
      .map(r => r.id);
    if (!PARKED.includes(target)) closeGates(ids);
    return ids.length;
  })();
}

export const requeueInterruptedPrep = () => moveWhere("prepping", "triaged", "UPDATE jobs SET status = ?, hold_reason = NULL WHERE status = ? RETURNING id");

export const releaseHeldJobs = () =>
  moveWhere("held", "found", "UPDATE jobs SET status = ?, note = NULL, hold_reason = NULL, updated_at = datetime('now') WHERE status = ? RETURNING id");
export const releaseTargetHolds = () =>
  moveWhere(
    "held",
    "found",
    "UPDATE jobs SET status = ?, note = NULL, hold_reason = NULL, updated_at = datetime('now') WHERE status = ? AND hold_reason IN ('triage', 'target') RETURNING id",
  );

export const deferredJobs = () => db.query<Job, []>("SELECT * FROM jobs WHERE deferred_at IS NOT NULL").all();

export interface StatusChange {
  from_status: Status;
  to_status: Status;
  note: string | null;
  approved_by: "user" | "auto" | null;
  at: string;
}
export const statusHistory = (jobId: number, limit = 500) =>
  db
    .query<StatusChange, [number, number]>("SELECT from_status, to_status, note, approved_by, at FROM status_changes WHERE job_id = ? ORDER BY id LIMIT ?")
    .all(jobId, limit);
export const lastMovedFrom = (jobIds: readonly number[]) =>
  new Map(
    db
      .query<{ job_id: number; from_status: Status }, [string]>(
        `SELECT job_id, from_status FROM status_changes WHERE id IN (
          SELECT max(id) FROM status_changes WHERE job_id IN (SELECT value FROM json_each(?)) GROUP BY job_id)`,
      )
      .all(JSON.stringify(jobIds))
      .map(r => [r.job_id, r.from_status]),
  );

export interface EventRow {
  id: number;
  job_id: number | null;
  worker: string | null;
  kind: string;
  message: string;
  at: string;
}

export function logEvent(kind: string, message: string, jobId?: number | null, worker?: string) {
  db.query("INSERT INTO events (job_id, worker, kind, message) VALUES (?, ?, ?, ?)").run(jobId ?? null, worker ?? null, kind, message.slice(0, 4000));
  emit(jobId == null ? { type: "event" } : { type: "event", jobId });
}

export const lastEventId = () => db.query<{ id: number | null }, []>("SELECT MAX(id) AS id FROM events").get()?.id ?? 0;
export const workerEvents = (worker: string, afterId: number, limit = 8) =>
  db
    .query<EventRow, [string, number, number]>("SELECT * FROM events WHERE worker = ? AND id > ? AND kind IN ('step', 'agent') ORDER BY id DESC LIMIT ?")
    .all(worker, afterId, limit);

export const recentEvents = (limit = 150, before: number | null = null, kinds: readonly string[] = []) =>
  db
    .query<EventRow, [number, number, string, number]>(
      `SELECT id, job_id, worker, kind, message, at FROM events
      WHERE id < ?1 AND (?2 = 0 OR kind IN (SELECT value FROM json_each(?3)))
      ORDER BY id DESC LIMIT ?4`,
    )
    .all(before ?? Number.MAX_SAFE_INTEGER, kinds.length, JSON.stringify(kinds), limit);

const CHATTER = JSON.stringify(["step", "tool", "agent"]);

export const highlightEvents = (limit = 80, before: number | null = null, kinds: readonly string[] = []) =>
  db
    .query<Omit<EventRow, "worker"> & { company: string | null; title: string | null }, [string, number, number, string, number]>(
      `
      SELECT e.id, e.job_id, e.kind, e.message, e.at, j.company, j.title
      FROM events e
      LEFT JOIN jobs j ON j.id = e.job_id
      WHERE e.kind NOT IN (SELECT value FROM json_each(?1)) AND e.id < ?2 AND (?3 = 0 OR e.kind IN (SELECT value FROM json_each(?4)))
      ORDER BY e.id DESC
      LIMIT ?5`,
    )
    .all(CHATTER, before ?? Number.MAX_SAFE_INTEGER, kinds.length, JSON.stringify(kinds), limit);

export function pruneChatter(days: number): number {
  if (!(days > 0)) return 0;
  return db
    .query<{ id: number }, [string, string]>("DELETE FROM events WHERE kind IN (SELECT value FROM json_each(?)) AND at < datetime('now', ?) RETURNING id")
    .all(CHATTER, `-${days} days`).length;
}

export const jobEvents = (jobId: number, limit = 200) =>
  db
    .query<Pick<EventRow, "worker" | "kind" | "message" | "at">, [number, number]>(
      "SELECT worker, kind, message, at FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(jobId, limit);

export const kvGet = (key: string) => db.query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null;
export const kvSet = (key: string, value: string) =>
  db.query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
export const kvDelete = (key: string) => db.query("DELETE FROM kv WHERE key = ?").run(key);
export const kvEntries = (prefix: string) =>
  db
    .query<{ key: string; value: string }, [string, string]>("SELECT key, value FROM kv WHERE substr(key, 1, length(?)) = ? ORDER BY rowid")
    .all(prefix, prefix);

if (dbExisted) for (const migration of appliedMigrations) logEvent("system", `Database schema upgraded to version ${migration.version} (${migration.name})`);
