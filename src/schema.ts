import { Database } from "bun:sqlite";
import { existsSync, writeFileSync } from "node:fs";

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => void;
}

const hasColumn = (db: Database, table: string, column: string) =>
  !!db.query<{ name: string }, [string, string]>("SELECT name FROM pragma_table_info(?) WHERE name = ?").get(table, column);

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

function runEach(db: Database, statements: readonly string[]) {
  for (const sql of statements) db.run(sql);
}

function statusHistory(db: Database) {
  runEach(db, [
    `CREATE TABLE status_changes (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      from_status TEXT NOT NULL,
      to_status TEXT NOT NULL,
      note TEXT,          -- the note written with the change; NULL when the change left the note alone
      approved_by TEXT,   -- who gave gate 1, on a move to 'approved'
      at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX status_changes_job ON status_changes(job_id, id)",
    `CREATE TRIGGER jobs_status_changed AFTER UPDATE OF status ON jobs
    WHEN OLD.status IS NOT NEW.status
    BEGIN
      INSERT INTO status_changes (job_id, from_status, to_status, note, approved_by)
      VALUES (
        NEW.id, OLD.status, NEW.status,
        CASE WHEN NEW.note IS NOT OLD.note THEN NEW.note END,
        CASE WHEN NEW.status = 'approved' THEN NEW.approved_by END
      );
    END`,
    `CREATE TRIGGER jobs_status_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM status_changes WHERE job_id = OLD.id;
    END`,
  ]);
}

function fillState(db: Database) {
  runEach(db, [
    `CREATE TABLE fill_state (
      job_id INTEGER PRIMARY KEY,
      submitting INTEGER NOT NULL DEFAULT 0 CHECK (submitting IN (0, 1)),
      verifying INTEGER NOT NULL DEFAULT 0 CHECK (verifying IN (0, 1)),
      recovering INTEGER NOT NULL DEFAULT 0 CHECK (recovering IN (0, 1)),
      slot INTEGER CHECK (slot >= 0),   -- the browser that last held this job's draft
      manual_gate TEXT,                 -- the open gate under which a person reserved that browser
      CHECK (verifying = 0 OR submitting = 1)
    )`,
    `INSERT INTO fill_state (job_id, submitting, verifying, recovering, slot, manual_gate)
    SELECT
      j.id,
      COALESCE((SELECT value = '1' FROM kv WHERE key = 'fill.submitting.' || j.id), 0),
      COALESCE((SELECT value = '1' FROM kv WHERE key = 'fill.verify.' || j.id), 0),
      COALESCE((SELECT value = '1' FROM kv WHERE key = 'fill.recovery.' || j.id), 0),
      (SELECT CAST(value AS INTEGER) FROM kv WHERE key = 'fill.slot.' || j.id),
      (SELECT value FROM kv WHERE key = 'fill.manual.' || j.id)
    FROM jobs j
    WHERE EXISTS (
      SELECT 1 FROM kv
      WHERE key IN ('fill.submitting.' || j.id, 'fill.verify.' || j.id, 'fill.recovery.' || j.id, 'fill.slot.' || j.id, 'fill.manual.' || j.id)
    )`,
    `DELETE FROM kv
    WHERE key GLOB 'fill.submitting.*' OR key GLOB 'fill.verify.*' OR key GLOB 'fill.recovery.*' OR key GLOB 'fill.slot.*' OR key GLOB 'fill.manual.*'`,
    `CREATE TRIGGER jobs_fill_state_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM fill_state WHERE job_id = OLD.id;
    END`,
  ]);
}

function queuedQuestions(db: Database) {
  runEach(db, [
    `CREATE TABLE queued_questions (
      job_id INTEGER NOT NULL,
      match_key TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT NOT NULL,
      options TEXT NOT NULL,
      queued_at TEXT NOT NULL,
      PRIMARY KEY (job_id, match_key)
    )`,
    `CREATE TRIGGER jobs_queued_questions_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM queued_questions WHERE job_id = OLD.id;
    END`,
  ]);
}

function applicationSteps(db: Database) {
  runEach(db, [
    `CREATE TABLE application_steps (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('questionnaire', 'assessment', 'schedule', 'interview', 'info_request', 'other')),
      title TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'todo' CHECK (state IN ('todo', 'done', 'scheduled', 'closed', 'expired', 'cancelled')),
      due_at TEXT,          -- the employer's deadline: YYYY-MM-DD, or an ISO time
      scheduled_at TEXT,    -- ISO time of the booked call or interview
      link TEXT,            -- the assessment or booking link from the mail, for the user; agents never open it
      detail TEXT,
      source TEXT NOT NULL CHECK (source IN ('mail', 'user')),
      message_id TEXT,      -- the Gmail message it came from, so a message read twice adds nothing
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT,
      done_note TEXT,       -- the user's own note on doing it
      closed_at TEXT,
      CHECK (state != 'scheduled' OR scheduled_at IS NOT NULL)
    )`,
    "CREATE INDEX application_steps_job ON application_steps(job_id, id)",
    "CREATE UNIQUE INDEX application_steps_message ON application_steps(job_id, message_id, kind) WHERE message_id IS NOT NULL",
    `INSERT INTO application_steps (job_id, kind, title, source, created_at, updated_at)
    SELECT id, 'other', COALESCE(NULLIF(trim(note), ''), 'Next step from the employer'), 'mail', updated_at, updated_at
    FROM jobs WHERE status = 'interview'`,
    `CREATE TRIGGER jobs_steps_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM application_steps WHERE job_id = OLD.id;
    END`,
  ]);
}

function blockers(db: Database) {
  runEach(db, [
    `CREATE TABLE blockers (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      cause TEXT NOT NULL CHECK (cause IN ('site_down', 'login', 'captcha', 'email_code', 'no_form', 'needs_you', 'browser', 'no_response', 'unknown', 'other')),
      detail TEXT NOT NULL, -- the worker's own account of what it saw
      at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX blockers_job ON blockers(job_id, id)",
    `CREATE TRIGGER jobs_blockers_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM blockers WHERE job_id = OLD.id;
    END`,
  ]);
}

