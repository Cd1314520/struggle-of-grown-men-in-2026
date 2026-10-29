import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/schema";
import { observeAutoApplyActivity, JOURNAL_HEADER, type AutoApplyJobAttempt } from "./journal-stalls";
import { reviewResumes, REVIEW_MODEL, type ResumeReviewInput, type ResumeGap, type ApplicationResumeReview } from "./resume-review-model";

// Resolve repository root via import.meta.url so default paths are independent of process.cwd()
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const DEFAULT_DB_PATH = join(REPO_ROOT, "data/app.db");
export const DEFAULT_JOURNAL_PATH = join(REPO_ROOT, "reports/auto-apply-journal.md");
export const DEFAULT_STATE_PATH = join(REPO_ROOT, "data/auto-apply-resume-reviews.json");
export const DEFAULT_NOTES_PATH = join(REPO_ROOT, "profile/resume-notes.md");
export const DEFAULT_JOBS_ROOT = join(REPO_ROOT, "data/jobs");
export const DEFAULT_BATCH_SIZE = 5;
export const DEFAULT_MAX_APPS = 25;
export type ResumeReviewerFn = (inputs: ResumeReviewInput[], knownThemes: string[]) => Promise<ApplicationResumeReview[]>;

export interface CliOptions {
  dbPath: string;
  journalPath: string;
  statePath: string;
  notesPath: string;
  jobsRoot: string;
  batchSize: number;
  maxApps: number;
  silent: boolean;
  help: boolean;
  reviewFn?: ResumeReviewerFn;
}
export interface CachedReviewEntry {
  jobId: number;
  company: string;
  title: string;
  resumeSha: string;
  sourcePdfPath: string;
  fingerprint: string;
  reviewedAt: string;
  model: string;
  gaps: ResumeGap[];
}

export interface MissingEvidenceEntry {
  jobId: number;
  company: string;
  title: string;
  reason: string;
  notedAt: string;
}

export interface ResumeJournalState {
  version: 1;
  lastRunAt: string;
  reviews: Record<string, CachedReviewEntry>;
  missingEvidence: Record<string, MissingEvidenceEntry>;
}

export interface ValidJobEvidence {
  valid: true;
  jobId: number;
  company: string;
  title: string;
  description: string;
  resumeSha: string;
  resumeFrozenAt: string;
  pdfPath: string;
  resumeText: string;
  notesText: string;
  fingerprint: string;
}

export interface InvalidJobEvidence {
  valid: false;
  jobId: number;
  company: string;
  title: string;
  reason: string;
}

export type JobEvidenceResult = ValidJobEvidence | InvalidJobEvidence;

export interface ApprovalEventRow {
  id: number;
  kind: string;
  message: string;
  at: string;
}

export interface JobDetailRow {
  id: number;
  company: string;
  title: string;
  description: string | null;
  resume_sha: string | null;
  resume_frozen_at: string | null;
  approved_by: string | null;
  status: string;
}

export interface ThemeBucketSummary {
  theme: string;
  distinctJobIds: Set<number>;
  distinctCompanies: Set<string>;
  requiredCount: number;
  coreCount: number;
  preferredCount: number;
  jobIdsList: number[];
}

export function parseTimestampMs(ts: string | null | undefined): number | null {
  if (!ts) return null;
  const normalized = ts.includes("T") ? ts : ts.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return isNaN(ms) ? null : ms;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;
  let journalPath = DEFAULT_JOURNAL_PATH;
  let statePath = DEFAULT_STATE_PATH;
  let notesPath = DEFAULT_NOTES_PATH;
  let jobsRoot = DEFAULT_JOBS_ROOT;
  let batchSize = DEFAULT_BATCH_SIZE;
  let maxApps = DEFAULT_MAX_APPS;
  let silent = false;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--silent" || arg === "-q") {
      silent = true;
    } else if (arg === "--db") {
      if (!next) throw new Error("Missing value for --db");
      dbPath = resolve(process.cwd(), next);
      i++;
    } else if (arg === "--journal") {
      if (!next) throw new Error("Missing value for --journal");
      journalPath = resolve(process.cwd(), next);
      i++;
    } else if (arg === "--state") {
      if (!next) throw new Error("Missing value for --state");
      statePath = resolve(process.cwd(), next);
      i++;
    } else if (arg === "--notes") {
      if (!next) throw new Error("Missing value for --notes");
      notesPath = resolve(process.cwd(), next);
      i++;
    } else if (arg === "--jobs-root") {
      if (!next) throw new Error("Missing value for --jobs-root");
      jobsRoot = resolve(process.cwd(), next);
      i++;
    } else if (arg === "--batch-size") {
      if (!next) throw new Error("Missing value for --batch-size");
      batchSize = parseInt(next, 10);
      i++;
      if (isNaN(batchSize) || batchSize <= 0) throw new Error("Invalid batch-size value");
    } else if (arg === "--max-apps") {
      if (!next) throw new Error("Missing value for --max-apps");
      maxApps = parseInt(next, 10);
      i++;
      if (isNaN(maxApps) || maxApps < 0) throw new Error("Invalid max-apps value");
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { dbPath, journalPath, statePath, notesPath, jobsRoot, batchSize, maxApps, silent, help };
}

