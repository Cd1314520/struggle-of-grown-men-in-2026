// The host tools a fill worker is given. Each one acts for the session it was built for and for
// nothing else: once that session no longer owns the application, every tool refuses.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolveAccount } from "./accounts";
import { CAUSE_GUIDE, recordBlocker, WORKER_CAUSES } from "./blockers";
import type { JobBrowser } from "./chrome";
import { db, notifyJobChange, writeJob, type Job } from "./db";
import { errorMessage } from "./errors";
import { clearFillFlags, endVerification, isSubmitting } from "./fill-state";
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
import { arg, S, schema, type HostTool, type ToolArgs } from "./omp";
import {
  cancelJobGates,
  evidenceProblem,
  findStoredAnswer,
  nextQueuedQuestion,
  queueQuestion,
  resolveAmbiguityWithEvidence,
  type AmbiguityEvidence,
  type GateInput,
} from "./questions";
import { to } from "./status";
import { gmailTools } from "./worker-tools";

export interface FillContext {
  job: Job;
  session: FillSession;
  dir: string; // the job's working directory
  mailbox: string;
  // A verification worker only finds out whether an authorized submit went through; it never submits.
  isVerification: boolean;
  jobBrowser: JobBrowser;
}

// Settles an ambiguous submit from what the verification worker observed, or parks it again.
async function verifyStatus(rt: FillRuntime, ctx: FillContext, args: ToolArgs): Promise<string> {
  const { job, session, isVerification } = ctx;
  if (!isVerification) return "ERROR: verify_status is only available during verification mode.";
  const outcome = arg.str(args, "outcome");
  const evidence = (arg.optStr(args, "evidence") ?? "").trim();
  if (evidence.length < 5) return "ERROR: detailed evidence text is required (minimum 5 characters).";

  if (outcome === "unresolved") {
    const cp = await checkpointFrom(rt, session, args).catch(() => session.checkpoint);
    endVerification(job.id);
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
    endSession(session);
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
  endSession(session);
  await session.handle?.done;
  return "Recorded: Ambiguity resolved. Verified draft queued for normal fill with fresh confirm_submit required.";
}

// What stopped the application, so stops can be counted and looked at again by cause.
const causeParam = { type: "string", enum: WORKER_CAUSES, description: CAUSE_GUIDE };

export function fillTools(rt: FillRuntime, ctx: FillContext): Record<string, HostTool> {
  const { job, session, dir, mailbox, isVerification, jobBrowser } = ctx;
  const { slot } = session;
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
        },
        ["domain"],
      ),
      handler: args => {
        const allowCreate = args["register"] === true && !isVerification && !isSubmitting(job.id);
        return resolveAccount(arg.str(args, "domain"), mailbox, allowCreate);
      },
    },
    ask_user: {
      description:
        "Consult profile first; then get an exact scoped answer, or record the question. Every unknown question on the page goes in one batch: `more: true` records it and returns, the last one without `more` durably parks on all of them and terminates this worker.",
      parameters: schema({
        question: S.str("The form question verbatim, not including options"),
        context: S.str(
          "Verbatim answer-relevant surrounding form/legal text and constraints. Put job IDs, navigation and fill progress in checkpoint fields, not here, unless materially required by this question. Never omit answer-relevant wording.",
        ),
        options: { type: "array", items: { type: "string" }, description: "All current choices verbatim and in order, or [] for free text" },
        more: { type: "boolean", description: "true when other unknown questions on this page are still to be asked: record this one and keep going" },
        ...navigationFields,
      }),
      handler: async args => {
        const options: unknown = args["options"];
        if (!Array.isArray(options) || !options.every((option): option is string => typeof option === "string"))
          return "ERROR: options must contain every current choice verbatim.";
        const input: GateInput = { kind: "question", text: arg.str(args, "question"), context: arg.str(args, "context"), options };
        const answer = findStoredAnswer(job.id, input);
        if (answer !== null) return `Exact scoped candidate answer: ${answer}`;
        if (!ownsFill(rt, session)) throw new Error("stale fill worker");
        queueQuestion(job.id, input);
        if (args["more"] === true)
          return "Recorded. Leave this field blank, fill everything else you can on this page, and ask its other unknown questions; the last one without `more` parks the application on all of them.";
        return parkFill(rt, session, nextQueuedQuestion(job.id) ?? input, await checkpointFrom(rt, session, args));
      },
    },
    ask_cover_letter: {
      description: "Return this application's provided letter or durably park for it. Never write a letter.",
      parameters: schema({ prompt: S.str("Exact required cover-letter prompt, limits and upload/text requirements"), ...navigationFields }),
      handler: async args => {
        const input: GateInput = {
          kind: "cover_letter",
          text: arg.str(args, "prompt"),
          context: "Required cover letter for this application; exact constraints in prompt",
          options: [],
        };
        const letter = findStoredAnswer(job.id, input);
        if (letter === null) return parkFill(rt, session, input, await checkpointFrom(rt, session, args));
        writeFileSync(join(dir, "cover_letter.txt"), letter + "\n");
        return `Use exactly this letter; for file upload use ${join(dir, "cover_letter.txt")}:\n\n${letter}`;
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
      parameters: schema({ cause: causeParam, reason: S.str("Blocking evidence and what the candidate needs to do"), ...navigationFields }),
      handler: async args => {
        const cause = arg.oneOf(args, "cause", WORKER_CAUSES);
        let checkpoint = session.checkpoint;
        let reason = arg.str(args, "reason");
        try {
          checkpoint = await checkpointFrom(rt, session, args);
        } catch (err) {
          if (!ownsFill(rt, session)) throw err;
          reason += `\nCurrent navigation could not be verified; checkpoint is the last observed draft: ${errorMessage(err)}`;
        }
        recordBlocker(job.id, cause, reason);
        if (isVerification) {
          endVerification(job.id);
          return parkFill(rt, session, { kind: "submission_ambiguous", text: `Verification handoff: ${reason}` }, checkpoint);
        }
        return parkFill(rt, session, { kind: "manual", text: reason }, checkpoint);
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
        db.transaction(() => {
          cancelJobGates(job.id);
          clearFillFlags(job.id);
          if (outcome === "submitted" || outcome === "already_applied") writeJob(job.id, to.submitted(note));
          else if (outcome === "closed") writeJob(job.id, to.skipped(`posting closed: ${note}`));
          else {
            writeJob(job.id, to.failed(note));
            recordBlocker(job.id, cause ?? "other", note);
          }
        })();
        notifyJobChange(job.id);
        endSession(session);
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
    tool.handler = args => (ownsFill(rt, session) ? handler(args) : "ERROR: stale or parked fill worker; no action recorded.");
  }
  return tools;
}
