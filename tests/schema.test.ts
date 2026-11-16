import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runMigrate } from "../scripts/migrate";
import {
  MIGRATIONS,
  SCHEMA_VERSION,
  assertSchemaCurrent,
  backupPath,
  connectDatabase,
  migrate,
  openDatabase,
  schemaVersion,
  type Migration,
} from "../src/schema";
import { STATUSES } from "../src/status";
import { BEFORE_COMPANY_KEYS_SCHEMA, FIRST_VERSION_SCHEMA, createLegacyDatabase } from "./fixtures/legacy-db";

const TABLES = [
  "accounts",
  "application_answers",
  "application_steps",
  "banked_answers",
  "blockers",
  "events",
  "fill_state",
  "job_sources",
  "jobs",
  "kv",
  "question_digest_deliveries",
  "question_digest_notified",
  "question_gates",
  "queued_questions",
  "referral_connections",
  "referral_contacts",
  "referral_imports",
  "referral_suggestions",
  "status_changes",
  "submit_approvals",
];

const dirs: string[] = [];
const open: Database[] = [];
function tempPath() {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-schema-"));
  dirs.push(dir);
  return join(dir, "app.db");
}
function track<T extends Database>(db: T): T {
  open.push(db);
  return db;
}
const memory = () => track(new Database(":memory:"));
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tableNames = (db: Database) =>
  db
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map(r => r.name);

const flat = (sql: string | null | undefined) => sql?.replace(/\s+/g, " ").trim() ?? null;

function shape(db: Database) {
  const tables = Object.fromEntries(
    tableNames(db).map(name => [
      name,
      {
        columns: db
          .query<{ name: string; type: string; notnull: number; dflt_value: string | null; pk: number }, [string]>(
            'SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?) ORDER BY name',
          )
          .all(name),
        sql:
          name === "jobs" ? null : flat(db.query<{ sql: string }, [string]>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)?.sql),
      },
    ]),
  );
  const indexes = db
    .query<{ name: string; tbl_name: string; sql: string | null }, []>("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name")
    .all()
    .map(index => ({ ...index, sql: flat(index.sql) }));
  return { tables, indexes };
}

function freshShape() {
  const db = memory();
  migrate(db);
  return shape(db);
}

