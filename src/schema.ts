// The database schema, as an ordered list of migrations. `PRAGMA user_version` records how many have
// been applied; `migrate` applies the rest, each in its own transaction together with the version
// bump, so a database is always at exactly one known version.
//
// Changing the schema:
//   - Append a migration. Never edit or reorder one that has shipped: databases that already ran it
//     will not run it again, and new databases would diverge from them.
//   - Write it for exactly the schema the previous migration leaves behind. No IF NOT EXISTS, no
//     try/catch: a statement that fails must fail the migration. Only the baseline is tolerant.
//   - SQLite cannot alter a constraint or a column type in place. Create the new table, copy the rows
//     across, drop the old table and rename, all in the one migration.
//   - Backfills belong in the same migration as the column they fill.
//
// This module must not import anything that reads configuration: scripts and tests use it on
// databases other than the app's own.
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const hasColumn = (db: Database, table: string, column: string) =>
  !!db.query<{ name: string }, [string, string]>("SELECT name FROM pragma_table_info(?) WHERE name = ?").get(table, column);

// Columns `jobs` gained, in the order they were added, before schema versions were tracked.
const JOBS_COLUMNS_ADDED = [
  "resume_sha TEXT",
  "resume_frozen_at TEXT",
  "checklist TEXT",
  "dedupe_key TEXT",
  "company_key TEXT",
  "posted_at TEXT",
  "approved_by TEXT",
  "practice_assessment TEXT",
  "fill_checkpoint TEXT",
] as const;

// Version 1 is the schema as it stood when versioning began. Databases older than that were grown by
// CREATE TABLE IF NOT EXISTS and ADD COLUMN on every start, so one may hold any prefix of this. The
// baseline therefore creates only what is missing, and brings an empty database and every earlier
// database to the same shape.
function baseline(db: Database) {
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
  `);
  for (const definition of JOBS_COLUMNS_ADDED) {
    const name = definition.slice(0, definition.indexOf(" "));
    if (!hasColumn(db, "jobs", name)) db.run(`ALTER TABLE jobs ADD COLUMN ${definition}`);
  }
  db.run(`
    CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key);
    CREATE INDEX IF NOT EXISTS jobs_company ON jobs(company_key);

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

    -- Every other listing of a job: the boards, aggregators and locations it was also seen at.
    CREATE TABLE IF NOT EXISTS job_sources (
      url TEXT PRIMARY KEY,
      job_id INTEGER NOT NULL,
      source TEXT NOT NULL,
      location TEXT,
      seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS job_sources_job ON job_sources(job_id);

    -- Durable human gates, application-only answers, and explicitly authorized exact standing rules.
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

    -- The digest ledger is independent of gate lifetime. Closing or adding jobs cannot erase delivery proof.
    CREATE TABLE IF NOT EXISTS question_digest_deliveries (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      fingerprints TEXT NOT NULL,
      group_count INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('sending', 'uncertain', 'failed', 'sent')),
      created_at TEXT NOT NULL,
      attempt_at TEXT NOT NULL,
      sent_at TEXT,
      gmail_id TEXT,
      error TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS question_digest_one_pending
      ON question_digest_deliveries ((1)) WHERE state != 'sent';
    CREATE TABLE IF NOT EXISTS question_digest_notified (
      fingerprint TEXT PRIMARY KEY,
      delivery_id TEXT NOT NULL,
      sent_at TEXT NOT NULL
    );
  `);
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", up: baseline },
];

// The version this code reads and writes.
export const SCHEMA_VERSION = MIGRATIONS.length;

export const schemaVersion = (db: Database) => db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;

// Brings the database up to the last migration and returns the ones it applied. Safe to call from
// several processes at once: each step re-reads the version under the write lock before acting.
export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error(`Migration "${migration.name}" must be version ${index + 1}, not ${migration.version}`);
  });
  const latest = migrations.length;
  const tooNew = (version: number) => new Error(`Database schema is version ${version}, but this code only knows up to version ${latest}. Run the newer code, or restore a backup.`);
  const applied: Migration[] = [];
  for (;;) {
    const current = schemaVersion(db);
    if (current > latest) throw tooNew(current);
    if (current === latest) return applied;
    const step = db.transaction(() => {
      const version = schemaVersion(db);
      if (version > latest) throw tooNew(version);
      const next = migrations[version];
      if (!next) return null; // another process got there first
      try {
        next.up(db);
      } catch (error) {
        throw new Error(`Migration ${next.version} (${next.name}) failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      // PRAGMA takes no parameters; the version is an integer checked above.
      db.run(`PRAGMA user_version = ${next.version}`);
      return next;
    }).immediate();
    if (step) applied.push(step);
  }
}

export function assertSchemaCurrent(db: Database, label = "Database") {
  const version = schemaVersion(db);
  if (version === SCHEMA_VERSION) return;
  throw new Error(
    version < SCHEMA_VERSION
      ? `${label} schema is version ${version}, but this code needs version ${SCHEMA_VERSION}. Run \`bun run migrate\` (or start the app) to upgrade it.`
      : `${label} schema is version ${version}, but this code only knows up to version ${SCHEMA_VERSION}. Run the newer code.`,
  );
}

// How long a statement waits for another process's write lock before failing with SQLITE_BUSY.
const BUSY_TIMEOUT_MS = 5000;
const WAL_RETRY_MS = 50;

// Opens a connection configured the way every user of the database needs it, without looking at the
// schema. "create" makes the file if it is missing.
export function connectDatabase(path: string, access: "create" | "readwrite" | "readonly"): Database {
  if (access !== "create" && !existsSync(path)) throw new Error(`Database file not found: ${path}`);
  const db = new Database(path, access === "create" ? { create: true } : access === "readwrite" ? { readwrite: true } : { readonly: true });
  try {
    // PRAGMA takes no parameters; the value is a constant.
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (access !== "readonly") enableWal(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

// Switching the journal mode needs the database to itself. Depending on what the other process holds,
// the attempt either fails at once or waits out the busy timeout first, so retries are bounded by
// the clock, not counted. That only matters while several processes open a database that is not yet
// in WAL mode.
function enableWal(db: Database) {
  const journalMode = (sql: string) => db.query<{ journal_mode: string }, []>(sql).get()?.journal_mode;
  if (journalMode("PRAGMA journal_mode") === "wal") return;
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      // Answers with the mode now in force. A database that cannot use WAL (in-memory) keeps its own
      // without an error, and asking again would not change that.
      journalMode("PRAGMA journal_mode = WAL");
      return;
    } catch (error) {
      const busy = error instanceof Error && "code" in error && error.code === "SQLITE_BUSY";
      if (!busy || Date.now() >= deadline) throw error;
      Bun.sleepSync(WAL_RETRY_MS);
    }
  }
}

// "migrate" creates the file if needed and upgrades it: for the app, and for tests building a database.
// "readwrite" and "readonly" are for tools working beside the app: they need an existing database
// that is already at this code's version, and never change its schema.
export type OpenMode = "migrate" | "readwrite" | "readonly";

export function openDatabase(path: string, mode: OpenMode): Database {
  if (mode === "readwrite") {
    // Look before opening for writing: that switches the file to WAL, and a refused database must be left as it was.
    const probe = connectDatabase(path, "readonly");
    try { assertSchemaCurrent(probe, path); } finally { probe.close(); }
  }
  const db = connectDatabase(path, mode === "migrate" ? "create" : mode);
  try {
    if (mode === "migrate") migrate(db);
    else assertSchemaCurrent(db, path);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
