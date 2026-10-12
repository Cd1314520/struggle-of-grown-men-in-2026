// Databases as older code left them, from before the schema carried a version. Frozen history:
// these are inputs to the migration tests and must not follow later schema changes.
import { Database } from "bun:sqlite";

// The first version of the app: four tables, and none of the columns jobs gained later.
export const FIRST_VERSION_SCHEMA = `
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
`;

// A real intermediate stage (the shape of a backup taken before company keys existed): some of the
// later jobs columns, job_sources, and nothing of gates or the digest.
export const BEFORE_COMPANY_KEYS_SCHEMA = `${FIRST_VERSION_SCHEMA}
ALTER TABLE jobs ADD COLUMN resume_sha TEXT;
ALTER TABLE jobs ADD COLUMN resume_frozen_at TEXT;
ALTER TABLE jobs ADD COLUMN checklist TEXT;
ALTER TABLE jobs ADD COLUMN dedupe_key TEXT;
CREATE TABLE IF NOT EXISTS job_sources (
  url TEXT PRIMARY KEY,
  job_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  location TEXT,
  seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS job_sources_job ON job_sources(job_id);
CREATE INDEX IF NOT EXISTS jobs_dedupe ON jobs(dedupe_key);
`;

export function createLegacyDatabase(path: string, schema: string = FIRST_VERSION_SCHEMA): Database {
  const db = new Database(path, { create: true });
  db.run(schema);
  return db;
}
