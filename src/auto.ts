// Auto apply: the rules under which the app gives an approval itself instead of waiting for the user.
// Gate 1 is decided here, from what prep reported; gate 2 follows `submit` for jobs approved this way.
// Anything the rules do not clear lands in To review exactly as before.
import { config } from "./config";
import type { Job } from "./db";
import { employerListing } from "./employers";
import { needsJudgment, parsePracticeAssessment, practiceReason, practiceRefusal } from "./practice";
import { evaluate, type Verdict } from "./rubric";

export const autoApply = () => ({ enabled: false, phases: ["practice"], minScore: 80, allowConcerns: false, perDay: 5, submit: false, ...config.autoApply });

// A stored assessment read against the candidate's employer lists as they stand now: an employer
// moved onto the frontier list since the job was assessed is no longer spent on practice.
function storedAssessment(job: { company?: string; practice_assessment?: string | null }) {
  const assessment = parsePracticeAssessment(job.practice_assessment);
  return assessment && job.company !== undefined ? { ...assessment, listed: employerListing(job.company) } : assessment;
}

export interface AutoApprovalResult {
  approve: boolean;
  note: string | null;
  deferred?: "daily_cap";
}

// Whether a freshly prepped job may skip gate 1. `note` says why not, for the job's page.
export function autoApproval(verdict: Verdict, facts: { concerns: string | null; handPicked: boolean; approvedToday: number }): AutoApprovalResult {
  const rules = autoApply();
  if (!rules.enabled) return { approve: false, note: null };
  const review = (why: string) => ({ approve: false, note: `needs your review: ${why}` });
  if (!rules.phases.includes(config.phase)) return review(`auto apply is off in the ${config.phase} phase`);
  // A job the user sent back or picked out by hand is one they are watching.
  if (facts.handPicked) return review("you asked for this one yourself");
  if (verdict.decision !== "apply") return review(verdict.reason);

  // In practice mode, independently require positive practice evidence
  const refusal = config.phase === "practice" ? practiceRefusal(verdict.practice) : null;
  if (refusal) return review(`not a practice job: ${refusal}`);

  if (verdict.score < rules.minScore) return review(`score ${verdict.score} is below the auto-apply bar of ${rules.minScore}`);
  const unclear = verdict.items.filter(i => i.phase === config.phase && i.required && i.answer === "unclear");
  if (unclear.length) return review(`the posting does not settle: ${unclear.map(i => i.label).join(", ")}`);
  if (!rules.allowConcerns && facts.concerns?.trim()) return review("the assessment raised concerns");
  if (facts.approvedToday >= rules.perDay) {
    return {
      approve: false,
      note: `needs your review: auto apply has used its ${rules.perDay} for today`,
      deferred: "daily_cap",
    };
  }
  return { approve: true, note: null };
}

export type ReconsiderJob = Pick<
  Job,
  "status" | "approved_by" | "checklist" | "practice_assessment" | "resume_sha" | "resume_frozen_at" | "submitted_at" | "concerns"
> & { id?: number; company?: string };

export interface ReconsiderFacts {
  handPicked: boolean;
  approvedToday: number;
  concerns?: string | null;
}

export interface ReconsiderResult {
  approved: boolean;
  verdict: Verdict | null;
  approval: AutoApprovalResult;
  reason: string | null;
}

/**
 * Pure helper to reconsider auto-approval for a deferred / eligible job.
 * Re-evaluates persisted checklist JSON against current rubric and validates persisted practice assessment.
 * Fails closed on malformed checklist, stale qualifications, non-qualifying practice evidence,
 * or manual / frozen / submitted job state.
 */
