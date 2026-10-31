import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ActivityResult, AppState, Attention, BlockersResult, JobDetail, ModelsResult, ResumeState, SettingsResult, Summary } from "./api-types";
import { feedNames, loadCompanies } from "./ats";
import { jobBlockers, listBlockers } from "./blockers";
import { isBoardUrl } from "./boards";
import { screenshot, tabs } from "./chrome";
import { browserCount, config, jobDir, LOCAL_CONFIG, PROFILE, RESUME_DIR, STOCK_MAIN, vncUrl } from "./config";
import {
  boardJobs,
  getJob,
  highlightEvents,
  insertJob,
  knownJobId,
  jobEvents,
  jobSources,
  kvGet,
  kvSet,
  logEvent,
  onChange,
  openedAt,
  recentEvents,
  releaseHeldJobs,
  releaseTargetHolds,
  siblingJobs,
  statusCounts,
  statusHistory,
  updateJob,
  UNTITLED,
  type Job,
} from "./db";
import * as gmail from "./gmail";
import { startCdpProxy } from "./cdp-proxy";
import { killAllWorkers } from "./worker";
import { MAIN, pagePng, PDF_NAME, resumeFiles, stockPdf, stockResume, workingPdf } from "./resume";
import { cachedCatalog, isModelStage, modelCatalog, setModel, stageModels } from "./models";
import { acceptImport, beginImport, discardImport, draftPdf, importState, importSteps, MAX_BYTES, MAX_FILES, reviseImport } from "./resume-import";
import { readBase, setSetting, settingsState } from "./settings";
import { setupStatus } from "./setup";
import { autoApply } from "./auto";
import { thresholds } from "./rubric";
import { forgetDeferredApproval } from "./deferred-approvals";
import { usedToday } from "./limits";
import { isExample, PLACEHOLDER, profileProblems, seedProfile } from "./profile";
import { answerGate, getOpenGate, listQuestionGroups, readCheckpoint, resolveAmbiguous, respond } from "./questions";
import { Scheduler } from "./scheduler";
import { digestStatus, sendQuestionDigest } from "./digest";
import { errorMessage } from "./errors";
import { isSubmitting, recoveryMode } from "./fill-state";
import { RETRYABLE, to, wasSent } from "./status";
import { addStep, changeStep, jobSteps, nextStepOf, nextSteps, recordOutcome, removeStep, STEP_KINDS, stepOf } from "./steps";
import { serveUi } from "./ui";
import { isListView, listJobs } from "./listing";
import { stats } from "./stats";
import { addContact, changeContact, importLinkedInExport, jobOptions, referralsState, syncReferralMail } from "./outreach";

const PROFILE_FILES = ["targets.md", "rubric.yml", MAIN, "resume-notes.md", "answers.md", "personal.yml", "companies.yml", "employers.yml", "referral.yml"];
const safeThresholds = () => {
  try {
    return thresholds();
  } catch {
    return null;
  }
};
// The resume content file lives in the resume project, everything else in profile/.
const profilePath = (name: string) => (name === MAIN ? STOCK_MAIN : join(PROFILE, name));
// A full LinkedIn export with messages runs to tens of megabytes; Connections.csv alone is far smaller.
const REFERRAL_EXPORT_BYTES = 200 * 1024 * 1024;
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

// The app has no login. What stands in for one is that only its own pages may talk to it: the
// browsers it drives visit arbitrary sites on this machine, and any of them could otherwise post an
// approval to 127.0.0.1, or read the profile through a hostname re-pointed at it.
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);
const ownHost = (hostname: string) => LOOPBACK.has(hostname) || (!!config.publicUrl && new URL(config.publicUrl).hostname === hostname);
// Why this request is refused, or null when it may go ahead.
export function refusal(req: Request): string | null {
  // The name the request was addressed to. A page on another site can only reach the app under a name of its own.
  if (!ownHost(new URL(req.url).hostname)) return "this app does not answer under that host name";
  if (req.method === "GET" || req.method === "HEAD") return null;
  // Browsers say where a request that changes something comes from; tools like curl send neither header.
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return "requests from other sites are refused";
  const origin = req.headers.get("origin");
  if (origin === null) return null;
  try {
    return ownHost(new URL(origin).hostname) ? null : "requests from other sites are refused";
  } catch {
    return "requests from other sites are refused";
  }
}

