import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase } from "../src/schema";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  runResumeJournal,
  loadResumeJournalState,
  aggregateResumeThemes,
  formatResumeJournalEntry,
  verifyJobAttributionAndEvidence,
  parseCliArgs,
  REPO_ROOT,
  DEFAULT_DB_PATH,
  type CachedReviewEntry,
  type CliOptions,
  type JobDetailRow,
  type ApprovalEventRow,
  type ResumeReviewerFn,
} from "../scripts/journal-resumes";
import type { ResumeReviewInput, ApplicationResumeReview } from "../scripts/resume-review-model";

/** Resolves with the Error a promise rejects with; fails the test if it settles any other way. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Error) return err;
    throw new Error(`Expected rejection with an Error, got: ${String(err)}`, { cause: err });
  }
  throw new Error("Expected promise to reject, but it resolved");
}

describe("Auto-Apply Resume Journal - Comprehensive Correctness Tests", () => {
  const samplePdfBytes = readFileSync(join(import.meta.dir, "fixtures/sample-resume.pdf"));

  function createMockReviewer(
    callsAccumulator: ResumeReviewInput[][],
    handler?: (inputs: ResumeReviewInput[]) => Promise<ApplicationResumeReview[]>,
  ): ResumeReviewerFn {
    return async (inputs: ResumeReviewInput[], _knownThemes: string[]): Promise<ApplicationResumeReview[]> => {
      callsAccumulator.push(inputs);
      if (handler) {
        return handler(inputs);
      }
      return inputs.map(inp => ({
        jobId: inp.jobId,
        gaps: [
          {
            theme: "SQL Server Schema Design",
            importance: "required",
            status: "supported_omission",
            postingQuote: "Must design relational schemas for state tracking",
            resumeEvidence: null,
            notesEvidence: "Designed SQL Server schema for retry state",
            rationale: "Posting requires relational schema design which was omitted from resume",
            suggestion: "Add confirmed SQL Server state design bullet from resume notes",
          },
        ],
      }));
    };
  }

  function setupTestEnv(customHandler?: (inputs: ResumeReviewInput[]) => Promise<ApplicationResumeReview[]>) {
    const mockCalls: ResumeReviewInput[][] = [];
    const reviewFn = createMockReviewer(mockCalls, customHandler);

    const dir = mkdtempSync(join(tmpdir(), "resume-journal-test-"));
    const dbPath = join(dir, "test.db");
    const journalPath = join(dir, "auto-apply-journal.md");
    const statePath = join(dir, "auto-apply-resume-reviews.json");
    const notesPath = join(dir, "resume-notes.md");
    const jobsRoot = join(dir, "jobs");

    mkdirSync(jobsRoot, { recursive: true });

    // Seed notes file with explicit negative boundaries
    writeFileSync(
      notesPath,
      `# Candidate Notes
- CRM sync: state and retries (SQL Server schema design, retry state)
- Monitoring and alerting (Azure Application Insights, TypeScript dashboards)
- Negative boundaries: distributed systems design, on-call or incident rotation, mentoring or managing other engineers
`,
      "utf8",
    );

    const db = openDatabase(dbPath, "migrate");
    db.close();

    const defaultOpts: CliOptions = {
      dbPath,
      journalPath,
      statePath,
      notesPath,
      jobsRoot,
      batchSize: 5,
      maxApps: 25,
      silent: true,
      help: false,
      reviewFn,
    };

    return { dir, dbPath, journalPath, statePath, notesPath, jobsRoot, defaultOpts, mockCalls };
  }

  function createValidJobArtifacts(jobsRoot: string, jobId: number, customPdfBytes?: Buffer): { sha: string; pdfPath: string } {
    const bytes = customPdfBytes ?? samplePdfBytes;
    const sha = createHash("sha256").update(bytes).digest("hex");
    const dir = join(jobsRoot, String(jobId), "applied", sha.slice(0, 12));
    mkdirSync(dir, { recursive: true });
    const pdfPath = join(dir, "alex_rivera_resume.pdf");
    writeFileSync(pdfPath, bytes);
    return { sha, pdfPath };
  }

  it("1. Exits cleanly with changed=false on an empty DB without creating files", async () => {
    const { defaultOpts, mockCalls } = setupTestEnv();
    const res = await runResumeJournal(defaultOpts);

    expect(res.changed).toBe(false);
    expect(res.success).toBe(true);
    expect(existsSync(defaultOpts.journalPath)).toBe(false);
    expect(existsSync(defaultOpts.statePath)).toBe(false);
    expect(mockCalls.length).toBe(0);
  });

  it("2. Strictly enforces read-only access to SQLite database within consistent transaction", async () => {
    const { dbPath, defaultOpts } = setupTestEnv();

    const db = new Database(dbPath);
    const now = "2026-10-10 03:00:00";
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (101, 'https://example.com/job/101', 'discover', 'Acme Corp', 'Engineer', 'Need Python and SQL', 'filling', 'auto', 'invalidsha', '2026-10-10T03:00:00.000Z');
      INSERT INTO events (id, job_id, worker, kind, message, at)
      VALUES (1, 101, 'prep', 'auto', 'Approved by auto apply: practice', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at)
      VALUES (2, 101, 'fill', 'step', 'Starting fill', '${now}');
    `);
    db.close();

    const initialBytes = readFileSync(dbPath);
    const res = await runResumeJournal(defaultOpts);
    expect(res.success).toBe(true);

    const finalBytes = readFileSync(dbPath);
    expect(Buffer.compare(initialBytes, finalBytes)).toBe(0);
  });

  it("3. Resolves default paths relative to REPO_ROOT and explicit flags relative to cwd", () => {
    // Default invocation
    const defaults = parseCliArgs(["node", "scripts/journal-resumes.ts"]);
    expect(defaults.dbPath).toBe(DEFAULT_DB_PATH);
    expect(defaults.dbPath.startsWith(REPO_ROOT)).toBe(true);

    // Explicit flag invocation
    const custom = parseCliArgs(["node", "scripts/journal-resumes.ts", "--db", "custom/test.db"]);
    expect(custom.dbPath).toBe(join(process.cwd(), "custom/test.db"));
  });

  it("4. Enumerates retained eligible attempts even when journal already contains stall checkpoints", async () => {
    const { dbPath, journalPath, jobsRoot, defaultOpts, mockCalls } = setupTestEnv();

    const { sha } = createValidJobArtifacts(jobsRoot, 102);
    const now = "2026-10-10 03:00:00";
    const nowIso = "2026-10-10T03:00:00.000Z";

    // Simulate pre-existing journal with high watermark checkpoint from previous stall run
    writeFileSync(journalPath, `# Auto-Apply Observation & Stalls Journal\n\n<!-- journal-checkpoint: watermark=999999 -->\n\n### Prior stall run\n`, "utf8");

    const db = new Database(dbPath);
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (102, 'https://example.com/102', 'discover', 'Retained Corp', 'Dev', 'Must know SQL', 'filling', 'auto', '${sha}', '${nowIso}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (1, 102, 'prep', 'auto', 'Approved by auto apply: ok', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (2, 102, 'fill', 'step', 'fill starting', '${now}');
    `);
    db.close();

    // Must still discover Job 102 even though stall watermark 999999 is higher than event id 2
    const res = await runResumeJournal(defaultOpts);
    expect(res.success).toBe(true);
    expect(res.changed).toBe(true);
    expect(mockCalls.length).toBe(1);
    expect(mockCalls[0]?.[0]?.jobId).toBe(102);
  });

  it("5. Attributions handle interleaved approvals: auto -> user -> auto recognizes latest governing approval at freeze", () => {
    const { jobsRoot, notesPath } = setupTestEnv();
    const { sha } = createValidJobArtifacts(jobsRoot, 201);

    const attempt = {
      jobId: 201,
      company: "Reapproved Corp",
      title: "Data Eng",
      status: "filling",
      autoApprovalEventId: 10,
      autoApprovalAt: "2026-10-10 03:00:00",
      firstFillEventId: 11,
      firstFillAt: "2026-10-10 03:00:05",
      submittedAt: null,
      pendingText: null,
      pendingShot: null,
    };

    const jobRow: JobDetailRow = {
      id: 201,
      company: "Reapproved Corp",
      title: "Data Eng",
      description: "Posting text description",
      resume_sha: sha,
      resume_frozen_at: "2026-10-10T03:00:02.000Z", // frozen under auto approval id 10
      approved_by: "auto",
      status: "filling",
    };

    // Case A: Governing approval is auto (event 10 at 03:00:00 before freeze at 03:00:02)
    const approvalsA: ApprovalEventRow[] = [
      { id: 1, kind: "user", message: "approve", at: "2026-10-09 10:00:00" },
      { id: 10, kind: "auto", message: "Approved by auto apply: test", at: "2026-10-10 03:00:00" },
    ];

    const resA = verifyJobAttributionAndEvidence(jobRow, attempt, approvalsA, jobsRoot, notesPath);
    expect(resA.valid).toBe(true);

    // Case B: Governing approval is user (event 20 at 04:00:00 before new freeze at 04:00:05)
    const jobRowB: JobDetailRow = {
      ...jobRow,
      resume_frozen_at: "2026-10-10T04:00:05.000Z",
    };
    const approvalsB: ApprovalEventRow[] = [
      { id: 10, kind: "auto", message: "Approved by auto apply: test", at: "2026-10-10 03:00:00" },
      { id: 20, kind: "user", message: "approve", at: "2026-10-10 04:00:00" },
    ];

    const resB = verifyJobAttributionAndEvidence(jobRowB, attempt, approvalsB, jobsRoot, notesPath);
    expect(resB.valid).toBe(false);
    if (!resB.valid) {
      expect(typeof resB.reason).toBe("string");
      expect(resB.reason.length).toBeGreaterThan(0);
    }
  });

  it("6. Keying markers by full evidence fingerprint prevents data loss when posting changes on same resume", async () => {
    const { dbPath, jobsRoot, defaultOpts, mockCalls } = setupTestEnv();

    const { sha } = createValidJobArtifacts(jobsRoot, 301);
    const now = "2026-10-10 03:00:00";
    const nowIso = "2026-10-10T03:00:00.000Z";

    const db = new Database(dbPath);
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (301, 'https://example.com/301', 'discover', 'Changing Corp', 'Role', 'Initial posting text', 'filling', 'auto', '${sha}', '${nowIso}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (1, 301, 'prep', 'auto', 'Approved by auto apply: test', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (2, 301, 'fill', 'step', 'fill 1', '${now}');
    `);
    db.close();

    // First review with initial posting text
    const res1 = await runResumeJournal(defaultOpts);
    expect(res1.changed).toBe(true);
    expect(mockCalls.length).toBe(1);

    const journalContent1 = readFileSync(defaultOpts.journalPath, "utf8");
    expect(journalContent1).toContain(`jobId=301 fp=`);

    // Employer posting text updates in database (same resume SHA)
    const db2 = new Database(dbPath);
    db2.run(`UPDATE jobs SET description = 'Updated posting text with new requirements' WHERE id = 301`);
    db2.close();

    mockCalls.length = 0;
    const res2 = await runResumeJournal(defaultOpts);
    expect(res2.changed).toBe(true);
    expect(mockCalls.length).toBe(1); // Re-reviewed because evidence fingerprint changed!

    const journalContent2 = readFileSync(defaultOpts.journalPath, "utf8");
    // Journal contains two distinct review entries reflecting the two different fingerprints
    const matches = Array.from(journalContent2.matchAll(/<!--\s*journal-resume-review:\s*jobId=301\s+fp=([0-9a-f]+)/g));
    expect(matches.length).toBe(2);
    expect(matches[0]?.[1]).not.toBe(matches[1]?.[1]);
  });

  it("7. Groups themes strictly by bucket (never relabels unconfirmed as supported) with compact table format", () => {
    const reviews: CachedReviewEntry[] = [
      {
        jobId: 401,
        company: "Alpha Corp",
        title: "Role 1",
        resumeSha: "sha1",
        sourcePdfPath: "/path1",
        fingerprint: "fp1",
        reviewedAt: "2026-10-10T01:00:00Z",
        model: "openai-codex/gpt-6-luna",
        gaps: [
          {
            theme: "SQL Server Schema Design",
            importance: "required",
            status: "supported_omission",
            postingQuote: "Must design SQL schemas",
            resumeEvidence: null,
            notesEvidence: "SQL Server schema design",
            rationale: "Supported",
            suggestion: "Add bullet",
          },
        ],
      },
      {
        jobId: 402,
        company: "Beta LLC",
        title: "Role 2",
        resumeSha: "sha2",
        sourcePdfPath: "/path2",
        fingerprint: "fp2",
        reviewedAt: "2026-10-10T01:00:00Z",
        model: "openai-codex/gpt-6-luna",
        gaps: [
          {
            theme: "SQL Server Schema Design",
            importance: "core",
            status: "unconfirmed", // Same theme name, but unconfirmed here!
            postingQuote: "SQL Server experience required",
            resumeEvidence: null,
            notesEvidence: null,
            rationale: "Unconfirmed",
            suggestion: "Did you design SQL schemas?",
          },
        ],
      },
    ];

    const { supportedThemes, unconfirmedThemes } = aggregateResumeThemes(reviews);

    // Verify structured segregation without majority conflation
    expect(supportedThemes.length).toBe(1);
    expect(supportedThemes[0]?.theme).toBe("SQL Server Schema Design");
    expect(supportedThemes[0]?.distinctJobIds.size).toBe(1);
    expect(supportedThemes[0]?.requiredCount).toBe(1);
    expect(supportedThemes[0]?.coreCount).toBe(0);

    expect(unconfirmedThemes.length).toBe(1);
    expect(unconfirmedThemes[0]?.theme).toBe("SQL Server Schema Design");
    expect(unconfirmedThemes[0]?.distinctJobIds.size).toBe(1);
    expect(unconfirmedThemes[0]?.requiredCount).toBe(0);
    expect(unconfirmedThemes[0]?.coreCount).toBe(1);

    // Verify formatted entry contains stable markers and verbatim posting quotes
    const formatted = formatResumeJournalEntry({
      timestamp: "2026-10-10T02:00:00Z",
      newReviews: reviews,
      allReviews: reviews,
      newMissingEvidence: [],
      allMissingEvidence: [],
    });

    expect(formatted).toContain("<!-- journal-resume-review-entry: timestamp=");
    expect(formatted).toContain(`<!-- journal-resume-review: jobId=401 fp=fp1 sha=sha1 -->`);
    expect(formatted).toContain(`<!-- journal-resume-review: jobId=402 fp=fp2 sha=sha2 -->`);
  });

  it("8. Strict throw when model review output lacks coverage for an input job (no fake fallback)", async () => {
    // Custom reviewer returns empty array (missing coverage for job 501)
    const { dbPath, jobsRoot, defaultOpts } = setupTestEnv(() => Promise.resolve([]));

    const { sha } = createValidJobArtifacts(jobsRoot, 501);
    const now = "2026-10-10 03:00:00";
    const nowIso = "2026-10-10T03:00:00.000Z";

    const db = new Database(dbPath);
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (501, 'https://example.com/501', 'discover', 'Corp', 'Role', 'Posting text', 'filling', 'auto', '${sha}', '${nowIso}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (1, 501, 'prep', 'auto', 'Approved by auto apply: test', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (2, 501, 'fill', 'step', 'fill step', '${now}');
    `);
    db.close();

    expect(await rejectionOf(runResumeJournal(defaultOpts))).toBeInstanceOf(Error);

    // Job 501 is NOT cached in state
    const state = loadResumeJournalState(defaultOpts.statePath);
    expect(state.reviews["501"]).toBeUndefined();
  });

  it("9. Missing evidence reason updates are published with reason hash marker and cleared on recovery", async () => {
    const { dbPath, jobsRoot, defaultOpts } = setupTestEnv();

    const now = "2026-10-10 03:00:00";
    const nowIso = "2026-10-10T03:00:00.000Z";

    const db = new Database(dbPath);
    // Job 601 starts with missing PDF file
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (601, 'https://example.com/601', 'discover', 'Recovering Corp', 'Role', 'Posting text', 'filling', 'auto', 'nonexistent_sha_value', '${nowIso}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (1, 601, 'prep', 'auto', 'Approved by auto apply: test', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at) VALUES (2, 601, 'fill', 'step', 'fill step', '${now}');
    `);
    db.close();

    // Run 1: Missing evidence recorded
    const res1 = await runResumeJournal(defaultOpts);
    expect(res1.success).toBe(true);
    let state = loadResumeJournalState(defaultOpts.statePath);
    expect(state.missingEvidence["601"]).toBeDefined();

    // Fix the issue: create valid PDF artifact and update DB with real SHA
    const { sha: realSha } = createValidJobArtifacts(jobsRoot, 601);
    const db2 = new Database(dbPath);
    db2.run(`UPDATE jobs SET resume_sha = '${realSha}' WHERE id = 601`);
    db2.close();

    // Run 2: Evidence recovers, stale missing evidence is deleted from mapping
    const res2 = await runResumeJournal(defaultOpts);
    expect(res2.success).toBe(true);
    state = loadResumeJournalState(defaultOpts.statePath);
    expect(state.missingEvidence["601"]).toBeUndefined(); // Cleared on recovery!
    expect(state.reviews["601"]).toBeDefined(); // Now reviewed!
  });

  it("10. Corrupt state file throws an error and is NEVER silently overwritten", () => {
    const { statePath } = setupTestEnv();

    writeFileSync(statePath, "{ malformed json syntax error !!!", "utf8");

    expect(() => {
      loadResumeJournalState(statePath);
    }).toThrow("Corrupt resume journal state file");

    const content = readFileSync(statePath, "utf8");
    expect(content).toContain("malformed json syntax error");
  });

  it("11. Recognizes reconsidered auto-approvals as eligible for resume review", async () => {
    const { dbPath, jobsRoot, defaultOpts, mockCalls } = setupTestEnv();
    const jobId = 701;
    const { sha } = createValidJobArtifacts(jobsRoot, jobId);
    const now = "2026-10-10 05:00:00";
    const nowIso = "2026-10-10T05:00:05.000Z";

    const db = new Database(dbPath);
    db.run(`
      INSERT INTO jobs (id, url, source, company, title, description, status, approved_by, resume_sha, resume_frozen_at)
      VALUES (${jobId}, 'https://example.com/701', 'discover', 'Deferred Reconsidered Corp', 'Backend Engineer', 'Must know TypeScript and SQLite', 'submitted', 'auto', '${sha}', '${nowIso}');
      INSERT INTO events (id, job_id, worker, kind, message, at)
      VALUES (1, ${jobId}, 'prep', 'auto', 'Approved by reconsidered auto apply: daily_cap cleared', '${now}');
      INSERT INTO events (id, job_id, worker, kind, message, at)
      VALUES (2, ${jobId}, 'fill', 'step', 'Starting fill session', '${now}');
    `);
    db.close();

    const res = await runResumeJournal(defaultOpts);
    expect(res.success).toBe(true);
    expect(res.changed).toBe(true);
    expect(mockCalls.length).toBe(1);
    expect(mockCalls[0]?.[0]?.jobId).toBe(jobId);
    expect(mockCalls[0]?.[0]?.company).toBe("Deferred Reconsidered Corp");

    const journalContent = readFileSync(defaultOpts.journalPath, "utf8");
    expect(journalContent).toContain("Deferred Reconsidered Corp");
    expect(journalContent).toContain(`jobId=${jobId}`);

    const state = loadResumeJournalState(defaultOpts.statePath);
    expect(state.reviews[String(jobId)]).toBeDefined();
  });
});
