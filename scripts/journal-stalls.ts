#!/usr/bin/env bun
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase } from "../src/schema";

export const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
export const DEFAULT_DB_PATH = join(REPO_ROOT, "data", "app.db");
export const DEFAULT_JOURNAL_PATH = join(REPO_ROOT, "reports", "auto-apply-journal.md");
export const DEFAULT_STATE_PATH = join(REPO_ROOT, "data", "auto-apply-journal-state.json");

export interface CliOptions {
  dbPath: string;
  journalPath: string;
  statePath: string;
  silent: boolean;
  help: boolean;
}

export interface JournalState {
  version: 1;
  lastRunAt: string;
  lastEventId: number;
  reportedGateEventIds: number[];
  reportedJobStatuses: Record<number, string>;
}

export interface QuestionGateEvidence {
  eventId: number;
  jobId: number;
  company: string;
  title: string;
  at: string;
  rawQuestion: string;
  category: string;
  isCurrentlyPending: boolean;
  resolutionStatus: "pending" | "historical";
}

export interface OtherBlockerEvidence {
  eventId: number;
  jobId: number;
  company: string;
  title: string;
  at: string;
  kind: "manual_stall" | "confirm_submit_gate" | "fill_failure";
  detail: string;
}

export interface AutoApplyJobAttempt {
  jobId: number;
  company: string;
  title: string;
  status: string;
  autoApprovalEventId: number;
  autoApprovalAt: string;
  firstFillEventId: number;
  firstFillAt: string;
  submittedAt: string | null;
  pendingText: string | null;
  pendingShot: number | null;
}

export interface JournalSnapshot {
  timestamp: string;
  isBootstrap: boolean;
  maxEventId: number;
  eligibleJobs: AutoApplyJobAttempt[];
  activeOrRecentJobs: AutoApplyJobAttempt[];
  newGates: QuestionGateEvidence[];
  otherBlockers: OtherBlockerEvidence[];
  themeCounts: Record<string, { count: number; suggestion: string }>;
  currentlyStalled: {
    jobId: number;
    company: string;
    title: string;
    stalledSince: string;
    reason: string;
  }[];
}

export interface MonitorResult {
  changed: boolean;
  message: string;
}

/** Shape of the JSON stored in `jobs.pending`; fields are untrusted until checked. */
interface PendingPayload {
  text?: unknown;
  shot?: unknown;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);
  let dbPath = DEFAULT_DB_PATH;
  let journalPath = DEFAULT_JOURNAL_PATH;
  let statePath = DEFAULT_STATE_PATH;
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
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { dbPath, journalPath, statePath, silent, help };
}

export function extractJournalCheckpoints(journalPath: string): {
  maxWatermark: number;
  gateIds: number[];
  content: string;
} {
  if (!existsSync(journalPath)) {
    return { maxWatermark: 0, gateIds: [], content: "" };
  }
  const content = readFileSync(journalPath, "utf8");
  let maxWatermark = 0;
  for (const m of content.matchAll(/<!--\s*journal-checkpoint:\s*watermark=(\d+)\s*-->/g)) {
    const w = Number(m[1]);
    if (w > maxWatermark) maxWatermark = w;
  }
  const gateIds: number[] = [];
  for (const m of content.matchAll(/<!--\s*journal-gate:\s*id=(\d+)\s*-->/g)) {
    gateIds.push(Number(m[1]));
  }
  return { maxWatermark, gateIds, content };
}