function resumeDiff(job: Job) {
  const tailored = resumeFiles(job.id, job.resume_sha).main;
  if (!existsSync(tailored)) return "";
  const out = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", "-U2", STOCK_MAIN, tailored]);
  return out.stdout.toString().split("\n").slice(4).join("\n");
}

// Reading companies.yml is most of what a summary would cost, so its count is kept until the file changes.
let companies: { stamp: string; count: number } | null = null;
function boardCount() {
  const file = statSync(profilePath("companies.yml"), { throwIfNoEntry: false });
  const stamp = file ? `${file.mtimeMs}:${file.size}` : "";
  if (companies?.stamp !== stamp) companies = { stamp, count: loadCompanies().length };
  return companies.count + feedNames().length;
}

// The app's state without its lists: what /api/state and /api/summary share.
function settings(scheduler: Scheduler): Omit<Summary, "attention"> {
  return {
    counts: statusCounts(),
    digest: digestStatus(),
    gmail: gmail.gmailStatus(),
    profileProblems: profileProblems(),
    running: { scan: scheduler.isRunning("scan"), track: scheduler.isRunning("track") },
    lastScan: kvGet("last.scan"),
    scanMinutes: config.schedule.scanMinutes,
    boards: boardCount(),
    lastTrack: kvGet("last.track"),
    approval: config.approval,
    targets: { holdBack: config.targets.holdBack, describe: config.targets.describe?.trim() ?? "" },
    autoApply: { ...autoApply(), perEmployer: Number.isFinite(autoApply().perEmployer) ? autoApply().perEmployer : null, approvedToday: usedToday("auto") },
    applyPerDay: config.limits.applyPerDay,
    thresholds: safeThresholds(),
    vncUrl: config.chrome.vncPort ? vncUrl() : null,
    browsers: config.chrome.vncPort ? Array.from({ length: browserCount() }, (_, slot) => vncUrl(slot)) : [],
    redirectUri: gmail.redirectUri(),
    mailbox: config.mailbox,
    profileFiles: PROFILE_FILES,
    setupRemaining: setupStatus(cachedCatalog()).remaining,
  };
}

function state(scheduler: Scheduler): AppState {
  const next = nextSteps();
  return {
    ...settings(scheduler),
    jobs: boardJobs().map(j => ({ ...j, opened_at: openedAt(j), next: next.get(j.id) ?? null })),
    questionGroups: listQuestionGroups(),
    events: recentEvents(),
    highlights: highlightEvents(),
  };
}

function summary(scheduler: Scheduler): Summary {
  const rest = settings(scheduler),
    questionGroups = listQuestionGroups();
  const gates = (kind: string) => questionGroups.filter(g => g.kind === kind).reduce((n, g) => n + g.jobs.length, 0);
  const attention: Omit<Attention, "total"> = {
    review: rest.counts["awaiting_approval"] ?? 0,
    questions: questionGroups.filter(g => g.kind === "question").length,
    confirmSubmit: gates("confirm_submit"),
    manual: gates("manual"),
    coverLetter: gates("cover_letter"),
    ambiguous: gates("submission_ambiguous"),
    failed: rest.counts["failed"] ?? 0,
  };
  const total = attention.questions + attention.confirmSubmit + attention.manual + attention.coverLetter + attention.ambiguous + attention.failed;
  return { ...rest, attention: { ...attention, total } };
}

// One page of the event log. The full log names the job of each event as the highlights do.
function activity(url: URL): ActivityResult {
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 60));
  const before = Number(url.searchParams.get("before")) || null;
  const kinds = url.searchParams.getAll("kind").filter(Boolean);
  const rows =
    url.searchParams.get("feed") === "all"
      ? recentEvents(limit, before, kinds).map(e => {
          const job = e.job_id ? getJob(e.job_id) : null;
          return { ...e, company: job?.company ?? null, title: job?.title ?? null };
        })
      : highlightEvents(limit, before, kinds).map(e => ({ ...e, worker: null }));
  return { items: rows, next: rows.length === limit ? (rows.at(-1)?.id ?? null) : null };
}

