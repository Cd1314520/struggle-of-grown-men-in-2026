import { existsSync } from "node:fs";
import { autoApply, reconsiderAutoApproval } from "./auto";
import { db, employerApplications, getJob, openedAt, kvDelete, kvEntries, kvGet, kvSet, logEvent, notifyJobChange, updateJob, writeJob } from "./db";
import { countOne, usedToday } from "./limits";
import { profileProblems } from "./profile";
import { workingPdf } from "./resume";
import { to } from "./status";

const DEFERRED_PREFIX = "auto.deferred.";
export const deferApproval = (jobId: number) => kvSet(`${DEFERRED_PREFIX}${jobId}`, new Date().toISOString());
export const forgetDeferredApproval = (jobId: number) => kvDelete(`${DEFERRED_PREFIX}${jobId}`);

export function pumpDeferredApprovals() {
  if (profileProblems().length > 0) return;
  const rules = autoApply();
  if (!rules.enabled) return;

  const limit = rules.perDay;
  if (usedToday("auto") >= limit) return;

  const opened = (key: string) => {
    const job = getJob(Number(key.slice(DEFERRED_PREFIX.length)) || 0);
    return job ? openedAt(job) : 0;
  };
  const rows = kvEntries(DEFERRED_PREFIX).sort((a, b) => opened(b.key) - opened(a.key));

  for (const row of rows) {
    if (usedToday("auto") >= limit) break;

    const idStr = row.key.slice(DEFERRED_PREFIX.length);
    const jobId = Number(idStr);
    if (!Number.isInteger(jobId) || jobId <= 0) {
      kvDelete(row.key);
      continue;
    }

    const job = getJob(jobId);
    if (!job) {
      kvDelete(row.key);
      continue;
    }

    const pdf = workingPdf(job.id);
    const hasFeedback = !!kvGet(`feedback.${job.id}`);
    const isFrozen = !!(job.resume_sha || job.resume_frozen_at);
    const isSubmitted = !!(job.submitted_at || job.status === "submitted");

    if (job.status !== "awaiting_approval" || job.approved_by !== null || hasFeedback || isFrozen || isSubmitted || !existsSync(pdf)) {
      kvDelete(row.key);
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
      db.transaction(() => {
        countOne("auto");
        writeJob(job.id, {
          ...to.approved("auto"),
          score: verdict.score,
          checklist: JSON.stringify(verdict.items),
          practice_assessment: verdict.practice ? JSON.stringify(verdict.practice) : null,
        });
        kvDelete(row.key);
      })();
      notifyJobChange(job.id);
      logEvent("auto", `Approved by reconsidered auto apply: ${verdict.reason}`, job.id, "prep");
    } else {
      if (result.approval.deferred === "daily_cap") {
        break;
      } else {
        kvDelete(row.key);
        if (result.approval.note || result.reason) {
          updateJob(job.id, { note: result.approval.note ?? `needs your review: ${result.reason}` });
        }
      }
    }
  }
}
