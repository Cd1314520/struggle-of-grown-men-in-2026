// Track: read the application mailbox and record what it says about applications already sent: each
// new request from an employer becomes a step (steps.ts), and later mail moves those steps on.
import { config } from "./config";
import { applicationsAwaitingOutcome, kvGet, kvSet, logEvent, type Job } from "./db";
import * as gmail from "./gmail";
import { arg, S, schema, type RunWorker } from "./omp";
import { addStep, changeStep, getStep, openSteps, recordOutcome, STEP_KINDS, stepMs, type Step } from "./steps";
import { gmailTools, render, workDir } from "./worker-tools";

const MAIL_STEP_STATES = ["done", "scheduled", "closed", "expired", "cancelled"] as const;
const ENDINGS = ["offer", "rejected_by_company"] as const;
const day = (s: string | null | undefined) => s?.slice(0, 10) ?? "?";

// One step as the agent reads it: what it is, and whose move it is.
function stepLine(s: Step, company: string, now: number) {
  const state =
    s.state === "todo"
      ? `to do: the candidate's move${s.due_at ? `, due ${s.due_at}` : ""}`
      : s.state === "done"
        ? `done by the candidate ${day(s.done_at)}: waiting on ${company}`
        : s.scheduled_at && stepMs(s.scheduled_at) > now
          ? `booked for ${s.scheduled_at}`
          : `held ${s.scheduled_at ?? "?"}: waiting on ${company}`;
  return `   step ${s.id} · ${s.kind} · ${JSON.stringify(s.title)} · ${state}`;
}
export function applicationList(open: readonly Pick<Job, "id" | "company" | "title" | "submitted_at">[], steps: readonly Step[], now = Date.now()) {
  return open
    .map(j =>
      [`${j.id} | ${j.company} | ${j.title} | ${day(j.submitted_at)}`, ...steps.filter(s => s.job_id === j.id).map(s => stepLine(s, j.company, now))].join(
        "\n",
      ),
    )
    .join("\n");
}

export async function trackMailbox(run: RunWorker) {
  if (!gmail.gmailStatus().connected) return;
  const open = applicationsAwaitingOutcome();
  if (!open.length) return;
  const since = kvGet("last.track") ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const started = new Date().toISOString();
  const byId = new Map(open.map(j => [j.id, j]));
  const listed = (id: number) => byId.get(id);
  let finished = false as boolean; // set from the tool callback
  // A refusal goes back to the agent as text, so it can correct the call.
  const attempt = (fn: () => string) => {
    try {
      return fn();
    } catch (err) {
      return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
    }
  };
  const { done } = run({
    name: "track",
    builtins: ["read", "write"],
    model: config.models.track,
    cwd: workDir(),
    maxTime: "20m",
    prompt: render("track", {
      mailbox: gmail.gmailStatus().address ?? "",
      since,
      sinceDate: since.slice(0, 10).replaceAll("-", "/"),
      applications: applicationList(open, openSteps(open.map(j => j.id))),
    }),
    tools: {
      ...gmailTools(),
      add_step: {
        description: "Record a new request from an employer on one application: something the candidate has to do, book or attend.",
        parameters: schema(
          {
            job_id: S.int("Application id from the list"),
            kind: { type: "string", enum: [...STEP_KINDS] },
            title: S.str("Short name for it, e.g. 'HackerRank assessment, 90 min'"),
            due_at: S.str("Deadline: YYYY-MM-DD, or an ISO time with offset"),
            link: S.str("The link the candidate needs (assessment, booking page); never opened by you"),
            detail: S.str("Anything else the candidate needs: length, format, who they will meet"),
            message_id: S.str("Gmail message id it came from"),
          },
          ["job_id", "kind", "title", "message_id"],
        ),
        handler: args =>
          attempt(() => {
            const job = listed(arg.int(args, "job_id"));
            if (!job) return "ERROR: unknown application id.";
            const title = arg.str(args, "title");
            const { id, added } = addStep(job, {
              kind: arg.oneOf(args, "kind", STEP_KINDS),
              title,
              due_at: arg.optStr(args, "due_at") ?? null,
              link: arg.optStr(args, "link") ?? null,
              detail: arg.optStr(args, "detail") ?? null,
              source: "mail",
              message_id: arg.str(args, "message_id"),
            });
            if (!added) return `Already recorded as step ${id}.`;
            job.status = "interview";
            logEvent("mail", `New step: ${title}`, job.id, "track");
            return `Recorded as step ${id}.`;
          }),
      },
      update_step: {
        description: "Record what a message says about a step already listed.",
        parameters: schema(
          {
            step_id: S.int("Step id from the list"),
            state: { type: "string", enum: [...MAIL_STEP_STATES] },
            note: S.str("One line with the key fact"),
            scheduled_at: S.str("With scheduled: the booked time, ISO with offset"),
          },
          ["step_id", "state", "note"],
        ),
        handler: args =>
          attempt(() => {
            const step = getStep(arg.int(args, "step_id"));
            const job = step && listed(step.job_id);
            if (!step || !job) return "ERROR: unknown step id.";
            if (job.status === "rejected_by_company") return "ERROR: that application was rejected, which closed its steps.";
            const state = arg.oneOf(args, "state", MAIL_STEP_STATES),
              note = arg.str(args, "note");
            const scheduledAt = arg.optStr(args, "scheduled_at");
            changeStep(step.id, { state, ...(scheduledAt ? { scheduled_at: scheduledAt } : {}) });
            logEvent("mail", `${step.title}: ${state}. ${note}`, step.job_id, "track");
            return "Recorded.";
          }),
      },
      record_outcome: {
        description: "Record an offer or a rejection on one application. Closes its open steps.",
        parameters: schema({
          job_id: S.int("Application id from the list"),
          status: { type: "string", enum: [...ENDINGS] },
          note: S.str("One line with the key fact"),
        }),
        handler: args =>
          attempt(() => {
            const job = listed(arg.int(args, "job_id"));
            if (!job) return "ERROR: unknown application id.";
            const status = arg.oneOf(args, "status", ENDINGS),
              note = arg.str(args, "note");
            recordOutcome(job.id, status, note);
            job.status = status; // so later mail in this run cannot add steps to it
            logEvent("mail", `${status}: ${note}`, job.id, "track");
            return "Recorded.";
          }),
      },
      note: {
        description: "Flag a message for the candidate that matches no listed application.",
        parameters: schema({ summary: S.str("One-line summary including sender") }),
        handler: args => (logEvent("mail", arg.str(args, "summary"), null, "track"), "Noted."),
      },
      track_done: {
        description: "Finish the tracking task.",
        parameters: schema({ summary: S.str("One-line summary") }),
        handler: args => {
          finished = true;
          logEvent("system", `Track: ${arg.str(args, "summary")}`);
          return "Done.";
        },
      },
    },
  });
  await done;
  if (finished) kvSet("last.track", started);
}
