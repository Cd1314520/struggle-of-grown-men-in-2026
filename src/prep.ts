// Prep: score one job against the rubric and, when it clears, tailor the resume for it.
import { existsSync } from "node:fs";
import { autoApply, autoApproval, employerCapNote } from "./auto";
import { config, describing, jobDir, readProfile } from "./config";
import { appliedLocation, employerApplications, getJob, jobSources, kvGet, logEvent, updateJob, type Job } from "./db";
import { deferApproval, forgetDeferredApproval } from "./deferred-approvals";
import { countOne, uncountOne, usedToday } from "./limits";
import { arg, S, schema, type RunWorker } from "./worker";
import { employerListing, employersText, rememberedEmployer } from "./employers";
import { isCapacityError } from "./errors";
import { assessPractice, targetsKey, type PracticeAssessment } from "./practice";
import { changedTemplateFiles, compileWorking, MAIN, pageCount, PDF_NAME, stageResume, stockPages, workingPdf } from "./resume";
import { checklistText, evaluate, screenChecklistText, screenVerdict, type Verdict } from "./rubric";
import { to } from "./status";
import { screenPosting } from "./screen";
import { render } from "./worker-tools";

export async function prep(job: Job, run: RunWorker) {
  const feedback = kvGet(`feedback.${job.id}`); // set when the user asked for this job explicitly
  // The listing that would be applied through, not the other offices the same role is listed for.
  const location = appliedLocation(job);
  // What the text alone rules out, for jobs that skipped triage or whose description came after it.
  const out = feedback ? null : screenPosting(location, job.description);
  if (out) {
    uncountOne("prep");
    updateJob(job.id, to.skipped(out));
    return;
  }
  // Auto apply could not take it whatever the assessment said: not worth one.
  const capped = feedback ? null : employerCapped(job);
  if (capped) {
    uncountOne("prep");
    updateJob(job.id, to.skipped(capped));
    return;
  }
  // An employer judged before settles what the full assessment would only judge again.
  const settled = feedback ? null : settledByEmployer(job);
  if (settled) {
    // The real rubric decides whether a job held for the real search is worth keeping. Its plain
    // requirements are left to the cheap screen, when it runs; the rest wait until the job is released.
    if (job.description && config.screen?.readPostings) {
      const screened = await screen(job, location, run, "frontier");
      if (screened !== "pass") {
        uncountOne("prep");
        if (screened === "capacity") updateJob(job.id, to.triaged("assessing again: the model provider was at capacity"));
        return;
      }
    }
    uncountOne("prep");
    updateJob(job.id, { ...to.held(settled.reason), practice_assessment: settled.practice ? JSON.stringify(settled.practice) : null });
    return;
  }
  // The screen only rules jobs out: the full assessment answers every statement again, its own too.
  if (!feedback && job.description && config.screen?.readPostings) {
    const screened = await screen(job, location, run);
    if (screened !== "pass") {
      uncountOne("prep");
      if (screened === "capacity") updateJob(job.id, to.triaged("assessing again: the model provider was at capacity"));
      return;
    }
  }
  const elsewhere = jobSources(job.id)
    .filter(listing => listing.url !== job.url && listing.location && listing.location !== location)
    .map(listing => listing.location);
  const dir = jobDir(job.id);
  stageResume(dir);
  const maxPages = stockPages();
  updateJob(job.id, to.prepping());
  // Both are set from tool callbacks.
  let verdict = null as Verdict | null;
  let reported = false as boolean;
  // The user can reject a job, or send it back, while its worker is still running. From then on the
  // worker's reports are for a job that is no longer its own.
  const WITHDRAWN = "ERROR: this job was taken out of prep while you were working; nothing was recorded. Stop.";
  const stillPrepping = () => getJob(job.id)?.status === "prepping";
  const { done } = run({
    name: "prep",
    // No shell: the job description it reads comes from anyone who can post a job, and a shell would
    // let a planted instruction run commands on this machine. finish_prep compiles the resume itself.
    builtins: ["read", "write", "edit"],
    jobId: job.id,
    model: config.models.prep,
    cwd: dir,
    maxTime: "20m",
    prompt: render("prep", {
      ...job,
      location: location ?? "location not stated",
      otherListings: elsewhere.length
        ? `\nThe same role is also listed for: ${[...new Set(elsewhere)].join("; ")}. Those are separate postings. Judge where the job is, its attendance rules and its pay only from the posting above, which is the one the application goes through.\n`
        : "",
      checklist: checklistText(),
      employers: employersText(undefined, [job.company]),
      targets: describing()
        ? `- \`target\`: \`yes\` when the employer fits the candidate's description of a target employer below, \`no\` when it does not. Judge the employer as a whole, not this team or role.\n\n  > ${(config.targets.describe ?? "").trim().replace(/\s+/g, " ")}\n\n`
        : "",
      notes: readProfile("resume-notes.md"),
      main: MAIN,
      pdfName: PDF_NAME,
      description: job.description || "(not captured; read it from the URL)",
      feedback: feedback ? `\n## Note from the candidate\n\n${feedback}\n` : "",
    }),
    tools: {
      submit_checklist: {
        description: "Submit your answer to every checklist statement. The orchestrator computes the score and tells you whether to continue.",
        parameters: schema(
          {
            answers: {
              type: "array",
              items: schema({
                id: S.str("Checklist id exactly as given, e.g. practice.python"),
                answer: { type: "string", enum: ["yes", "no", "unclear"] },
                evidence: S.str("Short quote or fact from the posting or resume that decides it; empty if unclear"),
              }),
            },
            practice: {
              type: "object",
              description: "What kind of employer this is, and whether its engineering organisation is agent-native.",
              properties: {
                ...(describing()
                  ? {
                      target: {
                        type: "string",
                        enum: ["yes", "no"],
                        description: "Whether the employer fits the candidate's description of a target employer",
                      },
                    }
                  : {}),
                employerEvidence: S.str("One sentence naming what about the company decides what kind of employer it is"),
                agentNative: {
                  type: "string",
                  enum: ["yes", "no", "unclear"],
                  description: "Whether the engineering organisation visibly builds and ships with AI agents",
                },
                agentNativeEvidence: S.str("The fact that decides a yes or no; empty only if unclear"),
              },
              required: [...(describing() ? ["target"] : []), "employerEvidence", "agentNative", "agentNativeEvidence"],
              additionalProperties: false,
            },
          },
          ["answers", "practice"],
        ),
        handler: args => {
          if (!stillPrepping()) return WITHDRAWN;
          const answers = args["answers"];
          let practice = args["practice"];
          if (!practice || typeof practice !== "object" || Array.isArray(practice)) {
            return `ERROR: the 'practice' object is required, with ${describing() ? "target, " : ""}employerEvidence, agentNative and agentNativeEvidence. Call submit_checklist again with it.`;
          }
          // Whether the employer is on one of the candidate's lists, and the description it was judged
          // against, are the host's to say, not the worker's.
          const { target } = practice as Record<string, unknown>;
          practice = {
            ...practice,
            target: describing() ? target : null,
            listed: employerListing(job.company),
            against: targetsKey(config.targets.describe ?? ""),
          };
          if (!assessPractice(practice) || (describing() && target !== "yes" && target !== "no")) {
            return `ERROR: malformed practice evidence. Ensure: ${describing() ? "target is 'yes' or 'no'; " : ""}employerEvidence is a non-empty sentence; agentNative is 'yes', 'no', or 'unclear', with agentNativeEvidence stating the deciding fact unless unclear. Do not include a version field. Call submit_checklist again.`;
          }
          const result = evaluate(answers, practice);
          if (typeof result === "string") return `ERROR: ${result}. Call submit_checklist again with every statement answered.`;
          verdict = result;
          const fields = {
            score: result.score,
            checklist: JSON.stringify(result.items),
            practice_assessment: result.practice ? JSON.stringify(result.practice) : null,
          };
          // A job the user asked for by hand is tailored whatever the checklist says.
          if (result.decision === "apply" || feedback) {
            updateJob(job.id, fields);
            return `Checklist recorded (${result.reason}). CONTINUE: tailor the resume, then call finish_prep.`;
          }
          reported = true;
          updateJob(job.id, { ...fields, ...(result.decision === "hold" ? to.held(result.reason) : to.skipped(result.reason)) });
          return `Checklist recorded: ${result.reason}. STOP: do not tailor a resume; you are done.`;
        },
      },
      finish_prep: {
        description: "Report the tailored resume for this job. Only after submit_checklist told you to continue.",
        parameters: schema({
          rationale: S.str("At most two short sentences: what the role is and the strongest reason the candidate fits"),
          concerns: S.str("At most two short lines about real gaps or risks of this job; empty string if none"),
          resume_changes: S.str("Up to five short bullets: what changed in the resume and why"),
        }),
        handler: args => {
          const rationale = arg.str(args, "rationale"),
            concerns = arg.str(args, "concerns"),
            resume_changes = arg.str(args, "resume_changes");
          if (!stillPrepping()) return WITHDRAWN;
          if (!verdict) return "ERROR: call submit_checklist first.";
          if (reported) return "ERROR: this job was already closed by the checklist; nothing more to do.";
          // Compiled here, not trusted from the worker: its sandbox may not run typst, and the PDF must match MAIN.
          const failed = compileWorking(dir);
          if (failed) return `ERROR: ${MAIN} does not compile. Fix it, then call finish_prep again. typst said:\n${failed}`;
          const pdf = workingPdf(job.id);
          if (!existsSync(pdf)) return `ERROR: ${PDF_NAME} was not written; call finish_prep again.`;
          const touched = changedTemplateFiles(dir);
          if (touched.length)
            return `ERROR: template file(s) ${touched.join(", ")} were modified. Restore them exactly, edit only ${MAIN}, recompile, then call finish_prep again.`;
          const pages = pageCount(pdf);
          if (maxPages && pages && pages > maxPages)
            return `ERROR: the tailored resume is ${pages} pages; the stock resume is ${maxPages}. Trim it, recompile, then call finish_prep again.`;
          reported = true;
          const auto = autoApproval(verdict, {
            concerns,
            handPicked: !!feedback,
            approvedToday: usedToday("auto"),
            employerApplications: employerApplications(job),
          });
          if (auto.deferred === "daily_cap") {
            deferApproval(job.id);
          } else {
            forgetDeferredApproval(job.id);
          }
          updateJob(job.id, {
            ...(auto.approve ? to.approved("auto") : { ...to.awaitingApproval(auto.note), approved_by: null }),
            rationale,
            concerns: concerns || null,
            resume_changes: resume_changes || null,
            practice_assessment: verdict.practice ? JSON.stringify(verdict.practice) : null,
          });
          if (auto.approve) {
            countOne("auto");
            logEvent("auto", `Approved by auto apply: ${verdict.reason}`, job.id, "prep");
          }
          return "Recorded.";
        },
      },
    },
  });
  const res = await done;
  if (reported || !stillPrepping()) return;
  if (isCapacityError(res.error)) {
    // The provider stopped it, not the job: back in the queue, and the day's count given back.
    uncountOne("prep");
    updateJob(job.id, to.triaged("assessing again: the model provider was at capacity"));
  } else updateJob(job.id, to.failed(`prep did not finish: ${res.error ?? "no report"}`));
}