export function loadState(statePath: string, journalPath?: string): JournalState | null {
  const stateExists = existsSync(statePath);
  let journalWatermark = 0;
  let journalGateIds: number[] = [];

  if (journalPath && existsSync(journalPath)) {
    const extracted = extractJournalCheckpoints(journalPath);
    journalWatermark = extracted.maxWatermark;
    journalGateIds = extracted.gateIds;
  }

  if (!stateExists) {
    if (journalWatermark > 0) {
      // Recover state from journal markers after prior uncommitted state crash
      return {
        version: 1,
        lastRunAt: new Date().toISOString(),
        lastEventId: journalWatermark,
        reportedGateEventIds: journalGateIds,
        reportedJobStatuses: {},
      };
    }
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(statePath, "utf8");
  } catch (err) {
    throw new Error(`Failed to read state file at ${statePath}: ${(err as Error).message}`, { cause: err });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`State file corrupted at ${statePath}: Invalid JSON (${(err as Error).message})`, { cause: err });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    (parsed as Record<string, unknown>)["version"] !== 1 ||
    typeof (parsed as Record<string, unknown>)["lastEventId"] !== "number" ||
    !Array.isArray((parsed as Record<string, unknown>)["reportedGateEventIds"])
  ) {
    throw new Error(`State file corrupted at ${statePath}: Invalid schema (version 1 required)`);
  }

  const s = parsed as Record<string, unknown>;
  const stateLastEventId = s["lastEventId"] as number;
  const mergedLastEventId = Math.max(stateLastEventId, journalWatermark);
  const reportedSet = new Set<number>(s["reportedGateEventIds"] as number[]);
  const reportedJobStatuses = s["reportedJobStatuses"];
  for (const gid of journalGateIds) {
    reportedSet.add(gid);
  }

  return {
    version: 1,
    lastRunAt: typeof s["lastRunAt"] === "string" ? s["lastRunAt"] : new Date().toISOString(),
    lastEventId: mergedLastEventId,
    reportedGateEventIds: Array.from(reportedSet).sort((a, b) => a - b),
    reportedJobStatuses: reportedJobStatuses ? (reportedJobStatuses as Record<number, string>) : {},
  };
}

