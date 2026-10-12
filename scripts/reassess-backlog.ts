#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../src/config";
import { parsePracticeAssessment } from "../src/practice";

export interface ReassessmentSummary {
  totalJobs: number;
  eligibleCount: number;
  eligibleByStatus: Record<string, number>;
  excludedCount: number;
  excludedByReason: Record<string, number>;
  applied: boolean;
  sampleEligible: { id: number; company: string; title: string; status: string; score: number | null }[];
}

interface JobRow {
  id: number;
  company: string;
  title: string;
  status: string;
  score: number | null;
  checklist: string | null;
  approved_by: string | null;
  resume_sha: string | null;
  resume_frozen_at: string | null;
  submitted_at: string | null;
  practice_assessment: string | null;
}

const PROTECTED_STATUSES: Record<string, true> = {
  rejected: true,
  rejected_by_company: true,
  submitted: true,
  interview: true,
  offer: true,
  failed: true,
  needs_manual: true,
  filling: true,
  needs_input: true,
  awaiting_submit: true,
  prepping: true,
  locating: true,
  found: true,
  triaged: true,
};

const CANDIDATE_STATUSES: Record<string, true> = {
  awaiting_approval: true,
  held: true,
  skipped: true,
};

function selectAndFilter(db: Database) {
  // Support legacy DB safely before db.ts migration runs
  const cols = new Set(db.query<{ name: string }, []>("PRAGMA table_info(jobs)").all().map(c => c.name));
  const hasPracticeCol = cols.has("practice_assessment");

  const feedbackRows = db.query<{ key: string }, []>("SELECT key FROM kv WHERE key LIKE 'feedback.%'").all();
  const feedbackIds = new Set<number>();
  for (const r of feedbackRows) {
    const id = Number(r.key.split(".")[1]);
    if (Number.isFinite(id)) feedbackIds.add(id);
  }

  const querySql = hasPracticeCol
    ? "SELECT id, company, title, status, score, checklist, approved_by, resume_sha, resume_frozen_at, submitted_at, practice_assessment FROM jobs ORDER BY id"
    : "SELECT id, company, title, status, score, checklist, approved_by, resume_sha, resume_frozen_at, submitted_at, NULL as practice_assessment FROM jobs ORDER BY id";

  const allJobs = db.query<JobRow, []>(querySql).all();

  const eligibleJobs: JobRow[] = [];
  const eligibleByStatus: Record<string, number> = {};
  const excludedByReason: Record<string, number> = {};

  for (const j of allJobs) {
    if (PROTECTED_STATUSES[j.status] || !CANDIDATE_STATUSES[j.status]) {
      const key = `status_${j.status}`;
      excludedByReason[key] = (excludedByReason[key] ?? 0) + 1;
      continue;
    }

    if (j.score === null && j.checklist === null) {
      excludedByReason["unassessed_dropped_at_triage"] = (excludedByReason["unassessed_dropped_at_triage"] ?? 0) + 1;
      continue;
    }

    // Skip rows that already have a current valid practice assessment
    if (hasPracticeCol && parsePracticeAssessment(j.practice_assessment) !== null) {
      excludedByReason["already_has_practice_assessment"] = (excludedByReason["already_has_practice_assessment"] ?? 0) + 1;
      continue;
    }

    if (j.approved_by === "user") {
      excludedByReason["approved_by_user"] = (excludedByReason["approved_by_user"] ?? 0) + 1;
      continue;
    }

    if (j.resume_sha !== null || j.resume_frozen_at !== null) {
      excludedByReason["frozen_resume"] = (excludedByReason["frozen_resume"] ?? 0) + 1;
      continue;
    }

    if (feedbackIds.has(j.id)) {
      excludedByReason["user_feedback"] = (excludedByReason["user_feedback"] ?? 0) + 1;
      continue;
    }

    if (j.submitted_at !== null) {
      excludedByReason["already_submitted"] = (excludedByReason["already_submitted"] ?? 0) + 1;
      continue;
    }

    eligibleJobs.push(j);
    eligibleByStatus[j.status] = (eligibleByStatus[j.status] ?? 0) + 1;
  }

  return { allJobs, eligibleJobs, eligibleByStatus, excludedByReason, hasPracticeCol };
}