function answerBank(db: Database) {
  runEach(db, [
    `CREATE TABLE banked_answers (
      id INTEGER PRIMARY KEY,
      job_id INTEGER,       -- the application it was asked on
      employer TEXT NOT NULL,
      title TEXT NOT NULL,
      question TEXT NOT NULL,
      context TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT NOT NULL,
      answered_at TEXT NOT NULL,
      filed_at TEXT         -- when the agent took it into answers.md; NULL while it waits
    )`,
    `INSERT INTO banked_answers (job_id, employer, title, question, context, options, answer, answered_at)
    SELECT g.job_id, s.employer, COALESCE(j.title, ''), s.question, s.context, s.options, s.answer, s.answered_at
    FROM standing_answers s
    LEFT JOIN question_gates g ON g.id = s.source_gate_id
    LEFT JOIN jobs j ON j.id = g.job_id
    ORDER BY s.answered_at`,
    "DROP TABLE standing_answers",
    `CREATE TABLE question_gates_new (
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
      state TEXT NOT NULL CHECK(state IN ('open','answered','closed')),
      answer TEXT,
      scope TEXT CHECK(scope IN ('application','bank')),
      shot INTEGER,
      created_at TEXT NOT NULL,
      answered_at TEXT
    )`,
    `INSERT INTO question_gates_new (id, job_id, kind, group_key, match_key, employer, text, context, options, legacy, state, answer, scope, shot, created_at, answered_at)
    SELECT id, job_id, kind, group_key, match_key, employer, text, context, options, legacy, state, answer,
      CASE scope WHEN 'standing' THEN 'bank' ELSE scope END, shot, created_at, answered_at
    FROM question_gates`,
    "DROP TABLE question_gates",
    "ALTER TABLE question_gates_new RENAME TO question_gates",
    "CREATE UNIQUE INDEX question_gates_open_job ON question_gates(job_id) WHERE state = 'open'",
    "CREATE INDEX question_gates_group ON question_gates(group_key, state)",
    "CREATE INDEX question_gates_job ON question_gates(job_id, created_at)",
  ]);
}

