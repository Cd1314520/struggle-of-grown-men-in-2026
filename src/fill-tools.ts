import { newPassword, normalizeTenantDomain, resolveAccount, saveResetPassword } from "./accounts";
import { CAUSE_GUIDE, recordBlocker, WORKER_CAUSES } from "./blockers";
import { connectTab } from "./cdp-tab";
import type { JobBrowser } from "./chrome";
import { db, logEvent, moveJob, notifyJobChange, type Job } from "./db";
import { errorMessage } from "./errors";
import { fillPhase, isSubmitting, refuseSubmit, resetFillPhase } from "./fill-state";
import {
  checkpointFrom,
  confirmSubmission,
  endSession,
  navigationFields,
  ownsFill,
  parkFill,
  stopFailedFill,
  type FillRuntime,
  type FillSession,
} from "./fill-session";
import { prefill } from "./prefill";
import { arg, S, schema, type HostTool, type ToolArgs } from "./worker";
import {
  cancelJobGates,
  evidenceProblem,
  findStoredAnswer,
  nextQueuedQuestion,
  queueQuestion,
  QUESTION_REASONS,
  resolveAmbiguityWithEvidence,
  type AmbiguityEvidence,
  type GateInput,
} from "./questions";
import { to } from "./status";
import { gmailTools } from "./worker-tools";

const tenantOf = (domain: string): string | { error: string } => {
  try {
    return normalizeTenantDomain(domain);
  } catch (err) {
    return { error: JSON.stringify({ error: "invalid_domain", message: errorMessage(err) }) };
  }
};

const STALE_WORKER = "ERROR: stale or parked fill worker; no action recorded.";

export interface FillContext {
  job: Job;
  session: FillSession;
  mailbox: string;
  isVerification: boolean;
  jobBrowser: JobBrowser;
}

async function verifyStatus(rt: FillRuntime, ctx: FillContext, args: ToolArgs): Promise<string> {
  const { job, session, isVerification } = ctx;
  if (!isVerification) return "ERROR: verify_status is only available during verification mode.";
  const outcome = arg.str(args, "outcome");
  const evidence = (arg.optStr(args, "evidence") ?? "").trim();
  if (evidence.length < 5) return "ERROR: detailed evidence text is required (minimum 5 characters).";

  if (outcome === "unresolved") {
    const cp = await checkpointFrom(rt, session, args).catch(() => session.checkpoint);
    return await parkFill(
      rt,
      session,
      {
        kind: "submission_ambiguous",
        text: `Verification inconclusive: ${evidence}`,
        context: evidence,
      },
      cp,
    );
  }

  const source = (arg.optStr(args, "source") ?? "") as AmbiguityEvidence["source"];
  const status = (arg.optStr(args, "status") ?? "") as AmbiguityEvidence["status"];
  const reqId = (arg.optStr(args, "requisition_id") ?? "").trim();
  const messageId = (arg.optStr(args, "message_id") ?? "").trim();
  if (!reqId) return "ERROR: exact non-empty requisition_id is required for verified resolution.";
  const cp = await checkpointFrom(rt, session, args);

  if (outcome !== "submitted" && outcome !== "not_submitted") return "ERROR: invalid outcome.";
  const problem = evidenceProblem(outcome, { source, status, messageId });
  if (problem) return `ERROR: ${problem}`;

  if (outcome === "submitted") {
    resolveAmbiguityWithEvidence(job.id, "submitted", {
      notes: `Verified submitted: ${evidence}`,
      requisitionId: reqId,
      source,
      status,
      ...(messageId ? { messageId } : {}),
      checkpoint: cp,
    });
    endSession(session, "verified as submitted");
    await session.handle?.done;
    return "Recorded: Application verified as submitted. Worker exiting.";
  }

  resolveAmbiguityWithEvidence(job.id, "not_submitted", {
    notes: `Verified unsubmitted draft: ${evidence}`,
    requisitionId: reqId,
    source,
    status,
    checkpoint: cp,
  });
  endSession(session, "verified as not submitted; draft requeued");
  await session.handle?.done;
  return "Recorded: Ambiguity resolved. Verified draft queued for normal fill with fresh confirm_submit required.";
}

const SKIPPED_FOR = {
  cover_letter: "a cover letter",
  references: "references",
  recording: "a recording the candidate must make",
  own_work: "work the candidate must produce",
  phone_code: "a code sent to the candidate's phone",
  personal_login: "a personal account the candidate must sign in to",
  hcaptcha: "an hCaptcha this machine cannot pass",
};
const SKIP_GUIDE =
  "What the form requires. cover_letter and references: as the task says. " +
  "recording: a video or audio recording of the candidate. " +
  "own_work: a portfolio file, work sample or take-home the candidate has not supplied, or an answer the employer says must be written without AI. " +
  "phone_code: a code texted or phoned to the candidate, or an authenticator app, with no email alternative. " +
  "personal_login: signing in to a personal account you have no credentials for (Google, LinkedIn, Microsoft, Apple). " +
  "hcaptcha: an hCaptcha that rejected every honest attempt allowed, or a form on jobs.lever.co.";
