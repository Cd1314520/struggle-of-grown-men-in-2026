import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "./config";
import { connectDatabase, migrate } from "./schema";

// SQL lives with the module that owns the table: jobs, job_sources, events and kv here, accounts in
// accounts.ts, gates and answers in questions.ts, the digest ledger in digest.ts. The tables
// themselves are defined in schema.ts.
// `bun test` sets NODE_ENV=test. Opening the database migrates it, so a test process must say where
// its throwaway state is (tests/setup.ts does) rather than fall through to the live data directory.
export function refuseLiveDataUnderTest(env: Record<string, string | undefined> = process.env) {
  if (env["NODE_ENV"] === "test" && !env["AUTO_APPLY_DATA"])
    throw new Error("Refusing to open the live database from a test run: AUTO_APPLY_DATA is not set. Run `bun test` from the repository root so tests/setup.ts is loaded.");
}
refuseLiveDataUnderTest();

const DB_PATH = join(DATA, "app.db");
const dbExisted = existsSync(DB_PATH);
export const db = connectDatabase(DB_PATH, "create");
const appliedMigrations = migrate(db);

/*
 * found             scanned, not yet triaged
 * locating          title looked relevant, but it was found on LinkedIn/Indeed: looking for the employer's own posting
 * triaged           title looked relevant, waiting for scoring + resume
 * prepping          prep worker running
 * awaiting_approval gate 1: waiting for the user
 * approved          approved by the user or by auto apply (approved_by), waiting for the fill worker
 * filling           fill worker running
 * needs_input       fill worker is blocked on a question
 * awaiting_submit   gate 2: form filled, waiting for the user
 * needs_manual      agent gave up on something (captcha, odd flow); user takes over
 * submitted         application sent
 * interview / offer / rejected_by_company   outcomes seen in mail
 * held              good match set aside during the practice phase; released later
 * skipped           triage or score said no
 * rejected          user said no
 * failed            worker errored; can be retried
 */
export type Status =
  | "found" | "locating" | "triaged" | "prepping" | "awaiting_approval" | "approved" | "filling"
  | "needs_input" | "awaiting_submit" | "needs_manual" | "submitted" | "interview"
  | "offer" | "rejected_by_company" | "held" | "skipped" | "rejected" | "failed";

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
  posted_at: string | null; // when the employer opened it, where the source says: ISO time, or YYYY-MM-DD
  updated_at: string;
  submitted_at: string | null;
  resume_sha: string | null; // sha256 of the exact PDF handed to the fill worker
  resume_frozen_at: string | null;
  dedupe_key: string | null;
  company_key: string | null;
  approved_by: "user" | "auto" | null; // who gave gate 1
  checklist: string | null; // JSON: every rubric item with its answer, evidence and points
  practice_assessment: string | null; // JSON: PracticeAssessment { version: 1, ... }
  fill_checkpoint: string | null; // JSON: versioned FillCheckpoint; navigation only, never answer values
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

// Transactional callers notify only after durable state has committed.
export const notifyJobChange = (jobId: number) => { emit({ type: "job", jobId }); };

export const getJob = (id: number) => db.query<Job, [number]>("SELECT * FROM jobs WHERE id = ?").get(id);

// Best estimate of when a posting opened, in ms. Applying in the first hours matters, so this drives
// both the order jobs are assessed in and how the lists are sorted.
export function openedAt(j: Pick<Job, "posted_at" | "found_at">): number {
  const found = Date.parse(j.found_at.replace(" ", "T") + "Z");
  const said = j.posted_at ? Date.parse(j.posted_at) : NaN;
  if (!j.posted_at || Number.isNaN(said)) return found;
  // Only the day is known: a first sighting within a day or so of it is the closer estimate.
  if (j.posted_at.length === 10) return found - said < 36 * 3600_000 ? found : said + 12 * 3600_000;
  return Math.min(said, found);
}

// Triaged jobs waiting to be assessed, most recently opened first.
export const nextToPrep = () => jobsByStatus("triaged").sort((a, b) => openedAt(b) - openedAt(a))[0];