// Referral outreach (see referrals.ts): the people the owner contacts about an application, where each
// conversation stands, the owner's LinkedIn connections read from a data export they downloaded, the
// companies and people the daily list suggested on which day, and each file read. Nothing here is ever
// sent anywhere: the owner sends every message by hand.
function referrals(db: Database) {
  // Made already, under the fork's numbering (renumberForkReferrals).
  if (hasTable(db, "referral_contacts")) return;
  runEach(db, [
    `CREATE TABLE referral_contacts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',   -- their position, as the owner pasted it
      company TEXT NOT NULL,
      company_key TEXT NOT NULL,
      profile_url TEXT,
      email TEXT,                       -- a work address the owner found; drafts then include an email
      relation TEXT NOT NULL CHECK (relation IN ('manager', 'alumni', 'engineer', 'recruiter', 'connection')),
      stage TEXT NOT NULL DEFAULT 'drafted' CHECK (stage IN ('drafted', 'requested', 'connected', 'messaged', 'followed_up', 'replied', 'referred', 'declined', 'no_response', 'closed')),
      job_id INTEGER,                   -- the application it is about; NULL for interest in the employer
      job_title TEXT,                   -- without a job: the role as an older tracker named it
      job_url TEXT,
      area TEXT,                        -- which facts of referral.yml to draft from; NULL picks by the job's title
      with_note INTEGER NOT NULL DEFAULT 0 CHECK (with_note IN (0, 1)),   -- the invite used one of the month's notes
      notes TEXT NOT NULL DEFAULT '',
      added_on TEXT NOT NULL,           -- days, YYYY-MM-DD, in the owner's time zone
      requested_on TEXT,
      connected_on TEXT,
      messaged_on TEXT,
      followed_up_on TEXT,
      replied_on TEXT,
      referred_on TEXT,
      closed_on TEXT,
      legacy_id TEXT UNIQUE,            -- its id in InternScouter's outreach.json, when imported from there
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX referral_contacts_company ON referral_contacts(company_key)",
    `CREATE TABLE referral_connections (
      key TEXT PRIMARY KEY,             -- the LinkedIn profile id, or 'name:<name>' when the export has no URL
      name TEXT NOT NULL,
      url TEXT,
      company TEXT NOT NULL DEFAULT '',
      company_key TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL DEFAULT '',
      connected_on TEXT
    )`,
    "CREATE INDEX referral_connections_company ON referral_connections(company_key)",
    // A company ('<company key>') or a person ('bridge:<key>') the daily list named, and the day it last did.
    "CREATE TABLE referral_suggestions (key TEXT PRIMARY KEY, day TEXT NOT NULL)",
    `CREATE TABLE referral_imports (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('export', 'internscouter')),
      file TEXT NOT NULL,
      fingerprint TEXT NOT NULL,        -- sha256 of the bytes read
      exported_on TEXT,                 -- the day the export was made, when known
      connections INTEGER NOT NULL DEFAULT 0,
      updates INTEGER NOT NULL DEFAULT 0,   -- contacts moved on, or brought in
      at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    // The same outreach.json is brought in once.
    "CREATE UNIQUE INDEX referral_imports_once ON referral_imports(fingerprint) WHERE kind = 'internscouter'",
    `CREATE TRIGGER jobs_referrals_forgotten AFTER DELETE ON jobs
    BEGIN
      UPDATE referral_contacts SET job_id = NULL WHERE job_id = OLD.id;
    END`,
  ]);
}

function gateReasons(db: Database) {
  runEach(db, [
    "ALTER TABLE queued_questions ADD COLUMN why TEXT",
    "ALTER TABLE queued_questions ADD COLUMN missing TEXT",
    "ALTER TABLE question_gates ADD COLUMN why TEXT",
    "ALTER TABLE question_gates ADD COLUMN missing TEXT",
  ]);
}

