// Prep: score one job against the rubric and, when it clears, tailor the resume for it.
import { existsSync } from "node:fs";
import { autoApproval } from "./auto";
import { config, jobDir, readProfile } from "./config";
import { getJob, kvGet, logEvent, updateJob, type Job } from "./db";
import { deferApproval, forgetDeferredApproval } from "./deferred-approvals";
import { countOne, usedToday } from "./limits";
import { arg, S, schema, type RunWorker } from "./omp";
import { assessPractice } from "./practice";
import { changedTemplateFiles, MAIN, pageCount, PDF_NAME, stageResume, stockPages, workingPdf } from "./resume";
import { checklistText, evaluate, type Verdict } from "./rubric";
import { to } from "./status";
import { render } from "./worker-tools";

export async function prep(job: Job, run: RunWorker) {
  const dir = jobDir(job.id);
  stageResume(dir);
  const maxPages = stockPages();
  updateJob(job.id, to.prepping());
  const feedback = kvGet(`feedback.${job.id}`); // set when the user asked for this job explicitly
  // Both are set from tool callbacks.
  let verdict = null as Verdict | null;
  let reported = false as boolean;
  // The user can reject a job, or send it back, while its worker is still running. From then on the
  // worker's reports are for a job that is no longer its own.
  const WITHDRAWN = "ERROR: this job was taken out of prep while you were working; nothing was recorded. Stop.";
  const stillPrepping = () => getJob(job.id)?.status === "prepping";
  const { done } = run({
    name: "prep",
    builtins: ["read", "write", "edit", "bash"],
    jobId: job.id,
    model: config.models.prep,
    cwd: dir,
    maxTime: "20m",
    prompt: render("prep", {
      ...job,
      location: job.location ?? "location not stated",
      checklist: checklistText(),
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
              description:
                "Evidence for practice phase eligibility: annual base ceiling in USD, salary evidence quote, mandatory nonlocal onsite/hybrid requirement, location evidence quote.",
              properties: {
                annualBaseMaxUsd: { type: ["number", "null"], description: "Posted annual base salary ceiling in USD, or null" },
                salaryEvidence: S.str("Quote of salary evidence from job description, or empty string"),
                mandatoryNonlocalOnsite: {
                  type: "string",
                  enum: ["yes", "no", "unclear"],
                  description: "Whether mandatory nonlocal onsite/hybrid with no remote/local alternative",
                },
                locationEvidence: S.str("Quote of location evidence from job description"),
              },
              required: ["annualBaseMaxUsd", "salaryEvidence", "mandatoryNonlocalOnsite", "locationEvidence"],
              additionalProperties: false,
            },
          },
          config.phase === "practice" ? ["answers", "practice"] : ["answers"],
        ),
        handler: args => {
          if (!stillPrepping()) return WITHDRAWN;
          const answers = args["answers"],
            practice = args["practice"];
          if (config.phase === "practice") {
            if (!practice || typeof practice !== "object" || Array.isArray(practice)) {
              return "ERROR: 'practice' evidence object is required in the practice phase with annualBaseMaxUsd, salaryEvidence, mandatoryNonlocalOnsite, and locationEvidence. Call submit_checklist again with practice evidence.";
            }
            const assessed = assessPractice(practice);
            if (!assessed) {
              return "ERROR: malformed practice evidence. Ensure: annualBaseMaxUsd is a positive number or null; salaryEvidence is a non-empty quote when salary is given; mandatoryNonlocalOnsite is 'yes', 'no', or 'unclear'; and locationEvidence is a non-empty quote when mandatoryNonlocalOnsite is 'yes'. Do not include a version field. Call submit_checklist again.";
            }
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
          const pdf = workingPdf(job.id);
          if (!existsSync(pdf))
            return `ERROR: ${PDF_NAME} is missing in the working directory. Run \`typst compile ${MAIN} ${PDF_NAME}\`, then call finish_prep again.`;
          const touched = changedTemplateFiles(dir);
          if (touched.length)
            return `ERROR: template file(s) ${touched.join(", ")} were modified. Restore them exactly, edit only ${MAIN}, recompile, then call finish_prep again.`;
          const pages = pageCount(pdf);
          if (maxPages && pages && pages > maxPages)
            return `ERROR: the tailored resume is ${pages} pages; the stock resume is ${maxPages}. Trim it, recompile, then call finish_prep again.`;
          reported = true;
          const auto = autoApproval(verdict, { concerns, handPicked: !!feedback, approvedToday: usedToday("auto") });
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
  if (!reported && stillPrepping()) updateJob(job.id, to.failed(`prep did not finish: ${res.error ?? "no report"}`));
}