export function saveState(statePath: string, state: JournalState): void {
  const dir = dirname(statePath);
  mkdirSync(dir, { recursive: true });
  const tmpPath = `${statePath}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, JSON.stringify(state, null, 2) + "\n", "utf8");
  renameSync(tmpPath, statePath);
}

const CATEGORY_RULES: {
  category: string;
  pattern: RegExp;
  suggestion: string;
}[] = [
  {
    category: "Recruiting Communications & SMS Consent",
    pattern: /\b(sms|text\s*messages?|messaging\s*consent|consent\s*to\s*receive\b.*?\bsms)\b/i,
    suggestion:
      "Review recruiting SMS preferences in profile/answers. Candidate must explicitly choose consent (opt-in or opt-out preference); do not infer candidate consent.",
  },
  {
    category: "Export Control & Dual Citizenship Disclosures",
    pattern:
      /\b(export-screening|export\s*controls?|denial\s*orders?|denied\s*persons|ofac|denial\s*lists?|citizen\s*of\s*any\s*country\s*other|resident\s*of\s*any\s*country\s*other)\b/i,
    suggestion:
      "Review export control and multinational citizenship disclosures. Record explicit declarations for foreign citizenship/residency and trade denial lists; legal attestations must never be inferred.",
  },
  {
    category: "Work Authorization & Visa Sponsorship",
    pattern: /\b(sponsorship|authorized\s*to\s*work|visa\s*status|require.*sponsorship|alien\s*registration)\b/i,
    suggestion:
      "Review work authorization and future visa sponsorship questions in profile/answers. Verify standard answers for immigration sponsorship requirements.",
  },
  {
    category: "Demographics & Voluntary EEO Disclosures",
    pattern: /\b(gender|ethnicity|race|veteran|disability|eeo|equal\s*opportunity|demographic)\b/i,
    suggestion:
      "Review voluntary demographic disclosures. Ensure default candidate preferences (e.g., explicit self-identification vs. decline-to-state) are recorded.",
  },
  {
    category: "Conflict of Interest & Prior Affiliations",
    pattern:
      /\b(conflict\s*of\s*interest|immediate\s*family|client\/customer|previous\s*service|employed\s*by|restrictive\s*covenant|outside\s*business|non-solicitation|board\s*service)\b/i,
    suggestion:
      "Review employer/client conflicts of interest, outside business intentions, and non-solicitation covenants. Confirm candidate history against specific employer or client entities.",
  },
  {
    category: "Travel & Relocation Flexibility",
    pattern: /\b(travel|relocat(e|ion)|onsite|hybrid|commute|willing\s*to\s*travel|office\s*attendance|come\s*into\s*the\s*office)\b/i,
    suggestion:
      "Review travel percentages, mandatory office attendance, and relocation acceptance preferences in profile answers to match ATS option brackets.",
  },
  {
    category: "Target Compensation & Salary Expectations",
    pattern: /\b(salary|compensation|hourly\s*rate|expected\s*pay|target\s*rate|pay\s*range)\b/i,
    suggestion:
      "Review target compensation ranges and minimum salary guidance in profile answers for roles requiring numeric expectations.",
  },
  {
    category: "Legal, Criminal & Employment History Attestations",
    pattern: /\b(involuntarily\s*discharged|criminal|convicted|felony|bonding|discharge|asked\s*to\s*resign)\b/i,
    suggestion:
      "Review legal, bonding, and discharge attestations. Never infer candidate disciplinary or criminal background answers.",
  },
];

export function categorizeQuestion(question: string): { category: string; suggestion: string } {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(question)) {
      return { category: rule.category, suggestion: rule.suggestion };
    }
  }
  return {
    category: "General Application Inquiries (Uncategorized)",
    suggestion:
      "Review the question prompt in application context to determine if standard guidance should be added to profile/answers.md.",
  };
}

export function sanitizeQuestionText(raw: string): string {
  let cleaned = raw;
  if (cleaned.startsWith("question:")) {
    cleaned = cleaned.substring("question:".length).trim();
  }
  cleaned = cleaned.replace(/(password|secret|token)\s*[:=]\s*\S+/gi, "$1: [REDACTED]");
  cleaned = cleaned.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g, "[EMAIL]");
  return cleaned.trim();
}

export function sanitizeBlockerDetail(raw: string): string {
  let cleaned = raw.replace(/^(manual|confirm_submit):\s*/, "").trim();
  // Strip raw tool wrappers if present
  if (cleaned.startsWith("report_result")) {
    cleaned = cleaned.replace(/^report_result\s*/, "");
    try {
      const parsed = JSON.parse(cleaned) as { note?: unknown } | null;
      if (parsed && typeof parsed.note === "string") {
        cleaned = parsed.note;
      }
    } catch {
      // ignore
    }
  }
  cleaned = cleaned.replace(/(password|secret|token)\s*[:=]\s*\S+/gi, "$1: [REDACTED]");
  cleaned = cleaned.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,7}\b/g, "[EMAIL]");
  return cleaned.slice(0, 300).trim();
}

interface EventRow {
  id: number;
  job_id: number | null;
  worker: string | null;
  kind: string;
  message: string;
  at: string;
}

interface JobRow {
  id: number;
  company: string;
  title: string;
  status: string;
  approved_by: string | null;
  submitted_at: string | null;
  pending: string | null;
  updated_at: string;
}

interface AutoApprovalInterval {
  jobId: number;
  startId: number;
  endId: number;
  autoAt: string;
  firstFillId: number;
  firstFillAt: string;
}

export function observeAutoApplyActivity(
  db: Database,
  state: JournalState | null,
  _existingJournalContent: string
): {
  snapshot: JournalSnapshot | null;
  newState: JournalState | null;
} {
  const isBootstrap = state === null;
  const sinceEventId = state?.lastEventId ?? 0;
  const reportedGates = new Set<number>(state?.reportedGateEventIds ?? []);
  const prevStatuses = state?.reportedJobStatuses ?? {};

  // Execute snapshot within a consistent transaction
  const tx = db.transaction(() => {
    // 1. Retrieve all explicit auto-approval events (exact boundary required, never fallback to 0)
    const autoApprovalEvents = db.query<EventRow, []>(`
      SELECT id, job_id, worker, kind, message, at
      FROM events
      WHERE kind = 'auto' AND worker = 'prep' AND (message LIKE 'Approved by auto apply:%' OR message LIKE 'Approved by reconsidered auto apply:%')
      ORDER BY id ASC
    `).all();

    // 2. Retrieve user manual approval events to define cutoff boundaries
    const userApprovalEvents = db.query<EventRow, []>(`
      SELECT id, job_id, worker, kind, message, at
      FROM events
      WHERE kind = 'user' AND message = 'approve'
      ORDER BY id ASC
    `).all();

    // 3. Build non-overlapping auto-approval intervals for each job
    const allAutoJobIds = Array.from(
      new Set(autoApprovalEvents.flatMap((e) => (e.job_id === null ? [] : [e.job_id])))
    );
    const intervals: AutoApprovalInterval[] = [];

    for (const jobId of allAutoJobIds) {
      const jobAutos = autoApprovalEvents.filter((e) => e.job_id === jobId);
      const jobUsers = userApprovalEvents.filter((e) => e.job_id === jobId);

      for (const [i, autoEv] of jobAutos.entries()) {
        const nextAutoId = jobAutos[i + 1]?.id ?? Infinity;
        const nextUser = jobUsers.find((u) => u.id > autoEv.id);
        const nextUserId = nextUser ? nextUser.id : Infinity;
        const endId = Math.min(nextAutoId, nextUserId);

        // Check for actual live fill worker evidence within this auto-apply interval
        const fillEvent = db.query<EventRow, [number, number, number]>(`
          SELECT id, at FROM events
          WHERE job_id = ? AND worker = 'fill' AND id >= ? AND id < ?
          ORDER BY id ASC LIMIT 1
        `).get(jobId, autoEv.id, endId);

        if (fillEvent) {
          intervals.push({
            jobId,
            startId: autoEv.id,
            endId,
            autoAt: autoEv.at,
            firstFillId: fillEvent.id,
            firstFillAt: fillEvent.at,
          });
        }
      }
    }

    // Get max event ID
    const maxRow = db.query<{ max_id: number | null }, []>("SELECT max(id) as max_id FROM events").get();
    const maxEventId = maxRow?.max_id ?? 0;

    if (intervals.length === 0) {
      return {
        intervals: [],
        eligibleJobRows: [],
        allGates: [],
        otherBlockerEvents: [],
        maxEventId,
      };
    }

    const uniqueJobIds = Array.from(new Set(intervals.map((inv) => inv.jobId)));
    // One bound JSON array stands in for the id list, so no value is ever spliced into the SQL.
    const jobIdList = JSON.stringify(uniqueJobIds);
    const eligibleJobRows = db.query<JobRow, [string]>(`
      SELECT id, company, title, status, approved_by, submitted_at, pending, updated_at
      FROM jobs
      WHERE id IN (SELECT value FROM json_each(?))
    `).all(jobIdList);

    // 4. Retrieve candidate question gates strictly under worker = 'fill'
    const allGates = db.query<EventRow, [string]>(`
      SELECT id, job_id, worker, kind, message, at
      FROM events
      WHERE kind = 'gate' AND worker = 'fill' AND job_id IN (SELECT value FROM json_each(?))
      ORDER BY id ASC
    `).all(jobIdList);

    // 5. Retrieve non-KB blockers: manual stalls, confirm_submit gates, fill worker errors and report failures
    const otherBlockerEvents = db.query<EventRow, [string]>(`
      SELECT id, job_id, worker, kind, message, at
      FROM events
      WHERE worker = 'fill'
        AND job_id IN (SELECT value FROM json_each(?))
        AND (
          (kind = 'gate' AND (message LIKE 'manual:%' OR message LIKE 'confirm_submit:%'))
          OR kind = 'error'
          OR (kind = 'tool' AND message LIKE '%"outcome":"failed"%')
          OR (kind = 'step' AND message LIKE '%failed%')
        )
      ORDER BY id ASC
    `).all(jobIdList);

    return {
      intervals,
      eligibleJobRows,
      allGates,
      otherBlockerEvents,
      maxEventId,
    };
  });

  const { intervals, eligibleJobRows, allGates, otherBlockerEvents, maxEventId } = tx();

  if (intervals.length === 0) {
    return { snapshot: null, newState: null };
  }

  const jobsMap = new Map<number, JobRow>(eligibleJobRows.map((j) => [j.id, j]));

  // Build eligible attempts
  const eligibleAttempts: AutoApplyJobAttempt[] = [];
  for (const inv of intervals) {
    const job = jobsMap.get(inv.jobId);
    if (!job) continue;

    let pendingText: string | null = null;
    let pendingShot: number | null = null;
    if (job.pending) {
      try {
        const parsed = JSON.parse(job.pending) as PendingPayload | null;
        if (parsed && typeof parsed.text === "string") pendingText = parsed.text;
        if (parsed && typeof parsed.shot === "number") pendingShot = parsed.shot;
      } catch {
        // ignore parse error
      }
    }

    eligibleAttempts.push({
      jobId: job.id,
      company: job.company,
      title: job.title,
      status: job.status,
      autoApprovalEventId: inv.startId,
      autoApprovalAt: inv.autoAt,
      firstFillEventId: inv.firstFillId,
      firstFillAt: inv.firstFillAt,
      submittedAt: job.submitted_at,
      pendingText,
      pendingShot,
    });
  }

  // 6. Attribute gates strictly to auto intervals
  const allAttributedGates: QuestionGateEvidence[] = [];
  const newGates: QuestionGateEvidence[] = [];

  for (const g of allGates) {
    if (!g.job_id) continue;
    // Check if g falls within any auto interval for this job
    const matchedInv = intervals.find((inv) => inv.jobId === g.job_id && g.id >= inv.startId && g.id < inv.endId);
    if (!matchedInv) continue;

    const job = jobsMap.get(g.job_id);
    if (!job) continue;

    if (g.message.startsWith("question:")) {
      const sanitized = sanitizeQuestionText(g.message);
      const { category } = categorizeQuestion(sanitized);

      let isCurrentlyPending = false;
      if (job.status === "needs_input") {
        if (!job.pending) {
          isCurrentlyPending = true;
        } else {
          try {
            const parsed = JSON.parse(job.pending) as PendingPayload | null;
            const pendingText = typeof parsed?.text === "string" ? parsed.text : job.pending;
            const snippet = sanitized.slice(0, 25);
            isCurrentlyPending = pendingText.includes(snippet) || sanitized.includes(pendingText.slice(0, 25));
          } catch {
            isCurrentlyPending = job.pending.includes(sanitized.slice(0, 25));
          }
        }
      }
      const evidence: QuestionGateEvidence = {
        eventId: g.id,
        jobId: job.id,
        company: job.company,
        title: job.title,
        at: g.at,
        rawQuestion: sanitized,
        category,
        isCurrentlyPending,
        resolutionStatus: isCurrentlyPending ? "pending" : "historical",
      };

      allAttributedGates.push(evidence);
      if (!reportedGates.has(g.id)) {
        newGates.push(evidence);
      }
    }
  }

  // 7. Attribute other blockers strictly to auto intervals
  const newBlockers: OtherBlockerEvidence[] = [];
  for (const b of otherBlockerEvents) {
    if (!b.job_id) continue;
    const matchedInv = intervals.find((inv) => inv.jobId === b.job_id && b.id >= inv.startId && b.id < inv.endId);
    if (!matchedInv) continue;

    const job = jobsMap.get(b.job_id);
    if (!job) continue;

    if (!reportedGates.has(b.id)) {
      let kind: OtherBlockerEvidence["kind"] = "fill_failure";
      let detail: string;
      if (b.message.startsWith("confirm_submit:")) {
        kind = "confirm_submit_gate";
        detail = "Awaiting submission confirmation (not a knowledge-base question)";
      } else if (b.message.startsWith("manual:")) {
        kind = "manual_stall";
        detail = sanitizeBlockerDetail(b.message);
      } else {
        detail = sanitizeBlockerDetail(b.message);
      }
      newBlockers.push({
        eventId: b.id,
        jobId: job.id,
        company: job.company,
        title: job.title,
        at: b.at,
        kind,
        detail,
      });
    }
  }

  // 8. Determine real activity change
  let hasRealChanges = false;
  if (isBootstrap) {
    hasRealChanges = eligibleAttempts.length > 0;
  } else {
    if (newGates.length > 0 || newBlockers.length > 0) {
      hasRealChanges = true;
    }
    for (const att of eligibleAttempts) {
      if (att.firstFillEventId > sinceEventId) {
        hasRealChanges = true;
      } else {
        const prevStatus = prevStatuses[att.jobId];
        if (prevStatus && prevStatus !== att.status) {
          hasRealChanges = true;
        } else if (!prevStatus) {
          hasRealChanges = true;
        }
      }
    }
    if (!hasRealChanges) {
      // Check for any recent fill worker events in auto intervals
      for (const inv of intervals) {
        const recentFill = db.query<EventRow, [number, number, number, number]>(`
          SELECT id FROM events
          WHERE job_id = ? AND worker = 'fill' AND id > ? AND id >= ? AND id < ?
          LIMIT 1
        `).get(inv.jobId, sinceEventId, inv.startId, inv.endId);
        if (recentFill) {
          hasRealChanges = true;
          break;
        }
      }
    }
  }

  if (!hasRealChanges) {
    return { snapshot: null, newState: null };
  }

  // 9. Aggregate candidate input themes across ALL historical attributed gates
  const themeCounts: Record<string, { count: number; suggestion: string }> = {};
  const seenJobCategory = new Set<string>();

  for (const g of allAttributedGates) {
    const key = `${g.jobId}::${g.category}`;
    if (!seenJobCategory.has(key)) {
      seenJobCategory.add(key);
      let theme = themeCounts[g.category];
      if (!theme) {
        const { suggestion } = categorizeQuestion(g.rawQuestion);
        theme = { count: 0, suggestion };
        themeCounts[g.category] = theme;
      }
      theme.count += 1;
    }
  }

  // 10. Collect currently stalled jobs with accurate stall timestamps
  const currentlyStalled: {
    jobId: number;
    company: string;
    title: string;
    stalledSince: string;
    reason: string;
  }[] = [];

  for (const att of eligibleAttempts) {
    if (att.status === "needs_input") {
      // Find latest gate event in that interval
      const gateEv = allAttributedGates.filter((g) => g.jobId === att.jobId).pop();
      const stalledSince = gateEv
        ? gateEv.at
        : att.pendingShot
        ? new Date(att.pendingShot).toISOString()
        : "Time unknown";
      currentlyStalled.push({
        jobId: att.jobId,
        company: att.company,
        title: att.title,
        stalledSince,
        reason: gateEv
          ? `Gate: ${gateEv.category} (Event #${gateEv.eventId})`
          : "Awaiting candidate input",
      });
    } else if (att.status === "needs_manual") {
      const blockerEv = otherBlockerEvents.filter((b) => b.job_id === att.jobId).pop();
      currentlyStalled.push({
        jobId: att.jobId,
        company: att.company,
        title: att.title,
        stalledSince: blockerEv ? blockerEv.at : "Time unknown",
        reason: "Requires manual browser intervention",
      });
    } else if (att.status === "failed") {
      const failEv = otherBlockerEvents.filter((b) => b.job_id === att.jobId).pop();
      currentlyStalled.push({
        jobId: att.jobId,
        company: att.company,
        title: att.title,
        stalledSince: failEv ? failEv.at : "Time unknown",
        reason: "Fill automation failed",
      });
    }
  }

  // 11. Bounded progress table: active jobs or jobs touched in this scope
  const activeOrRecentJobs = eligibleAttempts.filter(
    (att) =>
      att.status === "filling" ||
      att.status === "needs_input" ||
      att.status === "needs_manual" ||
      att.status === "awaiting_submit" ||
      att.firstFillEventId > sinceEventId ||
      prevStatuses[att.jobId] !== att.status
  );

  const updatedReportedGates = new Set(reportedGates);
  for (const g of newGates) updatedReportedGates.add(g.eventId);
  for (const b of newBlockers) updatedReportedGates.add(b.eventId);

  const updatedJobStatuses: Record<number, string> = { ...prevStatuses };
  for (const att of eligibleAttempts) {
    updatedJobStatuses[att.jobId] = att.status;
  }

  const snapshot: JournalSnapshot = {
    timestamp: new Date().toISOString(),
    isBootstrap,
    maxEventId,
    eligibleJobs: eligibleAttempts,
    activeOrRecentJobs,
    newGates,
    otherBlockers: newBlockers,
    themeCounts,
    currentlyStalled,
  };

  const newState: JournalState = {
    version: 1,
    lastRunAt: snapshot.timestamp,
    lastEventId: maxEventId,
    reportedGateEventIds: Array.from(updatedReportedGates).sort((a, b) => a - b),
    reportedJobStatuses: updatedJobStatuses,
  };

  return { snapshot, newState };
}