function stateMachines(db: Database) {
  runEach(db, [
    "DROP TRIGGER jobs_fill_state_forgotten",
    `CREATE TABLE fill_state_new (
      job_id INTEGER PRIMARY KEY,
      phase TEXT NOT NULL DEFAULT 'idle' CHECK (phase IN ('idle', 'draft_recovery', 'submitting', 'ambiguous', 'verify_queued', 'verifying')),
      slot INTEGER CHECK (slot >= 0),
      manual_gate TEXT
    )`,
    `INSERT INTO fill_state_new (job_id, phase, slot, manual_gate)
    SELECT job_id,
      CASE
        WHEN submitting = 1 AND verifying = 1 AND recovering = 1 THEN 'verify_queued'
        WHEN submitting = 1 THEN 'ambiguous'
        WHEN recovering = 1 THEN 'draft_recovery'
        ELSE 'idle'
      END,
      slot, manual_gate
    FROM fill_state`,
    "DROP TABLE fill_state",
    "ALTER TABLE fill_state_new RENAME TO fill_state",
    `CREATE TRIGGER jobs_fill_state_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM fill_state WHERE job_id = OLD.id;
    END`,
    "ALTER TABLE jobs ADD COLUMN hold_reason TEXT CHECK (hold_reason IN ('triage', 'target', 'review', 'user'))",
    "ALTER TABLE jobs ADD COLUMN feedback TEXT",
    "ALTER TABLE jobs ADD COLUMN hand_picked INTEGER NOT NULL DEFAULT 0 CHECK (hand_picked IN (0, 1))",
    "ALTER TABLE jobs ADD COLUMN locate_tries INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE jobs ADD COLUMN deferred_at TEXT",
    `UPDATE jobs SET hold_reason = CASE
        WHEN note LIKE 'held back %' THEN 'triage'
        WHEN note LIKE 'not a practice job:%' THEN 'target'
        WHEN note LIKE 'needs your review:%' THEN 'review'
        ELSE 'user'
      END
    WHERE status = 'held'`,
    `UPDATE jobs SET
      hand_picked = 1,
      feedback = CASE WHEN status IN ('found', 'locating', 'triaged', 'prepping')
        THEN (SELECT value FROM kv WHERE key GLOB 'feedback.*' AND CAST(substr(key, 10) AS INTEGER) = jobs.id LIMIT 1)
        ELSE feedback END
    WHERE id IN (SELECT CAST(substr(key, 10) AS INTEGER) FROM kv WHERE key GLOB 'feedback.*')`,
    `UPDATE jobs SET locate_tries = (SELECT CAST(value AS INTEGER) FROM kv WHERE key GLOB 'locate.tries.*' AND CAST(substr(key, 14) AS INTEGER) = jobs.id LIMIT 1)
    WHERE id IN (SELECT CAST(substr(key, 14) AS INTEGER) FROM kv WHERE key GLOB 'locate.tries.*')`,
    `UPDATE jobs SET deferred_at = (SELECT value FROM kv WHERE key GLOB 'auto.deferred.*' AND CAST(substr(key, 15) AS INTEGER) = jobs.id LIMIT 1)
    WHERE id IN (SELECT CAST(substr(key, 15) AS INTEGER) FROM kv WHERE key GLOB 'auto.deferred.*')`,
    "DELETE FROM kv WHERE key GLOB 'feedback.*' OR key GLOB 'locate.tries.*' OR key GLOB 'auto.deferred.*'",
    "ALTER TABLE blockers ADD COLUMN gate_id TEXT",
    `UPDATE blockers SET gate_id = (
      SELECT g.id FROM question_gates g
      WHERE g.job_id = blockers.job_id
        AND abs(julianday(g.created_at) - julianday(blockers.at)) * 86400 <= 60
      ORDER BY abs(julianday(g.created_at) - julianday(blockers.at))
      LIMIT 1
    )`,
    `CREATE TABLE question_digest_deliveries_new (
      id TEXT PRIMARY KEY,
      recipient TEXT NOT NULL,
      fingerprints TEXT NOT NULL,
      group_count INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('sending', 'uncertain', 'failed', 'sent', 'abandoned')),
      attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      attempt_at TEXT NOT NULL,
      sent_at TEXT,
      gmail_id TEXT,
      error TEXT
    )`,
    `INSERT INTO question_digest_deliveries_new (id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at, sent_at, gmail_id, error)
    SELECT id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at, sent_at, gmail_id, error
    FROM question_digest_deliveries`,
    "DROP TABLE question_digest_deliveries",
    "ALTER TABLE question_digest_deliveries_new RENAME TO question_digest_deliveries",
    "CREATE UNIQUE INDEX question_digest_one_pending ON question_digest_deliveries ((1)) WHERE state NOT IN ('sent', 'abandoned')",
    `CREATE TRIGGER jobs_status_valid_insert BEFORE INSERT ON jobs
    WHEN NEW.status NOT IN ('found','locating','triaged','prepping','awaiting_approval','approved','filling','needs_input','awaiting_submit','needs_manual','submitted','interview','offer','rejected_by_company','withdrawn','held','skipped','rejected','failed')
    BEGIN
      SELECT RAISE(ABORT, 'invalid job status');
    END`,
    `CREATE TRIGGER jobs_status_valid_update BEFORE UPDATE OF status ON jobs
    WHEN NEW.status NOT IN ('found','locating','triaged','prepping','awaiting_approval','approved','filling','needs_input','awaiting_submit','needs_manual','submitted','interview','offer','rejected_by_company','withdrawn','held','skipped','rejected','failed')
    BEGIN
      SELECT RAISE(ABORT, 'invalid job status');
    END`,
  ]);
}

