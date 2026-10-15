import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { SCHEMA_VERSION, connectDatabase, openDatabase, schemaVersion } from "../src/schema";
import { BEFORE_COMPANY_KEYS_SCHEMA, createLegacyDatabase } from "./fixtures/legacy-db";

// db.ts opens the app database when it is imported, so each scenario imports it in a fresh process
// with throwaway state. Never mock shared modules or change the test runner's environment.
const prelude = `
import assert from "node:assert/strict";
import * as store from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import { MIGRATIONS, SCHEMA_VERSION, schemaVersion } from ${JSON.stringify(join(import.meta.dir, "../src/schema.ts"))};
const { db } = store;
const changes = [];
store.onChange(change => changes.push(change));
function job(id, fields = {}) {
  const row = { url: "https://ats.example/jobs/" + id, source: "test", company: "Acme", title: "Engineer " + id, status: "found", ...fields };
  const names = Object.keys(row);
  db.query("INSERT INTO jobs (id, " + names.join(", ") + ") VALUES (?" + ", ?".repeat(names.length) + ")").run(id, ...names.map(name => row[name]));
}
const ids = rows => rows.map(row => row.id);
`;

function run(body: string, dir: string) {
  const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
    cwd: join(import.meta.dir, ".."),
    env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: child.exitCode, output: `${child.stdout.toString()}\n${child.stderr.toString()}` };
}
function scenario(body: string, options: { before?: (dir: string) => void; restart?: string } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-db-"));
  try {
    options.before?.(dir);
    for (const step of options.restart === undefined ? [body] : [body, options.restart]) {
      const result = run(step, dir);
      if (result.code !== 0) throw new Error(`Database scenario failed (${result.code}):\n${result.output}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("app database startup", () => {
  it("is never the live database during a test run", async () => {
    const { DATA, ROOT } = await import("../src/config");
    expect(resolve(DATA)).not.toBe(resolve(ROOT, "data"));
    expect(resolve(DATA).startsWith(resolve(tmpdir()))).toBe(true);
    // The proxy tests load db.ts in this process; it must have opened the throwaway one.
    const { db } = await import("../src/db");
    expect(resolve(db.filename)).toBe(resolve(DATA, "app.db"));
  });

  it("creates a new database at the current schema version without logging anything", () => {
    scenario(
      `
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    assert.equal(db.query("PRAGMA journal_mode").get().journal_mode, "wal");
    assert.deepEqual(store.recentEvents(), []);
  `,
      {
        restart: `
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    assert.deepEqual(store.recentEvents(), []);
  `,
      },
    );
  });

  it("upgrades an existing database in place, records it once, and keeps its rows", () => {
    scenario(
      `
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    // One event for each migration the old database needed, newest first.
    assert.deepEqual(store.recentEvents().map(e => [e.kind, e.message, e.job_id]),
      MIGRATIONS.map(m => ["system", "Database schema upgraded to version " + m.version + " (" + m.name + ")", null]).reverse());
    assert.equal(store.recentEvents().at(-1).message, "Database schema upgraded to version 1 (baseline)");
    const kept = store.getJob(4);
    assert.equal(kept.title, "Engineer");
    assert.equal(kept.status, "submitted");
    assert.equal(kept.dedupe_key, "acme|engineer");
    assert.equal(kept.company_key, null);
    assert.equal(kept.fill_checkpoint, null);
    assert.equal(store.kvGet("last.scan"), "then");
    // Columns the old database lacked are usable straight away.
    store.updateJob(4, { company_key: "acme", fill_checkpoint: "{}", practice_assessment: "{}" });
    assert.deepEqual(ids(store.jobsWithCheckpoint()), [4]);
  `,
      {
        before: dir => {
          const legacy = createLegacyDatabase(join(dir, "app.db"), BEFORE_COMPANY_KEYS_SCHEMA);
          legacy.run(
            "INSERT INTO jobs (id, url, source, company, title, status, dedupe_key) VALUES (4, 'https://ats.example/jobs/4', 'lever', 'Acme', 'Engineer', 'submitted', 'acme|engineer')",
          );
          legacy.run("INSERT INTO kv (key, value) VALUES ('last.scan', 'then')");
          legacy.close();
        },
        restart: `
    assert.equal(schemaVersion(db), SCHEMA_VERSION);
    assert.equal(store.recentEvents().filter(e => e.message.startsWith("Database schema upgraded")).length, MIGRATIONS.length);
    assert.equal(store.getJob(4).company_key, "acme");
  `,
      },
    );
  });

  it("refuses to start on a database newer than the code and leaves it untouched", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-apply-db-"));
    try {
      const path = join(dir, "app.db");
      const newer = openDatabase(path, "migrate");
      newer.run("INSERT INTO kv (key, value) VALUES ('k', 'v')");
      newer.run(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
      newer.close();

      const result = run("", dir);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain(`Database schema is version ${SCHEMA_VERSION + 1}, but this code only knows up to version ${SCHEMA_VERSION}`);
      const after = connectDatabase(path, "readonly");
      try {
        expect(schemaVersion(after)).toBe(SCHEMA_VERSION + 1);
        expect(after.query("SELECT key, value FROM kv").all()).toEqual([{ key: "k", value: "v" }]);
        expect(after.query<{ n: number }, []>("SELECT count(*) AS n FROM events").get()?.n).toBe(0);
      } finally {
        after.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("job queries", () => {
  it("selects jobs by status set, checkpoint and outcome", () => {
    scenario(`
    job(1, { status: "approved" }); job(2, { status: "filling", fill_checkpoint: "{}" }); job(3, { status: "skipped" });
    job(4, { status: "approved", fill_checkpoint: "{}" }); job(5, { status: "needs_manual" });
    job(6, { status: "submitted", submitted_at: "2026-10-02T00:00:00Z" }); job(7, { status: "interview", submitted_at: "2026-10-03T00:00:00Z" });
    job(8, { status: "submitted", submitted_at: "2026-10-01T00:00:00Z" });

    assert.deepEqual(ids(store.jobsInStatuses(["approved"])), [1, 4]);
    assert.deepEqual(ids(store.jobsInStatuses(["needs_manual", "approved", "filling"])), [1, 2, 4, 5]);
    assert.deepEqual(store.jobsInStatuses([]), []);
    assert.deepEqual(store.jobsInStatuses(["offer"]), []);
    // A status is data, never SQL.
    assert.deepEqual(store.jobsInStatuses(["approved') OR ('1'='1"]), []);
    assert.deepEqual(Object.keys(store.jobsInStatuses(["approved"])[0]).sort(), Object.keys(store.getJob(1)).sort());

    assert.deepEqual(ids(store.jobsByStatus("approved")), [1, 4]);
    assert.deepEqual(ids(store.jobsByStatus("approved", 1)), [1]);
    assert.deepEqual(ids(store.jobsWithCheckpoint()).sort(), [2, 4]);
    assert.deepEqual(ids(store.applicationsAwaitingOutcome()), [7, 6, 8]);
    assert.deepEqual(ids(store.applicationsAwaitingOutcome(2)), [7, 6]);
  `);
  });

  it("lists the board, counts and siblings the UI shows", () => {
    scenario(`
    job(1, { status: "found", company_key: "acme" }); job(2, { status: "skipped", company_key: "acme" });
    job(3, { status: "triaged", company_key: "acme", description: "long text", updated_at: "2026-10-01 00:00:00" });
    job(4, { status: "approved", company_key: "acme", updated_at: "2026-10-03 00:00:00" });
    job(5, { status: "held", company_key: "other", updated_at: "2026-10-02 00:00:00" });
    job(6, { status: "approved", company_key: null, updated_at: "2026-09-01 00:00:00" });

    const board = store.boardJobs();
    assert.deepEqual(ids(board), [4, 5, 3, 6]);
    assert.deepEqual(Object.keys(board[0]).sort(), ["company", "found_at", "id", "location", "note", "pending", "posted_at", "score", "source", "status", "submitted_at", "title", "updated_at", "url"]);
    // The limit trims the backlog only: approved jobs are all listed, however old.
    assert.deepEqual(ids(store.boardJobs(1)), [4, 5, 6]);
    assert.deepEqual(store.statusCounts(), { approved: 2, found: 1, held: 1, skipped: 1, triaged: 1 });

    assert.deepEqual(store.siblingJobs(store.getJob(3)), [{ id: 4, title: "Engineer 4", status: "approved" }]);
    assert.deepEqual(ids(store.siblingJobs(store.getJob(4))), [3]);
    // A job without a company key has no siblings, not every other keyless job.
    job(7, { status: "approved", company_key: null });
    assert.deepEqual(store.siblingJobs(store.getJob(6)), []);
  `);
  });

  it("reads events newest first, with and without worker chatter", () => {
    scenario(`
    job(1);
    store.logEvent("user", "approve", 1);
    store.logEvent("step", "clicked next", 1, "fill");
    store.logEvent("system", "started");
    store.logEvent("gate", "question: salary?", 1, "fill");
    store.logEvent("error", "x".repeat(5000), 2, "prep");

    assert.deepEqual(store.recentEvents().map(e => e.kind), ["error", "gate", "system", "step", "user"]);
    assert.deepEqual(store.recentEvents(2).map(e => e.kind), ["error", "gate"]);
    assert.deepEqual(Object.keys(store.recentEvents()[0]).sort(), ["at", "id", "job_id", "kind", "message", "worker"]);
    assert.equal(store.recentEvents()[0].message.length, 4000);

    const highlights = store.highlightEvents();
    assert.deepEqual(highlights.map(e => e.kind), ["error", "gate", "system", "user"]);
    assert.deepEqual(highlights.map(e => [e.company, e.title]), [[null, null], ["Acme", "Engineer 1"], [null, null], ["Acme", "Engineer 1"]]);
    assert.deepEqual(store.highlightEvents(1).map(e => e.kind), ["error"]);

    assert.deepEqual(store.jobEvents(1), store.recentEvents().filter(e => e.job_id === 1).map(({ worker, kind, message, at }) => ({ worker, kind, message, at })));
    assert.deepEqual(store.jobEvents(1, 1).map(e => e.kind), ["gate"]);
    assert.deepEqual(store.jobEvents(99), []);
    assert.deepEqual(changes, [{ type: "event", jobId: 1 }, { type: "event", jobId: 1 }, { type: "event" }, { type: "event", jobId: 1 }, { type: "event", jobId: 2 }]);
  `);
  });

  it("stores, replaces, lists and deletes kv entries", () => {
    scenario(`
    assert.equal(store.kvGet("a.1"), null);
    store.kvSet("a.1", "one"); store.kvSet("a.2", "two"); store.kvSet("ab", "other"); store.kvSet("a.1", "uno");
    assert.equal(store.kvGet("a.1"), "uno");
    assert.deepEqual(store.kvEntries("a."), [{ key: "a.1", value: "uno" }, { key: "a.2", value: "two" }]);
    // A prefix is matched literally: LIKE wildcards in it mean nothing.
    assert.deepEqual(store.kvEntries("a%"), []);
    store.kvDelete("a.1");
    assert.equal(store.kvGet("a.1"), null);
    assert.deepEqual(store.kvEntries("a."), [{ key: "a.2", value: "two" }]);
  `);
  });
});

describe("job writes", () => {
  it("writeJob stamps updated_at and stays silent; updateJob also notifies", () => {
    scenario(`
    job(1, { updated_at: "2020-01-01 00:00:00", note: "old", pending: "{}" });

    store.writeJob(1, { status: "approved", note: null, pending: undefined, score: 70 });
    let row = store.getJob(1);
    assert.deepEqual([row.status, row.note, row.pending, row.score], ["approved", null, null, 70]);
    assert.notEqual(row.updated_at, "2020-01-01 00:00:00");
    assert.match(row.updated_at, /^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d$/);
    assert.deepEqual(changes, []);

    db.run("UPDATE jobs SET updated_at = '2020-01-01 00:00:00' WHERE id = 1");
    store.writeJob(1, {});
    store.updateJob(1, {});
    assert.equal(store.getJob(1).updated_at, "2020-01-01 00:00:00");
    assert.deepEqual(changes, []);

    store.updateJob(1, { status: "filling" });
    assert.equal(store.getJob(1).status, "filling");
    assert.notEqual(store.getJob(1).updated_at, "2020-01-01 00:00:00");
    assert.deepEqual(changes, [{ type: "job", jobId: 1 }]);
  `);
  });

  it("only ever writes known columns", () => {
    scenario(`
    job(1, { note: "kept" }); job(2, { note: "kept" });
    for (const fields of [{ id: 5 }, { updated_at: "x" }, { nope: 1 }, { "note = 'pwned' --": "x" }, { status: "approved", "note = 'pwned' WHERE 1 = 1 --": "x" }, { toString: "x" }]) {
      assert.throws(() => store.writeJob(1, fields), /Not a writable jobs column/);
      assert.throws(() => store.updateJob(1, fields), /Not a writable jobs column/);
    }
    assert.deepEqual(db.query("SELECT id, status, note FROM jobs ORDER BY id").all(), [{ id: 1, status: "found", note: "kept" }, { id: 2, status: "found", note: "kept" }]);
    assert.deepEqual(changes, []);

    // Every column of the table except the two the writer owns is writable, and nothing else is.
    const columns = db.query("SELECT name FROM pragma_table_info('jobs')").all().map(c => c.name).filter(name => name !== "id" && name !== "updated_at");
    for (const column of columns) store.writeJob(2, { [column]: column === "score" ? 1 : column === "status" ? "held" : column + "-value" });
    const written = store.getJob(2);
    for (const column of columns) assert.equal(written[column], column === "score" ? 1 : column === "status" ? "held" : column + "-value", column);
  `);
  });

  it("requeues interrupted prep and releases held jobs in bulk", () => {
    scenario(`
    job(1, { status: "prepping", updated_at: "2020-01-01 00:00:00" }); job(2, { status: "prepping" }); job(3, { status: "triaged" });
    job(4, { status: "held", note: "set aside", updated_at: "2020-01-01 00:00:00" }); job(5, { status: "held" }); job(6, { status: "skipped", note: "no" });

    assert.equal(store.requeueInterruptedPrep(), 2);
    assert.equal(store.requeueInterruptedPrep(), 0);
    assert.deepEqual(ids(store.jobsByStatus("triaged")), [1, 2, 3]);
    assert.equal(store.getJob(1).updated_at, "2020-01-01 00:00:00");

    assert.equal(store.releaseHeldJobs(), 2);
    assert.equal(store.releaseHeldJobs(), 0);
    assert.deepEqual(ids(store.jobsByStatus("found")), [4, 5]);
    assert.equal(store.getJob(4).note, null);
    assert.notEqual(store.getJob(4).updated_at, "2020-01-01 00:00:00");
    assert.deepEqual([store.getJob(6).status, store.getJob(6).note], ["skipped", "no"]);
    assert.deepEqual(changes, []);
  `);
  });
});

describe("event retention", () => {
  it("removes only old step-by-step records", () => {
    scenario(`
    const add = (kind, age) => db.query("INSERT INTO events (job_id, worker, kind, message, at) VALUES (1, 'fill', ?, ?, datetime('now', ?))").run(kind, kind + " " + age, age);
    for (const kind of ["step", "tool", "agent", "gate", "auto", "user", "error", "mail", "system"]) { add(kind, "-40 days"); add(kind, "-2 days"); }

    assert.equal(store.pruneChatter(0), 0, "0 keeps everything");
    assert.equal(store.pruneChatter(-5), 0);
    assert.equal(store.pruneChatter(NaN), 0);
    assert.equal(db.query("SELECT count(*) AS n FROM events").get().n, 18);

    assert.equal(store.pruneChatter(30), 3);
    assert.deepEqual(db.query("SELECT message FROM events WHERE at < datetime('now', '-30 days') ORDER BY message").all().map(r => r.message),
      ["auto -40 days", "error -40 days", "gate -40 days", "mail -40 days", "system -40 days", "user -40 days"]);
    assert.equal(db.query("SELECT count(*) AS n FROM events WHERE at > datetime('now', '-30 days')").get().n, 9);
    assert.equal(store.pruneChatter(30), 0);
  `);
  });
});

describe("status history", () => {
  it("records every change of status with what was written alongside it, and nothing else", () => {
    scenario(`
    job(1, { note: "seen" }); job(2);
    assert.deepEqual(store.statusHistory(1), [], "history starts with the first change");

    store.updateJob(1, { status: "triaged", note: null });
    store.updateJob(1, { status: "prepping" });                       // leaves the note alone
    store.updateJob(1, { status: "awaiting_approval", note: "needs your review: score 55" });
    store.updateJob(1, { score: 55, note: "edited" });                // not a status change
    store.updateJob(1, { status: "awaiting_approval", note: "same status again" });
    store.writeJob(1, { status: "approved", approved_by: "auto", note: null });
    store.writeJob(1, { status: "filling", pending: null });
    store.writeJob(1, { status: "submitted", note: "confirmation page seen", submitted_at: "2026-10-01T00:00:00.000Z" });

    const history = store.statusHistory(1);
    assert.deepEqual(history.map(({ at, ...change }) => change), [
      { from_status: "found", to_status: "triaged", note: null, approved_by: null },
      { from_status: "triaged", to_status: "prepping", note: null, approved_by: null },
      { from_status: "prepping", to_status: "awaiting_approval", note: "needs your review: score 55", approved_by: null },
      { from_status: "awaiting_approval", to_status: "approved", note: null, approved_by: "auto" },
      { from_status: "approved", to_status: "filling", note: null, approved_by: null },
      { from_status: "filling", to_status: "submitted", note: "confirmation page seen", approved_by: null },
    ]);
    for (const change of history) assert.match(change.at, /^\\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d:\\d\\d$/);
    assert.deepEqual(store.statusHistory(2), []);
  `);
  });

  it("sees moves made in bulk or straight in SQL, and rolls back with them", () => {
    scenario(`
    job(1, { status: "prepping" }); job(2, { status: "held", note: "set aside" }); job(3, { status: "found" });
    store.requeueInterruptedPrep();
    store.releaseHeldJobs();
    db.run("UPDATE jobs SET status = 'skipped' WHERE id = 3");
    assert.deepEqual(store.statusHistory(1).map(c => [c.from_status, c.to_status]), [["prepping", "triaged"]]);
    assert.deepEqual(store.statusHistory(2).map(c => [c.from_status, c.to_status, c.note]), [["held", "found", null]]);
    assert.deepEqual(store.statusHistory(3).map(c => [c.from_status, c.to_status]), [["found", "skipped"]]);

    assert.throws(() => db.transaction(() => {
      store.writeJob(3, { status: "triaged" });
      throw new Error("undo");
    })(), /undo/);
    assert.equal(store.getJob(3).status, "skipped");
    assert.equal(store.statusHistory(3).length, 1);
  `);
  });

  it("goes with a job that is folded into its duplicate", () => {
    scenario(`
    const board = store.insertJob({ url: "https://www.linkedin.com/jobs/view/1", source: "linkedin", company: "Acme", title: "Data Engineer", location: null, description: null });
    const own = store.insertJob({ url: "https://boards.greenhouse.io/acme/jobs/7", source: "greenhouse", company: "Acme", title: "Platform Analyst", location: null, description: null });
    store.updateJob(board, { status: "locating" });
    store.updateJob(own, { status: "triaged" });
    assert.equal(store.relocateJob(store.getJob(board), "https://boards.greenhouse.io/acme/jobs/7", null), "merged");
    assert.equal(store.getJob(board), null);
    assert.equal(db.query("SELECT count(*) AS n FROM status_changes WHERE job_id = ?").get(board).n, 0);
    assert.equal(store.statusHistory(own).length, 1);
  `);
  });
});

describe("postings, duplicates and sources", () => {
  it("inserts a posting once and folds repeats and twins into it", () => {
    scenario(`
    const posting = { url: "https://boards.example/acme/1?utm_source=x#apply", source: "greenhouse", company: "Acme, Inc.", title: "Senior Software Engineer", location: "Austin", description: null };
    const id = store.insertJob(posting);
    assert.equal(typeof id, "number");
    let row = store.getJob(id);
    assert.deepEqual([row.url, row.status, row.company_key, row.dedupe_key, row.posted_at], ["https://boards.example/acme/1", "found", "acme", "acme|engineer senior software", null]);
    assert.deepEqual(changes, [{ type: "job", jobId: id }]);
    assert.equal(store.knownUrl("https://boards.example/acme/1?utm_campaign=y"), true);
    assert.equal(store.knownUrl("https://boards.example/acme/2"), false);

    // The same URL again adds nothing, but supplies a posting date that was missing.
    assert.equal(store.insertJob({ ...posting, posted: "2026-10-01" }), null);
    assert.equal(store.getJob(id).posted_at, "2026-10-01");
    assert.equal(store.insertJob({ ...posting, posted: "2026-10-05" }), null);
    assert.equal(store.getJob(id).posted_at, "2026-10-01");

    // The same role listed elsewhere becomes a source, widens the location and fills the description.
    assert.equal(store.insertJob({ url: "https://other.example/acme/sse", source: "lever", company: "Acme Inc", title: "Sr. Software Engineer (Remote)", location: "Remote", description: "Build things" }), null);
    row = store.getJob(id);
    assert.deepEqual([row.url, row.location, row.description], ["https://boards.example/acme/1", "Austin | Remote", "Build things"]);
    assert.deepEqual(store.jobSources(id), [{ url: "https://other.example/acme/sse", source: "lever", location: "Remote" }]);
    assert.equal(store.knownUrl("https://other.example/acme/sse"), true);
    assert.equal(db.query("SELECT count(*) AS n FROM jobs").get().n, 1);

    // A different level is a different job.
    const junior = store.insertJob({ url: "https://boards.example/acme/3", source: "greenhouse", company: "Acme", title: "Junior Software Engineer", location: null, description: null }, "triaged");
    assert.equal(typeof junior, "number");
    assert.equal(store.getJob(junior).status, "triaged");
  `);
  });

  it("moves a job first seen on an aggregator to the employer's own listing", () => {
    scenario(`
    const id = store.insertJob({ url: "https://www.linkedin.com/jobs/view/1", source: "linkedin", company: "Acme", title: "Data Engineer", location: "Houston", description: null });
    assert.equal(store.insertJob({ url: "https://boards.example/acme/de", source: "greenhouse", company: "Acme", title: "Data Engineer", location: "Houston", description: null }), null);
    const row = store.getJob(id);
    assert.deepEqual([row.url, row.source], ["https://boards.example/acme/de", "greenhouse"]);
    assert.deepEqual(store.jobSources(id), [{ url: "https://www.linkedin.com/jobs/view/1", source: "linkedin", location: "Houston" }]);
  `);
  });

  it("applies through the US listing of a role that is also listed abroad", () => {
    scenario(`
    const role = { source: "lever", company: "Acme", title: "Data Engineer", description: null };
    const id = store.insertJob({ ...role, url: "https://jobs.example/acme/london", location: "London, United Kingdom" }, "held");
    assert.equal(store.insertJob({ ...role, url: "https://jobs.example/acme/nyc", location: "New York, NY" }), null);
    let row = store.getJob(id);
    assert.deepEqual([row.url, row.location, row.status], ["https://jobs.example/acme/nyc", "New York, NY | London, United Kingdom", "found"]);
    assert.equal(store.appliedLocation(row), "New York, NY");
    assert.deepEqual(store.jobSources(id), [{ url: "https://jobs.example/acme/london", source: "lever", location: "London, United Kingdom" }]);
    // Another office abroad, or a second US one, changes nothing about where it applies.
    assert.equal(store.insertJob({ ...role, url: "https://jobs.example/acme/dublin", location: "Dublin, Ireland" }), null);
    assert.equal(store.insertJob({ ...role, url: "https://jobs.example/acme/dc", location: "Washington, D.C." }), null);
    row = store.getJob(id);
    assert.equal(row.url, "https://jobs.example/acme/nyc");
    assert.equal(store.appliedLocation(row), "New York, NY");
  `);
  });

  it("moves existing jobs off a listing abroad at start, except ones that cannot move", () => {
    scenario(`
    const { preferUsListings } = await import(${JSON.stringify(join(import.meta.dir, "../src/listings.ts"))});
    const abroad = (id, fields) => { job(id, { url: "https://jobs.example/" + id + "/london", location: "London, United Kingdom | New York, NY", ...fields });
      db.query("INSERT INTO job_sources (job_id, url, source, location) VALUES (?, ?, 'test', 'New York, NY')").run(id, "https://jobs.example/" + id + "/nyc"); };
    abroad(1, { status: "held", resume_sha: "sha", resume_frozen_at: "2026-10-10T00:00:00Z", score: 70 });
    abroad(2, { status: "submitted", submitted_at: "2026-10-10T00:00:00Z" });
    abroad(3, { status: "needs_input" });
    job(4, { status: "awaiting_approval", location: "London, United Kingdom" });
    job(5, { status: "awaiting_approval", location: "Remote" });
    db.query("INSERT INTO job_sources (job_id, url, source, location) VALUES (5, 'https://jobs.example/5/austin', 'test', 'Austin, TX')").run();
    assert.equal(preferUsListings(), 1);
    const moved = store.getJob(1);
    assert.deepEqual([moved.url, moved.status, moved.resume_sha, store.appliedLocation(moved)], ["https://jobs.example/1/nyc", "found", null, "New York, NY"]);
    for (const id of [2, 3, 4, 5]) assert.equal(store.getJob(id).url, id < 4 ? "https://jobs.example/" + id + "/london" : "https://ats.example/jobs/" + id);
    assert.equal(preferUsListings(), 0);
  `);
  });

  it("relocates a job to an unknown employer posting", () => {
    scenario(`
    job(1, { url: "https://www.linkedin.com/jobs/view/1", source: "linkedin", status: "locating", location: "Houston", note: "looking", description: "old" });
    assert.equal(store.relocateJob(store.getJob(1), "https://boards.example/acme/1?utm_source=li", ""), "moved");
    const row = store.getJob(1);
    assert.deepEqual([row.url, row.status, row.note, row.description], ["https://boards.example/acme/1", "triaged", null, "old"]);
    assert.deepEqual(store.jobSources(1), [{ url: "https://www.linkedin.com/jobs/view/1", source: "linkedin", location: "Houston" }]);
    assert.deepEqual(changes, [{ type: "job", jobId: 1 }]);
  `);
  });

  it("merges a relocated job into the job that already has that posting", () => {
    scenario(`
    job(1, { url: "https://boards.example/acme/1", source: "greenhouse", status: "triaged" });
    job(2, { url: "https://www.linkedin.com/jobs/view/2", source: "linkedin", status: "locating", location: "Houston" });
    db.query("INSERT INTO job_sources (job_id, url, source, location) VALUES (2, 'https://www.indeed.com/viewjob?jk=2', 'indeed', NULL)").run();
    db.query("INSERT INTO job_sources (job_id, url, source, location) VALUES (1, 'https://boards.example/acme/alias', 'greenhouse', NULL)").run();
    store.logEvent("step", "locating", 2, "locate"); store.logEvent("step", "kept", 1, "prep");
    store.kvSet("feedback.2", "x"); store.kvSet("locate.tries.2", "3"); store.kvSet("auto.deferred.2", "1"); store.kvSet("feedback.1", "keep");
    changes.length = 0;

    // Found through one of the other job's extra listings, not its main URL.
    assert.equal(store.relocateJob(store.getJob(2), "https://boards.example/acme/alias", "text"), "merged");

    assert.equal(store.getJob(2), null);
    assert.deepEqual(store.jobSources(1).map(s => s.url).sort(), ["https://boards.example/acme/alias", "https://www.indeed.com/viewjob?jk=2", "https://www.linkedin.com/jobs/view/2"]);
    assert.deepEqual(store.jobSources(2), []);
    assert.deepEqual(store.jobEvents(2), []);
    assert.deepEqual(store.jobEvents(1).map(e => e.message), ["kept"]);
    assert.deepEqual(["feedback.2", "locate.tries.2", "auto.deferred.2", "feedback.1"].map(store.kvGet), [null, null, null, "keep"]);
    assert.deepEqual(changes, [{ type: "job", jobId: 1 }]);
  `);
  });

  it("re-keys and folds duplicates saved under older rules, once per rules version", () => {
    scenario(`
    job(1, { company: "Acme, Inc.", title: "Software Engineer", status: "skipped" });
    job(2, { company: "Acme Inc", title: "Software Engineer (Remote)", status: "triaged", location: "Remote" });
    job(3, { company: "Acme", title: "Software Engineer", status: "submitted" });
    job(4, { company: "Other Co", title: "Software Engineer" });
    job(6, { company: "Beta LLC", title: "Analyst", status: "skipped", location: "Austin" });
    job(7, { company: "Beta", title: "Analyst", status: "triaged", location: "Houston" });
    store.logEvent("step", "old", 1);
    store.kvSet("feedback.1", "x");

    store.dedupeExisting();

    // A job something has acted on is never folded away; untouched duplicates fold into it.
    // Among untouched duplicates the most advanced survives.
    assert.deepEqual(ids(db.query("SELECT id FROM jobs ORDER BY id").all()), [3, 4, 7]);
    assert.deepEqual(db.query("SELECT id, company_key, dedupe_key FROM jobs ORDER BY id").all(), [
      { id: 3, company_key: "acme", dedupe_key: "acme|engineer software" },
      { id: 4, company_key: "other", dedupe_key: "other|engineer software" },
      { id: 7, company_key: "beta", dedupe_key: "beta|analyst" },
    ]);
    assert.deepEqual(store.jobSources(3).map(s => s.url).sort(), ["https://ats.example/jobs/1", "https://ats.example/jobs/2"]);
    assert.deepEqual(store.jobSources(7), [{ url: "https://ats.example/jobs/6", source: "test", location: "Austin" }]);
    assert.equal(store.getJob(7).location, "Houston | Austin");
    assert.equal(store.getJob(3).location, null);
    assert.deepEqual(store.jobEvents(1), []);
    assert.equal(store.kvGet("feedback.1"), null);
    assert.equal(store.kvGet("dedupe.version"), "2");
    assert.equal(store.recentEvents()[0].message, "Folded 3 duplicate postings into existing jobs");

    // With the rules version recorded, only rows that have no key yet are keyed.
    db.run("UPDATE jobs SET company_key = 'stale', dedupe_key = 'stale' WHERE id = 3");
    job(5, { company: "New Co", title: "Analyst" });
    store.dedupeExisting();
    assert.deepEqual([store.getJob(3).company_key, store.getJob(5).company_key, store.getJob(5).dedupe_key], ["stale", "new", "new|analyst"]);

    // A new rules version re-keys everything.
    store.kvSet("dedupe.version", "1");
    store.dedupeExisting();
    assert.equal(store.getJob(3).company_key, "acme");
  `);
  });
});

describe("where SQL lives", () => {
  const root = join(import.meta.dir, "..");
  const files = [...new Bun.Glob("{src,scripts}/**/*.ts").scanSync(root)].sort();
  const read = (file: string) => Bun.file(join(root, file)).text();
  // The modules that own tables. Everything else calls their functions.
  const owners = new Set(["src/db.ts", "src/schema.ts", "src/accounts.ts", "src/questions.ts", "src/fill-state.ts", "src/digest.ts"]);
  // Standalone tools that read a database by path rather than through the app's connection.
  const tools = new Set(["scripts/journal-stalls.ts", "scripts/journal-resumes.ts", "scripts/reassess-backlog.ts", "scripts/migrate.ts"]);
  it("keeps statements in the modules that own the tables", async () => {
    expect(files.length).toBeGreaterThan(20);
    const strays: string[] = [];
    for (const file of files) {
      if (owners.has(file) || tools.has(file)) continue;
      const text = await read(file);
      if (/\bdb\s*\.(?:query|prepare|run|exec)\b/.test(text) || text.includes('from "bun:sqlite"')) strays.push(file);
    }
    expect(strays).toEqual([]);
  });

  it("opens databases only through schema.ts", async () => {
    const openers: string[] = [];
    for (const file of files) if ((await read(file)).includes("new Database(")) openers.push(file);
    // migrate.ts reads the version of a database before deciding whether to upgrade it.
    expect(openers).toEqual(["scripts/migrate.ts", "src/schema.ts"]);
  });

  it("never splices a value into a SQL template", async () => {
    // Looks at every template literal that starts like SQL, wherever it is used, so a statement built
    // in a variable first is seen too. It cannot see SQL assembled with + or held in plain strings.
    // The only text ever spliced in: a checked column list, a migration's own column definition, and
    // two PRAGMA values, none of which SQLite can take as parameters.
    const allowed = new Set(["src/db.ts ${sets}", "src/schema.ts ${definition}", "src/schema.ts ${next.version}", "src/schema.ts ${BUSY_TIMEOUT_MS}"]);
    const sqlStart = /^\s*(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|PRAGMA|WITH|VACUUM)\b/;
    const holes = (text: string) =>
      [...text.matchAll(/`([^`]*)`/g)].flatMap(match => (sqlStart.test(match[1] ?? "") ? (match[1]?.match(/\$\{[^}]*\}/g) ?? []) : []));
    const spliced: string[] = [];
    for (const file of files) for (const hole of holes(await read(file))) if (!allowed.has(`${file} ${hole}`)) spliced.push(`${file} ${hole}`);
    expect(spliced).toEqual([]);
    // The check sees the kind of statement it exists to stop, including one built in a variable.
    expect(holes('const sql = `\n  SELECT id FROM jobs WHERE id IN (${ids.join(",")})`;\ndb.query(sql)')).toEqual(['${ids.join(",")}']);
    expect(holes('db.query(`SELECT * FROM jobs ${stale ? "" : "WHERE x"}`)')).toHaveLength(1);
    expect(holes("throw new Error(`Job ${id} does not exist`)")).toEqual([]);
  });

  it("refuses the live data directory from a test process that has not been pointed elsewhere", async () => {
    const { refuseLiveDataUnderTest } = await import("../src/db");
    expect(() => {
      refuseLiveDataUnderTest({ NODE_ENV: "test" });
    }).toThrow("Refusing to open the live database from a test run");
    expect(() => {
      refuseLiveDataUnderTest({ NODE_ENV: "test", AUTO_APPLY_DATA: "" });
    }).toThrow("Refusing to open the live database");
    refuseLiveDataUnderTest({ NODE_ENV: "test", AUTO_APPLY_DATA: "/tmp/somewhere" });
    refuseLiveDataUnderTest({ NODE_ENV: "production" });
    refuseLiveDataUnderTest({});
    expect(process.env.NODE_ENV).toBe("test");
  });
});