export const JOURNAL_HEADER = `# Auto-Apply Observation & Stalls Journal

## Overview & Scope
This journal records periodic observations of automated job application runs, tracking progress, completions, and candidate-input stalls encountered during form filling.

- **Observation-Only**: This monitor is strictly read-only. It never intervenes in live browser sessions, never mutates application state or database records, and never modifies knowledge base files (\`profile/answers.md\`, \`profile/personal.yml\`).
- **Monitored Scope**: Tracks actual auto-approved fill attempts (including real practice attempts) and external submissions. It explicitly excludes job discovery, triage, prep-only stages, and manually approved jobs (\`approved_by = 'user'\`).
- **No Inactivity Churn**: Timestamped entries are appended only when new eligible application progress, completions, or blocking gates occur. When no application activity has taken place, the journal remains untouched.
- **Candidate-Input Gates**: When an application halts at an input gate (\`kind = 'gate'\`), the question and context are captured as potential knowledge base gaps, not confirmed absences. Questions may already have answers formatted differently or require candidate clarification.
- **Human Review**: Identified themes, recurring patterns, and suggestions are provided solely for human review and candidate consideration.

---

## Scheduling & Operational Controls
Automated checks are orchestrated by a systemd user timer (\`auto-apply-journal.timer\`) running every 3 hours on a persistent calendar schedule.

- **Cadence**: Every 3 hours at \`01/3:00:00\` local time (01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00, 22:00).
- **Service Unit**: \`~/.config/systemd/user/auto-apply-journal.service\` (\`Type=oneshot\`)
- **Timer Unit**: \`~/.config/systemd/user/auto-apply-journal.timer\` (\`Persistent=true\`)

---

## Journal Entries
`;