// Why auto apply would never take this job: its employer already has autoApply.perEmployer applications.
function employerCapped(job: Job): string | null {
  const rules = autoApply();
  if (!rules.enabled) return null;
  const others = employerApplications(job);
  return others >= rules.perEmployer ? employerCapNote(others) : null;
}

// What the employer alone decides about a job, before a full assessment is spent on it: while target
// employers are held back, a job at one is held without the practice assessment. The lists in
// profile/employers.yml outrank an earlier judgment, and a practice-listed employer is left to the full
// assessment.
function settledByEmployer(job: Job): { reason: string; practice: PracticeAssessment | null } | null {
  if (!config.targets.holdBack) return null;
  const listed = employerListing(job.company);
  if (listed === "practice") return null;
  const unassessed = "held without a full assessment until it is released";
  if (listed === "frontier") return { reason: `not a practice job: the employer is on your frontier list; ${unassessed}`, practice: null };
  const known = rememberedEmployer(job);
  if (known?.assessment.target !== "yes") return null;
  return {
    reason: `not a practice job: a target employer, as judged on job #${known.jobId} (${known.assessment.employerEvidence}); ${unassessed}`,
    practice: { ...known.assessment, listed: null },
  };
}

// A cheap model reads the posting for the requirements it settles on its own, and a job that plainly
// fails them is skipped without the full assessment. Anything else, including a screen that does not
// finish, goes on to prep: the screen can only rule a job out. Runs only with `screen.readPostings`.
// `listed` is the list the employer counts as being on, which decides the rubrics asked.
async function screen(
  job: Job,
  location: string | null | undefined,
  run: RunWorker,
  listed = employerListing(job.company),
): Promise<"pass" | "stop" | "capacity"> {
  let out = null as string | null; // set from the tool callback
  const { done } = run({
    name: "screen",
    builtins: [],
    jobId: job.id,
    model: config.models.screen,
    cwd: jobDir(job.id),
    maxTime: "5m",
    prompt: render("screen", {
      ...job,
      location: location ?? "location not stated",
      checklist: screenChecklistText(listed),
    }),
    tools: {
      screen_result: {
        description: "Submit your answer to every statement.",
        parameters: schema({
          answers: {
            type: "array",
            items: schema({
              id: S.str("Statement id exactly as given, e.g. practice.not_senior"),
              answer: { type: "string", enum: ["yes", "no", "unclear"] },
              evidence: S.str("Short quote or fact from the posting that decides it; empty if unclear"),
            }),
          },
        }),
        handler: args => {
          if (getJob(job.id)?.status !== "prepping") return "ERROR: this job was taken out of prep while you were working; nothing was recorded. Stop.";
          const result = screenVerdict(args["answers"], listed);
          if (typeof result === "string") return `ERROR: ${result}. Call screen_result again with every statement answered.`;
          out = result.out;
          return "Recorded.";
        },
      },
    },
  });
  const res = await done;
  // Taken out of prep while it ran: whatever the user did with it stands.
  if (getJob(job.id)?.status !== "prepping") return "stop";
  if (out) {
    updateJob(job.id, to.skipped(out));
    return "stop";
  }
  return isCapacityError(res.error) ? "capacity" : "pass";
}