function interviewBriefs(db: Database) {
  runEach(db, [
    "ALTER TABLE application_steps ADD COLUMN brief TEXT",
    "ALTER TABLE application_steps ADD COLUMN brief_at TEXT",
    "ALTER TABLE application_steps ADD COLUMN brief_tries INTEGER NOT NULL DEFAULT 0",
  ]);
}

function siteBlocks(db: Database) {
  runEach(db, [
    `CREATE TABLE blockers_new (
      id INTEGER PRIMARY KEY,
      job_id INTEGER NOT NULL,
      cause TEXT NOT NULL CHECK (cause IN ('site_down', 'blocked', 'login', 'captcha', 'email_code', 'no_form', 'needs_you', 'browser', 'no_response', 'unknown', 'other')),
      detail TEXT NOT NULL,
      at TEXT NOT NULL DEFAULT (datetime('now')),
      gate_id TEXT
    )`,
    "INSERT INTO blockers_new (id, job_id, cause, detail, at, gate_id) SELECT id, job_id, cause, detail, at, gate_id FROM blockers",
    "DROP TRIGGER jobs_blockers_forgotten",
    "DROP TABLE blockers",
    "ALTER TABLE blockers_new RENAME TO blockers",
    "CREATE INDEX blockers_job ON blockers(job_id, id)",
    `CREATE TRIGGER jobs_blockers_forgotten AFTER DELETE ON jobs
    BEGIN
      DELETE FROM blockers WHERE job_id = OLD.id;
    END`,
  ]);
}