export function formatJournalEntry(snapshot: JournalSnapshot): string {
  const lines: string[] = [];
  const tag = snapshot.isBootstrap ? " [Bootstrap]" : "";

  // Deterministic recovery checkpoint comments
  lines.push(`<!-- journal-checkpoint: watermark=${snapshot.maxEventId} -->`);
  for (const g of snapshot.newGates) {
    lines.push(`<!-- journal-gate: id=${g.eventId} -->`);
  }
  for (const b of snapshot.otherBlockers) {
    lines.push(`<!-- journal-gate: id=${b.eventId} -->`);
  }
  lines.push("");

  lines.push(`### [${snapshot.timestamp}] Auto-Apply Observation Run${tag}`);
  lines.push("");

  // Section 1: Application Attempt & Progress Summary
  lines.push("#### 1. Application Attempts & Progress Summary");
  const totalEligible = snapshot.eligibleJobs.length;
  const submitted = snapshot.eligibleJobs.filter((j) => j.status === "submitted" || j.submittedAt !== null);
  const activeFilling = snapshot.eligibleJobs.filter((j) => j.status === "filling");
  const awaitingSubmit = snapshot.eligibleJobs.filter((j) => j.status === "awaiting_submit");
  const stalledInput = snapshot.eligibleJobs.filter((j) => j.status === "needs_input");
  const failedOrManual = snapshot.eligibleJobs.filter((j) => j.status === "failed" || j.status === "needs_manual");

  lines.push(`- **Auto-Approved Applications in Scope**: ${totalEligible}`);
  lines.push(`- **Completed Submissions**: ${submitted.length}`);
  lines.push(`- **Actively Filling in Browser**: ${activeFilling.length}`);
  lines.push(`- **Awaiting Submission Confirmation**: ${awaitingSubmit.length}`);
  lines.push(`- **Stalled on Candidate Input Gates**: ${stalledInput.length}`);
  if (failedOrManual.length > 0) {
    lines.push(`- **Technical Failures / Manual Intervention**: ${failedOrManual.length}`);
  }
  lines.push("");

  // Bounded progress table (active or touched in this scope)
  if (snapshot.activeOrRecentJobs.length > 0) {
    lines.push("| Job ID | Company | Role | Current Status | Fill Started | Submitted |");
    lines.push("| :--- | :--- | :--- | :--- | :--- | :--- |");
    for (const j of snapshot.activeOrRecentJobs) {
      lines.push(
        `| #${j.jobId} | ${j.company} | ${j.title} | \`${j.status}\` | ${j.firstFillAt} | ${j.submittedAt ?? "—"} |`
      );
    }
    lines.push("");
  }

  // Section 2: Observed Candidate-Input Question Gates
  lines.push("#### 2. Observed Candidate-Input Question Gates");
  if (snapshot.newGates.length === 0) {
    lines.push("No new candidate question gates observed during this interval.");
    lines.push("");
  } else {
    lines.push(
      "The following form questions required candidate input that could not be answered automatically from `profile/personal.yml` or `profile/answers.md`:"
    );
    lines.push("");

    for (const g of snapshot.newGates) {
      const statusLabel =
        g.resolutionStatus === "pending"
          ? "Currently pending candidate input (blocking application)"
          : "Historical / no longer currently pending (outcome unverified; do not infer resolved in KB)";

      lines.push(`##### Job #${g.jobId} — ${g.company} (\`${g.title}\`)`);
      lines.push(`- **Event**: Gate Event #${g.eventId} at ${g.at}`);
      lines.push(`- **Resolution**: ${statusLabel}`);
      lines.push(`- **Category**: ${g.category}`);
      lines.push(`- **Question Evidence (Verbatim)**:`);
      lines.push("  ```text");
      for (const qLine of g.rawQuestion.split("\n")) {
        lines.push(`  ${qLine}`);
      }
      lines.push("  ```");
      lines.push("");
    }
  }

  // Section 3: Candidate Input Themes (Cumulative across distinct applications)
  lines.push("#### 3. Candidate Input Themes (Cumulative across distinct applications)");
  const themeEntries = Object.entries(snapshot.themeCounts);
  if (themeEntries.length === 0) {
    lines.push("No candidate input themes recorded in auto-apply history.");
    lines.push("");
  } else {
    lines.push(
      "Theme counts represent distinct applications requiring candidate input (cumulative across checks):"
    );
    lines.push("");
    for (const [category, { count, suggestion }] of themeEntries) {
      const label = count === 1 ? "(1 application affected)" : `(${count} applications affected — recurring)`;
      lines.push(`- **${category}** ${label}`);
      lines.push(`  - *Guidance Suggestion*: ${suggestion}`);
    }
    lines.push("");
  }

  // Section 4: Other Non-KB Blockers
  if (snapshot.otherBlockers.length > 0) {
    lines.push("#### 4. Non-KB Blockers & ATS Anomalies");
    for (const b of snapshot.otherBlockers) {
      lines.push(`- **Job #${b.jobId} (${b.company})** [Event #${b.eventId}]: ${b.detail}`);
    }
    lines.push("");
  }

  // Section 5: Current Unresolved Stalls (Active Queue)
  if (snapshot.currentlyStalled.length > 0) {
    lines.push("#### 5. Active Stalls Requiring Attention");
    for (const s of snapshot.currentlyStalled) {
      lines.push(
        `- **Job #${s.jobId}** (${s.company} - \`${s.title}\`): Waiting since ${s.stalledSince}. ${s.reason}`
      );
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

export function runMonitor(options: CliOptions): Promise<MonitorResult> {
  // The work is synchronous; the promise keeps failures surfacing as rejections for callers.
  return new Promise((resolveResult) => {
    resolveResult(monitorOnce(options));
  });
}

function monitorOnce(options: CliOptions): MonitorResult {
  if (!existsSync(options.dbPath)) {
    throw new Error(`Database file not found at: ${options.dbPath}`);
  }

  const db = openDatabase(options.dbPath, "readonly");
  try {
    const state = loadState(options.statePath, options.journalPath);
    const existingContent = existsSync(options.journalPath)
      ? readFileSync(options.journalPath, "utf8")
      : "";

    const { snapshot, newState } = observeAutoApplyActivity(db, state, existingContent);

    if (!snapshot || !newState) {
      const msg = "No new eligible auto-apply fill activity detected; journal unchanged.";
      if (!options.silent) {
        console.log(msg);
      }
      return { changed: false, message: msg };
    }

    // Check if entry with this watermark was already written to the journal (prior crash recovery)
    const marker = `<!-- journal-checkpoint: watermark=${snapshot.maxEventId} -->`;
    if (existingContent.includes(marker)) {
      // Sync state without duplicating journal entry
      saveState(options.statePath, newState);
      const msg = `Synced state checkpoint (watermark: ${snapshot.maxEventId}) without duplicating journal.`;
      if (!options.silent) {
        console.log(msg);
      }
      return { changed: true, message: msg };
    }

    const entry = formatJournalEntry(snapshot);
    updateJournalFile(options.journalPath, entry);
    saveState(options.statePath, newState);

    const msg = `Journal updated successfully. Scope: ${snapshot.eligibleJobs.length} eligible applications, ${snapshot.newGates.length} new question gates observed.`;
    if (!options.silent) {
      console.log(msg);
    }
    return { changed: true, message: msg };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  try {
    const options = parseCliArgs(process.argv);
    if (options.help) {
      console.log(`Auto-Apply Stalls & Submissions Journal Monitor

Usage:
  bun scripts/journal-stalls.ts [options]

Options:
  --db <path>        Path to app.db SQLite database (default: data/app.db)
  --journal <path>   Path to output markdown journal (default: reports/auto-apply-journal.md)
  --state <path>     Path to incremental state JSON (default: data/auto-apply-journal-state.json)
  --silent, -q       Suppress informational console output
  --help, -h         Show this help message
`);
      process.exit(0);
    }

    await runMonitor(options);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
