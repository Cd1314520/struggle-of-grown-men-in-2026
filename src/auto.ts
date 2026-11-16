import { config, describing } from "./config";
import { employerApplications, employerRejectionAfterInterview, type Job } from "./db";
import { employerListing } from "./employers";
import { needsJudgment, parsePracticeAssessment, practiceReason, practiceRefusal } from "./practice";
import { evaluate, type Verdict } from "./rubric";

export const autoApply = () => ({
  minScore: 80,
  allowConcerns: false,
  perDay: 5,
  perEmployer: Infinity,
  cooldownDays: 180,
  ...config.autoApply,
  enabled: config.approval === "auto",
});

function employerRefusal(assessment: ReturnType<typeof parsePracticeAssessment>): string | null {
  if (config.targets.holdBack) {
    const refusal = practiceRefusal(assessment, describing());
    return refusal && `not a practice job: ${refusal}`;
  }
  if (!assessment || needsJudgment(assessment, describing())) return "the employer has not been judged under the current rules";
  return null;
}

function storedAssessment(job: { company?: string; practice_assessment?: string | null }) {
  const assessment = parsePracticeAssessment(job.practice_assessment);
  return assessment && job.company !== undefined ? { ...assessment, listed: employerListing(job.company) } : assessment;
}

// `autoApply.lowerBar`: a job below minScore still goes when it scores at least lowerBar.minScore and its
// rubric answers "yes" to any of the criteria named in lowerBar.anyOf (ids in profile/rubric.yml, such as
// texas or startup).
type LowerBar = { minScore: number; anyOf: string[] } | undefined;
function underLowerBar(verdict: Verdict, bar: LowerBar): boolean {
  if (!bar || verdict.score < bar.minScore) return false;
  return verdict.items.some(i => i.phase === verdict.rubric && i.answer === "yes" && bar.anyOf.includes(i.key.slice(i.key.indexOf(".") + 1)));
}

export interface AutoApprovalResult {
  approve: boolean;
  note: string | null;
  deferred?: "daily_cap" | "employer";
}

export function autoApproval(
  verdict: Verdict,
  facts: { concerns: string | null; handPicked: boolean; approvedToday: number; employerHold?: string | null },
): AutoApprovalResult {
  const rules = autoApply();
  if (!rules.enabled) return { approve: false, note: null };
  const review = (why: string) => ({ approve: false, note: `needs your review: ${why}` });
  if (facts.handPicked) return review("you asked for this one yourself");
  if (verdict.decision !== "apply") return review(verdict.reason);

  const refusal = employerRefusal(verdict.practice);
  if (refusal) return review(refusal);

  if (verdict.score < rules.minScore && !underLowerBar(verdict, rules.lowerBar))
    return review(`score ${verdict.score} is below the auto-apply bar of ${rules.minScore}`);
  const unclear = verdict.items.filter(i => i.phase === verdict.rubric && i.required && !i.unclearOk && i.answer === "unclear");
  if (unclear.length) return review(`the posting does not settle: ${unclear.map(i => i.label).join(", ")}`);
  if (!rules.allowConcerns && facts.concerns?.trim()) return review("the assessment raised concerns");
  if (facts.employerHold) return { ...review(facts.employerHold), deferred: "employer" };
  if (facts.approvedToday >= rules.perDay) {
    return {
      approve: false,
      note: `needs your review: auto apply has used its ${rules.perDay} for today`,
      deferred: "daily_cap",
    };
  }
  return { approve: true, note: null };
}

export function employerHold(job: Pick<Job, "id" | "company_key">): string | null {
  const rules = autoApply();
  const others = employerApplications(job);
  if (others >= rules.perEmployer)
    return `already applying to ${others} other role${others === 1 ? "" : "s"} at this employer (auto apply allows ${rules.perEmployer})`;
  const rejected = employerRejectionAfterInterview(job, rules.cooldownDays);
  if (rejected) return `this employer turned you down after interviewing on ${rejected.slice(0, 10)} (auto apply waits ${rules.cooldownDays} days)`;
  return null;
}

export type ReconsiderJob = Pick<
  Job,
  "status" | "approved_by" | "checklist" | "practice_assessment" | "resume_sha" | "resume_frozen_at" | "submitted_at" | "concerns"
> & { id?: number; company?: string };

export interface ReconsiderFacts {
  handPicked: boolean;
  approvedToday: number;
  employerHold?: string | null;
  concerns?: string | null;
}

export interface ReconsiderResult {
  approved: boolean;
  verdict: Verdict | null;
  approval: AutoApprovalResult;
  reason: string | null;
}

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
    ...(facts.employerHold === undefined ? {} : { employerHold: facts.employerHold }),
  });

  return {
    approved: approval.approve,
    verdict,
    approval,
    reason: approval.approve ? null : approval.note,
  };
}

export function confirmsSubmit(job: { approved_by: string | null; company?: string; practice_assessment?: string | null }): boolean {
  if (config.approval !== "auto") return true;
  if (job.approved_by === "auto" && config.targets.holdBack && !practiceReason(storedAssessment(job), describing())) return true;
  return false;
}

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
  if (job.resume_sha && needsJudgment(assessment, describing()))
    return { ok: true, reason: "started before the practice rules asked for a judgment; final submit needs your confirmation" };
  return { ok: false, reason: `auto-approved, but not a practice job: ${refusal}` };
}
