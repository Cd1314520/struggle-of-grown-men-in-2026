import { existsSync } from "node:fs";
import { autoApply, reconsiderAutoApproval } from "./auto";
import { db, deferredJobs, employerApplications, logEvent, moveJob, notifyJobChange, openedAt, updateJob } from "./db";
import { countOne, usedToday } from "./limits";
import { profileProblems } from "./profile";
import { workingPdf } from "./resume";
import { applicationStarted, to } from "./status";

export const deferApproval = (jobId: number) => {
  updateJob(jobId, { deferred_at: new Date().toISOString() });
};
export const forgetDeferredApproval = (jobId: number) => {
  updateJob(jobId, { deferred_at: null });
};

export function pumpDeferredApprovals() {
  if (profileProblems().length > 0) return;
  const rules = autoApply();
  if (!rules.enabled) return;

  const limit = rules.perDay;
  if (usedToday("auto") >= limit) return;

  const rows = deferredJobs().sort((a, b) => openedAt(b) - openedAt(a));

  for (const job of rows) {
    if (usedToday("auto") >= limit) break;

    const pdf = workingPdf(job.id);

    if (job.status !== "awaiting_approval" || job.approved_by !== null || job.hand_picked === 1 || applicationStarted(job) || !existsSync(pdf)) {
      forgetDeferredApproval(job.id);
      continue;
    }

    const result = reconsiderAutoApproval(job, {
      concerns: job.concerns,
      handPicked: false,
      approvedToday: usedToday("auto"),
      employerApplications: employerApplications(job),
    });

    if (result.approved && result.verdict) {
      const verdict = result.verdict;
      const moved = db.transaction(() => {
        const ok = moveJob(
          job.id,
          "awaiting_approval",
          {
            ...to.approved("auto"),
            score: verdict.score,
            checklist: JSON.stringify(verdict.items),
            practice_assessment: verdict.practice ? JSON.stringify(verdict.practice) : null,
            deferred_at: null,
          },
          { quiet: true },
        );
        if (ok) countOne("auto");
        return ok;
      })();
      if (!moved) continue;
      notifyJobChange(job.id);
      logEvent("auto", `Approved by reconsidered auto apply: ${verdict.reason}`, job.id, "prep");
    } else {
      if (result.approval.deferred === "daily_cap") {
        break;
      } else {
        forgetDeferredApproval(job.id);
        if (result.approval.note || result.reason) {
          updateJob(job.id, { note: result.approval.note ?? `needs your review: ${result.reason}` });
        }
      }
    }
  }
}