export function reconsiderAutoApproval(job: ReconsiderJob, facts: ReconsiderFacts): ReconsiderResult {
  const deny = (reason: string, approvalNote?: string | null): ReconsiderResult => ({
    approved: false,
    verdict: null,
    approval: { approve: false, note: approvalNote !== undefined ? approvalNote : `needs your review: ${reason}` },
    reason,
  });

  const rules = autoApply();
  if (!rules.enabled) return deny("auto apply is disabled", null);
  if (!rules.phases.includes(config.phase)) return deny(`auto apply is off in the ${config.phase} phase`);

  if (facts.handPicked) return deny("you asked for this one yourself");
  if (job.approved_by !== null) return deny(`job already approved by ${job.approved_by}`);
  if (job.resume_sha || job.resume_frozen_at) return deny("job resume is already frozen");
  if (job.submitted_at || job.status === "submitted") return deny("job is already submitted");
  if (job.status !== "awaiting_approval") return deny(`job status is ${job.status}, expected awaiting_approval`);

  let practice = null;
  if (config.phase === "practice") {
    practice = storedAssessment(job);
    const refusal = practiceRefusal(practice);
    if (refusal) return deny(`not a practice job: ${refusal}`);
  }

  if (!job.checklist?.trim()) return deny("job checklist is missing");
  const raw: { id: string; answer: string; evidence?: string }[] = [];
  try {
    const parsed: unknown = JSON.parse(job.checklist.trim());
    if (!Array.isArray(parsed) || parsed.length === 0) return deny("malformed checklist: expected non-empty array");
    const seenKeys = new Set<string>();
    for (const item of parsed) {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return deny("malformed checklist item: expected object");
      }
      const record = item as Record<string, unknown>;
      if (typeof record["key"] !== "string" || !record["key"].trim()) {
        return deny("malformed checklist item: missing or invalid key");
      }
      const key = record["key"].trim();
      if (seenKeys.has(key)) {
        return deny(`malformed checklist: duplicate key ${key}`);
      }
      seenKeys.add(key);

      if (record["answer"] !== "yes" && record["answer"] !== "no" && record["answer"] !== "unclear") {
        return deny(`malformed checklist item: invalid answer for ${key}`);
      }

      if (typeof record["evidence"] !== "string") {
        return deny(`malformed checklist item: invalid evidence for ${key}`);
      }

      raw.push({
        id: key,
        answer: record["answer"],
        evidence: record["evidence"],
      });
    }
  } catch {
    return deny("malformed checklist: invalid JSON");
  }

  const evalResult = evaluate(raw, practice);
  if (typeof evalResult === "string") return deny(`rubric re-evaluation failed: ${evalResult}`);
  const verdict = evalResult;

  const approval = autoApproval(verdict, {
    concerns: facts.concerns ?? job.concerns ?? null,
    handPicked: false,
    approvedToday: facts.approvedToday,
  });

  return {
    approved: approval.approve,
    verdict,
    approval,
    reason: approval.approve ? null : approval.note,
  };
}

// Whether the fill worker stops for gate 2 on this job.
export function confirmsSubmit(job: { approved_by: string | null; company?: string; practice_assessment?: string | null }): boolean {
  // Manual or non-auto approvals preserve global flag semantics.
  if (job.approved_by !== "auto") {
    return config.confirmBeforeSubmit;
  }

  // Auto-approved job:
  // In practice phase, fail closed if stored practice assessment is missing, malformed,
  // or does not qualify, regardless of config.confirmBeforeSubmit.
  if (config.phase === "practice") {
    const assessment = storedAssessment(job);
    if (!assessment || !practiceReason(assessment)) {
      return true;
    }
  }

  // For valid auto-approved jobs:
  // Can only skip confirmation if autoApply is enabled, submit is enabled,
  // and the current phase is in rules.phases.
  const rules = autoApply();
  const canAutoSubmit = rules.enabled && rules.submit && rules.phases.includes(config.phase);

  return !canAutoSubmit;
}

// Early gate before freeze/navigation: re-check auto-approved practice jobs at fill start.
export function checkAutoApprovedPractice(job: {
  approved_by: string | null;
  company?: string;
  practice_assessment?: string | null;
  resume_sha?: string | null;
}): {
  ok: boolean;
  reason?: string;
} {
  if (job.approved_by !== "auto" || config.phase !== "practice") {
    return { ok: true };
  }
  const assessment = storedAssessment(job);
  const refusal = practiceRefusal(assessment);
  if (!refusal) return { ok: true, reason: practiceReason(assessment) ?? "" };
  // An application already under way cannot be assessed again: its resume is frozen. When all its
  // assessment lacks is a judgment asked for since, it may carry on filling; confirmsSubmit still
  // sees that it does not qualify and stops it for the user before anything is sent.
  if (job.resume_sha && needsJudgment(assessment))
    return { ok: true, reason: "started before the practice rules asked for a judgment; final submit needs your confirmation" };
  return { ok: false, reason: `auto-approved, but not a practice job: ${refusal}` };
}
