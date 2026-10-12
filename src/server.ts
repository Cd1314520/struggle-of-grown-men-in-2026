import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { feedNames, loadCompanies } from "./ats";
import { isBoardUrl } from "./boards";
import { screenshot, tabs } from "./chrome";
import { browserCount, config, jobDir, PROFILE, ROOT, STOCK_MAIN, vncUrl } from "./config";
import { db, getJob, insertJob, openedAt, kvGet, kvSet, logEvent, onChange, updateJob, type Job } from "./db";
import * as gmail from "./gmail";
import { startCdpProxy } from "./cdp-proxy";
import { killAllWorkers } from "./omp";
import { MAIN, PDF_NAME, resumeFiles, workingPdf } from "./resume";
import { autoApply } from "./auto";
import { currentThreshold } from "./rubric";
import { abortFill, activeFillSession, autoApprovedToday, fillSlot, forgetDeferredApproval, isRunning, manualBrowserReserved, profileProblems, pump, releaseBrowser, reserveBrowser, respond, scan, scheduleRecovery, startScheduler, track } from "./pipeline";
import { answerGate, getOpenGate, listQuestionGroups, readCheckpoint, resolveAmbiguous } from "./questions";
import { digestStatus, sendQuestionDigest } from "./digest";
import { errorMessage } from "./errors";
import { isSubmitting, recoveryMode } from "./fill-state";

const PROFILE_FILES = ["targets.md", "rubric.yml", MAIN, "resume-notes.md", "answers.md", "personal.yml", "companies.yml"];
const safeThreshold = () => {
  try {
    return currentThreshold();
  } catch {
    return null;
  }
};
// The resume content file lives in the resume project, everything else in profile/.
const profilePath = (name: string) => (name === MAIN ? STOCK_MAIN : join(PROFILE, name));
const json = (data: unknown, status = 200) => Response.json(data, { status });
const fail = (message: string, status = 400) => json({ error: message }, status);

function resumeDiff(job: Job) {
  const tailored = resumeFiles(job.id, job.resume_sha).main;
  if (!existsSync(tailored)) return "";
  const out = Bun.spawnSync(["git", "diff", "--no-index", "--no-color", "-U2", STOCK_MAIN, tailored]);
  return out.stdout.toString().split("\n").slice(4).join("\n");
}

function state() {
  const jobs = db
    .query<Job, []>(
      "SELECT id, url, source, company, title, location, status, score, pending, note, found_at, posted_at, updated_at, submitted_at FROM jobs WHERE status NOT IN ('found', 'skipped') ORDER BY updated_at DESC LIMIT 500",
    )
    .all()
    .map(j => ({ ...j, opened_at: openedAt(j) }));
  const counts = Object.fromEntries(
    db.query<{ status: string; n: number }, []>("SELECT status, count(*) n FROM jobs GROUP BY status").all().map(r => [r.status, r.n]),
  );
  const events = db.query("SELECT id, job_id, worker, kind, message, at FROM events ORDER BY id DESC LIMIT 150").all();
  // Without the agents' step-by-step chatter: what a person scanning the feed cares about.
  const highlights = db
    .query(
      "SELECT e.id, e.job_id, e.kind, e.message, e.at, j.company, j.title FROM events e LEFT JOIN jobs j ON j.id = e.job_id WHERE e.kind NOT IN ('step', 'tool', 'agent') ORDER BY e.id DESC LIMIT 80",
    )
    .all();
  return {
    jobs,
    counts,
    questionGroups: listQuestionGroups(),
    digest: digestStatus(),
    events,
    highlights,
    gmail: gmail.gmailStatus(),
    profileProblems: profileProblems(),
    running: { scan: isRunning("scan"), track: isRunning("track") },
    lastScan: kvGet("last.scan"),
    scanMinutes: config.schedule.scanMinutes,
    boards: loadCompanies().length + feedNames().length,
    lastTrack: kvGet("last.track"),
    confirmBeforeSubmit: config.confirmBeforeSubmit,
    autoApply: { ...autoApply(), approvedToday: autoApprovedToday() },
    applyPerDay: config.limits.applyPerDay,
    threshold: safeThreshold(),
    vncUrl: config.chrome.vncPort ? vncUrl() : null,
    browsers: config.chrome.vncPort ? Array.from({ length: browserCount() }, (_, slot) => vncUrl(slot)) : [],
    redirectUri: gmail.redirectUri(),
    mailbox: config.mailbox,
    phase: config.phase,
    home: config.boards?.location.split(",")[0]?.trim() || null,
    profileFiles: PROFILE_FILES,
  };
}