export function loadResumeJournalState(statePath: string): ResumeJournalState {
  if (!existsSync(statePath)) {
    return {
      version: 1,
      lastRunAt: "",
      reviews: {},
      missingEvidence: {},
    };
  }

  const raw = readFileSync(statePath, "utf8");
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof ResumeJournalState, unknown>> | null;
    if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
      throw new Error("Invalid state version or schema root");
    }
    if (!parsed.reviews || typeof parsed.reviews !== "object") {
      throw new Error("Missing or malformed reviews mapping");
    }
    if (!parsed.missingEvidence || typeof parsed.missingEvidence !== "object") {
      throw new Error("Missing or malformed missingEvidence mapping");
    }
    return parsed as ResumeJournalState;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Corrupt resume journal state file at ${statePath}: ${msg}. Refusing to overwrite corrupt state.`, { cause: err });
  }
}

export function saveResumeJournalState(statePath: string, state: ResumeJournalState): void {
  const dir = dirname(statePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${statePath}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmpPath, statePath);
}

export function computeFileSha256(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function computeFingerprint(postingText: string, resumeText: string, notesText: string): string {
  return createHash("sha256").update(`${postingText}\n---RESUME---\n${resumeText}\n---NOTES---\n${notesText}`).digest("hex");
}

export function extractPdfText(pdfPath: string): { success: true; text: string } | { success: false; error: string } {
  try {
    const proc = Bun.spawnSync([process.platform === "win32" ? "pdftotext" : "/usr/bin/pdftotext", "-layout", pdfPath, "-"]);
    if (proc.exitCode !== 0) {
      return {
        success: false,
        error: `pdftotext exited with code ${proc.exitCode}: ${proc.stderr.toString().trim()}`,
      };
    }
    const text = proc.stdout.toString();
    if (!text || text.trim().length === 0) {
      return { success: false, error: "Extracted PDF text is empty" };
    }
    return { success: true, text };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Failed to invoke pdftotext: ${msg}` };
  }
}

export function normalizeTheme(theme: string): string {
  return theme.trim().replace(/\s+/g, " ");
}

export function extractPublishedJournalMarkers(journalPath: string): {
  publishedJobFingerprints: Set<string>;
  publishedMissingKeys: Set<string>;
  entryTimestamps: Set<string>;
} {
  const publishedJobFingerprints = new Set<string>();
  const publishedMissingKeys = new Set<string>();
  const entryTimestamps = new Set<string>();

  if (!existsSync(journalPath)) {
    return { publishedJobFingerprints, publishedMissingKeys, entryTimestamps };
  }

  const content = readFileSync(journalPath, "utf8");
  // Match full evidence fingerprint marker: <!-- journal-resume-review: jobId=401 fp=<sha256> ... -->
  for (const m of content.matchAll(/<!--\s*journal-resume-review:\s*jobId=(\d+)\s+fp=([0-9a-fA-F]+)(?:\s+sha=([0-9a-fA-F]+))?\s*-->/g)) {
    publishedJobFingerprints.add(`${m[1]}:${m[2]}`);
  }
  // Match missing evidence marker with reason hash: <!-- journal-resume-missing-evidence: jobId=401 reasonHash=<sha256[:12]> -->
  for (const m of content.matchAll(/<!--\s*journal-resume-missing-evidence:\s*jobId=(\d+)\s+reasonHash=([0-9a-fA-F]+)\s*-->/g)) {
    publishedMissingKeys.add(`${m[1]}:${m[2]}`);
  }
  // Match entry timestamp
  for (const m of content.matchAll(/<!--\s*journal-resume-review-entry:\s*timestamp=([^\s]+)\s*-->/g)) {
    if (m[1] !== undefined) entryTimestamps.add(m[1]);
  }

  return { publishedJobFingerprints, publishedMissingKeys, entryTimestamps };
}

