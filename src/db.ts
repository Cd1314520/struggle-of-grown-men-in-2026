import { Database } from "bun:sqlite";
import { join } from "node:path";
import { DATA } from "./config";

export const db = new Database(join(DATA, "app.db"), { create: true });
db.run("PRAGMA journal_mode = WAL");

db.run(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  company TEXT NOT NULL,
  title TEXT NOT NULL,
  location TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'found',
  score INTEGER,
  rationale TEXT,
  concerns TEXT,
  resume_changes TEXT,
  pending TEXT,          -- JSON: question / confirmation the agent is blocked on
  note TEXT,             -- latest human-readable status note
  found_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_at TEXT
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  job_id INTEGER,
  worker TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_job ON events(job_id);

CREATE TABLE IF NOT EXISTS accounts (
  domain TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// Columns added after the first version.
for (const col of ["resume_sha TEXT", "resume_frozen_at TEXT", "checklist TEXT", "dedupe_key TEXT", "company_key TEXT", "posted_at TEXT", "approved_by TEXT", "practice_assessment TEXT", "fill_checkpoint TEXT"]) {
  try {
    db.run(`ALTER TABLE jobs ADD COLUMN ${col}`);
  } catch {
    // already there
  }
}

db.run(`
CREATE TABLE IF NOT EXISTS job_sources (
  url TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  location TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS job_sources_job ON job_sources(job_id);
CREATE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key);
CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_key);
`);

// Durable human gates, application-only answers, and explicitly authorized exact standing rules.
db.run(`
CREATE TABLE IF NOT EXISTS question_gates (
  id TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('question','cover_letter','confirm_submit','manual','submission_ambiguous')),
  group_key TEXT NOT NULL,
  match_key TEXT NOT NULL,
  employer TEXT NOT NULL,
  text TEXT NOT NULL,
  context TEXT NOT NULL,
  options TEXT NOT NULL,
  legacy INTEGER NOT NULL DEFAULT 0,
  standing_allowed INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK(state IN ('open','answered','closed')),
  answer TEXT,
  scope TEXT CHECK(scope IN ('application','standing')),
  shot INTEGER,
  created_at TEXT NOT NULL,
  answered_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS question_gates_open_job ON question_gates(job_id) WHERE state = 'open';
CREATE INDEX IF NOT EXISTS question_gates_group ON question_gates(group_key, state);
CREATE INDEX IF NOT EXISTS question_gates_job ON question_gates(job_id, created_at);
CREATE TABLE IF NOT EXISTS application_answers (
  job_id INTEGER NOT NULL,
  match_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT NOT NULL,
  options TEXT NOT NULL,
  answer TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY(job_id, match_key)
);
CREATE TABLE IF NOT EXISTS standing_answers (
  match_key TEXT PRIMARY KEY,
  employer TEXT NOT NULL,
  question TEXT NOT NULL,
  context TEXT NOT NULL,
  options TEXT NOT NULL,
  answer TEXT NOT NULL,
  source_gate_id TEXT NOT NULL,
  answered_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS submit_approvals (
  job_id INTEGER PRIMARY KEY,
  gate_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
`);

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
export const knownUrl = (raw: string) => {
  const url = normalizeUrl(raw);
  return !!db.query("SELECT 1 FROM jobs WHERE url = ? UNION SELECT 1 FROM job_sources WHERE url = ?").get(url, url);
};

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
    db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(into.id, into.url, into.source, into.location);
    db.query("UPDATE jobs SET url = ?, source = ? WHERE id = ?").run(url, source, into.id);
  } else db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(into.id, url, source, location);
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
    .query("INSERT INTO jobs (url, source, company, title, location, description, status, dedupe_key, company_key, posted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
  const other = db.query<{ id: number }, [string, string]>("SELECT id FROM jobs WHERE url = ? UNION SELECT job_id FROM job_sources WHERE url = ?").get(url, url);
  if (other && other.id !== job.id) {
    db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(other.id, job.url, job.source, job.location);
    db.query("UPDATE job_sources SET job_id = ? WHERE job_id = ?").run(other.id, job.id);
    deleteJob(job.id);
    emit({ type: "job", jobId: other.id });
    return "merged";
  }
  db.query("INSERT OR IGNORE INTO job_sources (job_id, url, source, location) VALUES (?, ?, ?, ?)").run(job.id, job.url, job.source, job.location);
  updateJob(job.id, { url, description: description || job.description, status: "triaged", note: null });
  return "moved";
}

// Re-keys rows and folds duplicates saved before the current matching rules. Safe to run on every start.
const DEDUPE_VERSION = "2";
export function dedupeExisting() {
  const stale = kvGet("dedupe.version") !== DEDUPE_VERSION;
  for (const j of db.query<Job, []>(`SELECT * FROM jobs ${stale ? "" : "WHERE company_key IS NULL"}`).all())
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
      db.query("UPDATE job_sources SET job_id = ? WHERE job_id = ?").run(twin.id, r.id);
      deleteJob(r.id);
      merged++;
    }
  }
  if (merged) logEvent("system", `Folded ${merged} duplicate postings into existing jobs`);
}

export function updateJob(id: number, fields: Partial<Omit<Job, "id">>) {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(", ");
  db.query(`UPDATE jobs SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...keys.map(k => fields[k] ?? null), id);
  emit({ type: "job", jobId: id });
}

export function logEvent(kind: string, message: string, jobId?: number | null, worker?: string) {
  db.query("INSERT INTO events (job_id, worker, kind, message) VALUES (?, ?, ?, ?)").run(jobId ?? null, worker ?? null, kind, message.slice(0, 4000));
  emit(jobId == null ? { type: "event" } : { type: "event", jobId });
}

export const kvGet = (key: string) => db.query<{ value: string }, [string]>("SELECT value FROM kv WHERE key = ?").get(key)?.value ?? null;
export const kvSet = (key: string, value: string) =>
  db.query("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
export const kvDelete = (key: string) => db.query("DELETE FROM kv WHERE key = ?").run(key);
// Every entry whose key starts with `prefix`, oldest first.
export const kvEntries = (prefix: string) =>
  db.query<{ key: string; value: string }, [string, string]>("SELECT key, value FROM kv WHERE substr(key, 1, length(?)) = ? ORDER BY rowid").all(prefix, prefix);