function jobAction(job: Job, action: string, text: string) {
  const gate = getOpenGate(job.id);
  const ambiguous = gate?.kind === "submission_ambiguous" || isSubmitting(job.id);
  if (ambiguous && !["reject", "mark_submitted", "confirmed_not_submitted"].includes(action))
    return "submission may already have occurred; inspect it, then mark submitted, confirm not submitted, or reject";
  switch (action) {
    case "approve":
      if (job.status !== "awaiting_approval") return "not awaiting approval";
      updateJob(job.id, { status: "approved", approved_by: "user", note: null });
      break;
    case "reject":
      abortFill(job.id);
      updateJob(job.id, { status: "rejected", pending: null, note: text || null });
      break;
    case "redo": // re-run scoring/tailoring with the user's feedback
      if (!text) return "feedback text required";
      abortFill(job.id);
      kvSet(`feedback.${job.id}`, text);
      updateJob(job.id, { status: "triaged", pending: null, note: "redo requested" });
      break;
    case "retry":
      if (!["failed", "rejected", "skipped", "held"].includes(job.status)) return "nothing to retry";
      // A held job the user picks out by hand is assessed and tailored regardless of the phase rules.
      if (job.status === "held") kvSet(`feedback.${job.id}`, "The candidate chose to apply to this job now. Do not hold it back.");
      kvSet(`locate.tries.${job.id}`, "0");
      updateJob(job.id, { status: existsSync(workingPdf(job.id)) ? "awaiting_approval" : isBoardUrl(job.url) ? "locating" : "triaged", note: null });
      break;
    case "mark_submitted": // user finished it by hand
      abortFill(job.id);
      updateJob(job.id, { status: "submitted", pending: null, note: text || "submitted manually", submitted_at: new Date().toISOString() });
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
  pump();
  return null;
}

const server = Bun.serve({
  hostname: "127.0.0.1", // holds credentials and controls a logged-in browser: local only, reach it over an SSH tunnel
  port: config.port,
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    const body = async () => (await req.json().catch(() => ({}))) as Record<string, unknown>;

    if (path === "/") return new Response(Bun.file(process.env["AUTO_APPLY_UI"] ?? join(ROOT, "ui/index.html")));
    if (path === "/api/state") return json(state());

    if (path === "/api/questions" && req.method === "GET") return json({ groups: listQuestionGroups() });
    const answerMatch = /^\/api\/questions\/([^/]+)\/answer$/.exec(path);
    if (answerMatch && req.method === "POST") {
      const { answer, scope } = await body();
      if (typeof answer !== "string" || !answer.trim()) return fail("answer text required");
      if (scope !== "application" && scope !== "standing") return fail("scope must be application or standing");
      try {
        const { jobIds } = answerGate(decodeURIComponent(answerMatch[1] ?? ""), answer.trim(), scope);
        logEvent("user", `Answered question (${scope}); queued applications: ${jobIds.join(", ")}`);
        pump();
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
        const events = db.query("SELECT worker, kind, message, at FROM events WHERE job_id = ? ORDER BY id DESC LIMIT 200").all(job.id);
        const files = resumeFiles(job.id, job.resume_sha);
        const sources = db.query("SELECT url, source, location FROM job_sources WHERE job_id = ?").all(job.id);
        const siblings = db
          .query("SELECT id, title, status FROM jobs WHERE id != ? AND status NOT IN ('found', 'skipped') AND company_key = ? ORDER BY updated_at DESC LIMIT 20")
          .all(job.id, job.company_key ?? "");
        const gate = getOpenGate(job.id);
        const checkpoint = readCheckpoint(job.id);
        // Historical slot assignments are not ownership: ordinary parked browsers are reused.
        const slot = fillSlot(job.id);
        const browserUrl = config.chrome.vncPort && slot !== null ? vncUrl(slot) : null;
                return json({ ...job, opened_at: openedAt(job), events, sources, siblings, gate, checkpoint, browserReserved: slot !== null, manualBrowserReserved: manualBrowserReserved(job.id), submissionAmbiguous: gate?.kind === "submission_ambiguous" || (job.status !== "filling" && isSubmitting(job.id)), recoveryMode: recoveryMode(job.id), vncUrl: browserUrl, hasPdf: existsSync(files.pdf), resumeFrozen: files.frozen, pdfName: PDF_NAME, diff: resumeDiff(job) });
      }
      if (sub === "/resume.pdf") {
        const file = Bun.file(resumeFiles(job.id, job.resume_sha).pdf);
        return (await file.exists())
          ? new Response(file, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${PDF_NAME}"` } })
          : fail("no resume yet", 404);
      }
      if (sub === "/resume.png") {
        // First page as an image: phones cannot embed PDFs, and it is calmer than a PDF viewer on desktop.
        const pdf = resumeFiles(job.id, job.resume_sha).pdf;
        if (!existsSync(pdf)) return fail("no resume yet", 404);
        const out = Bun.spawnSync(["pdftoppm", "-png", "-r", "120", "-f", "1", "-l", "1", pdf]);
        return out.exitCode === 0 ? new Response(out.stdout, { headers: { "content-type": "image/png", "cache-control": "max-age=300" } }) : fail("could not render the resume", 500);
      }
      if (sub === "/gate.png") {
        const file = Bun.file(join(jobDir(job.id), "gate.png"));
        return (await file.exists()) ? new Response(file, { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : fail("no screenshot", 404);
      }
      if (sub === "/action" && req.method === "POST") {
        const { action, text, gateId } = await body();
        if (action === "respond" && gateId !== undefined && (typeof gateId !== "string" || getOpenGate(job.id)?.id !== gateId))
          return fail("this gate is no longer open; reload the application", 409);
        if (action === "confirmed_not_submitted" && (typeof gateId !== "string" || getOpenGate(job.id)?.kind !== "submission_ambiguous" || getOpenGate(job.id)?.id !== gateId))
          return fail("inspect the current ambiguous submission before resolving it; this gate has changed", 409);
        try {
          const err = jobAction(job, typeof action === "string" ? action : "", typeof text === "string" ? text.trim() : "");
          return err ? fail(err, 409) : json({ ok: true });
        } catch (err) {
          return fail(err instanceof Error ? err.message : "job action failed", 409);
        }
      }
      if (sub === "/browser" && req.method === "POST") {
        const { action, gateId } = await body();
        if (typeof gateId !== "string" || !gateId || (action !== "reserve" && action !== "release"))
          return fail("action (reserve or release) and gateId are required", 400);
        try {
          if (action === "reserve") await reserveBrowser(job.id, gateId);
          else releaseBrowser(job.id, gateId);
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
        if (open.kind !== "manual" && open.kind !== "submission_ambiguous")
          return fail("only manual handoffs and ambiguous submissions can be recovered", 400);
        const checkpoint = readCheckpoint(job.id);
        if (!checkpoint) return fail("recovery requires a saved browser checkpoint", 400);
        if (activeFillSession(job.id)) return fail("an active worker is already running for this application", 409);
        try {
          scheduleRecovery(job.id, gateId);
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
      const id = insertJob({ url: jobUrl, source: "manual", company: text(company) || new URL(jobUrl).hostname, title: text(title) || "(untitled posting)", location: null, description: null }, "triaged");
      if (!id) return fail("already known");
      pump();
      return json({ id });
    }

    if (path === "/api/run" && req.method === "POST") {
      const { what } = await body();
      if (what === "scan" || what === "discover") {
        const bad = profileProblems(["targets.md"]);
        if (bad.length) return fail("fill in profile/targets.md first");
        void scan({ discover: what === "discover" });
      } else if (what === "release_held") {
        // back through triage, which now judges them against the current phase
        const n = db.query("UPDATE jobs SET status = 'found', note = NULL, updated_at = datetime('now') WHERE status = 'held'").run().changes;
        logEvent("user", `released ${n} held jobs for re-triage`);
        void scan();
      } else if (what === "track") void track();
      else return fail("unknown run target");
      return json({ ok: true });
    }

    const profileMatch = /^\/api\/profile\/([\w.-]+)$/.exec(path);
    if (profileMatch) {
      const name = profileMatch[1] ?? "";
      if (!PROFILE_FILES.includes(name)) return fail("unknown profile file", 404);
      const file = profilePath(name);
      if (req.method === "PUT") {
        writeFileSync(file, await req.text());
        logEvent("user", `edited profile/${name}`);
        pump();
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
        await gmail.exchangeCode(code);
        logEvent("system", `Gmail connected: ${gmail.gmailStatus().address}`);
        return Response.redirect("/#settings");
      } catch (err) {
        return fail(errorMessage(err), 500);
      }
    }

    return fail("not found", 404);
  },
});

for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    killAllWorkers();
    process.exit(0);
  });

for (let slot = 0; slot < browserCount(); slot++) startCdpProxy(slot);
startScheduler();
console.log(`auto-apply running at http://127.0.0.1:${server.port}`);