function jobDetail(scheduler: Scheduler, job: Job): JobDetail {
  const files = resumeFiles(job.id, job.resume_sha);
  const gate = getOpenGate(job.id);
  // Historical slot assignments are not ownership: ordinary parked browsers are reused.
  const slot = scheduler.fillSlot(job.id);
  const steps = jobSteps(job.id);
  return {
    ...job,
    opened_at: openedAt(job),
    events: jobEvents(job.id),
    history: statusHistory(job.id),
    sources: jobSources(job.id),
    siblings: siblingJobs(job),
    steps,
    blockers: jobBlockers(job.id),
    next: ["submitted", "interview", "offer"].includes(job.status) ? nextStepOf(steps) : null,
    gate,
    checkpoint: readCheckpoint(job.id),
    browserReserved: slot !== null,
    manualBrowserReserved: scheduler.manualBrowserReserved(job.id),
    submissionAmbiguous: gate?.kind === "submission_ambiguous" || (job.status !== "filling" && isSubmitting(job.id)),
    recoveryMode: recoveryMode(job.id),
    vncUrl: config.chrome.vncPort && slot !== null ? vncUrl(slot) : null,
    hasPdf: existsSync(files.pdf),
    resumeFrozen: files.frozen,
    pdfName: PDF_NAME,
    diff: resumeDiff(job),
  };
}

function jobAction(scheduler: Scheduler, job: Job, action: string, text: string) {
  const gate = getOpenGate(job.id);
  const ambiguous = gate?.kind === "submission_ambiguous" || isSubmitting(job.id);
  if (ambiguous && !["reject", "mark_submitted", "confirmed_not_submitted"].includes(action))
    return "submission may already have occurred; inspect it, then mark submitted, confirm not submitted, or reject";
  switch (action) {
    case "approve":
      if (job.status !== "awaiting_approval") return "not awaiting approval";
      updateJob(job.id, to.approved("user"));
      break;
    case "reject":
      if (job.status === "rejected") return "already rejected";
      if (wasSent(job)) return "this application was already sent; it cannot be rejected here";
      scheduler.abortFill(job.id);
      updateJob(job.id, to.rejected(text || null));
      break;
    case "hold": // set aside for later, like a job at a target employer held back; retry releases it
      if (job.status === "held") return "already held";
      if (job.status === "rejected") return "rejected; reconsider it first";
      if (wasSent(job)) return "this application was already sent; it cannot be held";
      scheduler.abortFill(job.id);
      updateJob(job.id, to.held(text || "held by you"));
      break;
    case "redo": // re-run scoring/tailoring with the user's feedback
      if (job.status !== "awaiting_approval") return "the resume can only be changed while the job is awaiting approval";
      // Once an application has started, its resume is frozen and a draft may already carry it: a
      // re-tailored copy would never be uploaded.
      if (job.resume_sha) return "this application has already started with its frozen resume; the resume can no longer be changed";
      if (!text) return "feedback text required";
      scheduler.abortFill(job.id);
      kvSet(`feedback.${job.id}`, text);
      updateJob(job.id, to.triaged("redo requested"));
      break;
    case "retry":
      if (!RETRYABLE.includes(job.status)) return "nothing to retry";
      // A held job the user picks out by hand is assessed and tailored regardless of the hold-back rule.
      if (job.status === "held") kvSet(`feedback.${job.id}`, "The candidate chose to apply to this job now. Do not hold it back.");
      kvSet(`locate.tries.${job.id}`, "0");
      updateJob(job.id, existsSync(workingPdf(job.id)) ? to.awaitingApproval(null) : isBoardUrl(job.url) ? to.locating() : to.triaged());
      break;
    case "mark_submitted": // user finished it by hand
      if (wasSent(job)) return "already recorded as submitted";
      scheduler.abortFill(job.id);
      updateJob(job.id, to.submitted(text || "submitted manually"));
      break;
    // What happened after it was sent, as the user knows it: mail the agent never saw, or a correction.
    case "mark_offer":
    case "mark_declined":
    case "withdraw": {
      if (!wasSent(job) || job.status === "rejected") return "only an application that was sent can have an outcome";
      const outcome = action === "mark_offer" ? "offer" : action === "mark_declined" ? "rejected_by_company" : "withdrawn";
      if (job.status === outcome) return "already recorded";
      recordOutcome(job.id, outcome, text || (outcome === "withdrawn" ? "withdrawn by you" : "marked by you"));
      break;
    }
    case "reopen_application": // back in process after an outcome recorded by mistake
      if (!["offer", "rejected_by_company", "withdrawn"].includes(job.status)) return "this application has no outcome to undo";
      recordOutcome(job.id, "reopen", text || "reopened by you");
      break;
    case "confirmed_not_submitted":
      if (!ambiguous) return "submission is not ambiguous";
      resolveAmbiguous(job.id, "not_submitted");
      break;
    case "respond": // answer a question, approve/adjust the final submit, or release a manual hand-off
      if (!respond(job.id, text)) return "this gate is no longer open or cannot accept an ordinary response";
      break;
    default:
      return "unknown action";
  }
  // An explicit user decision supersedes any queued automatic approval, even while quota is exhausted.
  forgetDeferredApproval(job.id);
  logEvent("user", `${action}${text ? `: ${text}` : ""}`, job.id);
  scheduler.pump();
  return null;
}