export function verifyJobAttributionAndEvidence(
  job: JobDetailRow | undefined,
  attempt: AutoApplyJobAttempt,
  approvals: ApprovalEventRow[],
  jobsRoot: string,
  notesPath: string,
): JobEvidenceResult {
  if (!job) {
    return {
      valid: false,
      jobId: attempt.jobId,
      company: attempt.company,
      title: attempt.title,
      reason: `Job record #${attempt.jobId} not found in database`,
    };
  }

  // 1. Governing approval at freeze/fill boundary:
  // Normalize timestamps to epoch ms to avoid lexical ISO vs SQLite comparisons
  const freezeMs = parseTimestampMs(job.resume_frozen_at);
  if (!freezeMs || !job.resume_frozen_at) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: "Job has no resume_frozen_at recorded (resume was never frozen)",
    };
  }

  // Find governing approval event: latest approval at or before the freeze timestamp
  // (allow 5000ms clock tolerance for minor differences between node Date and sqlite datetime)
  const priorApprovals = approvals.filter(a => {
    const apprMs = parseTimestampMs(a.at);
    return apprMs !== null && apprMs <= freezeMs + 5000;
  });

  const governingApproval = priorApprovals.length > 0 ? priorApprovals[priorApprovals.length - 1] : null;

  if (!governingApproval) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: "Governing approval for frozen resume is indeterminate / unknown",
    };
  }

  if (governingApproval.kind === "user") {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: "Frozen resume belongs to subsequent user manual approval, not auto-apply",
    };
  }

  // 2. Validate posting description
  if (!job.description?.trim()) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: "Stored job posting description is empty or missing",
    };
  }

  // 3. Validate stored resume SHA
  if (!job.resume_sha?.trim()) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: "Job has no resume_sha recorded (resume was never frozen)",
    };
  }

  // 4. Locate applied resume PDF: the one PDF in data/jobs/<id>/applied/<sha[:12]>/. Its name is
  // whatever resume.pdfName was when it was frozen; its identity is the SHA checked next.
  const frozenDir = join(jobsRoot, String(job.id), "applied", job.resume_sha.slice(0, 12));
  const pdfNames = existsSync(frozenDir) ? readdirSync(frozenDir).filter(name => name.toLowerCase().endsWith(".pdf")) : [];
  const [pdfName] = pdfNames;
  if (pdfName === undefined || pdfNames.length !== 1) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: pdfNames.length > 1 ? `More than one PDF in the frozen resume directory: ${frozenDir}` : `Frozen applied resume PDF not found in: ${frozenDir}`,
    };
  }
  const pdfPath = join(frozenDir, pdfName);

  // 5. Verify PDF SHA matches jobs.resume_sha
  let actualSha: string;
  try {
    actualSha = computeFileSha256(pdfPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: `Failed to read applied resume PDF: ${msg}`,
    };
  }

  if (actualSha !== job.resume_sha) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: `Applied PDF SHA256 mismatch (expected ${job.resume_sha}, found ${actualSha})`,
    };
  }

  // 6. Extract text with pdftotext
  const extractRes = extractPdfText(pdfPath);
  if (!extractRes.success) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: `Resume text extraction failed: ${extractRes.error}`,
    };
  }

  // 7. Load candidate notes
  if (!existsSync(notesPath)) {
    return {
      valid: false,
      jobId: job.id,
      company: job.company,
      title: job.title,
      reason: `Candidate notes file not found at ${notesPath}`,
    };
  }

  const notesText = readFileSync(notesPath, "utf8");
  const fingerprint = computeFingerprint(job.description, extractRes.text, notesText);

  return {
    valid: true,
    jobId: job.id,
    company: job.company,
    title: job.title,
    description: job.description,
    resumeSha: job.resume_sha,
    resumeFrozenAt: job.resume_frozen_at,
    pdfPath,
    resumeText: extractRes.text,
    notesText,
    fingerprint,
  };
}