// Early outreach (see leads.ts): companies found through a fresh hiring post, a new listing or a seed round,
// and the people the owner may email there, each with a draft. Nothing here is ever sent: the owner sends
// every email by hand and marks it.
function earlyOutreach(db: Database) {
  runEach(db, [
    `CREATE TABLE outreach_leads (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL CHECK (kind IN ('post', 'listing', 'seed')),
      company TEXT NOT NULL,
      company_key TEXT NOT NULL,
      domain TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL UNIQUE,
      source_title TEXT NOT NULL DEFAULT '',
      posted_at TEXT NOT NULL,          -- ISO time the post, listing or round appeared
      likes INTEGER,                    -- NULL: not shown where it was found
      what_they_do TEXT NOT NULL DEFAULT '',
      why_fit TEXT NOT NULL DEFAULT '',
      score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'active', 'done', 'dropped')),
      found_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    "CREATE INDEX outreach_leads_company ON outreach_leads(company_key)",
    `CREATE TABLE outreach_people (
      id INTEGER PRIMARY KEY,
      lead_id INTEGER NOT NULL REFERENCES outreach_leads(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      profile_url TEXT,
      email TEXT NOT NULL,              -- lowercased
      email_source TEXT NOT NULL CHECK (email_source IN ('public', 'hunter', 'guess')),
      email_confidence TEXT NOT NULL CHECK (email_confidence IN ('high', 'medium', 'low')),
      promoted INTEGER NOT NULL DEFAULT 0 CHECK (promoted IN (0, 1)),   -- the owner checked a low-confidence address
      subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      followup_body TEXT,
      stage TEXT NOT NULL DEFAULT 'drafted' CHECK (stage IN ('drafted', 'sent', 'followed_up', 'replied', 'no_response', 'closed')),
      drafted_on TEXT NOT NULL,         -- days, YYYY-MM-DD, in the owner's time zone
      sent_on TEXT,
      followed_up_on TEXT,
      replied_on TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (lead_id, email)
    )`,
    "CREATE INDEX outreach_people_lead ON outreach_people(lead_id)",
  ]);
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "baseline", up: baseline },
  { version: 2, name: "status history", up: statusHistory },
  { version: 3, name: "fill state", up: fillState },
  { version: 4, name: "queued questions", up: queuedQuestions },
  { version: 5, name: "application steps", up: applicationSteps },
  { version: 6, name: "blockers", up: blockers },
  { version: 7, name: "answer bank", up: answerBank },
  { version: 8, name: "gate reasons", up: gateReasons },
  { version: 9, name: "state machines", up: stateMachines },
  { version: 10, name: "interview briefs", up: interviewBriefs },
  { version: 11, name: "site blocks", up: siteBlocks },
  { version: 12, name: "referrals", up: referrals },
  { version: 13, name: "early outreach", up: earlyOutreach },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export const schemaVersion = (db: Database) => db.query<{ user_version: number }, []>("PRAGMA user_version").get()?.user_version ?? 0;

const hasTable = (db: Database, name: string) => db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== null;

// Databases from Chris's fork (Cd1314520) ran "referrals" as migration 8, so its gate reasons, state
// machines and interview briefs were 9 to 11. Here referrals is 12, after site blocks (11). A database at 8
// to 11 that already has the referral tables is this numbering's version one lower, plus referrals: step it
// back, so the migrations it lacks (site blocks) run, and referrals finds its tables in place. Below 12 a
// database numbered here never has those tables, so nothing else is touched.
function renumberForkReferrals(db: Database) {
  const version = schemaVersion(db);
  if (version >= 8 && version <= 11 && hasTable(db, "referral_contacts")) db.run(`PRAGMA user_version = ${version - 1}`);
}

export function migrate(db: Database, migrations: readonly Migration[] = MIGRATIONS): Migration[] {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) throw new Error(`Migration "${migration.name}" must be version ${index + 1}, not ${migration.version}`);
  });
  if (migrations === MIGRATIONS) renumberForkReferrals(db);
  const latest = migrations.length;
  const tooNew = (version: number) =>
    new Error(`Database schema is version ${version}, but this code only knows up to version ${latest}. Run the newer code, or restore a backup.`);
  const applied: Migration[] = [];
  let backedUp = false;
  for (;;) {
    const current = schemaVersion(db);
    if (current > latest) throw tooNew(current);
    if (current === latest) return applied;
    const step = db
      .transaction(() => {
        const version = schemaVersion(db);
        if (version > latest) throw tooNew(version);
        const next = migrations[version];
        if (!next) return null;
        if (!backedUp) backUpBeforeUpgrade(db, version);
        backedUp = true;
        try {
          next.up(db);
        } catch (error) {
          throw new Error(`Migration ${next.version} (${next.name}) failed and was rolled back: ${error instanceof Error ? error.message : String(error)}`, {
            cause: error,
          });
        }
        db.run(`PRAGMA user_version = ${next.version}`);
        return next;
      })
      .immediate();
    if (step) applied.push(step);
  }
}

export const backupPath = (path: string, version: number) => `${path}.v${version}.bak`;

function backUpBeforeUpgrade(db: Database, version: number) {
  const path = db.filename;
  if (!path || path === ":memory:") return;
  if (!db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get()) return;
  try {
    writeFileSync(backupPath(path, version), db.serialize(), { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
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

const BUSY_TIMEOUT_MS = 5000;
const WAL_RETRY_MS = 50;

export function connectDatabase(path: string, access: "create" | "readwrite" | "readonly"): Database {
  if (access !== "create" && !existsSync(path)) throw new Error(`Database file not found: ${path}`);
  const db = new Database(path, access === "create" ? { create: true } : access === "readwrite" ? { readwrite: true } : { readonly: true });
  try {
    db.run(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    if (access !== "readonly") enableWal(db);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}

function enableWal(db: Database) {
  const journalMode = (sql: string) => db.query<{ journal_mode: string }, []>(sql).get()?.journal_mode;
  if (journalMode("PRAGMA journal_mode") === "wal") return;
  const deadline = Date.now() + BUSY_TIMEOUT_MS;
  for (;;) {
    try {
      journalMode("PRAGMA journal_mode = WAL");
      return;
    } catch (error) {
      const busy = error instanceof Error && "code" in error && error.code === "SQLITE_BUSY";
      if (!busy || Date.now() >= deadline) throw error;
      Bun.sleepSync(WAL_RETRY_MS);
    }
  }
}

export type OpenMode = "migrate" | "readwrite" | "readonly";

export function openDatabase(path: string, mode: OpenMode): Database {
  if (mode === "readwrite") {
    const probe = connectDatabase(path, "readonly");
    try {
      assertSchemaCurrent(probe, path);
    } finally {
      probe.close();
    }
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