// The user's changes to the steps of an application that was sent. `op` names the change; `step` the
// step it applies to (all but add).
const STEP_DONE: Record<string, string> = {
  add: "added",
  done: "done",
  book: "booked",
  edit: "edited",
  todo: "reopened",
  cancel: "cancelled",
  remove: "removed",
};
function stepAction(job: Job, b: Record<string, unknown>) {
  const str = (key: string) => (typeof b[key] === "string" ? b[key].trim() : undefined);
  const op = str("op") ?? "";
  if (!Object.hasOwn(STEP_DONE, op)) return "unknown step change";
  if (!wasSent(job)) return "this application was not sent";
  const kind = STEP_KINDS.find(k => k === b["kind"]);
  if (op === "add") {
    const title = str("title") ?? "";
    if (!kind || !title) return "a step needs a kind and a title";
    addStep(job, { kind, title, due_at: str("due") || null, link: str("link") || null, detail: str("detail") || null, source: "user" });
    logEvent("user", `step added: ${title}`, job.id);
    return null;
  }
  const step = typeof b["step"] === "number" ? stepOf(job.id, b["step"]) : null;
  if (!step) return "no such step on this application";
  if (op === "remove") removeStep(step.id);
  else if (op === "done") changeStep(step.id, { state: "done", note: str("note") ?? null });
  else if (op === "book") {
    const at = str("at");
    if (!at) return "the booked time is required";
    changeStep(step.id, { state: "scheduled", scheduled_at: at });
  } else if (op === "todo") changeStep(step.id, { state: "todo" });
  else if (op === "cancel") changeStep(step.id, { state: "cancelled" });
  else {
    const title = str("title");
    if (title === "") return "a step needs a title";
    changeStep(step.id, {
      ...(kind ? { kind } : {}),
      ...(title ? { title } : {}),
      ...(b["due"] !== undefined ? { due_at: str("due") || null } : {}),
      ...(b["link"] !== undefined ? { link: str("link") || null } : {}),
      ...(b["detail"] !== undefined ? { detail: str("detail") || null } : {}),
    });
  }
  logEvent("user", `step ${STEP_DONE[op]}: ${step.title}`, job.id);
  return null;
}

function resumeState(): ResumeState {
  const imp = importState();
  const notes = readProfileFile("resume-notes.md");
  return {
    stock: stockResume(),
    import: { ...imp, steps: importSteps(imp) },
    notes: { example: isExample("resume-notes.md"), empty: !notes.trim() },
    pdfName: PDF_NAME,
    main: MAIN,
    limits: { files: MAX_FILES, bytes: MAX_BYTES },
  };
}
const readProfileFile = (name: string) => {
  const file = profilePath(name);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
};

const pdf = async (file: string) =>
  (await Bun.file(file).exists())
    ? new Response(Bun.file(file), {
        headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${PDF_NAME}"`, "cache-control": "no-store" },
      })
    : fail("no resume", 404);