export const jobsByStatus = (status: Status, limit = 1000) =>
  db.query<Job, [string, number]>("SELECT * FROM jobs WHERE status = ? ORDER BY id LIMIT ?").all(status, limit);

// Every job in any of the given statuses, oldest first.
export const jobsInStatuses = (statuses: readonly Status[]) =>
  db.query<Job, [string]>("SELECT * FROM jobs WHERE status IN (SELECT value FROM json_each(?)) ORDER BY id").all(JSON.stringify(statuses));

// Jobs with a saved browser checkpoint, whatever their status.
export const jobsWithCheckpoint = () => db.query<Job, []>("SELECT * FROM jobs WHERE fill_checkpoint IS NOT NULL").all();

// Applications still waiting for an outcome, most recently submitted first.
export const applicationsAwaitingOutcome = (limit = 300) =>
  db.query<Job, [number]>("SELECT * FROM jobs WHERE status IN ('submitted', 'interview') ORDER BY submitted_at DESC LIMIT ?").all(limit);

// ---- what the UI lists

export type BoardJob = Pick<Job, "id" | "url" | "source" | "company" | "title" | "location" | "status" | "score" | "pending" | "note" | "found_at" | "posted_at" | "updated_at" | "submitted_at">;
// Everything past triage, most recently touched first. Leaves out the long text columns.
export const boardJobs = (limit = 500) =>
  db
    .query<BoardJob, [number]>(`
      SELECT id, url, source, company, title, location, status, score, pending, note, found_at, posted_at, updated_at, submitted_at
      FROM jobs
      WHERE status NOT IN ('found', 'skipped')
      ORDER BY updated_at DESC
      LIMIT ?`)
    .all(limit);

export const statusCounts = (): Record<string, number> =>
  Object.fromEntries(db.query<{ status: string; n: number }, []>("SELECT status, count(*) AS n FROM jobs GROUP BY status").all().map(r => [r.status, r.n]));

// Other live jobs at the same employer.
export const siblingJobs = (job: Pick<Job, "id" | "company_key">, limit = 20) =>
  db
    .query<Pick<Job, "id" | "title" | "status">, [number, string, number]>(`
      SELECT id, title, status
      FROM jobs
      WHERE id != ? AND status NOT IN ('found', 'skipped') AND company_key = ?
      ORDER BY updated_at DESC
      LIMIT ?`)
    .all(job.id, job.company_key ?? "", limit);

export const jobSources = (jobId: number) =>
  db.query<{ url: string; source: string; location: string | null }, [number]>("SELECT url, source, location FROM job_sources WHERE job_id = ?").all(jobId);

// ---- duplicates: one row per (employer, role), however many boards, aggregators or locations list it
//
// Two postings are the same role when the employer matches and either the titles say the same thing
// (ignoring word order, abbreviations, punctuation and tags like "(Remote)" or a requisition id) or
// the titles are close and the description text is nearly identical.

const COMPANY_NOISE = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "gmbh", "plc", "holdings", "group", "the", "and"]);
const TITLE_STOP = new Set(["and", "the", "of", "for", "a", "an", "in", "at", "to", "with", "or"]);
const TITLE_SYNONYMS: Record<string, string> = {
  sr: "senior", snr: "senior", jr: "junior", jnr: "junior", eng: "engineer", engr: "engineer", dev: "developer", swe: "software engineer", sde: "software engineer",
  mgr: "manager", i: "1", ii: "2", iii: "3", iv: "4", v: "5", ml: "machine learning", backend: "back end", frontend: "front end", fullstack: "full stack",
  devops: "dev ops", qa: "quality assurance", ai: "artificial intelligence",
};
// What separates two genuinely different openings with otherwise similar titles.
const LEVEL = new Set(["1", "2", "3", "4", "5", "senior", "junior", "staff", "principal", "lead", "manager", "intern", "associate", "director"]);
const TITLE_TAGS = /[([][^)\]]*\b(remote|hybrid|onsite|on-site|usa?|united states|contract|full[- ]time|part[- ]time|req|r-?\d+|jr\d+|\d{4,})\b[^)\]]*[)\]]/gi;
const squash = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9+#]+/g, " ").trim();