const SKIPPED_AFTER_SUBMIT = ["own_work", "phone_code", "hcaptcha"];

const causeParam = { type: "string", enum: WORKER_CAUSES, description: CAUSE_GUIDE };

const WHY_GUIDE =
  "Why you cannot answer this yourself. " +
  "agreement: an agreement or acknowledgement out of the ordinary, outside the terms rule. " +
  "fact_missing: a fact about the candidate that is in neither the candidate details nor the answer bank. " +
  "skill_not_on_resume: a skill, tool or experience question you cannot settle from the resume; rare, since these are answered from the resume. " +
  "free_text: a free-text question you cannot answer with a grounded, honest answer from the resume, the job description and the candidate details. " +
  "sensitive_id: a Social Security number, date of birth or other ID number. " +
  "history_detail: employment or education detail the resume does not give, such as supervisors, an employer's phone number or exact dates. " +
  "other: none of these.";

const askUserFields = {
  question: S.str("The form question verbatim, not including options"),
  context: S.str(
    "Verbatim answer-relevant surrounding form/legal text and constraints. Put job IDs, navigation and fill progress in checkpoint fields, not here, unless materially required by this question. Never omit answer-relevant wording.",
  ),
  options: { type: "array", items: { type: "string" }, description: "All current choices verbatim and in order, or [] for free text" },
  why: { type: "string", enum: QUESTION_REASONS, description: WHY_GUIDE },
  missing: S.str("Optional: the candidate detail or answer bank entry that would settle this question, so the candidate can add it once"),
  more: { type: "boolean", description: "true when other unknown questions on this page are still to be asked: record this one and keep going" },
  ...navigationFields,
};