describe("schema migrations", () => {
  it("numbers migrations 1..N with distinct names", () => {
    expect(MIGRATIONS.map(m => m.version)).toEqual(MIGRATIONS.map((_, i) => i + 1));
    expect(new Set(MIGRATIONS.map(m => m.name)).size).toBe(MIGRATIONS.length);
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("builds every table on an empty database and records the version", () => {
    const db = memory();
    expect(schemaVersion(db)).toBe(0);
    expect(migrate(db).map(m => m.version)).toEqual(MIGRATIONS.map(m => m.version));
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(tableNames(db)).toEqual(TABLES);
  });

  it("produces exactly the recorded schema", () => {
    const db = memory();
    migrate(db);
    const definitions = db
      .query<{ sql: string }, []>("SELECT sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type DESC, name")
      .all()
      .map(row =>
        row.sql
          .split("\n")
          .map(line => line.trim())
          .join("\n"),
      );
    expect(`version ${schemaVersion(db)}\n\n${definitions.join(";\n\n")};\n`).toMatchSnapshot();
  });

  it("upgrades a database from Chris's fork, where referrals was migration 8", () => {
    // The fork's version 11: everything up to interview briefs (10 here), plus the referral tables.
    const fork = memory();
    migrate(fork, MIGRATIONS.slice(0, 10));
    MIGRATIONS[11]?.up(fork);
    fork.run("INSERT INTO referral_imports (kind, file, fingerprint) VALUES ('internscouter', 'outreach.json', 'kept')");
    fork.run("PRAGMA user_version = 11");
    expect(migrate(fork).map(m => m.name)).toEqual(["site blocks", "referrals"]);
    expect(schemaVersion(fork)).toBe(SCHEMA_VERSION);
    const fresh = memory();
    migrate(fresh);
    expect(shape(fork)).toEqual(shape(fresh));
    expect(fork.query("SELECT fingerprint FROM referral_imports").all()).toEqual([{ fingerprint: "kept" }]);
  });

  it("does nothing the second time", () => {
    const db = memory();
    migrate(db);
    const before = shape(db);
    expect(migrate(db)).toEqual([]);
    expect(shape(db)).toEqual(before);
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("keeps the constraints the app relies on", () => {
    const db = memory();
    migrate(db);
    db.run("INSERT INTO jobs (id, url, source, company, title) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer')");
    expect(db.query<{ status: string }, []>("SELECT status FROM jobs WHERE id = 1").get()?.status).toBe("found");
    expect(() => db.run("INSERT INTO jobs (url, source, company, title) VALUES ('https://a.example/1', 'test', 'Acme', 'Engineer')")).toThrow(/UNIQUE/);
    const gate = (id: string, state: string, kind = "question") =>
      db
        .query(
          "INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, created_at) VALUES (?, 1, ?, 'g', 'm', 'Acme', 't', 'c', '[]', ?, 'now')",
        )
        .run(id, kind, state);
    gate("a", "open");
    expect(() => gate("b", "open")).toThrow(/UNIQUE/);
    gate("c", "closed");
    expect(() => gate("d", "parked")).toThrow(/CHECK/);
    expect(() => gate("e", "closed", "survey")).toThrow(/CHECK/);
    const delivery = (id: string, state: string) =>
      db
        .query(
          "INSERT INTO question_digest_deliveries (id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at) VALUES (?, 'me@example.com', '[]', 1, 's', 'b', ?, 'now', 'now')",
        )
        .run(id, state);
    delivery("one", "sending");
    expect(() => delivery("two", "failed")).toThrow(/UNIQUE/);
    delivery("three", "sent");
  });

  describe("adopting a database from before versions were tracked", () => {
    const legacy: [string, string][] = [
      ["the first version of the app", FIRST_VERSION_SCHEMA],
      ["a partly grown database", BEFORE_COMPANY_KEYS_SCHEMA],
    ];
    for (const [label, schema] of legacy) {
      it(`brings ${label} to the same shape as a new database and keeps its rows`, () => {
        const db = memory();
        db.run(schema);
        db.run(`
          INSERT INTO jobs (id, url, source, company, title, status, score, note) VALUES (7, 'https://a.example/7', 'lever', 'Acme', 'Engineer', 'submitted', 81, 'sent');
          INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 7, 'fill', 'step', 'clicked');
          INSERT INTO kv (key, value) VALUES ('last.scan', '2026-10-01T00:00:00.000Z');
          INSERT INTO accounts (domain, email, password) VALUES ('a.example', 'me@example.com', 'secret');
        `);
        expect(schemaVersion(db)).toBe(0);

        migrate(db);

        expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
        expect(shape(db)).toEqual(freshShape());
        expect(db.query("SELECT id, url, status, score, note, fill_checkpoint, company_key FROM jobs").all()).toEqual([
          { id: 7, url: "https://a.example/7", status: "submitted", score: 81, note: "sent", fill_checkpoint: null, company_key: null },
        ]);
        expect(db.query("SELECT id, job_id, worker, kind, message FROM events").all()).toEqual([
          { id: 3, job_id: 7, worker: "fill", kind: "step", message: "clicked" },
        ]);
        expect(db.query("SELECT key, value FROM kv").all()).toEqual([{ key: "last.scan", value: "2026-10-01T00:00:00.000Z" }]);
        expect(db.query("SELECT domain, email, password FROM accounts").all()).toEqual([{ domain: "a.example", email: "me@example.com", password: "secret" }]);
      });
    }

    it("leaves a database that already has everything untouched apart from the version", () => {
      const baseline = MIGRATIONS.slice(0, 1);
      const db = memory();
      migrate(db, baseline);
      db.run("INSERT INTO jobs (id, url, source, company, title, fill_checkpoint) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer', '{}')");
      db.run("PRAGMA user_version = 0");
      const before = shape(db);

      expect(migrate(db, baseline).map(m => m.name)).toEqual(["baseline"]);

      expect(shape(db)).toEqual(before);
      expect(schemaVersion(db)).toBe(1);
      expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs WHERE fill_checkpoint = '{}'").get()?.n).toBe(1);
    });
  });

  describe("fill state (version 3)", () => {
    const beforeFillState = () => {
      const db = memory();
      migrate(db, MIGRATIONS.slice(0, 2));
      db.run(`
        INSERT INTO jobs (id, url, source, company, title, status) VALUES
          (1, 'https://a.example/1', 'test', 'Acme', 'One', 'needs_manual'),
          (2, 'https://a.example/2', 'test', 'Acme', 'Two', 'needs_manual'),
          (3, 'https://a.example/3', 'test', 'Acme', 'Three', 'approved'),
          (4, 'https://a.example/4', 'test', 'Acme', 'Four', 'found'),
          (12, 'https://a.example/12', 'test', 'Acme', 'Twelve', 'submitted');
        INSERT INTO kv (key, value) VALUES
          ('fill.submitting.1', '1'), ('fill.verify.1', '0'), ('fill.recovery.1', '0'), ('fill.slot.1', '2'), ('fill.manual.1', 'gate-a'),
          ('fill.submitting.2', '1'), ('fill.verify.2', '1'), ('fill.recovery.2', '1'),
          ('fill.recovery.3', '1'), ('fill.slot.3', '0'),
          ('fill.submitting.12', '0'), ('fill.slot.12', '4'),
          ('fill.submitting.99', '1'),
          ('fill.nextAt', '1791854250442'), ('fill.rest.0', '1791854829181.0046'), ('feedback.1', 'keep me'), ('count.fill.2026-10-12', '7');
      `);
      return db;
    };

    it("moves the flags out of kv without losing or inventing one", () => {
      const db = beforeFillState();
      expect(migrate(db, MIGRATIONS.slice(0, 3)).map(m => m.name)).toEqual(["fill state"]);
      expect(db.query("SELECT * FROM fill_state ORDER BY job_id").all()).toEqual([
        { job_id: 1, submitting: 1, verifying: 0, recovering: 0, slot: 2, manual_gate: "gate-a" },
        { job_id: 2, submitting: 1, verifying: 1, recovering: 1, slot: null, manual_gate: null },
        { job_id: 3, submitting: 0, verifying: 0, recovering: 1, slot: 0, manual_gate: null },
        { job_id: 12, submitting: 0, verifying: 0, recovering: 0, slot: 4, manual_gate: null },
      ]);
      expect(db.query("SELECT key, value FROM kv ORDER BY key").all()).toEqual([
        { key: "count.fill.2026-10-12", value: "7" },
        { key: "feedback.1", value: "keep me" },
        { key: "fill.nextAt", value: "1791854250442" },
        { key: "fill.rest.0", value: "1791854829181.0046" },
      ]);
    });

    it("stops, changing nothing, on a state the app could never have meant", () => {
      const db = beforeFillState();
      db.run("UPDATE kv SET value = '0' WHERE key = 'fill.submitting.2'");
      expect(() => migrate(db, MIGRATIONS.slice(0, 3))).toThrow(/Migration 3 \(fill state\) failed and was rolled back: CHECK constraint failed/);
      expect(schemaVersion(db)).toBe(2);
      expect(tableNames(db)).not.toContain("fill_state");
      expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM kv WHERE key GLOB 'fill.*'").get()?.n).toBe(15);
    });

    it("holds the state to its rules and forgets it with the job", () => {
      const db = memory();
      migrate(db, MIGRATIONS.slice(0, 3));
      db.run("INSERT INTO jobs (id, url, source, company, title) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'One')");
      db.run("INSERT INTO fill_state (job_id, submitting, verifying) VALUES (1, 1, 1)");
      expect(() => db.run("UPDATE fill_state SET submitting = 0 WHERE job_id = 1")).toThrow(/CHECK/);
      expect(() => db.run("UPDATE fill_state SET recovering = 2 WHERE job_id = 1")).toThrow(/CHECK/);
      expect(() => db.run("UPDATE fill_state SET slot = -1 WHERE job_id = 1")).toThrow(/CHECK/);
      expect(() => db.run("INSERT INTO fill_state (job_id) VALUES (1)")).toThrow(/UNIQUE/);
      db.run("DELETE FROM jobs WHERE id = 1");
      expect(db.query("SELECT * FROM fill_state").all()).toEqual([]);
    });
  });

  describe("referrals (version 12)", () => {
    it("holds contacts to their stages and keeps a contact when its application is folded away", () => {
      const db = memory();
      migrate(db);
      db.run("INSERT INTO jobs (id, url, source, company, title) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'One')");
      db.run(
        "INSERT INTO referral_contacts (id, name, company, company_key, relation, job_id, added_on) VALUES (1, 'Ana', 'Acme', 'acme', 'engineer', 1, '2026-10-01')",
      );
      expect(() => db.run("UPDATE referral_contacts SET stage = 'ghosted' WHERE id = 1")).toThrow(/CHECK/);
      expect(() => db.run("UPDATE referral_contacts SET relation = 'friend' WHERE id = 1")).toThrow(/CHECK/);
      db.run("DELETE FROM jobs WHERE id = 1");
      expect(db.query("SELECT id, job_id FROM referral_contacts").all()).toEqual([{ id: 1, job_id: null }]);
    });
  });

  describe("answer bank (version 7)", () => {
    it("queues each standing answer to be filed, and keeps every gate with its scope", () => {
      const db = memory();
      migrate(db, MIGRATIONS.slice(0, 6));
      db.run(`
        INSERT INTO jobs (id, url, source, company, title, status) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer', 'approved');
        INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, standing_allowed, state, answer, scope, created_at, answered_at) VALUES
          ('g1', 1, 'question', 'employer:m1', 'm1', 'Acme', 'Relocate?', 'Required', '["Yes","No"]', 1, 'answered', 'No', 'standing', 'a', 'b'),
          ('g2', 1, 'question', 'job:1:m2', 'm2', 'Acme', 'Start date?', '', '[]', 0, 'answered', 'June', 'application', 'c', 'd'),
          ('g3', 1, 'manual', 'job:1:m3', 'm3', 'Acme', 'Inspect', '', '[]', 0, 'open', NULL, NULL, 'e', NULL);
        INSERT INTO standing_answers (match_key, employer, question, context, options, answer, source_gate_id, answered_at) VALUES
          ('m1', 'Acme', 'Relocate?', 'Required', '["Yes","No"]', 'No', 'g1', 'b'),
          ('m9', 'Gone Co', 'Clearance?', 'Required', '[]', 'None', 'missing', 'z');
      `);
      expect(migrate(db, MIGRATIONS.slice(0, 7)).map(m => m.name)).toEqual(["answer bank"]);
      expect(
        db.query("SELECT job_id, employer, title, question, context, options, answer, answered_at, filed_at FROM banked_answers ORDER BY id").all(),
      ).toEqual([
        {
          job_id: 1,
          employer: "Acme",
          title: "Engineer",
          question: "Relocate?",
          context: "Required",
          options: '["Yes","No"]',
          answer: "No",
          answered_at: "b",
          filed_at: null,
        },
        {
          job_id: null,
          employer: "Gone Co",
          title: "",
          question: "Clearance?",
          context: "Required",
          options: "[]",
          answer: "None",
          answered_at: "z",
          filed_at: null,
        },
      ]);
      expect(db.query("SELECT id, state, scope FROM question_gates ORDER BY id").all()).toEqual([
        { id: "g1", state: "answered", scope: "bank" },
        { id: "g2", state: "answered", scope: "application" },
        { id: "g3", state: "open", scope: null },
      ]);
      expect(() => db.run("UPDATE question_gates SET scope = 'standing' WHERE id = 'g2'")).toThrow(/CHECK/);
      expect(() =>
        db.run(
          "INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, created_at) VALUES ('g4', 1, 'question', 'x', 'y', 'Acme', 't', '', '[]', 'open', 'f')",
        ),
      ).toThrow(/UNIQUE/);
    });
  });

  describe("gate reasons (version 8)", () => {
    it("adds the reason and the missing detail to gates and queued questions, empty for the old ones", () => {
      const db = memory();
      migrate(db, MIGRATIONS.slice(0, 7));
      db.run(`
        INSERT INTO jobs (id, url, source, company, title, status) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer', 'needs_input');
        INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, created_at)
          VALUES ('g1', 1, 'question', 'job:1:m1', 'm1', 'Acme', 'Relocate?', '', '[]', 'open', 'a');
        INSERT INTO queued_questions (job_id, match_key, text, context, options, queued_at) VALUES (1, 'm1', 'Relocate?', '', '[]', 'a');
      `);
      expect(migrate(db, MIGRATIONS.slice(0, 8)).map(m => m.name)).toEqual(["gate reasons"]);
      expect(db.query("SELECT why, missing FROM question_gates").all()).toEqual([{ why: null, missing: null }]);
      expect(db.query("SELECT why, missing FROM queued_questions").all()).toEqual([{ why: null, missing: null }]);
    });
  });

  describe("state machines (version 9)", () => {
    const jobRow = (id: number, status: string, note: string | null = null) =>
      `(${id}, 'https://a.example/${id}', 'test', 'Acme', 'Job ${id}', '${status}', ${note === null ? "NULL" : `'${note}'`})`;
    const beforeStateMachines = () => {
      const db = memory();
      migrate(db, MIGRATIONS.slice(0, 8));
      return db;
    };
    const upgrade = (db: Database) => {
      expect(migrate(db, MIGRATIONS.slice(0, 9)).map(m => m.name)).toEqual(["state machines"]);
    };

    it("maps each combination of the old fill flags to a phase", () => {
      const db = beforeStateMachines();
      const combos: [number, number, number, string][] = [
        [0, 0, 0, "idle"],
        [1, 0, 0, "ambiguous"],
        [1, 1, 0, "ambiguous"],
        [1, 0, 1, "ambiguous"],
        [1, 1, 1, "verify_queued"],
        [0, 0, 1, "draft_recovery"],
      ];
      combos.forEach(([submitting, verifying, recovering], i) => {
        const id = i + 1;
        db.run(`INSERT INTO jobs (id, url, source, company, title, status) VALUES (${id}, 'https://a.example/${id}', 'test', 'Acme', 'J', 'needs_manual')`);
        db.run("INSERT INTO fill_state (job_id, submitting, verifying, recovering, slot, manual_gate) VALUES (?, ?, ?, ?, ?, ?)", [
          id,
          submitting,
          verifying,
          recovering,
          id,
          `gate-${id}`,
        ]);
      });
      upgrade(db);
      expect(db.query("SELECT job_id, phase, slot, manual_gate FROM fill_state ORDER BY job_id").all()).toEqual(
        combos.map(([, , , phase], i) => ({ job_id: i + 1, phase, slot: i + 1, manual_gate: `gate-${i + 1}` })),
      );
    });

    it("holds the fill state to its rules and forgets it with the job", () => {
      const db = memory();
      migrate(db);
      db.run("INSERT INTO jobs (id, url, source, company, title) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'One')");
      db.run("INSERT INTO fill_state (job_id) VALUES (1)");
      expect(db.query("SELECT phase FROM fill_state WHERE job_id = 1").all()).toEqual([{ phase: "idle" }]);
      expect(() => db.run("UPDATE fill_state SET phase = 'bogus' WHERE job_id = 1")).toThrow(/CHECK/);
      expect(() => db.run("UPDATE fill_state SET slot = -1 WHERE job_id = 1")).toThrow(/CHECK/);
      expect(() => db.run("INSERT INTO fill_state (job_id) VALUES (1)")).toThrow(/UNIQUE/);
      db.run("UPDATE fill_state SET phase = 'verifying' WHERE job_id = 1");
      db.run("DELETE FROM jobs WHERE id = 1");
      expect(db.query("SELECT * FROM fill_state").all()).toEqual([]);
    });

    it("derives the hold reason of held jobs from their note", () => {
      const db = beforeStateMachines();
      db.run(`INSERT INTO jobs (id, url, source, company, title, status, note) VALUES
        ${jobRow(1, "held", "held back because it looked senior")},
        ${jobRow(2, "held", "not a practice job: sells insurance")},
        ${jobRow(3, "held", "needs your review: odd posting")},
        ${jobRow(4, "held", "parked by hand")},
        ${jobRow(5, "held")},
        ${jobRow(6, "skipped", "held back because it looked senior")}`);
      upgrade(db);
      expect(db.query("SELECT id, hold_reason FROM jobs ORDER BY id").all()).toEqual([
        { id: 1, hold_reason: "triage" },
        { id: 2, hold_reason: "target" },
        { id: 3, hold_reason: "review" },
        { id: 4, hold_reason: "user" },
        { id: 5, hold_reason: "user" },
        { id: 6, hold_reason: null },
      ]);
      expect(() => db.run("UPDATE jobs SET hold_reason = 'whim' WHERE id = 1")).toThrow(/CHECK/);
    });

    it("moves feedback, locate tries and deferral out of kv into the job, and deletes the keys", () => {
      const db = beforeStateMachines();
      db.run(`INSERT INTO jobs (id, url, source, company, title, status, note) VALUES
        ${jobRow(1, "triaged")}, ${jobRow(2, "approved")}, ${jobRow(3, "found")}, ${jobRow(4, "found")}`);
      db.run(`INSERT INTO kv (key, value) VALUES
        ('feedback.1', 'prefer remote'), ('feedback.2', 'stale words'),
        ('locate.tries.3', '2'), ('auto.deferred.3', '2026-10-01T00:00:00Z'),
        ('auto.deferred.4', '2026-10-02T00:00:00Z'),
        ('feedback.99', 'for nobody'),
        ('fill.nextAt', '1'), ('count.fill.2026-10-12', '7')`);
      upgrade(db);
      expect(db.query("SELECT id, feedback, hand_picked, locate_tries, deferred_at FROM jobs ORDER BY id").all()).toEqual([
        { id: 1, feedback: "prefer remote", hand_picked: 1, locate_tries: 0, deferred_at: null },
        { id: 2, feedback: null, hand_picked: 1, locate_tries: 0, deferred_at: null },
        { id: 3, feedback: null, hand_picked: 0, locate_tries: 2, deferred_at: "2026-10-01T00:00:00Z" },
        { id: 4, feedback: null, hand_picked: 0, locate_tries: 0, deferred_at: "2026-10-02T00:00:00Z" },
      ]);
      expect(db.query("SELECT key FROM kv ORDER BY key").all()).toEqual([{ key: "count.fill.2026-10-12" }, { key: "fill.nextAt" }]);
    });

    it("links each blocker to the gate raised at the same moment, and to none when there was none", () => {
      const db = beforeStateMachines();
      db.run(
        `INSERT INTO jobs (id, url, source, company, title, status) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'One', 'needs_input'), (2, 'https://a.example/2', 'test', 'Acme', 'Two', 'needs_input')`,
      );
      db.run(`INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, created_at) VALUES
        ('far', 1, 'question', 'job:1:a', 'a', 'Acme', 't', '', '[]', 'closed', '2026-10-01 09:00:00'),
        ('near', 1, 'question', 'job:1:b', 'b', 'Acme', 't', '', '[]', 'closed', '2026-10-01 10:00:20'),
        ('other', 2, 'question', 'job:2:a', 'a', 'Acme', 't', '', '[]', 'open', '2026-10-01 10:00:00')`);
      db.run(`INSERT INTO blockers (id, job_id, cause, detail, at) VALUES
        (1, 1, 'captcha', 'x', '2026-10-01 10:00:00'),
        (2, 1, 'login', 'y', '2026-10-01 11:30:00'),
        (3, 2, 'login', 'z', '2026-10-01 10:00:30')`);
      upgrade(db);
      expect(db.query("SELECT id, gate_id FROM blockers ORDER BY id").all()).toEqual([
        { id: 1, gate_id: "near" },
        { id: 2, gate_id: null },
        { id: 3, gate_id: "other" },
      ]);
    });

    it("keeps digest deliveries as they were, counting each as one attempt, and allows abandoning", () => {
      const db = beforeStateMachines();
      const insert = (id: string, state: string) =>
        db.run(
          "INSERT INTO question_digest_deliveries (id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at, sent_at, gmail_id, error) VALUES (?, 'me@example.com', '[\"f\"]', 1, 's', 'b', ?, 'c', 'a', NULL, NULL, 'oops')",
          [id, state],
        );
      insert("old-sent", "sent");
      insert("old-failed", "failed");
      upgrade(db);
      expect(db.query("SELECT id, state, attempts, error, recipient, attempt_at FROM question_digest_deliveries ORDER BY id").all()).toEqual([
        { id: "old-failed", state: "failed", attempts: 1, error: "oops", recipient: "me@example.com", attempt_at: "a" },
        { id: "old-sent", state: "sent", attempts: 1, error: "oops", recipient: "me@example.com", attempt_at: "a" },
      ]);
      db.run("UPDATE question_digest_deliveries SET state = 'abandoned' WHERE id = 'old-failed'");
      insert("next", "sending");
      expect(() => insert("another", "uncertain")).toThrow(/UNIQUE/);
      expect(() => db.run("UPDATE question_digest_deliveries SET state = 'lost' WHERE id = 'next'")).toThrow(/CHECK/);
    });

    it("accepts exactly the statuses the app knows on insert and update", () => {
      const db = memory();
      migrate(db);
      const insert = (id: number, status: string) =>
        db.run("INSERT INTO jobs (id, url, source, company, title, status) VALUES (?, ?, 'test', 'Acme', 'T', ?)", [id, `https://a.example/${id}`, status]);
      STATUSES.forEach((status, i) => insert(i + 1, status));
      expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()?.n).toBe(STATUSES.length);
      for (const status of STATUSES) db.run("UPDATE jobs SET status = ? WHERE id = 1", [status]);
      expect(() => insert(1000, "bogus")).toThrow(/invalid job status/);
      expect(() => insert(1001, "")).toThrow(/invalid job status/);
      expect(() => db.run("UPDATE jobs SET status = 'bogus' WHERE id = 1")).toThrow(/invalid job status/);
      expect(() => db.run("UPDATE jobs SET status = NULL WHERE id = 1")).toThrow();
      expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()?.n).toBe(STATUSES.length);
    });
  });

  describe("the copy taken before an upgrade", () => {
    it("holds the database exactly as it was, and is taken once", () => {
      const path = tempPath();
      const old = track(connectDatabase(path, "create"));
      migrate(old, MIGRATIONS.slice(0, 1));
      old.run("INSERT INTO kv (key, value) VALUES ('fill.submitting.7', '1')");
      old.run("INSERT INTO jobs (id, url, source, company, title) VALUES (7, 'https://a.example/7', 'test', 'Acme', 'Seven')");

      migrate(old);

      const copy = track(connectDatabase(backupPath(path, 1), "readonly"));
      expect(schemaVersion(copy)).toBe(1);
      expect(tableNames(copy)).not.toContain("fill_state");
      expect(copy.query("SELECT key, value FROM kv").all()).toEqual([{ key: "fill.submitting.7", value: "1" }]);
      expect(old.query("SELECT phase FROM fill_state WHERE job_id = 7").all()).toEqual([{ phase: "ambiguous" }]);
      for (let version = 2; version < SCHEMA_VERSION; version++) expect(existsSync(backupPath(path, version))).toBe(false);
    });

    it("is not taken for a new database, or when there is nothing to upgrade", () => {
      const path = tempPath();
      const db = track(connectDatabase(path, "create"));
      migrate(db);
      migrate(db);
      for (let version = 0; version <= SCHEMA_VERSION; version++) expect(existsSync(backupPath(path, version))).toBe(false);
    });

    it("keeps the first copy when a failed upgrade is tried again", () => {
      const path = tempPath();
      const db = track(connectDatabase(path, "create"));
      migrate(db);
      db.run("INSERT INTO kv (key, value) VALUES ('before', 'first attempt')");
      const failing: Migration = {
        version: SCHEMA_VERSION + 1,
        name: "failing",
        up: d => {
          d.run("INSERT INTO no_such_table VALUES (1)");
        },
      };
      expect(() => migrate(db, [...MIGRATIONS, failing])).toThrow(/rolled back/);
      db.run("UPDATE kv SET value = 'changed since' WHERE key = 'before'");
      expect(() => migrate(db, [...MIGRATIONS, failing])).toThrow(/rolled back/);
      const copy = track(connectDatabase(backupPath(path, SCHEMA_VERSION), "readonly"));
      expect(copy.query("SELECT value FROM kv WHERE key = 'before'").all()).toEqual([{ value: "first attempt" }]);
    });
  });

  describe("later migrations", () => {
    const addPriority: Migration = {
      version: SCHEMA_VERSION + 1,
      name: "job priority",
      up: db => {
        db.run("ALTER TABLE jobs ADD COLUMN priority INTEGER NOT NULL DEFAULT 0");
        db.run("UPDATE jobs SET priority = 1 WHERE status = 'approved'");
      },
    };
    const broken: Migration = {
      version: SCHEMA_VERSION + 2,
      name: "broken",
      up: db => {
        db.run("CREATE TABLE half_done (x TEXT)");
        db.run("UPDATE jobs SET note = 'half done'");
        db.run("INSERT INTO no_such_table VALUES (1)");
      },
    };
    const seeded = () => {
      const db = memory();
      migrate(db);
      db.run(
        "INSERT INTO jobs (id, url, source, company, title, status, note) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer', 'approved', 'kept'), (2, 'https://a.example/2', 'test', 'Acme', 'Analyst', 'found', 'kept')",
      );
      return db;
    };

    it("applies only what is pending, in order, exactly once", () => {
      const db = seeded();
      expect(migrate(db, [...MIGRATIONS, addPriority]).map(m => m.name)).toEqual(["job priority"]);
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION + 1);
      expect(db.query("SELECT id, priority FROM jobs ORDER BY id").all()).toEqual([
        { id: 1, priority: 1 },
        { id: 2, priority: 0 },
      ]);
      expect(migrate(db, [...MIGRATIONS, addPriority])).toEqual([]);
    });

    it("rolls a failing migration back completely and keeps the ones before it", () => {
      const db = seeded();
      expect(() => migrate(db, [...MIGRATIONS, addPriority, broken])).toThrow(
        `Migration ${SCHEMA_VERSION + 2} (broken) failed and was rolled back: no such table: no_such_table`,
      );
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION + 1);
      expect(tableNames(db)).toEqual(TABLES);
      expect(db.query("SELECT id, note, priority FROM jobs ORDER BY id").all()).toEqual([
        { id: 1, note: "kept", priority: 1 },
        { id: 2, note: "kept", priority: 0 },
      ]);
      expect(db.inTransaction).toBe(false);
    });

    it("refuses a database newer than the code and leaves it alone", () => {
      const db = seeded();
      migrate(db, [...MIGRATIONS, addPriority]);
      const before = shape(db);
      expect(() => migrate(db)).toThrow(`Database schema is version ${SCHEMA_VERSION + 1}, but this code only knows up to version ${SCHEMA_VERSION}`);
      expect(shape(db)).toEqual(before);
      expect(schemaVersion(db)).toBe(SCHEMA_VERSION + 1);
    });

    it("rejects a misnumbered list before touching the database", () => {
      const db = memory();
      expect(() => migrate(db, [...MIGRATIONS, { ...addPriority, version: SCHEMA_VERSION + 2 }])).toThrow(
        `must be version ${SCHEMA_VERSION + 1}, not ${SCHEMA_VERSION + 2}`,
      );
      expect(() => migrate(db, [{ version: 0, name: "zero", up: () => undefined }])).toThrow("must be version 1, not 0");
      expect(schemaVersion(db)).toBe(0);
      expect(tableNames(db)).toEqual([]);
    });
  });
});

