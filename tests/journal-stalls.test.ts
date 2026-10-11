import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import {
  runMonitor,
  loadState,
  observeAutoApplyActivity,
  categorizeQuestion,
  sanitizeQuestionText,
  sanitizeBlockerDetail,
} from "../scripts/journal-stalls";

describe("Auto-Apply Journal & Stalls Monitor - Consumer Regression Tests", () => {
  function setupTestEnv() {
    const dir = mkdtempSync(join(tmpdir(), "journal-stalls-test-"));
    const dbPath = join(dir, "test.db");
    const journalPath = join(dir, "auto-apply-journal.md");
    const statePath = join(dir, "journal-state.json");
    const db = new Database(dbPath, { create: true });

    db.exec(`
      CREATE TABLE jobs (
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
        pending TEXT,
        note TEXT,
        found_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        submitted_at TEXT,
        resume_sha TEXT,
        resume_frozen_at TEXT,
        checklist TEXT,
        dedupe_key TEXT,
        company_key TEXT,
        posted_at TEXT,
        approved_by TEXT,
        practice_assessment TEXT
      );

      CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        job_id INTEGER,
        worker TEXT,
        kind TEXT NOT NULL,
        message TEXT NOT NULL,
        at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    return { dir, dbPath, journalPath, statePath, db };
  }

  it("1. Exits with changed=false on empty DB without creating journal or state files", async () => {
    const { dbPath, journalPath, statePath } = setupTestEnv();
    const res = await runMonitor({
      dbPath,
      journalPath,
      statePath,
      silent: true,
      help: false,
    });

    expect(res.changed).toBe(false);
    expect(loadState(statePath)).toBeNull();
  });

  it("2. Ignores discovery, triage, and prep-only activity, creating no journal churn", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(
      `INSERT INTO jobs (id, url, source, company, title, status) VALUES (1, 'https://test/1', 'linkedin', 'Acme', 'Dev', 'triaged')`
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 1, 'discover', 'step', 'Found job')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 1, 'triage', 'step', 'Scoring job')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 1, 'prep', 'step', 'Preparing resume')`);

    const res = await runMonitor({
      dbPath,
      journalPath,
      statePath,
      silent: true,
      help: false,
    });

    expect(res.changed).toBe(false);
    expect(loadState(statePath)).toBeNull();
  });

  it("3. Strictly excludes purely manually approved jobs ('kind = user, message = approve')", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (10, 'https://test/10', 'board', 'Manual Corp', 'Engineer', 'needs_input', 'user', '{"kind":"question","text":"Are you local?"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (101, 10, 'prep', 'user', 'approve')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (102, 10, 'fill', 'step', 'Opening form')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message) VALUES (103, 10, 'fill', 'gate', 'question: Are you local? Options: Yes / No')`
    );

    const res = await runMonitor({
      dbPath,
      journalPath,
      statePath,
      silent: true,
      help: false,
    });

    expect(res.changed).toBe(false);
    expect(loadState(statePath)).toBeNull();
  });

  it("4. Captures auto-approved practice attempt and gate evidence on bootstrap", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (8805, 'https://test/8805', 'greenhouse', 'ALTEN Technology USA', 'SAP ABAP Developer', 'needs_input', 'auto',
              '{"kind":"question","text":"By selecting YES, I consent to receive recruiting SMS messages...","shot":1728531653000}')
    `);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11747, 8805, 'prep', 'auto', 'Approved by auto apply: practice: qualified', '2026-10-10 03:40:20')`
    );
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11762, 8805, 'fill', 'step', 'Opening job application', '2026-10-10 03:40:35')`
    );
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11788, 8805, 'fill', 'gate', 'question: By selecting YES, I consent to receive recruiting SMS messages from Alten Technology USA at the phone number provided on my job application. Options: Yes / No.', '2026-10-10 03:40:53')`
    );

    const res = await runMonitor({
      dbPath,
      journalPath,
      statePath,
      silent: true,
      help: false,
    });

    expect(res.changed).toBe(true);
    const journalText = readFileSync(journalPath, "utf8");

    // Header preserved
    expect(journalText).toContain("# Auto-Apply Observation & Stalls Journal");
    // Deterministic checkpoint comment
    expect(journalText).toContain("<!-- journal-checkpoint: watermark=11788 -->");
    // Bootstrap tagged
    expect(journalText).toContain("[Bootstrap]");
    // Job details in table
    expect(journalText).toContain("#8805");
    expect(journalText).toContain("ALTEN Technology USA");
    // Gate event and verbatim text
    expect(journalText).toContain("Gate Event #11788");
    expect(journalText).toContain("By selecting YES, I consent to receive recruiting SMS messages");
    // Categorization
    expect(journalText).toContain("Recruiting Communications & SMS Consent");
    expect(journalText).toContain("(1 application affected)");
    // Neutral resolution label without emojis
    expect(journalText).not.toContain("⚠️");
    expect(journalText).not.toContain("ℹ️");

    // State verification
    const state = loadState(statePath, journalPath);
    expect(state).not.toBeNull();
    expect(state?.lastEventId).toBe(11788);
    expect(state?.reportedGateEventIds).toEqual([11788]);
    expect(state?.reportedJobStatuses[8805]).toBe("needs_input");
  });

  it("5. Guarantees idempotency and zero churn when re-run without new events", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (8805, 'https://test/8805', 'greenhouse', 'ALTEN', 'Dev', 'needs_input', 'auto', '{"kind":"question","text":"SMS consent"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 8805, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 8805, 'fill', 'step', 'Filling form')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 8805, 'fill', 'gate', 'question: SMS consent?')`);

    const res1 = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res1.changed).toBe(true);
    const text1 = readFileSync(journalPath, "utf8");

    const res2 = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res2.changed).toBe(false);
    const text2 = readFileSync(journalPath, "utf8");
    expect(text2).toBe(text1); // Exact byte equality, no duplicated entries
  });

  it("6. Aggregates recurring themes across distinct applications: second app yields count=2 and recurring label", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    // Job 1 has an SMS consent question
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (101, 'https://test/101', 'greenhouse', 'Co A', 'Dev', 'needs_input', 'auto', '{"kind":"question","text":"SMS consent"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 101, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 101, 'fill', 'step', 'Filling')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 101, 'fill', 'gate', 'question: Consent to receive SMS messages?')`);

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    let text = readFileSync(journalPath, "utf8");
    expect(text).toContain("Recruiting Communications & SMS Consent** (1 application affected)");

    // Job 2 appears later and encounters another SMS consent question
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (102, 'https://test/102', 'greenhouse', 'Co B', 'Dev', 'needs_input', 'auto', '{"kind":"question","text":"SMS consent"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (10, 102, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (11, 102, 'fill', 'step', 'Filling')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (12, 102, 'fill', 'gate', 'question: Do you opt in to recruiting SMS messaging?')`);

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    text = readFileSync(journalPath, "utf8");

    // Cumulative theme count must now be 2 and labeled recurring
    expect(text).toContain("Recruiting Communications & SMS Consent** (2 applications affected — recurring)");
  });

  it("7. Safely isolates approval intervals: old manual gate excluded, later auto gate captured", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    // Job 999: Old manual attempt at events 10-12
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (999, 'https://test/999', 'board', 'Hybrid Corp', 'Eng', 'filling', 'auto')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (10, 999, 'prep', 'user', 'approve')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (11, 999, 'fill', 'step', 'Old manual fill')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (12, 999, 'fill', 'gate', 'question: Old manual question')`);

    // Later auto-apply reassessment at event 50
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (50, 999, 'prep', 'auto', 'Approved by auto apply: fresh practice')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (51, 999, 'fill', 'step', 'Fresh auto fill')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (52, 999, 'fill', 'gate', 'question: New auto gate: Travel percentage?')`);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    const journalText = readFileSync(journalPath, "utf8");
    expect(journalText).toContain("Gate Event #52");
    expect(journalText).toContain("New auto gate: Travel percentage?");
    expect(journalText).not.toContain("Gate Event #12");
    expect(journalText).not.toContain("Old manual question");
  });

  it("8. Historical auto gate survives even if job is later approved by user", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (888, 'https://test/888', 'board', 'Dual Corp', 'Eng', 'submitted', 'user')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (10, 888, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (11, 888, 'fill', 'step', 'Auto fill started')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (12, 888, 'fill', 'gate', 'question: Auto era gate: salary expectation?')`);

    // User approval at event 50 started manual interval
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (50, 888, 'prep', 'user', 'approve')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (51, 888, 'fill', 'gate', 'question: Manual era gate: commute time?')`);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    const journalText = readFileSync(journalPath, "utf8");
    // Historical auto gate at 12 is captured
    expect(journalText).toContain("Gate Event #12");
    expect(journalText).toContain("Auto era gate: salary expectation?");
    // Non-pending status labeled neutrally
    // Manual era gate at 51 is excluded
    expect(journalText).not.toContain("Gate Event #51");
    expect(journalText).not.toContain("Manual era gate: commute time?");
  });

  it("9. Recovers from uncommitted state write crash via journal checkpoint marker without duplicating entries", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (500, 'https://test/500', 'board', 'Crash Corp', 'Dev', 'needs_input', 'auto', '{"kind":"question","text":"Crash test"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 500, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 500, 'fill', 'step', 'Filling')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 500, 'fill', 'gate', 'question: Crash test question')`);

    // Normal run
    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    const journalText1 = readFileSync(journalPath, "utf8");

    // Simulate crash where state file was deleted/lost, but journal already had the entry written
    unlinkSync(statePath);

    // Re-run monitor
    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    // Journal must NOT duplicate the entry
    const journalText2 = readFileSync(journalPath, "utf8");
    expect(journalText2).toBe(journalText1);

    // State file must be restored with lastEventId=3
    const state = loadState(statePath, journalPath);
    expect(state?.lastEventId).toBe(3);
    expect(state?.reportedGateEventIds).toContain(3);
  });

  it("10. Strictly preserves pre-existing journal headers and human notes verbatim without trimming", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    const customExistingContent = `# Auto-Apply Observation & Stalls Journal

## Candidate Custom Notes
Alex Rivera reviewed on 2026-10-09: Remember to keep checking Workday tabs!

## Journal Entries
`;
    writeFileSync(journalPath, customExistingContent, "utf8");

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, submitted_at)
      VALUES (777, 'https://test/777', 'board', 'Live Corp', 'Dev', 'submitted', 'auto', '2026-10-10 03:00:00')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 777, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 777, 'fill', 'step', 'Submitting')`);

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });

    const updatedText = readFileSync(journalPath, "utf8");
    expect(updatedText.startsWith(customExistingContent)).toBe(true);
    expect(updatedText).toContain("Live Corp");
  });

  it("11. Throws visibly on corrupt state files", async () => {
    const { dbPath, journalPath, statePath } = setupTestEnv();
    writeFileSync(statePath, "{ corrupted json syntax --", "utf8");

    expect(
      runMonitor({ dbPath, journalPath, statePath, silent: true, help: false })
    ).rejects.toThrow("State file corrupted");

    // Invalid schema
    writeFileSync(statePath, JSON.stringify({ version: 999 }), "utf8");
    expect(
      runMonitor({ dbPath, journalPath, statePath, silent: true, help: false })
    ).rejects.toThrow("Invalid schema");
  });

  it("12. Separates non-KB blockers (fill errors, manual stalls, confirm_submit gates) with sanitized details", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (600, 'https://test/600', 'board', 'Workday Corp', 'Dev', 'needs_manual', 'auto')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 600, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 600, 'fill', 'step', 'Filling')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 600, 'fill', 'gate', 'manual: Tab job-600: Workday returned persistent error, token: secret123, email: test@example.com')`
    );
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message) VALUES (4, 600, 'fill', 'gate', 'confirm_submit: Review page: Alex Rivera, phone 1234567890, address 123 Main St')`
    );
    const { snapshot } = observeAutoApplyActivity(db, null, "");
    expect(snapshot).not.toBeNull();
    const event4Blocker = snapshot?.otherBlockers.find((b) => b.eventId === 4);
    expect(event4Blocker?.kind).toBe("confirm_submit_gate");

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    const text = readFileSync(journalPath, "utf8");

    expect(text).toContain("Non-KB Blockers & ATS Anomalies");
    expect(text).toContain("Workday Corp");
    expect(text).toContain("Event #4");
    expect(text).toContain("token: [REDACTED]");
    expect(text).toContain("[EMAIL]");
    expect(text).not.toContain("1234567890");
    expect(text).not.toContain("123 Main St");
  });

  it("13. Enforces worker = 'fill' requirement on gates", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (700, 'https://test/700', 'board', 'Triage Corp', 'Dev', 'approved', 'auto')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (1, 700, 'prep', 'auto', 'Approved by auto apply: test')`);
    // Gate logged by prep worker, NOT fill worker
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 700, 'prep', 'gate', 'question: Prep gate?')`);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    // No fill events at all, so excluded
    expect(res.changed).toBe(false);
  });
});