export const companyKey = (company: string) => squash(company).split(" ").filter(w => w && !COMPANY_NOISE.has(w)).join("") || squash(company).replace(/ /g, "");

export function titleTokens(title: string) {
  const words = squash(title.replace(TITLE_TAGS, " ")).split(" ").flatMap(w => (TITLE_SYNONYMS[w] ?? w).split(" "));
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
// The existing job this posting duplicates, if any.
export function findTwin(j: Twinnable, candidates?: Job[]): Job | null {
  const pool = candidates ?? db.query<Job, [string]>("SELECT * FROM jobs WHERE company_key = ? ORDER BY id").all(companyKey(j.company));
  if (!pool.length) return null;
  const tokens = new Set(titleTokens(j.title)), key = [...tokens].join(" ");
  let text: Set<string> | null = null;
  for (const c of pool) {
    const theirs = new Set(titleTokens(c.title));
    if ([...theirs].join(" ") === key) return c;
    const overlap = jaccard(tokens, theirs);
    if (overlap < 0.5) continue;
    const differing = [...tokens].filter(t => !theirs.has(t)).concat([...theirs].filter(t => !tokens.has(t)));
    if (differing.some(t => LEVEL.has(t))) continue; // "Engineer 1" and "Engineer 2" are different jobs
    // Close titles: accept unless both bodies are there to compare and they disagree.
    // Related titles: only when the body text is nearly identical.
    const mine = j.description ?? "", other = c.description ?? "";
    if (mine.length <= 400 || other.length <= 400) {
      if (overlap >= 0.8) return c;
      continue;
    }
    if (jaccard((text ??= shingles(mine)), shingles(other)) >= (overlap >= 0.8 ? 0.6 : 0.85)) return c;
  }
  return null;
}

// Tracking parameters differ per board; everything else in the URL identifies the posting.
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
// The job a (normalized) URL belongs to, as its own posting or as another listing of it.
const jobIdForUrl = (url: string) =>
  db.query<{ id: number }, [string, string]>("SELECT id FROM jobs WHERE url = ? UNION SELECT job_id FROM job_sources WHERE url = ?").get(url, url)?.id ?? null;
export const knownUrl = (raw: string) => jobIdForUrl(normalizeUrl(raw)) !== null;

const addSource = (jobId: number, url: string, source: string, location: string | null) =>
  db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(jobId, url, source, location);
const moveSources = (from: number, to: number) => db.query("UPDATE job_sources SET job_id = ? WHERE job_id = ?").run(to, from);

const mergeLocation = (existing: string | null, extra: string | null) => {
  if (!extra) return existing;
  if (!existing) return extra;
  return existing.toLowerCase().includes(extra.toLowerCase()) ? existing : `${existing} | ${extra}`.slice(0, 300);
};

// Aggregator listings only link on to the employer's form; a company board is the form itself.
const AGGREGATORS = new Set(["remotive", "jobicy", "remoteok", "linkedin", "indeed"]);
const NOT_STARTED = ["found", "locating", "triaged", "held", "skipped", "awaiting_approval"];

function fold(into: Job, url: string, source: string, location: string | null, description: string | null) {
  if (AGGREGATORS.has(into.source) && !AGGREGATORS.has(source) && NOT_STARTED.includes(into.status)) {
    // The employer's own listing turned up for a job first seen on an aggregator: apply there instead.
    addSource(into.id, into.url, into.source, into.location);
    db.query("UPDATE jobs SET url = ?, source = ? WHERE id = ?").run(url, source, into.id);
  } else addSource(into.id, url, source, location);
  // Until it has been assessed, let the extra listing widen the location and fill a missing description.
  if (["found", "locating", "triaged"].includes(into.status))
    db.query("UPDATE jobs SET location = ?, description = COALESCE(description, ?) WHERE id = ?").run(mergeLocation(into.location, location), description, into.id);
}

// Inserts a posting, or folds it into the job it duplicates (returns null either way when nothing new was added).
export function insertJob(j: Pick<Job, "url" | "source" | "company" | "title" | "location" | "description"> & { posted?: string | null }, status: Status = "found") {
  const url = normalizeUrl(j.url);
  if (knownUrl(url)) {
    // Jobs saved before posting dates were recorded pick theirs up the next time the board is read.
    if (j.posted) db.query("UPDATE jobs SET posted_at = ? WHERE url = ? AND posted_at IS NULL").run(j.posted, url);
    return null;
  }
  const twin = findTwin(j);
  if (twin) return fold(twin, url, j.source, j.location, j.description), null;
  const res = db
    .query(`
      INSERT INTO jobs (url, source, company, title, location, description, status, dedupe_key, company_key, posted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(url, j.source, j.company, j.title, j.location, j.description, status, dedupeKey(j.company, j.title), companyKey(j.company), j.posted ?? null);
  emit({ type: "job", jobId: Number(res.lastInsertRowid) });
  return Number(res.lastInsertRowid);
}

// Removes a job that was folded into another, with what was recorded under its id. Only jobs nothing
// has acted on are ever folded, so there is no fill state to carry over.
function deleteJob(id: number) {
  db.query("DELETE FROM events WHERE job_id = ?").run(id);
  db.query("DELETE FROM jobs WHERE id = ?").run(id);
  for (const key of ["feedback", "locate.tries", "auto.deferred"]) kvDelete(`${key}.${id}`);
}

// Points a job found on a job-search site at the employer's own posting. When that posting is already
// a job here, this one is folded into it instead.
export function relocateJob(job: Job, rawUrl: string, description: string | null): "moved" | "merged" {
  const url = normalizeUrl(rawUrl);
  const other = jobIdForUrl(url);
  if (other !== null && other !== job.id) {
    addSource(other, job.url, job.source, job.location);
    moveSources(job.id, other);
    deleteJob(job.id);
    emit({ type: "job", jobId: other });
    return "merged";
  }
  addSource(job.id, job.url, job.source, job.location);
  updateJob(job.id, { url, description: description || job.description, status: "triaged", note: null });
  return "moved";
}

// Re-keys rows and folds duplicates saved before the current matching rules. Safe to run on every start.
const DEDUPE_VERSION = "2";
export function dedupeExisting() {
  const stale = kvGet("dedupe.version") !== DEDUPE_VERSION;
  const unkeyed = stale ? db.query<Job, []>("SELECT * FROM jobs").all() : db.query<Job, []>("SELECT * FROM jobs WHERE company_key IS NULL").all();
  for (const j of unkeyed)
    db.query("UPDATE jobs SET dedupe_key = ?, company_key = ? WHERE id = ?").run(dedupeKey(j.company, j.title), companyKey(j.company), j.id);
  kvSet("dedupe.version", DEDUPE_VERSION);
  // Only rows nothing has acted on yet may be folded away; the most advanced row of a set is kept.
  const rank = (st: string) => ({ skipped: 0, found: 1, held: 2, locating: 3, triaged: 3 })[st] ?? 9;
  let merged = 0;
  for (const g of db.query<{ company_key: string }, []>("SELECT company_key FROM jobs GROUP BY company_key HAVING count(*) > 1").all()) {
    const rows = db.query<Job, [string]>("SELECT * FROM jobs WHERE company_key = ?").all(g.company_key).sort((a, b) => rank(b.status) - rank(a.status) || a.id - b.id);
    const kept: Job[] = [];
    for (const r of rows) {
      const twin = rank(r.status) === 9 ? null : findTwin(r, kept);
      if (!twin) {
        kept.push(r);
        continue;
      }
      fold(twin, r.url, r.source, r.location, r.description);
      moveSources(r.id, twin.id);
      deleteJob(r.id);
      merged++;
    }
  }
  if (merged) logEvent("system", `Folded ${merged} duplicate postings into existing jobs`);
}

// Every column a caller may set. `id` never changes and `updated_at` is stamped on every write.
export type JobFields = Partial<Omit<Job, "id" | "updated_at">>;
const WRITABLE_JOB_COLUMNS: Record<keyof JobFields, true> = {
  url: true, source: true, company: true, title: true, location: true, description: true, status: true, score: true,
  rationale: true, concerns: true, resume_changes: true, pending: true, note: true, found_at: true, posted_at: true,
  submitted_at: true, resume_sha: true, resume_frozen_at: true, dedupe_key: true, company_key: true, approved_by: true,
  checklist: true, practice_assessment: true, fill_checkpoint: true,
};

// Writes the given columns without telling listeners. For callers inside a transaction, which call
// notifyJobChange themselves once it has committed; everything else uses updateJob.
export function writeJob(id: number, fields: JobFields) {
  const keys = Object.keys(fields) as (keyof JobFields)[];
  if (!keys.length) return;
  // Column names cannot be bound as parameters, so only known ones ever reach the statement.
  const unknown = keys.filter(k => !Object.hasOwn(WRITABLE_JOB_COLUMNS, k));
  if (unknown.length) throw new Error(`Not a writable jobs column: ${unknown.join(", ")}`);
  const sets = keys.map(k => `${k} = ?`).join(", ");
  db.query(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => fields[k] ?? null), id);
}

export function updateJob(id: number, fields: JobFields) {
  if (!Object.keys(fields).length) return;
  writeJob(id, fields);
  emit({ type: "job", jobId: id });
}

// The current time as datetime('now') writes it, for columns that are otherwise stamped in SQL.
export const sqlNow = () => new Date().toISOString().slice(0, 19).replace("T", " ");

// A prep worker does not survive a restart: its jobs go back in the queue.
export const requeueInterruptedPrep = () => db.query("UPDATE jobs SET status = 'triaged' WHERE status = 'prepping'").run().changes;

// Sends held jobs back through triage. Returns how many.
export const releaseHeldJobs = () =>
  db.query("UPDATE jobs SET status = 'found', note = NULL, updated_at = datetime('now') WHERE status = 'held'").run().changes;

// ---- events

export interface EventRow { id: number; job_id: number | null; worker: string | null; kind: string; message: string; at: string }

export function logEvent(kind: string, message: string, jobId?: number | null, worker?: string) {
  db.query("INSERT INTO events (job_id, worker, kind, message) VALUES (?, ?, ?, ?)").run(jobId ?? null, worker ?? null, kind, message.slice(0, 4000));
  emit(jobId == null ? { type: "event" } : { type: "event", jobId });
}

export const recentEvents = (limit = 150) =>
  db.query<EventRow, [number]>("SELECT id, job_id, worker, kind, message, at FROM events ORDER BY id DESC LIMIT ?").all(limit);

// Without the agents' step-by-step chatter: what a person scanning the feed cares about.
export const highlightEvents = (limit = 80) =>
  db
    .query<Omit<EventRow, "worker"> & { company: string | null; title: string | null }, [number]>(`
      SELECT e.id, e.job_id, e.kind, e.message, e.at, j.company, j.title
      FROM events e
      LEFT JOIN jobs j ON j.id = e.job_id
      WHERE e.kind NOT IN ('step', 'tool', 'agent')
      ORDER BY e.id DESC
      LIMIT ?`)
    .all(limit);

export const jobEvents = (jobId: number, limit = 200) =>
  db.query<Pick<EventRow, "worker" | "kind" | "message" | "at">, [number, number]>("SELECT worker, kind, message, at FROM events WHERE job_id = ? ORDER BY id DESC LIMIT ?").all(jobId, limit);

// ---- kv: small durable values keyed by name

export const kvGet = (key: string) => db.query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null;
export const kvSet = (key: string, value: string) =>
  db.query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
export const kvDelete = (key: string) => db.query("DELETE FROM kv WHERE key = ?").run(key);
// Every entry whose key starts with `prefix`, oldest first.
export const kvEntries = (prefix: string) =>
  db.query<{ key: string; value: string }, [string, string]>("SELECT key, value FROM kv WHERE substr(key, 1, length(?)) = ? ORDER BY rowid").all(prefix, prefix);

// A fresh database has nothing worth telling; an existing one records what changed under it.
if (dbExisted) for (const migration of appliedMigrations) logEvent("system", `Database schema upgraded to version ${migration.version} (${migration.name})`);