describe("opening a database", () => {
  it("migrate mode creates the file in WAL mode at the current version, and reopens it unchanged", () => {
    const path = tempPath();
    const db = track(openDatabase(path, "migrate"));
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(db.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBe(5000);
    db.run("INSERT INTO kv (key, value) VALUES ('k', 'v')");
    db.close();
    const again = track(openDatabase(path, "migrate"));
    expect(again.query("SELECT key, value FROM kv").all()).toEqual([{ key: "k", value: "v" }]);
  });

  it("readonly and readwrite need an existing file and never create one", () => {
    const path = tempPath();
    for (const mode of ["readonly", "readwrite"] as const) {
      expect(() => openDatabase(path, mode)).toThrow(`Database file not found: ${path}`);
      expect(existsSync(path)).toBe(false);
    }
  });

  it("readonly and readwrite refuse an older schema, say how to fix it, and change nothing", () => {
    const path = tempPath();
    createLegacyDatabase(path).close();
    for (const mode of ["readonly", "readwrite"] as const)
      expect(() => openDatabase(path, mode)).toThrow(`${path} schema is version 0, but this code needs version ${SCHEMA_VERSION}. Run \`bun run migrate\``);
    const db = track(new Database(path, { readonly: true }));
    expect(schemaVersion(db)).toBe(0);
    expect(tableNames(db)).toEqual(["accounts", "events", "jobs", "kv"]);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("delete");
  });

  it("readonly and readwrite refuse a newer schema", () => {
    const path = tempPath();
    const db = openDatabase(path, "migrate");
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();
    for (const mode of ["readonly", "readwrite"] as const) expect(() => openDatabase(path, mode)).toThrow(`only knows up to version ${SCHEMA_VERSION}`);
    expect(() => openDatabase(path, "migrate")).toThrow(`only knows up to version ${SCHEMA_VERSION}`);
  });

  it("readonly cannot write; readwrite can", () => {
    const path = tempPath();
    openDatabase(path, "migrate").close();
    const reader = track(openDatabase(path, "readonly"));
    expect(() => reader.run("INSERT INTO kv (key, value) VALUES ('k', 'v')")).toThrow(/readonly/);
    const writer = track(openDatabase(path, "readwrite"));
    writer.run("INSERT INTO kv (key, value) VALUES ('k', 'v')");
    expect(reader.query("SELECT value FROM kv WHERE key = 'k'").get()).toEqual({ value: "v" });
  });

  it("assertSchemaCurrent passes only at the exact version", () => {
    const db = memory();
    expect(() => {
      assertSchemaCurrent(db);
    }).toThrow("Database schema is version 0");
    migrate(db);
    assertSchemaCurrent(db);
  });

  it("connectDatabase configures the connection without touching the schema", () => {
    const path = tempPath();
    const db = track(connectDatabase(path, "create"));
    expect(schemaVersion(db)).toBe(0);
    expect(tableNames(db)).toEqual([]);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
  });

  it("opens a database that cannot use WAL without waiting on it", () => {
    const started = Date.now();
    const db = track(openDatabase(":memory:", "migrate"));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("memory");
    expect(schemaVersion(db)).toBe(SCHEMA_VERSION);
  });

  it("gives up switching to WAL after the busy timeout while another connection is reading", () => {
    const path = tempPath();
    const reader = track(new Database(path, { create: true }));
    reader.run("CREATE TABLE t (x); INSERT INTO t VALUES (1)");
    reader.run("BEGIN");
    reader.query("SELECT * FROM t").all();
    const started = Date.now();
    expect(() => connectDatabase(path, "readwrite")).toThrow(/locked/);
    const waited = Date.now() - started;
    expect(waited).toBeGreaterThanOrEqual(4500);
    expect(waited).toBeLessThan(12000);
    reader.run("ROLLBACK");
    const db = track(connectDatabase(path, "readwrite"));
    expect(db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
  }, 20000);

  it("lets several processes start on a new database at once", async () => {
    const path = tempPath();
    const script = `
      import { openDatabase, schemaVersion } from ${JSON.stringify(join(import.meta.dir, "../src/schema.ts"))};
      const db = openDatabase(${JSON.stringify(path)}, "migrate");
      db.run("INSERT INTO kv (key, value) VALUES (?, 'started')", [String(process.pid)]);
      console.log(schemaVersion(db));
      db.close();
    `;
    const children = Array.from({ length: 8 }, () => Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" }));
    const results = await Promise.all(
      children.map(async child => ({
        code: await child.exited,
        out: (await new Response(child.stdout).text()).trim(),
        err: await new Response(child.stderr).text(),
      })),
    );
    expect(results.map(r => r.err).join("")).toBe("");
    expect(results.map(r => r.code)).toEqual(children.map(() => 0));
    expect(results.map(r => r.out)).toEqual(children.map(() => String(SCHEMA_VERSION)));
    const db = track(openDatabase(path, "readonly"));
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM kv").get()?.n).toBe(8);
    expect(tableNames(db)).toEqual(TABLES);
  });
});

describe("migrate command", () => {
  it("reports status without changing the database", () => {
    const path = tempPath();
    createLegacyDatabase(path).close();
    const report = runMigrate({ dbPath: path, status: true, silent: true });
    expect(report).toEqual({ path, from: 0, to: 0, pending: MIGRATIONS.map(m => `${m.version} (${m.name})`), applied: false });
    const db = track(new Database(path, { readonly: true }));
    expect(schemaVersion(db)).toBe(0);
  });

  it("upgrades an old database, then reports it up to date", () => {
    const path = tempPath();
    const legacy = createLegacyDatabase(path, BEFORE_COMPANY_KEYS_SCHEMA);
    legacy.run("INSERT INTO jobs (id, url, source, company, title) VALUES (1, 'https://a.example/1', 'test', 'Acme', 'Engineer')");
    legacy.close();

    expect(runMigrate({ dbPath: path, silent: true })).toMatchObject({ from: 0, to: SCHEMA_VERSION, applied: true });
    expect(runMigrate({ dbPath: path, silent: true })).toEqual({ path, from: SCHEMA_VERSION, to: SCHEMA_VERSION, pending: [], applied: false });

    const db = track(openDatabase(path, "readonly"));
    expect(shape(db)).toEqual(freshShape());
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM jobs").get()?.n).toBe(1);
  });

  it("fails clearly on a missing file or a database newer than the code", () => {
    const path = tempPath();
    expect(() => runMigrate({ dbPath: path, silent: true })).toThrow(`Database file not found: ${path}`);
    expect(existsSync(path)).toBe(false);
    const db = openDatabase(path, "migrate");
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION + 3}`);
    db.close();
    expect(() => runMigrate({ dbPath: path, silent: true })).toThrow(`is at schema version ${SCHEMA_VERSION + 3}`);
    expect(() => runMigrate({ dbPath: path, status: true, silent: true })).toThrow(`is at schema version ${SCHEMA_VERSION + 3}`);
  });

  it("runs from the command line and exits non-zero on failure", () => {
    const path = tempPath();
    createLegacyDatabase(path).close();
    const cli = (...args: string[]) => {
      const child = Bun.spawnSync([process.execPath, join(import.meta.dir, "../scripts/migrate.ts"), ...args], { stdout: "pipe", stderr: "pipe" });
      return { code: child.exitCode, out: child.stdout.toString(), err: child.stderr.toString() };
    };
    expect(cli("--status", "--db", path)).toEqual({
      code: 0,
      out: `${path}: schema version 0 of ${SCHEMA_VERSION}; pending: ${MIGRATIONS.map(m => `${m.version} (${m.name})`).join(", ")}\n`,
      err: "",
    });
    expect(cli("--db", path)).toMatchObject({ code: 0, err: "" });
    expect(cli("--db", path)).toEqual({ code: 0, out: `${path}: schema version ${SCHEMA_VERSION} of ${SCHEMA_VERSION}; up to date\n`, err: "" });
    expect(cli("--db", `${path}.missing`)).toEqual({ code: 1, out: "", err: `Database file not found: ${path}.missing\n` });
    expect(cli("--bogus")).toMatchObject({ code: 1, out: "" });
  });
});
