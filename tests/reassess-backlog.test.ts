import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { runReassessment } from "../scripts/reassess-backlog";

describe("Backlog Reassessment Script - Migration Invariants & Edge Cases", () => {
  function setupTestDb(options: { withPracticeCol?: boolean } = {}): { dir: string; dbPath: string; db: Database } {
    const dir = mkdtempSync(join(tmpdir(), "reassess-test-"));
    const dbPath = join(dir, "test.db");
    const db = new Database(dbPath, { create: true });

    const practiceColSql = options.withPracticeCol ? ", practice_assessment TEXT" : "";

    db.run(`
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
        approved_by TEXT
        ${practiceColSql}
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

    return { dir, dbPath, db };
  }

  it("handles legacy DB without practice_assessment column safely", () => {
    const { dir, dbPath, db } = setupTestDb({ withPracticeCol: false });
    try {
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (1, 'http://1', 'board', 'Co A', 'Eng 1', 'awaiting_approval', 75, '[{}]')`).run();
      const dryResult = runReassessment({ dbPath, apply: false, silent: true });
      expect(dryResult.eligibleCount).toBe(1);

      const applyResult = runReassessment({ dbPath, apply: true, silent: true });
      expect(applyResult.eligibleCount).toBe(1);

      const row1 = db.query<{ status: string; score: number | null }, [number]>("SELECT status, score FROM jobs WHERE id = ?").get(1);
      expect(row1?.status).toBe("triaged");
      expect(row1?.score).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips jobs with already-valid practice_assessment to preserve fresh prep work", () => {
    const { dir, dbPath, db } = setupTestDb({ withPracticeCol: true });
    try {
      const validPracticeJson = JSON.stringify({
        version: 1,
        annualBaseMaxUsd: 75000,
        salaryEvidence: "$75k base",
        mandatoryNonlocalOnsite: "no",
        locationEvidence: "Remote",
      });

      // Job 1: Old scored job needing reassessment (practice_assessment is NULL)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, practice_assessment) VALUES (1, 'http://1', 'board', 'Co A', 'Eng 1', 'awaiting_approval', 75, '[{}]', NULL)`).run();

      // Job 2: Freshly prepped job with valid practice assessment (must be protected/skipped)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, practice_assessment) VALUES (2, 'http://2', 'board', 'Co B', 'Eng 2', 'awaiting_approval', 75, '[{}]', ?)`).run(validPracticeJson);

      const result = runReassessment({ dbPath, apply: false, silent: true });
      expect(result.eligibleCount).toBe(1);
      expect(result.excludedByReason["already_has_practice_assessment"]).toBe(1);

      // Apply
      runReassessment({ dbPath, apply: true, silent: true });

      const row1 = db.query<{ status: string }, [number]>("SELECT status FROM jobs WHERE id = ?").get(1);
      const row2 = db.query<{ status: string; practice_assessment: string }, [number]>("SELECT status, practice_assessment FROM jobs WHERE id = ?").get(2);

      expect(row1?.status).toBe("triaged");
      expect(row2?.status).toBe("awaiting_approval");
      expect(row2?.practice_assessment).toBe(validPracticeJson);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resets approved_by to NULL on requeue", () => {
    const { dir, dbPath, db } = setupTestDb({ withPracticeCol: true });
    try {
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, approved_by) VALUES (1, 'http://1', 'board', 'Co A', 'Eng 1', 'awaiting_approval', 75, '[{}]', 'auto')`).run();

      runReassessment({ dbPath, apply: true, silent: true });

      const row1 = db.query<{ status: string; approved_by: string | null }, [number]>("SELECT status, approved_by FROM jobs WHERE id = ?").get(1);
      expect(row1?.status).toBe("triaged");
      expect(row1?.approved_by).toBeNull();
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-run defaults to no writes and correctly categorizes eligible vs protected", () => {
    const { dir, dbPath, db } = setupTestDb({ withPracticeCol: true });
    try {
      // 1. Eligible awaiting_approval
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (1, 'http://1', 'board', 'Co A', 'Eng 1', 'awaiting_approval', 75, '[{}]')`).run();
      // 2. Eligible held
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (2, 'http://2', 'board', 'Co B', 'Eng 2', 'held', 70, '[{}]')`).run();
      // 3. Eligible skipped
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (3, 'http://3', 'board', 'Co C', 'Eng 3', 'skipped', 50, '[{}]')`).run();

      // Protected categories:
      // 4. Frozen resume (resume_sha present)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, resume_sha) VALUES (4, 'http://4', 'board', 'Co D', 'Eng 4', 'awaiting_approval', 80, '[{}]', 'sha123')`).run();
      // 5. User feedback in kv
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (5, 'http://5', 'board', 'Co E', 'Eng 5', 'awaiting_approval', 60, '[{}]')`).run();
      db.query(`INSERT INTO kv (key, value) VALUES ('feedback.5', 'user asked for this')`).run();
      // 6. Manual approval (approved_by = user)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, approved_by) VALUES (6, 'http://6', 'board', 'Co F', 'Eng 6', 'awaiting_approval', 70, '[{}]', 'user')`).run();
      // 7. Submitted
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, submitted_at) VALUES (7, 'http://7', 'board', 'Co G', 'Eng 7', 'submitted', 85, '[{}]', '2026-10-09')`).run();
      // 8. Rejected
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (8, 'http://8', 'board', 'Co H', 'Eng 8', 'rejected', 40, '[{}]')`).run();
      // 9. Active needs_manual (like Centric 7829)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (9, 'http://9', 'board', 'Co I', 'Eng 9', 'needs_manual', 90, '[{}]')`).run();
      // 10. Unassessed triage drop (score null, checklist null)
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (10, 'http://10', 'board', 'Co J', 'Eng 10', 'skipped', NULL, NULL)`).run();

      const dryRunResult = runReassessment({ dbPath, apply: false, silent: true });
      expect(dryRunResult.totalJobs).toBe(10);
      expect(dryRunResult.eligibleCount).toBe(3);
      expect(dryRunResult.eligibleByStatus).toEqual({
        awaiting_approval: 1,
        held: 1,
        skipped: 1,
      });
      expect(dryRunResult.excludedCount).toBe(7);

      const row1 = db.query<{ status: string; score: number }, [number]>("SELECT status, score FROM jobs WHERE id = ?").get(1);
      expect(row1?.status).toBe("awaiting_approval");
      expect(row1?.score).toBe(75);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requeues eligible rows atomically, preserves freeze invariants, and is idempotent", () => {
    const { dir, dbPath, db } = setupTestDb({ withPracticeCol: true });
    try {
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, rationale, concerns) VALUES (1, 'http://1', 'board', 'Co A', 'Eng 1', 'awaiting_approval', 75, '[{}]', 'good', 'none')`).run();
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist, resume_sha) VALUES (2, 'http://2', 'board', 'Co B', 'Eng 2', 'awaiting_approval', 80, '[{}]', 'sha-freeze')`).run();
      db.query(`INSERT INTO jobs (id, url, source, company, title, status, score, checklist) VALUES (3, 'http://3', 'board', 'Co C', 'Eng 3', 'awaiting_approval', 60, '[{}]')`).run();
      db.query(`INSERT INTO kv (key, value) VALUES ('feedback.3', 'keep this')`).run();

      const appliedResult = runReassessment({ dbPath, apply: true, silent: true });
      expect(appliedResult.eligibleCount).toBe(1);

      const row1 = db.query<{ status: string; score: number | null; checklist: string | null; rationale: string | null; concerns: string | null }, [number]>(
        "SELECT status, score, checklist, rationale, concerns FROM jobs WHERE id = ?"
      ).get(1);
      expect(row1?.status).toBe("triaged");
      expect(row1?.score).toBeNull();
      expect(row1?.checklist).toBeNull();
      expect(row1?.rationale).toBeNull();
      expect(row1?.concerns).toBeNull();

      const row2 = db.query<{ status: string; resume_sha: string }, [number]>("SELECT status, resume_sha FROM jobs WHERE id = ?").get(2);
      expect(row2?.status).toBe("awaiting_approval");
      expect(row2?.resume_sha).toBe("sha-freeze");

      const row3 = db.query<{ status: string; score: number }, [number]>("SELECT status, score FROM jobs WHERE id = ?").get(3);
      expect(row3?.status).toBe("awaiting_approval");
      expect(row3?.score).toBe(60);

      const secondRun = runReassessment({ dbPath, apply: true, silent: true });
      expect(secondRun.eligibleCount).toBe(0);
      expect(secondRun.excludedCount).toBe(3);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
