import { describe, expect, it } from "bun:test";
import { openDatabase } from "../src/schema";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { runMonitor, loadState, observeAutoApplyActivity } from "../scripts/journal-stalls";

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error) return err;
    throw new Error(`Expected rejection with an Error, got: ${String(err)}`, { cause: err });
  }
  throw new Error("Expected promise to reject, but it resolved");
}

describe("Auto-Apply Journal & Stalls Monitor - Consumer Regression Tests", () => {
  function setupTestEnv() {
    const dir = mkdtempSync(join(tmpdir(), "journal-stalls-test-"));
    const dbPath = join(dir, "test.db");
    const journalPath = join(dir, "auto-apply-journal.md");
    const statePath = join(dir, "journal-state.json");
    const db = openDatabase(dbPath, "migrate");

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
    db.run(`INSERT INTO jobs (id, url, source, company, title, status) VALUES (1, 'https://test/1', 'linkedin', 'Acme', 'Dev', 'triaged')`);
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
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (103, 10, 'fill', 'gate', 'question: Are you local? Options: Yes / No')`);

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
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11747, 8805, 'prep', 'auto', 'Approved by auto apply: practice: qualified', '2026-10-10 03:40:20')`,
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11762, 8805, 'fill', 'step', 'Opening job application', '2026-10-10 03:40:35')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (11788, 8805, 'fill', 'gate', 'question: By selecting YES, I consent to receive recruiting SMS messages from Alten Technology USA at the phone number provided on my job application. Options: Yes / No.', '2026-10-10 03:40:53')`,
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

    expect(journalText).toContain("# Auto-Apply Observation & Stalls Journal");
    expect(journalText).toContain("<!-- journal-checkpoint: watermark=11788 -->");
    expect(journalText).toContain("[Bootstrap]");
    expect(journalText).toContain("#8805");
    expect(journalText).toContain("ALTEN Technology USA");
    expect(journalText).toContain("Gate Event #11788");
    expect(journalText).toContain("By selecting YES, I consent to receive recruiting SMS messages");
    expect(journalText).toContain("Recruiting Communications & SMS Consent");
    expect(journalText).toContain("(1 application affected)");
    expect(journalText).not.toContain("⚠️");
    expect(journalText).not.toContain("ℹ️");

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
    expect(text2).toBe(text1);
  });

  it("6. Aggregates recurring themes across distinct applications: second app yields count=2 and recurring label", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
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

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (102, 'https://test/102', 'greenhouse', 'Co B', 'Dev', 'needs_input', 'auto', '{"kind":"question","text":"SMS consent"}')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (10, 102, 'prep', 'auto', 'Approved by auto apply: test')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (11, 102, 'fill', 'step', 'Filling')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (12, 102, 'fill', 'gate', 'question: Do you opt in to recruiting SMS messaging?')`);

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    text = readFileSync(journalPath, "utf8");

    expect(text).toContain("Recruiting Communications & SMS Consent** (2 applications affected — recurring)");
  });

  it("7. Safely isolates approval intervals: old manual gate excluded, later auto gate captured", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (999, 'https://test/999', 'board', 'Hybrid Corp', 'Eng', 'filling', 'auto')
    `);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (10, 999, 'prep', 'user', 'approve')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (11, 999, 'fill', 'step', 'Old manual fill')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (12, 999, 'fill', 'gate', 'question: Old manual question')`);

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

    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (50, 888, 'prep', 'user', 'approve')`);
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (51, 888, 'fill', 'gate', 'question: Manual era gate: commute time?')`);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    const journalText = readFileSync(journalPath, "utf8");
    expect(journalText).toContain("Gate Event #12");
    expect(journalText).toContain("Auto era gate: salary expectation?");
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

    await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    const journalText1 = readFileSync(journalPath, "utf8");

    unlinkSync(statePath);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    const journalText2 = readFileSync(journalPath, "utf8");
    expect(journalText2).toBe(journalText1);

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

    const corruptErr = await rejectionOf(runMonitor({ dbPath, journalPath, statePath, silent: true, help: false }));
    expect(corruptErr.message).toContain("State file corrupted");

    writeFileSync(statePath, JSON.stringify({ version: 999 }), "utf8");
    const schemaErr = await rejectionOf(runMonitor({ dbPath, journalPath, statePath, silent: true, help: false }));
    expect(schemaErr.message).toContain("Invalid schema");
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
      `INSERT INTO events (id, job_id, worker, kind, message) VALUES (3, 600, 'fill', 'gate', 'manual: Tab job-600: Workday returned persistent error, token: secret123, email: test@example.com')`,
    );
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message) VALUES (4, 600, 'fill', 'gate', 'confirm_submit: Review page: Alex Rivera, phone 1234567890, address 123 Main St')`,
    );
    const { snapshot } = observeAutoApplyActivity(db, null, "");
    expect(snapshot).not.toBeNull();
    const event4Blocker = snapshot?.otherBlockers.find(b => b.eventId === 4);
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
    db.run(`INSERT INTO events (id, job_id, worker, kind, message) VALUES (2, 700, 'prep', 'gate', 'question: Prep gate?')`);

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(false);
  });

  it("14. Correctly attributes reconsidered auto-approvals, excludes prep-only, respects user cutoff, and discovers historical attempts past watermark", async () => {
    const { dbPath, journalPath, statePath, db } = setupTestEnv();

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by, pending)
      VALUES (801, 'https://test/801', 'board', 'Reconsidered Input Corp', 'SWE', 'needs_input', 'auto', '{"text":"Consent to receive SMS messages?","shot":1760000000000}')
    `);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (50, 801, 'prep', 'auto', 'Approved by reconsidered auto apply: daily_cap released', '2026-10-10 05:00:00')`,
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (51, 801, 'fill', 'step', 'Opening application form', '2026-10-10 05:01:00')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (52, 801, 'fill', 'gate', 'question: Consent to receive SMS messages?', '2026-10-10 05:02:00')`,
    );

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (802, 'https://test/802', 'board', 'Reconsidered Manual Corp', 'SRE', 'needs_manual', 'auto')
    `);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (60, 802, 'prep', 'auto', 'Approved by reconsidered auto apply: practice qualified', '2026-10-10 06:00:00')`,
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (61, 802, 'fill', 'step', 'Starting fill', '2026-10-10 06:01:00')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (62, 802, 'fill', 'gate', 'manual: Cloudflare captcha challenge detected on form', '2026-10-10 06:02:00')`,
    );

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (803, 'https://test/803', 'board', 'Prep Only Corp', 'QA', 'approved', 'auto')
    `);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (70, 803, 'prep', 'auto', 'Approved by reconsidered auto apply: qualified', '2026-10-10 07:00:00')`,
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (71, 803, 'prep', 'step', 'Tailoring resume in prep', '2026-10-10 07:01:00')`);

    db.run(`
      INSERT INTO jobs (id, url, source, company, title, status, approved_by)
      VALUES (804, 'https://test/804', 'board', 'Manual Cutoff Corp', 'DevOps', 'needs_input', 'user')
    `);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (80, 804, 'prep', 'auto', 'Approved by reconsidered auto apply: test', '2026-10-10 08:00:00')`,
    );
    db.run(`INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (85, 804, 'user', 'user', 'approve', '2026-10-10 08:30:00')`);
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (90, 804, 'fill', 'step', 'Fill started under manual approval', '2026-10-10 09:00:00')`,
    );
    db.run(
      `INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (91, 804, 'fill', 'gate', 'question: Travel percentage?', '2026-10-10 09:01:00')`,
    );

    writeFileSync(
      statePath,
      JSON.stringify(
        {
          version: 1,
          lastRunAt: "2026-10-10T04:00:00.000Z",
          lastEventId: 500,
          reportedGateEventIds: [1, 2],
          reportedJobStatuses: { "99": "submitted" },
        },
        null,
        2,
      ),
      "utf8",
    );

    const res = await runMonitor({ dbPath, journalPath, statePath, silent: true, help: false });
    expect(res.changed).toBe(true);

    const journalText = readFileSync(journalPath, "utf8");

    expect(journalText).toContain("Reconsidered Input Corp");
    expect(journalText).toContain("Reconsidered Manual Corp");
    expect(journalText).toContain("Gate Event #52");
    expect(journalText).toContain("Cloudflare captcha challenge detected on form");

    expect(journalText).not.toContain("Prep Only Corp");

    expect(journalText).not.toContain("Manual Cutoff Corp");
    expect(journalText).not.toContain("Gate Event #91");

    const updatedState = loadState(statePath);
    expect(updatedState).not.toBeNull();
    expect(updatedState?.reportedJobStatuses["801"]).toBe("needs_input");
    expect(updatedState?.reportedJobStatuses["802"]).toBe("needs_manual");
    expect(updatedState?.reportedJobStatuses["803"]).toBeUndefined();
    expect(updatedState?.reportedJobStatuses["804"]).toBeUndefined();
    expect(updatedState?.reportedGateEventIds).toContain(52);
    expect(updatedState?.reportedGateEventIds).toContain(62);
    expect(updatedState?.reportedGateEventIds).not.toContain(91);
  });
});
