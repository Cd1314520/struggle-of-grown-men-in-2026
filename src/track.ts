// Track: read the application mailbox and record what it says about applications already sent.
import { config } from "./config";
import { applicationsAwaitingOutcome, kvGet, kvSet, logEvent, updateJob } from "./db";
import * as gmail from "./gmail";
import { arg, S, schema, type RunWorker } from "./omp";
import { MAIL_OUTCOMES, to } from "./status";
import { gmailTools, render, workDir } from "./worker-tools";

export async function trackMailbox(run: RunWorker) {
  if (!gmail.gmailStatus().connected) return;
  const open = applicationsAwaitingOutcome();
  if (!open.length) return;
  const since = kvGet("last.track") ?? new Date(Date.now() - 7 * 86400_000).toISOString();
  const started = new Date().toISOString();
  const ids = new Set(open.map(j => j.id));
  let finished = false as boolean; // set from the tool callback
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
      applications: open.map(j => `${j.id} | ${j.company} | ${j.title} | ${j.submitted_at?.slice(0, 10) ?? "?"}`).join("\n"),
    }),
    tools: {
      ...gmailTools(),
      update_application: {
        description: "Record what a message means for one application.",
        parameters: schema({
          job_id: S.int("Application id from the list"),
          status: { type: "string", enum: [...MAIL_OUTCOMES] },
          note: S.str("One line with the key fact"),
        }),
        handler: args => {
          const job_id = arg.int(args, "job_id"),
            note = arg.str(args, "note");
          const status = arg.oneOf(args, "status", MAIL_OUTCOMES);
          if (!ids.has(job_id)) return "ERROR: unknown application id.";
          updateJob(job_id, to.outcome(status, note));
          logEvent("mail", `${status}: ${note}`, job_id, "track");
          return "Recorded.";
        },
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