export function aggregateResumeThemes(reviews: CachedReviewEntry[]): {
  supportedThemes: ThemeBucketSummary[];
  unconfirmedThemes: ThemeBucketSummary[];
  confirmedMismatchThemes: ThemeBucketSummary[];
} {
  // Group by status bucket AND theme to never conflate categories across apps
  type BucketKey = "supported" | "unconfirmed" | "confirmed_mismatch";

  const bucketMaps: Record<
    BucketKey,
    Map<
      string,
      {
        canonicalTheme: string;
        jobImportance: Map<number, "required" | "core" | "preferred">;
        jobCompany: Map<number, string>;
      }
    >
  > = {
    supported: new Map(),
    unconfirmed: new Map(),
    confirmed_mismatch: new Map(),
  };

  const importanceRank = (imp: "required" | "core" | "preferred") => {
    switch (imp) {
      case "required":
        return 3;
      case "core":
        return 2;
      case "preferred":
        return 1;
    }
  };

  for (const review of reviews) {
    for (const gap of review.gaps) {
      let bucket: BucketKey;
      if (gap.status === "supported_omission" || gap.status === "underemphasized") {
        bucket = "supported";
      } else if (gap.status === "confirmed_mismatch") {
        bucket = "confirmed_mismatch";
      } else {
        bucket = "unconfirmed";
      }

      const normalized = normalizeTheme(gap.theme);
      const groupKey = normalized.toLowerCase();
      const map = bucketMaps[bucket];

      let entry = map.get(groupKey);
      if (!entry) {
        entry = {
          canonicalTheme: normalized,
          jobImportance: new Map(),
          jobCompany: new Map(),
        };
        map.set(groupKey, entry);
      }

      entry.jobCompany.set(review.jobId, review.company);

      // Deduplicate importance per job/theme: keep strongest classification if duplicate
      const currentImp = entry.jobImportance.get(review.jobId);
      if (!currentImp || importanceRank(gap.importance) > importanceRank(currentImp)) {
        entry.jobImportance.set(review.jobId, gap.importance);
      }
    }
  }

  const buildBucketSummaries = (map: (typeof bucketMaps)["supported"]): ThemeBucketSummary[] => {
    const list: ThemeBucketSummary[] = [];

    for (const item of map.values()) {
      let requiredCount = 0;
      let coreCount = 0;
      let preferredCount = 0;

      for (const imp of item.jobImportance.values()) {
        if (imp === "required") requiredCount++;
        else if (imp === "core") coreCount++;
        else preferredCount++;
      }

      const distinctJobIds = new Set(item.jobImportance.keys());
      const distinctCompanies = new Set(item.jobCompany.values());
      const jobIdsList = Array.from(distinctJobIds).sort((a, b) => a - b);

      list.push({
        theme: item.canonicalTheme,
        distinctJobIds,
        distinctCompanies,
        requiredCount,
        coreCount,
        preferredCount,
        jobIdsList,
      });
    }

    list.sort((a, b) => {
      // 1. Distinct applications descending
      const countDiff = b.distinctJobIds.size - a.distinctJobIds.size;
      if (countDiff !== 0) return countDiff;
      // 2. Required count descending
      const reqDiff = b.requiredCount - a.requiredCount;
      if (reqDiff !== 0) return reqDiff;
      // 3. Alphabetical
      return a.theme.localeCompare(b.theme);
    });

    return list;
  };

  return {
    supportedThemes: buildBucketSummaries(bucketMaps.supported),
    unconfirmedThemes: buildBucketSummaries(bucketMaps.unconfirmed),
    confirmedMismatchThemes: buildBucketSummaries(bucketMaps.confirmed_mismatch),
  };
}

export function formatBucketTable(summaries: ThemeBucketSummary[]): string[] {
  if (summaries.length === 0) {
    return ["*None identified in cumulative reviewed applications.*", ""];
  }

  const lines: string[] = ["| Theme | Applications (Companies) | Importance (Req / Core / Pref) | Job IDs |", "| :--- | :--- | :--- | :--- |"];

  for (const s of summaries) {
    const appsText = `${s.distinctJobIds.size} app${s.distinctJobIds.size === 1 ? "" : "s"} (${s.distinctCompanies.size} co${s.distinctCompanies.size === 1 ? "" : "s"})`;
    const impText = `${s.requiredCount} req, ${s.coreCount} core, ${s.preferredCount} pref`;
    const jobsText = s.jobIdsList.map(id => `#${id}`).join(", ");
    lines.push(`| ${s.theme} | ${appsText} | ${impText} | ${jobsText} |`);
  }

  lines.push("");
  return lines;
}