const png = (file: string, page: number) => {
  const image = pagePng(file, page);
  return image ? new Response(image, { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : fail("no such page", 404);
};

// Answers one request against the given scheduler.
export function createHandler(scheduler: Scheduler) {
  return async function handle(req: Request): Promise<Response> {
    const refused = refusal(req);
    if (refused) return fail(refused, 403);
    const url = new URL(req.url);
    const path = url.pathname;
    const body = async () => (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const page = await serveUi(path);
    if (page) return page;
    if (path === "/api/state") return json(state(scheduler));
    if (path === "/api/summary") return json(summary(scheduler));
    if (path === "/api/stats") return json(stats());
    if (path === "/api/activity") return json(activity(url));
    if (path === "/api/jobs" && req.method === "GET") {
      const view = url.searchParams.get("view");
      if (!isListView(view)) return fail("view must be one of review, pipeline, applications, held, rejected");
      const p = url.searchParams;
      return json(
        listJobs({
          view,
          group: p.get("group"),
          q: p.get("q"),
          filters: p.getAll("filter"),
          sort: p.get("sort"),
          offset: Number(p.get("offset")) || 0,
          limit: Number(p.get("limit")) || 50,
          focus: Number(p.get("focus")) || null,
        }),
      );
    }

    if (path === "/api/blockers" && req.method === "GET") return json({ blockers: listBlockers() } satisfies BlockersResult);
    if (path === "/api/questions" && req.method === "GET") return json({ groups: listQuestionGroups() });
    const answerMatch = /^\/api\/questions\/([^/]+)\/answer$/.exec(path);
    if (answerMatch && req.method === "POST") {
      const { answer, scope } = await body();
      if (typeof answer !== "string" || !answer.trim()) return fail("answer text required");
      if (scope !== "application" && scope !== "bank") return fail("scope must be application or bank");
      try {
        const { jobIds } = answerGate(decodeURIComponent(answerMatch[1] ?? ""), answer.trim(), scope);
        logEvent("user", `Answered question (${scope}); queued applications: ${jobIds.join(", ")}`);
        scheduler.pump();
        return json({ ok: true, jobIds });
      } catch (err) {
        return fail(err instanceof Error ? err.message : "gate cannot accept this answer", 409);
      }
    }
    if (path === "/api/digest/status" && req.method === "GET") return json(digestStatus());
    if (path === "/api/digest/send" && req.method === "POST") {
      try {
        return json(await sendQuestionDigest({ force: true }));
      } catch (err) {
        return fail(err instanceof Error ? err.message : "digest delivery failed", 502);
      }
    }

    if (path === "/api/stream") {
      let off: (() => void) | undefined;
      let timer: Timer;
      return new Response(
        new ReadableStream({
          start(ctrl) {
            let dirty = false;
            off = onChange(() => (dirty = true));
            timer = setInterval(() => {
              ctrl.enqueue(dirty ? "data: change\n\n" : ": ping\n\n");
              dirty = false;
            }, 1000);
          },
          cancel() {
            off?.();
            clearInterval(timer);
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      );
    }

    const jobMatch = /^\/api\/jobs\/(\d+)(\/[\w.]+)?$/.exec(path);
    if (jobMatch) {
      const job = getJob(Number(jobMatch[1]));
      if (!job) return fail("no such job", 404);
      const sub = jobMatch[2];
      if (!sub) {
        return json(jobDetail(scheduler, job));
      }
      if (sub === "/resume.pdf") {
        const file = Bun.file(resumeFiles(job.id, job.resume_sha).pdf);
        return (await file.exists())
          ? new Response(file, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${PDF_NAME}"` } })
          : fail("no resume yet", 404);
      }
      if (sub === "/resume.png") {
        const file = resumeFiles(job.id, job.resume_sha).pdf;
        if (!existsSync(file)) return fail("no resume yet", 404);
        const image = pagePng(file);
        return image
          ? new Response(image, { headers: { "content-type": "image/png", "cache-control": "max-age=300" } })
          : fail("could not render the resume", 500);
      }
      if (sub === "/gate.png") {
        const file = Bun.file(join(jobDir(job.id), "gate.png"));
        return (await file.exists())
          ? new Response(file, { headers: { "content-type": "image/png", "cache-control": "no-store" } })
          : fail("no screenshot", 404);
      }
      if (sub === "/action" && req.method === "POST") {
        const { action, text, gateId } = await body();
        if (action === "respond" && gateId !== undefined && (typeof gateId !== "string" || getOpenGate(job.id)?.id !== gateId))
          return fail("this gate is no longer open; reload the application", 409);
        if (
          action === "confirmed_not_submitted" &&
          (typeof gateId !== "string" || getOpenGate(job.id)?.kind !== "submission_ambiguous" || getOpenGate(job.id)?.id !== gateId)
        )
          return fail("inspect the current ambiguous submission before resolving it; this gate has changed", 409);
        try {
          const err = jobAction(scheduler, job, typeof action === "string" ? action : "", typeof text === "string" ? text.trim() : "");
          return err ? fail(err, 409) : json({ ok: true });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "job action failed", 409);
        }
      }
      if (sub === "/steps" && req.method === "POST") {
        try {
          const err = stepAction(job, await body());
          return err ? fail(err, 409) : json({ ok: true });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "step change failed", 409);
        }
      }
      if (sub === "/browser" && req.method === "POST") {
        const { action, gateId } = await body();
        if (typeof gateId !== "string" || !gateId || (action !== "reserve" && action !== "release"))
          return fail("action (reserve or release) and gateId are required", 400);
        try {
          if (action === "reserve") await scheduler.reserveBrowser(job.id, gateId);
          else scheduler.releaseBrowser(job.id, gateId);
          return json({ ok: true });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "browser reservation failed", 409);
        }
      }
      if (sub === "/recover" && req.method === "POST") {
        const { gateId } = await body();
        if (typeof gateId !== "string" || !gateId) return fail("gateId is required", 400);
        const open = getOpenGate(job.id);
        if (open?.id !== gateId) return fail("this gate is no longer open; reload the application", 409);
        if (open.kind !== "manual" && open.kind !== "submission_ambiguous") return fail("only manual handoffs and ambiguous submissions can be recovered", 400);
        const checkpoint = readCheckpoint(job.id);
        if (!checkpoint) return fail("recovery requires a saved browser checkpoint", 400);
        if (scheduler.activeFillSession(job.id)) return fail("an active worker is already running for this application", 409);
        try {
          scheduler.scheduleRecovery(job.id, gateId);
          return json({ ok: true });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "recovery failed", 409);
        }
      }
    }

    if (path === "/api/jobs" && req.method === "POST") {
      const { url: jobUrl, company, title } = await body();
      if (typeof jobUrl !== "string" || !/^https?:\/\//.test(jobUrl)) return fail("a posting URL is required");
      const text = (value: unknown) => (typeof value === "string" ? value : "");
      const id = insertJob(
        {
          url: jobUrl,
          source: "manual",
          company: text(company) || new URL(jobUrl).hostname,
          title: text(title) || UNTITLED,
          location: null,
          description: null,
        },
        "triaged",
      );
      // Name the job it matched, so the page can link to it instead of only saying no.
      if (!id) return json({ error: "already known", id: knownJobId(jobUrl) }, 409);
      scheduler.pump();
      return json({ id });
    }

    if (path === "/api/run" && req.method === "POST") {
      const { what } = await body();
      if (what === "scan" || what === "discover") {
        const bad = profileProblems(["targets.md"]);
        if (bad.length) return fail("fill in profile/targets.md first");
        void scheduler.scan({ discover: what === "discover" });
      } else if (what === "release_held") {
        // back through triage, which judges them again against the current targets
        const n = releaseHeldJobs();
        logEvent("user", `released ${n} held jobs for re-triage`);
        void scheduler.scan();
      } else if (what === "release_targets") {
        // the jobs held back at target employers, once they are no longer held back
        const n = releaseTargetHolds();
        logEvent("user", `released ${n} jobs held at target employers for re-triage`);
        void scheduler.scan();
      } else if (what === "track") void scheduler.track();
      else return fail("unknown run target");
      return json({ ok: true });
    }

    if (path === "/api/setup" && req.method === "GET") return json(setupStatus(await modelCatalog(url.searchParams.has("refresh"))));

    if (path === "/api/models" && req.method === "GET")
      return json({ catalog: await modelCatalog(url.searchParams.has("refresh")), stages: stageModels(), localConfig: LOCAL_CONFIG } satisfies ModelsResult);
    const modelMatch = /^\/api\/models\/(\w+)$/.exec(path);
    if (modelMatch && req.method === "PUT") {
      const stage = modelMatch[1];
      if (!isModelStage(stage)) return fail("unknown stage", 404);
      const { model } = await body();
      if (model !== null && (typeof model !== "string" || !model.trim() || /\s/.test(model.trim())))
        return fail("model must be a model name, or null for omp's default");
      try {
        setModel(stage, model === null ? null : model.trim());
      } catch (err) {
        return fail(errorMessage(err), 409);
      }
      logEvent("user", `${stage} model set to ${model ?? "omp's default"}`);
      return json({ ok: true });
    }

    if (path === "/api/settings" && req.method === "GET") return json(settingsState() satisfies SettingsResult);
    if (path === "/api/settings" && req.method === "PUT") {
      const { path: key, value, reset } = await body();
      if (!Array.isArray(key) || !key.length || !key.every(k => typeof k === "string" && /^\w+$/.test(k))) return fail("path must name a setting");
      if (reset !== true && value === undefined) return fail("send a value, or reset: true for config.yml's");
      // A public address under another name would refuse the very page that set it.
      if (key.join(".") === "publicUrl") {
        const host = new URL(req.url).hostname;
        const next = reset === true ? (readBase() as Record<string, unknown>)["publicUrl"] : value;
        const nextHost = typeof next === "string" && URL.canParse(next) ? new URL(next).hostname : null;
        if (!LOOPBACK.has(host) && nextHost !== host)
          return fail(
            `you reach the app as ${host}: a public address under another name would lock this page out. Change it from this machine (localhost)`,
            409,
          );
      }
      let saved: { restart: boolean };
      try {
        saved = setSetting(key as string[], reset === true ? undefined : value);
      } catch (err) {
        return fail(errorMessage(err), 409);
      }
      logEvent(
        "user",
        `setting ${key.join(".")} ${reset === true ? "reset to config.yml's" : `set to ${JSON.stringify(value)}`}${saved.restart ? " (from the next restart)" : ""}`,
      );
      return json({ ok: true, ...saved });
    }

    if (path === "/api/resume" && req.method === "GET") return json(resumeState());
    if (path === "/api/resume/stock.pdf") return pdf(stockPdf());
    if (path === "/api/resume/draft.pdf") return pdf(draftPdf());
    if (path === "/api/resume/stock.png" || path === "/api/resume/draft.png") {
      if (path === "/api/resume/stock.png") stockResume(); // compiled if the sources changed since
      return png(path.endsWith("stock.png") ? stockPdf() : draftPdf(), Math.max(1, Number(url.searchParams.get("page")) || 1));
    }
    if (path === "/api/resume/example" && req.method === "POST") {
      if (existsSync(STOCK_MAIN)) return fail("there is already a stock resume", 409);
      // Marked, so nothing is applied with the example's made-up person until its details are replaced.
      const example = readFileSync(join(RESUME_DIR, "main.example.typ"), "utf8");
      writeFileSync(STOCK_MAIN, `// ${PLACEHOLDER}: replace every detail below with your own, then delete this line.\n${example}`);
      logEvent("user", `started ${MAIN} from the example resume`);
      return json({ ok: true });
    }
    const importMatch = /^\/api\/resume\/import(?:\/(\w+))?$/.exec(path);
    if (importMatch && req.method === "POST") {
      const op = importMatch[1] ?? "start";
      let err: string | null;
      if (op === "start") {
        // Only the app's own pages may post here (refusal), and the size is checked before the body is read.
        if (Number(req.headers.get("content-length") ?? Infinity) > MAX_BYTES + 1024 * 1024) return fail("the files are too large", 413);
        // eslint-disable-next-line @typescript-eslint/no-deprecated -- the body is bounded above and comes from the app's own page
        const form = await req.formData().catch(() => null);
        if (!form) return fail("send the files as a form");
        const files = form.getAll("files").flatMap(f => (typeof f === "string" || !f.size ? [] : [f]));
        const note = form.get("note");
        err = await beginImport(files, typeof note === "string" ? note : "");
        if (!err) void scheduler.importResume();
      } else if (op === "revise") {
        const { feedback } = await body();
        err = reviseImport(typeof feedback === "string" ? feedback : "");
        if (!err) void scheduler.importResume();
      } else if (op === "accept") {
        const { notes } = await body();
        err = acceptImport(notes !== false);
        if (!err) scheduler.pump();
      } else if (op === "discard") err = discardImport();
      else if (op === "cancel") err = scheduler.cancelImport() ? null : "no import is running";
      else return fail("not found", 404);
      return err ? fail(err, 409) : json({ ok: true });
    }

    // Referral outreach (src/outreach.ts). Nothing here sends a message or reaches LinkedIn.
    if (path === "/api/referrals" && req.method === "GET") return json(referralsState());
    if (path === "/api/referrals/jobs" && req.method === "GET") return json({ jobs: jobOptions(url.searchParams.get("company") ?? "") });
    if (path === "/api/referrals/contacts" && req.method === "POST") {
      const added = addContact(await body());
      return typeof added === "string" ? fail(added, 409) : json(added);
    }
    const contactMatch = /^\/api\/referrals\/contacts\/(\d+)$/.exec(path);
    if (contactMatch && req.method === "POST") {
      const err = changeContact(Number(contactMatch[1]), await body());
      return err ? fail(err, err === "no such contact" ? 404 : 409) : json({ ok: true });
    }
    if (path === "/api/referrals/import" && req.method === "POST") {
      // Only the app's own pages may post here (refusal), and the size is checked before the body is read.
      if (Number(req.headers.get("content-length") ?? Infinity) > REFERRAL_EXPORT_BYTES) return fail("the file is too large", 413);
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- the body is bounded above and comes from the app's own page
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!file || typeof file === "string" || !file.size) return fail("send the export as a form with one file");
      const modified = Number(form?.get("modified"));
      try {
        return json(importLinkedInExport(file.name, new Uint8Array(await file.arrayBuffer()), Number.isFinite(modified) && modified > 0 ? modified : null));
      } catch (err) {
        return fail(errorMessage(err), 422);
      }
    }
    if (path === "/api/referrals/mail" && req.method === "POST") {
      try {
        return json(await syncReferralMail());
      } catch (err) {
        return fail(errorMessage(err), 502);
      }
    }

    const profileMatch = /^\/api\/profile\/([\w.-]+)$/.exec(path);
    if (profileMatch) {
      const name = profileMatch[1] ?? "";
      if (!PROFILE_FILES.includes(name)) return fail("unknown profile file", 404);
      const file = profilePath(name);
      if (req.method === "PUT") {
        writeFileSync(file, await req.text());
        logEvent("user", `edited profile/${name}`);
        scheduler.pump();
        return json({ ok: true });
      }
      return new Response(existsSync(file) ? readFileSync(file, "utf8") : "", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const slot = Math.min(Math.max(0, Number(url.searchParams.get("browser")) || 0), browserCount() - 1);
    if (path === "/api/browser/tabs") return json(await tabs(slot));
    if (path === "/api/browser/screenshot") {
      const png = await screenshot(slot, url.searchParams.get("tab") ?? undefined);
      return png ? new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : fail("browser not running", 404);
    }

    if (path === "/oauth/start") {
      try {
        return Response.redirect(gmail.authUrl());
      } catch (err) {
        return fail(errorMessage(err));
      }
    }
    if (path === "/oauth/callback") {
      const code = url.searchParams.get("code");
      if (!code) return fail(url.searchParams.get("error") ?? "no code returned");
      try {
        await gmail.exchangeCode(code, url.searchParams.get("state"));
        logEvent("system", `Gmail connected: ${gmail.gmailStatus().address}`);
        return Response.redirect("/#settings");
      } catch (err) {
        return fail(errorMessage(err), 500);
      }
    }

    return fail("not found", 404);
  };
}

// Starts the app: the HTTP server, a pacing proxy per browser, and the scheduler.
export function main() {
  const seeded = seedProfile();
  if (seeded.length) logEvent("system", `Copied the example ${seeded.join(", ")} into profile/: fill them in on the Profile page`);
  void modelCatalog(); // read once now, so the setup count in the summary knows the models
  const scheduler = new Scheduler();
  const server = Bun.serve({
    hostname: "127.0.0.1", // holds credentials and controls a logged-in browser: local only. `tailscale serve` publishes it to the tailnet
    port: config.port,
    idleTimeout: 0,
    fetch: createHandler(scheduler),
  });
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      killAllWorkers();
      process.exit(0);
    });
  for (let slot = 0; slot < browserCount(); slot++) startCdpProxy(slot);
  scheduler.start();
  console.log(`auto-apply running at http://127.0.0.1:${server.port}`);
}

if (import.meta.main) main();
