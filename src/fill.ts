// Fill: one worker drives one browser through one application, from the frozen resume to a recorded outcome.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { checkAutoApprovedPractice } from "./auto";
import { browserSlot, config, jobDir, readProfile } from "./config";
import { jobsWithCheckpoint, logEvent, updateJob, type Job } from "./db";
import { endVerification, isSubmitting, isVerifying, rememberSlot } from "./fill-state";
import { ownsFill, stopFailedFill, type FillRuntime, type FillSession } from "./fill-session";
import { fillTools } from "./fill-tools";
import * as gmail from "./gmail";
import { parkGate, readCheckpoint, recordCheckpoint, resumeContext } from "./questions";
import { freezeResume, frozenResume } from "./resume";
import { to } from "./status";
import { render } from "./worker-tools";

// What the worker is told about where this application stands.
const VERIFY_BRIEF =
  "VERIFICATION-ONLY MODE. Final submission was authorized previously, but its outcome is ambiguous. Your ONLY task is to check whether this application was already submitted or is still an unsubmitted draft. Sign in with existing credentials and check the candidate portal/status or confirmation email. NEVER submit, authorize, or click final submit. A checkpoint or form does NOT prove non-submission; require explicit portal status or validation error. Call verify_status to record evidence, or need_manual if inconclusive.";
const RESUME_BRIEF =
  "RESUMING an application. Recover the exact requisition and check if an account or draft exists. A frozen resume or checkpoint is navigation history, NOT proof that an ATS account or draft exists on the site. Previous handoff notes in resumeContext.handoffHistory are historical observations, NOT binding directives; current instructions and live site evidence supersede intermediate assumptions. Look at the earliest/oldest handoff to identify the true root failure. If the earliest failure occurred before account creation (e.g. outage or 302 before registration) and the site confirms no account exists, create credentials with get_account (register: true) and proceed with the first application. If remote signup never finished or this is the first application after pre-draft outage, permit initial registration with previously stored credentials or new account. If identity cannot be verified, call need_manual.";
const FIRST_BRIEF = "First fill for this application. Open the exact posting and record the draft/requisition identity.";
const SUBMIT_RULE =
  "- **Before final submit:** re-observe and verify all fields, take a full-page screenshot, then call `confirm_submit` with an exact summary and current navigation checkpoint. Click only if it returns APPROVED. An unused approval is valid only for the unchanged summary. Immediate post-click verification challenges (email codes or CAPTCHAs) continue this pending attempt; complete them using challenge controls. Any other uncertainty or requirement to click final application submit again requires `need_manual`; never click final application submit a second time.";

export async function fill(rt: FillRuntime, job: Job, session: FillSession) {
  const { slot } = session;
  const isVerification = isVerifying(job.id);
  if (isSubmitting(job.id) && !isVerification) {
    updateJob(job.id, to.filling());
    stopFailedFill(rt, session, "Runnable job still had a final-submit marker.");
    return;
  }
  if (!isVerification) {
    const guard = checkAutoApprovedPractice(job);
    if (!guard.ok) {
      session.active = false;
      const note = `needs your review: ${guard.reason ?? "invalid practice assessment"}`;
      updateJob(job.id, to.held(note));
      logEvent("auto", `Early fill guard: held auto-approved job #${job.id} (${guard.reason})`, job.id, "fill");
      return;
    }
  }
  updateJob(job.id, to.filling());
  const dir = jobDir(job.id);
  const browser = browserSlot(slot);
  const context = resumeContext(job.id);
  rememberSlot(job.id, slot);
  const frozen = job.resume_sha ? frozenResume(job.id, job.resume_sha) : freezeResume(job.id);
  if (context.checkpoint?.resumeSha && context.checkpoint.resumeSha !== frozen.sha)
    throw new Error("checkpoint resume SHA does not match the frozen application resume");
  session.checkpoint = { ...session.checkpoint, slot, resumeSha: frozen.sha };
  updateJob(job.id, { resume_sha: frozen.sha, resume_frozen_at: job.resume_frozen_at ?? new Date().toISOString() });
  recordCheckpoint(job.id, session.checkpoint);
  const mailbox = gmail.gmailStatus().address ?? "";
  for (const answer of context.answers) {
    if (answer.kind === "cover_letter") writeFileSync(join(dir, "cover_letter.txt"), answer.answer + "\n");
  }
  await rt.browser.ensureChrome(slot);
  if (!ownsFill(rt, session)) return;
  const protectedTabs = new Set<string>();
  const excludedTargets = new Set<string>();
  for (const row of jobsWithCheckpoint()) {
    const checkpoint = readCheckpoint(row.id);
    if (checkpoint?.slot === slot && checkpoint.tabId) {
      protectedTabs.add(checkpoint.tabId);
      if (row.id !== job.id) excludedTargets.add(checkpoint.tabId);
    }
  }
  await rt.browser.pruneTabs(slot, 5, protectedTabs);
  if (!ownsFill(rt, session)) return;
  const jobBrowser = await rt.browser.prepareJobBrowser(slot, session.checkpoint.tabId, excludedTargets);
  session.browser = jobBrowser;
  if (!ownsFill(rt, session)) return;
  session.checkpoint = {
    ...session.checkpoint,
    tabId: session.browser.tabId,
    url: session.browser.reused ? session.checkpoint.url : null,
    savedAt: new Date().toISOString(),
  };
  recordCheckpoint(job.id, session.checkpoint);
  const tools = fillTools(rt, { job, session, dir, mailbox, isVerification, jobBrowser });
  session.handle = rt.runWorker({
    name: "fill",
    builtins: ["read", "write", "eval"],
    jobId: job.id,
    model: config.models.fill,
    cwd: dir,
    browser: true,
    cdpPort: session.browser.port,
    maxTime: isVerification ? "10m" : "24h",
    env: { DISPLAY: browser.display },
    prompt: render("fill", {
      ...job,
      resumePdf: frozen.pdf,
      mailbox,
      personal: readProfile("personal.yml"),
      answers: readProfile("answers.md"),
      resumeContext: JSON.stringify(context, null, 2),
      browserTabId: session.browser.tabId,
      continuationNote: job.note ?? "(none)",
      recovery: isVerification ? VERIFY_BRIEF : job.resume_sha || context.checkpoint ? RESUME_BRIEF : FIRST_BRIEF,
      description: job.description || "(not captured; read it from the URL)",
      captchaAttempts: 3,
      approval:
        job.approved_by === "auto"
          ? "Approved by the candidate's standing auto-apply rules; they have not reviewed this application."
          : "The candidate has reviewed and approved this application.",
      submitRule: SUBMIT_RULE,
    }),
    tools,
  });
  const result = await session.handle.done;
  if (isVerification) {
    if (session.active) {
      parkGate(
        job.id,
        {
          kind: "submission_ambiguous",
          text: `Verification worker ended without conclusive evidence (${result.error ?? result.status}).`,
        },
        session.checkpoint,
      );
      endVerification(job.id);
      session.active = false;
    }
    return;
  }
  stopFailedFill(rt, session, `Worker ended without a verified outcome (${result.error ?? result.status}).`);
}
