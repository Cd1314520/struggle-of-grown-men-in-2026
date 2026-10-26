// Locate: a job that passed triage on a job-search site is pointed at the employer's own posting.
import { addCompany, fetchDescription, watchBoardOf } from "./ats";
import { isBoardUrl, linkedinDescription, probeEmployer } from "./boards";
import { config } from "./config";
import { findTwin, jobsByStatus, kvGet, kvSet, logEvent, relocateJob, updateJob } from "./db";
import { countOne, usedToday } from "./limits";
import { arg, S, schema, type RunWorker } from "./worker";
import { to } from "./status";
import { addCompanyTool, render, workDir } from "./worker-tools";

const LOCATE_BATCH = 8;
const NOT_EMPLOYER = /(linkedin|indeed|dice|ziprecruiter|glassdoor|simplyhired|monster|lensa|builtin|jooble|talent|careerbuilder|jobgether|google)\.com\//i;
export const locatePerDay = () => config.limits.locatePerDay ?? 40;

// Jobs that passed triage on a LinkedIn or Indeed listing: find the employer's own posting, first on
// the public boards (free), then with a web-search agent. What cannot be found is skipped.
export async function locateEmployerPostings(run: RunWorker) {
  for (const job of jobsByStatus("locating")) {
    if (!isBoardUrl(job.url)) {
      updateJob(job.id, to.triaged());
      continue;
    }
    const hit = await probeEmployer(job);
    if (!hit) continue;
    addCompany(hit.company);
    relocateJob(job, hit.posting.url, hit.posting.description ?? (await fetchDescription(hit.posting.url)));
    logEvent("system", `Found on the employer's board: ${hit.company.ats}/${hit.company.slug}`, job.id, "locate");
  }
  const cap = locatePerDay();
  for (;;) {
    const room = Math.min(LOCATE_BATCH, cap - usedToday("locate"));
    const batch = room > 0 ? jobsByStatus("locating", room) : [];
    if (!batch.length) break;
    const open = new Map(batch.map(j => [j.id, j]));
    for (const j of batch) {
      countOne("locate");
      kvSet(`locate.tries.${j.id}`, String(Number(kvGet(`locate.tries.${j.id}`) ?? 0) + 1));
    }
    const { done } = run({
      name: "locate",
      builtins: ["read", "write", "web_search"],
      model: config.models.locate,
      cwd: workDir(),
      maxTime: "25m",
      prompt: render("locate", { jobs: batch.map(j => `${j.id} | ${j.company} | ${j.title} | ${j.location ?? "?"} | ${j.source}`).join("\n") }),
      tools: {
        found_posting: {
          description: "Record the employer's own posting for one job.",
          parameters: schema({
            job_id: S.int("Job id from the list"),
            url: S.str("Direct URL of the posting on the employer's site"),
            description: S.str("Full job description text from that page"),
          }),
          handler: async args => {
            const job_id = arg.int(args, "job_id"),
              url = arg.str(args, "url");
            const job = open.get(job_id);
            if (!job) return "ERROR: unknown job id, or already reported.";
            if (!/^https?:\/\//i.test(url) || NOT_EMPLOYER.test(url))
              return "ERROR: that is a job site, not the employer's own posting. Find the employer's page or call no_posting.";
            const status = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(20_000) }).then(
              r => r.status,
              () => 0,
            );
            if (status === 404 || status === 410) return `ERROR: that URL answers ${status}. Check it, or call no_posting.`;
            open.delete(job_id);
            const text = (arg.optStr(args, "description") ?? "").trim();
            const merged =
              relocateJob(
                job,
                url,
                text.length >= 300 ? text : ((await fetchDescription(url)) ?? job.description ?? (await linkedinDescription(job.url)) ?? text),
              ) === "merged";
            logEvent("system", `Found the employer's posting: ${url}`, merged ? null : job_id, "locate");
            const board = await watchBoardOf(url, job.company);
            if (board) logEvent("system", `Watching ${board.name}'s board (${board.ats}/${board.slug}), found through a posting`, null, "locate");
            return merged ? "Recorded (that posting was already known)." : "Recorded.";
          },
        },
        // The board's feed may list the job even when its pages cannot be read from a search.
        add_company: addCompanyTool(postings => {
          const same = [...open.values()].flatMap(j =>
            postings
              .filter(p => findTwin({ company: j.company, title: p.title, description: null }, [j]))
              .map(p => `job ${j.id}: ${p.title} | ${p.location ?? "?"} | ${p.url}`),
          );
          return same.length
            ? `\nOn this board, with a title matching a job in your list:\n${same.slice(0, 12).join("\n")}`
            : "\nNo posting on this board has a title matching a job in your list.";
        }),
        no_posting: {
          description: "Report that a job has no findable posting on the employer's own site.",
          parameters: schema({ job_id: S.int("Job id from the list"), reason: S.str("Short reason") }),
          handler: args => {
            const job_id = arg.int(args, "job_id");
            if (!open.delete(job_id)) return "ERROR: unknown job id, or already reported.";
            updateJob(job_id, to.skipped(`no posting on the employer's own site: ${arg.str(args, "reason")}`));
            return "Recorded.";
          },
        },
        locate_done: {
          description: "Finish the task.",
          parameters: schema({ summary: S.str("One-line summary") }),
          handler: args => (logEvent("system", `Locate: ${arg.str(args, "summary")}`), "Done."),
        },
      },
    });
    const res = await done;
    // Unreported jobs get one more attempt, then give way.
    for (const j of open.values())
      if (Number(kvGet(`locate.tries.${j.id}`)) >= 2) updateJob(j.id, to.skipped("could not find a posting on the employer's own site"));
    if (res.status !== "completed") break;
  }
}