export function formatResumeJournalEntry(params: {
  timestamp: string;
  newReviews: CachedReviewEntry[];
  allReviews: CachedReviewEntry[];
  newMissingEvidence: MissingEvidenceEntry[];
  allMissingEvidence: MissingEvidenceEntry[];
}): string {
  const lines: string[] = [];

  // 1. Stable markers for checkpointing & crash idempotency (keyed by full evidence fingerprint)
  lines.push(`<!-- journal-resume-review-entry: timestamp=${params.timestamp} -->`);
  for (const r of params.newReviews) {
    lines.push(`<!-- journal-resume-review: jobId=${r.jobId} fp=${r.fingerprint} sha=${r.resumeSha} -->`);
  }
  for (const m of params.newMissingEvidence) {
    const reasonHash = createHash("sha256").update(m.reason).digest("hex").slice(0, 12);
    lines.push(`<!-- journal-resume-missing-evidence: jobId=${m.jobId} reasonHash=${reasonHash} -->`);
  }
  lines.push("");

  // 2. Section Heading
  lines.push(`### [${params.timestamp}] Auto-Apply Resume Review Run (GPT-6 Luna)`);
  lines.push("");

  // 3. Denominator & Scope Summary
  const allDistinctJobIds = new Set(params.allReviews.map(r => r.jobId));
  const allDistinctCompanies = new Set(params.allReviews.map(r => r.company));

  lines.push("#### 1. Review Scope & Cumulative Denominator");
  lines.push(`- **Review Model**: \`${REVIEW_MODEL}\``);
  lines.push(`- **Newly Evaluated in This Run**: ${params.newReviews.length} application(s)`);
  lines.push(
    `- **Cumulative Evaluated Applications**: ${allDistinctJobIds.size} distinct application(s) across ${allDistinctCompanies.size} company/companies`,
  );
  if (params.newReviews.length > 0) {
    lines.push("- **Evaluated Applications in Current Batch**:");
    for (const r of params.newReviews) {
      lines.push(`  - Job #${r.jobId}: **${r.company}** — *${r.title}* (Resume: \`${r.resumeSha.slice(0, 12)}\` at \`${r.sourcePdfPath}\`)`);
    }
  }
  lines.push("");

  // 4. Methodological & Practice-Biased Sample Limitations
  lines.push("#### 2. Methodological & Sampling Limitations");
  lines.push(
    "Observations represent read-only AI evaluations (`openai-codex/gpt-6-luna`) comparing verbatim text extracted from the exact frozen applied resume PDF (`pdftotext -layout`) against stored employer posting text and candidate notes (`profile/resume-notes.md`).",
  );
  lines.push("");
  lines.push(
    "- **Practice-Biased Sample**: The auto-apply queue monitors entry-level and real practice applications matching auto-apply criteria, not a balanced cross-section of the entire software engineering market.",
  );
  lines.push(
    "- **Stored Posting Text**: Stored posting descriptions reflect the current saved text in the database (`jobs.description`), not an independently frozen employer posting capture at submission time.",
  );
  lines.push(
    "- **Unconfirmed Qualifications**: Marked as not evidenced in supplied material (resume PDF or `profile/resume-notes.md`), not a proven candidate skill gap. Clarification with the candidate is required.",
  );
  lines.push(
    "- **Advisory Editorial Only**: Findings are provided solely for candidate review and editorial consideration. This monitor never alters resumes, candidate knowledge banks (`profile/answers.md`), or live application submissions.",
  );
  lines.push("");

  // 5. Cumulative Ranked Resume Themes Across Applications (Compact Tables per bucket)
  const { supportedThemes, unconfirmedThemes, confirmedMismatchThemes } = aggregateResumeThemes(params.allReviews);

  lines.push("#### 3. Cumulative Ranked Resume Themes (Across Distinct Applications)");
  lines.push("Counts indicate DISTINCT employer applications and companies where the qualification gap was identified:");
  lines.push("");

  // Subsection 3A: Supported Omissions
  lines.push("##### A. Supported-but-Omitted & Underemphasized Experience");
  lines.push(
    "*Experience supported by candidate notes (`profile/resume-notes.md`) or existing resume evidence that was omitted or underemphasized relative to employer requirements (including reframing already-supported resume work without requiring separate notes):*",
  );
  lines.push("");
  lines.push(...formatBucketTable(supportedThemes));

  // Subsection 3B: Unconfirmed Experience & Questions
  lines.push("##### B. Unconfirmed Experience & Questions for Candidate");
  lines.push("*Employer requirements absent from both tailored resume and candidate notes (not evidenced in supplied material):*");
  lines.push("");
  lines.push(...formatBucketTable(unconfirmedThemes));

  // Subsection 3C: Explicitly Unsupported Requirements / Confirmed Negatives
  lines.push("##### C. Explicitly Unsupported Requirements (Candidate Negative Boundaries)");
  lines.push("*Posting requirements that conflict with candidate negative boundaries in `profile/resume-notes.md`. Must never be claimed on resumes:*");
  lines.push("");
  lines.push(...formatBucketTable(confirmedMismatchThemes));

  // 6. Detailed Per-Application Findings (for newly reviewed applications in this run)
  if (params.newReviews.length > 0) {
    lines.push("#### 4. Detailed Application Gap Findings (Newly Evaluated)");
    for (const r of params.newReviews) {
      lines.push(`##### Job #${r.jobId} — ${r.company} (\`${r.title}\`)`);
      lines.push(`- **Applied Resume**: \`${r.resumeSha.slice(0, 12)}\` (Source: \`${r.sourcePdfPath}\`)`);
      lines.push(`- **Model Evaluation**: \`${r.model}\` at ${r.reviewedAt}`);
      if (r.gaps.length === 0) {
        lines.push("- *No substantial qualification gaps or omitted resume bullets identified.*");
      } else {
        lines.push("- **Identified Gaps & Review Observations**:");
        for (const g of r.gaps) {
          lines.push(`  - **[${g.importance.toUpperCase()} / ${g.status}] ${g.theme}**`);
          lines.push(`    - *Posting Quote*: "${g.postingQuote}"`);
          if (g.resumeEvidence) {
            lines.push(`    - *Resume Evidence*: "${g.resumeEvidence}"`);
          }
          if (g.notesEvidence) {
            lines.push(`    - *Notes Evidence*: "${g.notesEvidence}"`);
          }
          lines.push(`    - *Rationale*: ${g.rationale}`);
          lines.push(`    - *Suggestion*: ${g.suggestion}`);
        }
      }
      lines.push("");
    }
  }

  // 7. Evidence-Unavailable Applications
  if (params.allMissingEvidence.length > 0) {
    lines.push("#### 5. Evidence-Unavailable Applications");
    lines.push("*The following auto-approved applications could not be evaluated due to missing or unattributable evidence:*");
    lines.push("");
    for (const m of params.allMissingEvidence) {
      lines.push(`- **Job #${m.jobId}** (${m.company} - \`${m.title}\`): ${m.reason} *(recorded at ${m.notedAt})*`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function updateJournalFile(journalPath: string, entryContent: string): void {
  const dir = dirname(journalPath);
  mkdirSync(dir, { recursive: true });

  let existing = "";
  if (existsSync(journalPath)) {
    existing = readFileSync(journalPath, "utf8");
  }

  let finalContent: string;
  if (!existing) {
    finalContent = `${JOURNAL_HEADER}\n\n${entryContent}\n`;
  } else {
    // Preserve existing file bytes without trimming
    const separator = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
    finalContent = `${existing}${separator}${entryContent}\n`;
  }

  const tmpPath = `${journalPath}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, finalContent, "utf8");
  renameSync(tmpPath, journalPath);
}

export async function runResumeJournal(options: CliOptions): Promise<{ changed: boolean; message: string; success: boolean }> {
  if (!existsSync(options.dbPath)) {
    throw new Error(`Database file not found at: ${options.dbPath}`);
  }

  // Strict read-only database connection
  const db = openDatabase(options.dbPath, "readonly");

  try {
    // 1. Consistent database transaction snapshot for all DB reads (NO await inside transaction!)
    const dbSnapshot = db.transaction(() => {
      // Pass empty string "" for journal content so stall checkpoints are NOT recovered
      // This ensures all retained eligible attempts are enumerated every check
      const act = observeAutoApplyActivity(db, null, "");

      if (!act.snapshot || act.snapshot.eligibleJobs.length === 0) {
        return {
          hasEligible: false,
          uniqueAttempts: [] as AutoApplyJobAttempt[],
          jobDetailsMap: new Map<number, JobDetailRow>(),
          approvalsMap: new Map<number, ApprovalEventRow[]>(),
        };
      }

      // Deduplicate eligible jobs by jobId
      const uniqueAttemptsMap = new Map<number, AutoApplyJobAttempt>();
      for (const att of act.snapshot.eligibleJobs) {
        if (!uniqueAttemptsMap.has(att.jobId)) {
          uniqueAttemptsMap.set(att.jobId, att);
        }
      }
      const uniqueAttempts = Array.from(uniqueAttemptsMap.values());
      const jobIds = uniqueAttempts.map(a => a.jobId);

      // Query jobs rows
      // One bound JSON array stands in for the id list, so no value is ever spliced into the SQL.
      const jobIdList = JSON.stringify(jobIds);
      const jobRows = db
        .query<JobDetailRow, [string]>(
          `SELECT id, company, title, description, resume_sha, resume_frozen_at, approved_by, status
           FROM jobs
           WHERE id IN (SELECT value FROM json_each(?))`,
        )
        .all(jobIdList);
      const jobDetailsMap = new Map<number, JobDetailRow>(jobRows.map(j => [j.id, j]));

      // Query approval events (auto and user approvals) for governing approval determination
      const approvalRows = db
        .query<ApprovalEventRow & { job_id: number }, [string]>(
          `SELECT id, job_id, kind, message, at
           FROM events
           WHERE job_id IN (SELECT value FROM json_each(?)) AND (
             (kind = 'auto' AND worker = 'prep' AND (message LIKE 'Approved by auto apply:%' OR message LIKE 'Approved by reconsidered auto apply:%'))
             OR (kind = 'user' AND message = 'approve')
           )
           ORDER BY id ASC`,
        )
        .all(jobIdList);

      const approvalsMap = new Map<number, ApprovalEventRow[]>();
      for (const a of approvalRows) {
        let list = approvalsMap.get(a.job_id);
        if (!list) {
          list = [];
          approvalsMap.set(a.job_id, list);
        }
        list.push({ id: a.id, kind: a.kind, message: a.message, at: a.at });
      }

      return {
        hasEligible: true,
        uniqueAttempts,
        jobDetailsMap,
        approvalsMap,
      };
    })();

    if (!dbSnapshot.hasEligible) {
      return {
        changed: false,
        message: "No eligible auto-approved fill applications found.",
        success: true,
      };
    }

    // 2. Load resume review state (throws if corrupt, never silent reset)
    const state = loadResumeJournalState(options.statePath);

    // 3. Inspect published markers in journal (keyed by full evidence fingerprint & reason hash)
    const { publishedJobFingerprints, publishedMissingKeys } = extractPublishedJournalMarkers(options.journalPath);

    // 4. Collect and validate evidence for each eligible attempt outside of DB transaction
    const validEvidenceList: ValidJobEvidence[] = [];
    const newMissingEvidenceEntries: MissingEvidenceEntry[] = [];

    for (const attempt of dbSnapshot.uniqueAttempts) {
      const jobDetail = dbSnapshot.jobDetailsMap.get(attempt.jobId);
      const approvals = dbSnapshot.approvalsMap.get(attempt.jobId) ?? [];

      const res = verifyJobAttributionAndEvidence(jobDetail, attempt, approvals, options.jobsRoot, options.notesPath);

      if (res.valid) {
        validEvidenceList.push(res);
        // Clear stale missing evidence mapping on valid recovery
        const recoveredKey = String(res.jobId);
        if (state.missingEvidence[recoveredKey]) {
          const { [recoveredKey]: _recovered, ...stillMissing } = state.missingEvidence;
          state.missingEvidence = stillMissing;
        }
      } else {
        const existingMissing = state.missingEvidence[String(res.jobId)];
        if (existingMissing?.reason !== res.reason) {
          const entry: MissingEvidenceEntry = {
            jobId: res.jobId,
            company: res.company,
            title: res.title,
            reason: res.reason,
            notedAt: new Date().toISOString(),
          };
          state.missingEvidence[String(res.jobId)] = entry;
          newMissingEvidenceEntries.push(entry);
        }
      }
    }

    // 5. Identify unreviewed jobs (not in state.reviews or fingerprint changed)
    const unreviewedEvidence: ValidJobEvidence[] = [];
    const cachedToPublish: CachedReviewEntry[] = [];

    for (const ev of validEvidenceList) {
      const cached = state.reviews[String(ev.jobId)];
      if (cached?.fingerprint === ev.fingerprint) {
        // Cached exists and matches exact evidence fingerprint
        const key = `${cached.jobId}:${cached.fingerprint}`;
        if (!publishedJobFingerprints.has(key)) {
          cachedToPublish.push(cached);
        }
      } else {
        // Needs review
        unreviewedEvidence.push(ev);
      }
    }

    // Check if any missing evidence needs publication in journal (keyed by jobId:reasonHash)
    const unpublishedMissing = Object.values(state.missingEvidence).filter(m => {
      const reasonHash = createHash("sha256").update(m.reason).digest("hex").slice(0, 12);
      return !publishedMissingKeys.has(`${m.jobId}:${reasonHash}`);
    });

    // If no unreviewed jobs, no unpublished cached reviews, and no unpublished missing evidence: NO-OP!
    if (unreviewedEvidence.length === 0 && cachedToPublish.length === 0 && unpublishedMissing.length === 0) {
      return {
        changed: false,
        message: "No new activity or unreviewed resume evidence. Journal and state are current.",
        success: true,
      };
    }

    // Bound the unreviewed backlog by maxApps if specified (preserving remainder for subsequent runs)
    let jobsToReview = unreviewedEvidence;
    if (options.maxApps > 0 && jobsToReview.length > options.maxApps) {
      jobsToReview = jobsToReview.slice(0, options.maxApps);
    }

    // Extract known themes for vocabulary consistency across model invocations
    const knownThemes = Array.from(new Set(Object.values(state.reviews).flatMap(r => r.gaps.map(g => normalizeTheme(g.theme)))));

    // 6. If there are unpublished cached reviews or missing evidence but no unreviewed jobs, publish them directly
    if (jobsToReview.length === 0 && (cachedToPublish.length > 0 || unpublishedMissing.length > 0)) {
      const runTimestamp = new Date().toISOString();
      const allReviews = Object.values(state.reviews);
      const allMissing = Object.values(state.missingEvidence);

      const entryMarkdown = formatResumeJournalEntry({
        timestamp: runTimestamp,
        newReviews: cachedToPublish,
        allReviews,
        newMissingEvidence: unpublishedMissing,
        allMissingEvidence: allMissing,
      });

      updateJournalFile(options.journalPath, entryMarkdown);
      state.lastRunAt = runTimestamp;
      saveResumeJournalState(options.statePath, state);

      return {
        changed: true,
        message: `Published ${cachedToPublish.length} cached review(s) and ${unpublishedMissing.length} missing-evidence notice(s) to journal.`,
        success: true,
      };
    }

    // 7. Process unreviewed evidence in small bounded batches (e.g. at most 5 per batch)
    // Checkpoint/cache + publish after EACH successful batch to preserve progress if service is interrupted
    let totalReviewed = 0;
    const batchSize = Math.max(1, options.batchSize);

    for (let i = 0; i < jobsToReview.length; i += batchSize) {
      const batchEvidence = jobsToReview.slice(i, i + batchSize);
      const batchInputs: ResumeReviewInput[] = batchEvidence.map(ev => ({
        jobId: ev.jobId,
        company: ev.company,
        title: ev.title,
        postingText: ev.description,
        resumeText: ev.resumeText,
        notesText: ev.notesText,
      }));

      let batchReviews: ApplicationResumeReview[];
      try {
        const reviewer = options.reviewFn ?? reviewResumes;
        batchReviews = await reviewer(batchInputs, knownThemes);
      } catch (err: unknown) {
        const failedJobIds = batchEvidence.map(e => e.jobId).join(", ");
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[journal-resumes] Error invoking reviewResumes on batch [${failedJobIds}]: ${msg}`);
        return {
          changed: totalReviewed > 0,
          message: `Model review failed on batch [${failedJobIds}]: ${msg}. Prior ${totalReviewed} review(s) preserved.`,
          success: false,
        };
      }

      // Map batch outputs back to evidence; throw if any model review output is missing (no fake fallback!)
      const batchTimestamp = new Date().toISOString();
      const batchCachedEntries: CachedReviewEntry[] = [];

      for (const ev of batchEvidence) {
        const rev = batchReviews.find(r => r.jobId === ev.jobId);
        if (!rev) {
          throw new Error(`Model review output missing coverage for jobId #${ev.jobId} (batch had ${batchReviews.length} result(s))`);
        }
        const gaps = rev.gaps;

        const cached: CachedReviewEntry = {
          jobId: ev.jobId,
          company: ev.company,
          title: ev.title,
          resumeSha: ev.resumeSha,
          sourcePdfPath: ev.pdfPath,
          fingerprint: ev.fingerprint,
          reviewedAt: batchTimestamp,
          model: REVIEW_MODEL,
          gaps,
        };

        state.reviews[String(ev.jobId)] = cached;
        batchCachedEntries.push(cached);

        // Add newly found themes to knownThemes for subsequent batches
        for (const g of gaps) {
          const nt = normalizeTheme(g.theme);
          if (!knownThemes.includes(nt)) knownThemes.push(nt);
        }
      }

      // Checkpoint state immediately
      state.lastRunAt = batchTimestamp;
      saveResumeJournalState(options.statePath, state);

      // Append journal section for this successful batch
      const allReviews = Object.values(state.reviews);
      const allMissing = Object.values(state.missingEvidence);

      // In the first batch, also include any previously unpublished cached entries or missing evidence
      const publishReviews = i === 0 ? [...cachedToPublish, ...batchCachedEntries] : batchCachedEntries;
      const publishMissing = i === 0 ? unpublishedMissing : [];

      const entryMarkdown = formatResumeJournalEntry({
        timestamp: batchTimestamp,
        newReviews: publishReviews,
        allReviews,
        newMissingEvidence: publishMissing,
        allMissingEvidence: allMissing,
      });

      updateJournalFile(options.journalPath, entryMarkdown);
      totalReviewed += batchEvidence.length;
    }

    const remainingQueued = unreviewedEvidence.length - jobsToReview.length;
    let msg = `Successfully reviewed and published ${totalReviewed} application(s).`;
    if (remainingQueued > 0) {
      msg += ` ${remainingQueued} remaining unreviewed application(s) queued for next run.`;
    }

    return {
      changed: true,
      message: msg,
      success: true,
    };
  } finally {
    db.close();
  }
}

// Standalone CLI execution
if (import.meta.main) {
  try {
    const opts = parseCliArgs(process.argv);
    if (opts.help) {
      console.log(`Usage: bun scripts/journal-resumes.ts [options]
Options:
  --db <path>          Path to SQLite database (default: data/app.db)
  --journal <path>     Path to Markdown journal (default: reports/auto-apply-journal.md)
  --state <path>       Path to JSON state cache (default: data/auto-apply-resume-reviews.json)
  --notes <path>       Path to candidate notes file (default: profile/resume-notes.md)
  --jobs-root <path>   Path to jobs directory (default: data/jobs)
  --batch-size <num>   Batch size for reviewResumes (default: 5)
  --max-apps <num>     Maximum applications to evaluate in one run (default: 25)
  --silent, -q         Suppress standard stdout summary
  --help, -h           Show this help message
`);
      process.exit(0);
    }

    const res = await runResumeJournal(opts);
    if (!opts.silent) {
      console.log(res.message);
    }
    if (!res.success) {
      process.exit(1);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[journal-resumes] Fatal error: ${msg}`);
    process.exit(1);
  }
}
