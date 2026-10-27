// Auto apply: the rules under which the app gives an approval itself instead of waiting for the user
// (`approval: auto`). Gate 1 is decided here, from what prep reported; gate 2 follows `approval` for
// every job. Anything the rules do not clear lands in To review exactly as before.
import { config, describing } from "./config";
import type { Job } from "./db";
import { employerListing } from "./employers";
import { needsJudgment, parsePracticeAssessment, practiceReason, practiceRefusal } from "./practice";
import { evaluate, type Verdict } from "./rubric";

export const autoApply = () => ({
  minScore: 80,
  allowConcerns: false,
  perDay: 5,
  perEmployer: Infinity,
  ...config.autoApply,
  enabled: config.approval === "auto",
});

// Why auto apply must not take a job on this assessment, or null. While target employers are held
// back only a proven practice job may be approved; otherwise the employer must still have been judged.
function employerRefusal(assessment: ReturnType<typeof parsePracticeAssessment>): string | null {
  if (config.targets.holdBack) {
    const refusal = practiceRefusal(assessment, describing());
    return refusal && `not a practice job: ${refusal}`;
  }
  if (!assessment || needsJudgment(assessment, describing())) return "the employer has not been judged under the current rules";
  return null;
}

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
export function autoApproval(
  verdict: Verdict,
  facts: { concerns: string | null; handPicked: boolean; approvedToday: number; employerApplications?: number },
): AutoApprovalResult {
  const rules = autoApply();
  if (!rules.enabled) return { approve: false, note: null };
  const review = (why: string) => ({ approve: false, note: `needs your review: ${why}` });
  // A job the user sent back or picked out by hand is one they are watching.
  if (facts.handPicked) return review("you asked for this one yourself");
  if (verdict.decision !== "apply") return review(verdict.reason);

  // Independently of the verdict, the employer evidence must allow it.
  const refusal = employerRefusal(verdict.practice);
  if (refusal) return review(refusal);

  if (verdict.score < rules.minScore) return review(`score ${verdict.score} is below the auto-apply bar of ${rules.minScore}`);
  const unclear = verdict.items.filter(i => i.phase === verdict.rubric && i.required && i.answer === "unclear");
  if (unclear.length) return review(`the posting does not settle: ${unclear.map(i => i.label).join(", ")}`);
  if (!rules.allowConcerns && facts.concerns?.trim()) return review("the assessment raised concerns");
  const others = facts.employerApplications ?? 0;
  if (others >= rules.perEmployer) return review(employerCapNote(others));
  if (facts.approvedToday >= rules.perDay) {
    return {
      approve: false,
      note: `needs your review: auto apply has used its ${rules.perDay} for today`,
      deferred: "daily_cap",
    };
  }
  return { approve: true, note: null };
}

export const employerCapNote = (others: number) =>
  `already applying to ${others} other role${others === 1 ? "" : "s"} at this employer (auto apply allows ${autoApply().perEmployer})`;

export type ReconsiderJob = Pick<
  Job,
  "status" | "approved_by" | "checklist" | "practice_assessment" | "resume_sha" | "resume_frozen_at" | "submitted_at" | "concerns"
> & { id?: number; company?: string };

export interface ReconsiderFacts {
  handPicked: boolean;
  approvedToday: number;
  employerApplications?: number;
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

  if (facts.handPicked) return deny("you asked for this one yourself");
  if (job.approved_by !== null) return deny(`job already approved by ${job.approved_by}`);
  if (job.resume_sha || job.resume_frozen_at) return deny("job resume is already frozen");
  if (job.submitted_at || job.status === "submitted") return deny("job is already submitted");
  if (job.status !== "awaiting_approval") return deny(`job status is ${job.status}, expected awaiting_approval`);

  const practice = storedAssessment(job);
  const refusal = employerRefusal(practice);
  if (refusal) return deny(refusal);

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
    ...(facts.employerApplications === undefined ? {} : { employerApplications: facts.employerApplications }),
  });

  return {
    approved: approval.approve,
    verdict,
    approval,
    reason: approval.approve ? null : approval.note,
  };
}

// Whether the fill worker stops for gate 2 on this job: always when approval is gated. Otherwise an
// application is sent without asking, except one auto apply approved that, while target employers are
// held back, no longer proves a practice job.
export function confirmsSubmit(job: { approved_by: string | null; company?: string; practice_assessment?: string | null }): boolean {
  if (config.approval !== "auto") return true;
  if (job.approved_by === "auto" && config.targets.holdBack && !practiceReason(storedAssessment(job), describing())) return true;
  return false;
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
  if (job.approved_by !== "auto" || !config.targets.holdBack) {
    return { ok: true };
  }
  const assessment = storedAssessment(job);
  const refusal = practiceRefusal(assessment, describing());
  if (!refusal) return { ok: true, reason: practiceReason(assessment, describing()) ?? "" };
  // An application already under way cannot be assessed again: its resume is frozen. When all its
  // assessment lacks is a judgment asked for since, it may carry on filling; confirmsSubmit still
  // sees that it does not qualify and stops it for the user before anything is sent.
  if (job.resume_sha && needsJudgment(assessment, describing()))
    return { ok: true, reason: "started before the practice rules asked for a judgment; final submit needs your confirmation" };
  return { ok: false, reason: `auto-approved, but not a practice job: ${refusal}` };
}