export function runReassessment(options: { apply?: boolean; dbPath?: string; silent?: boolean } = {}): ReassessmentSummary {
  const dbPath = options.dbPath ?? join(DATA, "app.db");
  const apply = !!options.apply;
  const silent = !!options.silent;

  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }

  const db = new Database(dbPath, apply ? { readwrite: true } : { readonly: true });
  try {
    if (apply) {
      db.run("PRAGMA journal_mode = WAL");
    }
  // In apply mode, selection and writes run inside the same transaction
  const { allJobs, eligibleJobs, eligibleByStatus, excludedByReason, hasPracticeCol } = apply
    ? db.transaction(() => {
      const filtered = selectAndFilter(db);

      if (filtered.eligibleJobs.length > 0) {
        const updateSql = filtered.hasPracticeCol
          ? `UPDATE jobs
             SET status = 'triaged',
                 score = NULL,
                 checklist = NULL,
                 practice_assessment = NULL,
                 approved_by = NULL,
                 rationale = NULL,
                 concerns = NULL,
                 resume_changes = NULL,
                 note = 'reassessment: requeued for fresh practice prep',
                 updated_at = datetime('now')
             WHERE id = ? AND status = ?`
          : `UPDATE jobs
             SET status = 'triaged',
                 score = NULL,
                 checklist = NULL,
                 approved_by = NULL,
                 rationale = NULL,
                 concerns = NULL,
                 resume_changes = NULL,
                 note = 'reassessment: requeued for fresh practice prep',
                 updated_at = datetime('now')
             WHERE id = ? AND status = ?`;

        const updateStmt = db.prepare(updateSql);
        const logEventStmt = db.prepare(`
          INSERT INTO events (job_id, worker, kind, message)
          VALUES (?, 'migration', 'migration', 'Requeued old assessed job for fresh practice prep')
        `);

        for (const j of filtered.eligibleJobs) {
          updateStmt.run(j.id, j.status);
          logEventStmt.run(j.id);
        }
      }

      return filtered;
    })()
    : selectAndFilter(db);

  const sampleEligible = eligibleJobs.slice(0, 10).map(j => ({
    id: j.id,
    company: j.company,
    title: j.title,
    status: j.status,
    score: j.score,
  }));

  const excludedCount = allJobs.length - eligibleJobs.length;

  if (!silent) {
    console.log(`=== Backlog Reassessment CLI ===`);
    console.log(`Mode:    ${apply ? "APPLY (writing changes)" : "DRY-RUN (no changes made)"}`);
    console.log(`DB:      ${dbPath} (practice column: ${hasPracticeCol ? "present" : "legacy/none"})`);
    console.log(`Total jobs in DB:         ${allJobs.length}`);
    console.log(`Eligible to requeue:      ${eligibleJobs.length}`);
    for (const [st, cnt] of Object.entries(eligibleByStatus)) {
      console.log(`  - ${st.padEnd(20)}: ${cnt}`);
    }
    console.log(`Excluded / Protected:     ${excludedCount}`);
    for (const [reason, cnt] of Object.entries(excludedByReason)) {
      console.log(`  - ${reason.padEnd(28)}: ${cnt}`);
    }

    if (sampleEligible.length > 0) {
      console.log(`\nSample eligible jobs (first ${sampleEligible.length}):`);
      for (const s of sampleEligible) {
        console.log(`  #${s.id} [${s.status}, score=${s.score}] ${s.company} - ${s.title}`);
      }
    }

    if (apply) {
      console.log(`\nSuccessfully requeued ${eligibleJobs.length} jobs to 'triaged' for fresh prep.`);
    } else {
      console.log("\nDry-run complete. No changes were made. Pass --apply to execute.");
    }
  }

  return {
    totalJobs: allJobs.length,
    eligibleCount: eligibleJobs.length,
    eligibleByStatus,
    excludedCount,
    excludedByReason,
    applied: apply,
    sampleEligible,
  };
  } finally {
    db.close();
  }

}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let apply = false;
  let dbPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--apply") {
      apply = true;
    } else if (arg === "--db" && i + 1 < args.length) {
      dbPath = args[++i];
    } else if (arg === "-h" || arg === "--help") {
      console.log(`Usage: bun scripts/reassess-backlog.ts [--apply] [--db <path>]`);
      console.log(`Options:`);
      console.log(`  --apply       Actually update the database (defaults to dry-run)`);
      console.log(`  --db <path>   Path to sqlite database (default: app.db)`);
      console.log(`  -h, --help    Show this help message`);
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  runReassessment(dbPath === undefined ? { apply } : { apply, dbPath });
}
