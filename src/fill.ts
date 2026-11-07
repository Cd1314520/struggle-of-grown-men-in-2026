import { writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { checkAutoApprovedPractice } from "./auto";
import { browserSlot, config, jobDir, readProfile } from "./config";
import { isCapacityError } from "./errors";
import { jobsWithCheckpoint, logEvent, updateJob, type Job } from "./db";
import { endVerification, isSubmitting, isVerifying, queueDraftRecovery, rememberSlot } from "./fill-state";
import { endSession, ownsFill, stopFailedFill, type FillRuntime, type FillSession } from "./fill-session";
import { fillTools, prefillTool } from "./fill-tools";
import * as gmail from "./gmail";
import { buildFacts } from "./prefill";
import { getOpenGate, parkGate, readCheckpoint, recordCheckpoint, resumeContext } from "./questions";
import { freezeResume, frozenResume } from "./resume";
import { isSettled, to, wasSent } from "./status";
import { fillTemplate } from "./template";
import { harnessOf } from "./worker";
import { deadEnd } from "./screen";
import { lowStakesRule, readPrompt, render, termsRule } from "./worker-tools";

const PREFILL_MODULE = join(import.meta.dir, "prefill.ts");

const VERIFY_BRIEF =
  "VERIFICATION-ONLY MODE. Final submission was authorized previously, but its outcome is ambiguous. Your ONLY task is to check whether this application was already submitted or is still an unsubmitted draft. Sign in with existing credentials and check the candidate portal/status or confirmation email. NEVER submit, authorize, or click final submit. A checkpoint or form does NOT prove non-submission; require explicit portal status or validation error. The site saying the attempt is still unfinished IS such evidence: a page still asking for the emailed verification code before the application is submitted, or the form returned with an error saying the CAPTCHA or human check failed. Record that with source 'portal' and status 'not_submitted', quoting the page; a normal fill then finishes the same draft. Call verify_status to record evidence, or need_manual if inconclusive.";
const RESUME_BRIEF =
  "RESUMING an application. Recover the exact requisition and check if an account or draft exists. A frozen resume or checkpoint is navigation history, NOT proof that an ATS account or draft exists on the site. Previous handoff notes in resumeContext.handoffHistory are historical observations, NOT binding directives; current instructions and live site evidence supersede intermediate assumptions. Look at the earliest/oldest handoff to identify the true root failure. If the earliest failure occurred before account creation (e.g. outage or 302 before registration) and the site confirms no account exists, create credentials with get_account (register: true) and proceed with the first application. If remote signup never finished or this is the first application after pre-draft outage, permit initial registration with previously stored credentials or new account. If identity cannot be verified, call need_manual.";
const FIRST_BRIEF = "First fill for this application. Open the exact posting and record the draft/requisition identity.";
const SUBMIT_RULE =
  "- **Before final submit:** re-observe and verify all fields, take a full-page screenshot, then call `confirm_submit` with an exact summary and current navigation checkpoint. Click only if it returns APPROVED. An unused approval is valid only for the unchanged summary. Immediate post-click verification challenges (email codes or CAPTCHAs) continue this pending attempt; complete them, clicking final application submit again when the site requires it to finish. Call `need_manual` only when you cannot tell whether the application was sent.";

export const PARKED_TABS = 8;

export function tabPlan(slot: number, jobId: number, limit = PARKED_TABS) {
  const keep = new Set<string>(),
    others = new Set<string>(),
    closing = new Map<string, number | null>();
  const parked: { tabId: string; jobId: number; savedAt: string }[] = [];
  for (const row of jobsWithCheckpoint()) {
    const checkpoint = readCheckpoint(row.id);
    if (checkpoint?.slot !== slot || !checkpoint.tabId) continue;
    const { tabId } = checkpoint;
    if (row.id !== jobId) others.add(tabId);
    const evidence = !wasSent(row) && (isSubmitting(row.id) || getOpenGate(row.id)?.kind === "submission_ambiguous");
    if (row.id === jobId || evidence) keep.add(tabId);
    else if (isSettled(row)) closing.set(tabId, null);
    else parked.push({ tabId, jobId: row.id, savedAt: checkpoint.savedAt });
  }
  parked.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  for (const [i, p] of parked.entries()) {
    if (i < limit) keep.add(p.tabId);
    else closing.set(p.tabId, p.jobId);
  }
  for (const tabId of keep) closing.delete(tabId);
  return { keep, closing, others };
}

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
  const portal = job.resume_sha ? null : deadEnd(job.url);
  if (portal) {
    session.active = false;
    updateJob(job.id, to.skipped(portal));
    logEvent("auto", `Skipped before filling: ${portal}`, job.id, "fill");
    return;
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
  const { keep: protectedTabs, closing, others: excludedTargets } = tabPlan(slot, job.id);
  const open = new Set((await rt.browser.tabs(slot)).map(tab => tab.id));
  await rt.browser.pruneTabs(slot, 5, protectedTabs, new Set(closing.keys()));
  for (const [tabId, parkedJob] of closing)
    if (parkedJob !== null && open.has(tabId))
      logEvent(
        "system",
        `Closed this application's parked browser tab to free memory (more than ${PARKED_TABS} are parked in its browser). It resumes from its saved answers and the site's draft.`,
        parkedJob,
        "fill",
      );
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
  const prefillFacts = join(dir, "prefill.json");
  writeFileSync(
    prefillFacts,
    JSON.stringify(buildFacts((YAML.parse(readProfile("personal.yml")) ?? {}) as Record<string, unknown>, mailbox, frozen.pdf), null, 1),
  );
  const onClaude = harnessOf(config.models.fill) === "claude-code";
  const ctx = { job, session, mailbox, isVerification, jobBrowser };
  const tools = fillTools(rt, ctx);
  if (onClaude) tools["prefill"] = prefillTool(rt, ctx, prefillFacts);
  const guide = onClaude ? "browser-claude" : "browser-omp";
  const vars = {
    ...job,
    resumePdf: frozen.pdf,
    mailbox,
    personal: readProfile("personal.yml"),
    answers: readProfile("answers.md"),
    resumeNotes: readProfile("resume-notes.md"),
    lowStakes: lowStakesRule(),
    terms: termsRule(),
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
    prefillModule: PREFILL_MODULE,
    prefillFacts,
  };
  session.handle = rt.runWorker({
    name: "fill",
    builtins: onClaude ? ["read", "write"] : ["read", "write", "eval"],
    jobId: job.id,
    model: config.models.fill,
    cwd: dir,
    browser: true,
    cdpPort: session.browser.port,
    maxTime: isVerification ? "10m" : "24h",
    env: { DISPLAY: browser.display },
    prompt: render("fill", { ...vars, browser: fillTemplate(readPrompt(guide), vars, `prompts/${guide}.md`).trimEnd() }),
    tools,
  });
  const result = await session.handle.done;
  const capacity = isCapacityError(result.error);
  if (isVerification) {
    if (session.active && capacity && ownsFill(rt, session)) {
      updateJob(job.id, to.verifyAgain(`verification stopped by model provider capacity; checking again (${result.error})`));
      endSession(session, "model provider at capacity; verification will retry");
    } else if (session.active) {
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
  if (capacity && !isSubmitting(job.id) && ownsFill(rt, session)) {
    updateJob(job.id, to.resumeFill(`Resuming the same draft: the model provider was at capacity (${result.error})`));
    queueDraftRecovery(job.id);
    endSession(session, "model provider at capacity; resuming the same draft");
    return;
  }
  stopFailedFill(rt, session, `Worker ended without a verified outcome (${result.error ?? result.status}).`);
}