export function fillTools(rt: FillRuntime, ctx: FillContext): Record<string, HostTool> {
  const { job, session, mailbox, isVerification, jobBrowser } = ctx;
  const { slot } = session;
  const resets = new Map<string, string>();
  const tools: Record<string, HostTool> = {
    ...gmailTools(),
    application_tabs: {
      description: "Get actual CDP tab IDs and sanitized navigation URLs owned by this application. Other parked/manual drafts are inaccessible.",
      parameters: schema({}),
      handler: async () =>
        JSON.stringify(
          (await rt.browser.tabs(slot))
            .filter(tab => jobBrowser.ownsTarget(tab.id))
            .flatMap(tab => {
              const url = new URL(tab.url);
              return ["http:", "https:"].includes(url.protocol) ? [{ tab_id: tab.id, title: tab.title, url: `${url.origin}${url.pathname}` }] : [];
            }),
        ),
    },
    checkpoint: {
      description: "Record navigation/draft identity after each page. This is NOT proof the ATS saved fields.",
      parameters: schema(navigationFields),
      handler: async args => (await checkpointFrom(rt, session, args), "Navigation checkpoint recorded; verify ATS persistence separately."),
    },
    get_account: {
      description: "Get the existing login, or create stored credentials on first use. A resumed application must use the same account.",
      parameters: schema(
        {
          domain: S.str("Site domain, e.g. acme.wd5.myworkdayjobs.com"),
          register: { type: "boolean", description: "Set true only if the site explicitly confirmed no existing account and registration is required" },
          password_min: S.int("With register: the shortest password the site's sign-up form accepts, when it states one"),
          password_max: S.int("With register: the longest password the site's sign-up form accepts, when it states one"),
        },
        ["domain"],
      ),
      handler: args => {
        const allowCreate = args["register"] === true && !isVerification && !isSubmitting(job.id);
        const min = arg.optInt(args, "password_min"),
          max = arg.optInt(args, "password_max");
        return resolveAccount(arg.str(args, "domain"), mailbox, allowCreate, { ...(min ? { min } : {}), ...(max ? { max } : {}) });
      },
    },
    reset_password: {
      description:
        "Get a new password for this site's own password reset form, once its reset link or code has come by email. Nothing is saved until you call password_reset_done.",
      parameters: schema(
        {
          domain: S.str("Site domain, exactly as for get_account"),
          password_min: S.int("The shortest password the reset form accepts, when it states one"),
          password_max: S.int("The longest password the reset form accepts, when it states one"),
        },
        ["domain"],
      ),
      handler: args => {
        const min = arg.optInt(args, "password_min"),
          max = arg.optInt(args, "password_max");
        const domain = tenantOf(arg.str(args, "domain"));
        if (typeof domain !== "string") return domain.error;
        const password = newPassword({ ...(min ? { min } : {}), ...(max ? { max } : {}) });
        resets.set(domain, password);
        logEvent("auto", `Password reset started for ${domain}`, job.id, "fill");
        return JSON.stringify({ email: mailbox, password, saved: false });
      },
    },
    password_reset_done: {
      description:
        "Save the password from reset_password as this site's login, once the site confirms it changed (it says so, or signing in with it works). Do not call it when the reset failed.",
      parameters: schema({ domain: S.str("Site domain, exactly as given to reset_password") }),
      handler: args => {
        const domain = tenantOf(arg.str(args, "domain"));
        if (typeof domain !== "string") return domain.error;
        const password = resets.get(domain);
        if (!password) return "ERROR: call reset_password for this domain first, and enter its password in the site's reset form.";
        resets.delete(domain);
        logEvent("auto", `Password reset saved for ${domain}`, job.id, "fill");
        return saveResetPassword(domain, mailbox, password);
      },
    },
    ask_user: {
      description:
        "Consult profile first; then get an exact scoped answer, or record the question. Every unknown question on the page goes in one batch: `more: true` records it and returns, the last one without `more` durably parks on all of them and terminates this worker.",
      parameters: schema(
        askUserFields,
        Object.keys(askUserFields).filter(key => key !== "missing"),
      ),
      handler: async args => {
        const options: unknown = args["options"];
        if (!Array.isArray(options) || !options.every((option): option is string => typeof option === "string"))
          return "ERROR: options must contain every current choice verbatim.";
        const why = arg.oneOf(args, "why", QUESTION_REASONS);
        const missing = arg.optStr(args, "missing")?.trim() || null;
        const input: GateInput = { kind: "question", text: arg.str(args, "question"), context: arg.str(args, "context"), options, why, missing };
        const answer = findStoredAnswer(job.id, input);
        if (answer !== null) return `Exact scoped candidate answer: ${answer}`;
        if (!ownsFill(rt, session)) throw new Error("stale fill worker");
        queueQuestion(job.id, input);
        if (args["more"] === true)
          return "Recorded. Leave this field blank, fill everything else you can on this page, and ask its other unknown questions; the last one without `more` parks the application on all of them.";
        return parkFill(rt, session, nextQueuedQuestion(job.id) ?? input, await checkpointFrom(rt, session, args));
      },
    },
    skip_application: {
      description:
        "Drop this application, unsubmitted, because it requires something the candidate does not give or this machine cannot do. Terminates the worker.",
      parameters: schema({
        requires: { type: "string", enum: Object.keys(SKIPPED_FOR), description: SKIP_GUIDE },
        note: S.str("The required field's label and the posting or form text that makes it required, or what the site showed"),
      }),
      handler: args => {
        const requires = arg.oneOf(args, "requires", Object.keys(SKIPPED_FOR) as (keyof typeof SKIPPED_FOR)[]);
        const refused = fillPhase(job.id) === "submitting" && SKIPPED_AFTER_SUBMIT.includes(requires);
        if (isVerification || (isSubmitting(job.id) && !refused)) return "ERROR: an authorized or ambiguous submission cannot be skipped; report it as usual.";
        const skipped = db.transaction(() => {
          if (!moveJob(job.id, "filling", to.skipped(`requires ${SKIPPED_FOR[requires]}: ${arg.str(args, "note")}`), { quiet: true })) return false;
          cancelJobGates(job.id);
          resetFillPhase(job.id);
          return true;
        })();
        if (!skipped) return STALE_WORKER;
        notifyJobChange(job.id);
        endSession(session, "application skipped by the worker");
        return "Recorded: application skipped. Stop now.";
      },
    },
    confirm_submit: {
      description: "After re-observing all entered fields, authorize the one final click or durably park for review.",
      parameters: schema({ summary: S.str("Exact final entered values, every non-trivial answer and free text verbatim"), ...navigationFields }),
      handler: async args => {
        if (isVerification) return "ERROR: verification workers are strictly forbidden from submitting or authorizing applications.";
        await checkpointFrom(rt, session, args);
        return confirmSubmission(rt, session, arg.str(args, "summary"));
      },
    },
    need_manual: {
      description:
        "Persist the blocker and draft checkpoint, then terminate the worker. The slot is reusable after exit; a human must explicitly reserve the browser before inspecting it.",
      parameters: schema(
        {
          cause: causeParam,
          reason: S.str("Blocking evidence and what the candidate needs to do"),
          not_submitted: S.str(
            "Only after final submit was authorized, and only when the site itself showed that the application was not sent: its message verbatim (a validation error, an error toast, a failed challenge with the form back). Leave out when you cannot tell.",
          ),
          ...navigationFields,
        },
        ["cause", "reason", ...Object.keys(navigationFields)],
      ),
      handler: async args => {
        const cause = arg.oneOf(args, "cause", WORKER_CAUSES);
        const refusal = arg.optStr(args, "not_submitted")?.trim();
        if (refusal && refusal.length >= 5 && !isVerification && ownsFill(rt, session) && refuseSubmit(job.id))
          logEvent("auto", `The site refused the submission, so this stop can be retried: ${refusal}`, job.id, "fill");
        let checkpoint = session.checkpoint;
        let reason = arg.str(args, "reason");
        try {
          checkpoint = await checkpointFrom(rt, session, args);
        } catch (err) {
          if (!ownsFill(rt, session)) throw err;
          reason += `\nCurrent navigation could not be verified; checkpoint is the last observed draft: ${errorMessage(err)}`;
        }
        return parkFill(
          rt,
          session,
          isVerification ? { kind: "submission_ambiguous", text: `Verification handoff: ${reason}` } : { kind: "manual", text: reason },
          checkpoint,
          { cause, detail: reason },
        );
      },
    },
    report_result: {
      description: "Report verified success/closed status, or failure. Failure after final authorization requires inspection, not retry.",
      parameters: schema(
        {
          outcome: { type: "string", enum: ["submitted", "already_applied", "closed", "failed"] },
          note: S.str("Observed evidence"),
          cause: { ...causeParam, description: `Required when outcome is failed. ${CAUSE_GUIDE}` },
        },
        ["outcome", "note"],
      ),
      handler: args => {
        const outcome = arg.oneOf(args, "outcome", ["submitted", "already_applied", "closed", "failed"]),
          note = arg.str(args, "note");
        if (isVerification) {
          return "ERROR: verification workers must record status through verify_status with structured evidence, or hand off through need_manual.";
        }
        const cause = outcome === "failed" ? arg.oneOf(args, "cause", WORKER_CAUSES) : null;
        if (outcome !== "submitted" && outcome !== "already_applied" && isSubmitting(job.id)) {
          stopFailedFill(rt, session, note, cause ?? "no_response");
          return "Submission ambiguity recorded; automatic retry forbidden.";
        }
        const move =
          outcome === "submitted" || outcome === "already_applied"
            ? to.submitted(note)
            : outcome === "closed"
              ? to.skipped(`posting closed: ${note}`)
              : to.failed(note);
        const recorded = db.transaction(() => {
          if (!moveJob(job.id, "filling", move, { quiet: true })) return false;
          cancelJobGates(job.id);
          resetFillPhase(job.id);
          if (outcome === "failed") recordBlocker(job.id, cause ?? "other", note, null);
          return true;
        })();
        if (!recorded) return STALE_WORKER;
        notifyJobChange(job.id);
        endSession(session, `result reported: ${outcome}`);
        return "Recorded.";
      },
    },
    verify_status: {
      description: "Record verified submission outcome for an ambiguous application. Available only in verification mode.",
      parameters: schema(
        {
          outcome: {
            type: "string",
            enum: ["submitted", "not_submitted", "unresolved"],
            description: "Verified status of the exact application",
          },
          evidence: S.str("Verbatim observed text/evidence from portal, form validation, or confirmation message"),
          source: {
            type: "string",
            enum: ["portal", "confirmation_email", "submission_error"],
            description: "Evidence category",
          },
          status: {
            type: "string",
            enum: ["submitted", "not_submitted", "draft", "incomplete", "rejected"],
            description: "Observed status category",
          },
          requisition_id: { type: "string", description: "Exact job or requisition ID verified on page or email" },
          message_id: { type: "string", description: "Gmail message id if source is confirmation_email" },
          ...navigationFields,
        },
        ["outcome", "evidence"],
      ),
      handler: args => verifyStatus(rt, ctx, args),
    },
  };
  for (const tool of Object.values(tools)) {
    const handler = tool.handler;
    tool.handler = args => (ownsFill(rt, session) ? handler(args) : STALE_WORKER);
  }
  return tools;
}

export function prefillTool(rt: FillRuntime, ctx: FillContext, factsPath: string): HostTool {
  const looked = new Set<string>();
  return {
    description:
      "Fill the plain fields of the application form on the tab's current page from the candidate details, at a person's pace. Replies with what it filled, every field it left, and whether to call it again. Takes up to a few minutes.",
    parameters: schema({ tab_id: S.str("Exact CDP tab id from application_tabs") }),
    handler: async args => {
      if (ctx.isVerification) return "ERROR: prefill is not available in verification-only mode.";
      const tabId = arg.str(args, "tab_id");
      if (!ownsFill(rt, ctx.session)) throw new Error("stale fill worker");
      if (!ctx.jobBrowser.ownsTarget(tabId)) throw new Error("tab is outside this application's browser scope");
      const tab = await connectTab(ctx.jobBrowser.port, tabId);
      try {
        return await prefill(tab, factsPath, { looked });
      } finally {
        tab.close();
      }
    },
  };
}
