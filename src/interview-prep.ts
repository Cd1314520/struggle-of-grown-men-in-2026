import { existsSync, readFileSync } from "node:fs";
import { config, readProfile } from "./config";
import { getJob, logEvent } from "./db";
import { resumeFiles, stockResumeSource } from "./resume";
import { bumpBriefTries, getStep, jobSteps, saveBrief, stepsNeedingBrief, type Step } from "./steps";
import { arg, S, schema, type RunWorker } from "./worker";
import { render, workDir } from "./worker-tools";

const PER_RUN = 3;

const resumeFor = (jobId: number, sha: string | null) => {
  const main = resumeFiles(jobId, sha).main;
  return existsSync(main) ? readFileSync(main, "utf8") : stockResumeSource();
};

const stepLine = (s: Step) =>
  `- ${s.kind}: ${JSON.stringify(s.title)}, ${s.state}${s.scheduled_at ? `, booked ${s.scheduled_at}` : ""}${s.done_note ? `, candidate's note: ${JSON.stringify(s.done_note)}` : ""}`;

function weakSpots(checklist: string | null) {
  if (!checklist) return "";
  try {
    const items: unknown = JSON.parse(checklist);
    if (!Array.isArray(items)) return "";
    return (items as { key?: string; label?: string; statement?: string; answer?: string }[])
      .filter(i => i.answer === "no" || i.answer === "unclear")
      .map(i => `- ${i.answer === "no" ? "missed" : "unclear"}: ${i.label ?? i.key ?? ""}. ${i.statement ?? ""}`.trim())
      .join("\n");
  } catch {
    return "";
  }
}

export async function briefInterviews(run: RunWorker) {
  for (const step of stepsNeedingBrief(PER_RUN)) {
    const job = getJob(step.job_id);
    if (!job) continue;
    bumpBriefTries(step.id);
    const others = jobSteps(job.id).filter(s => s.id !== step.id);
    let saved = false as boolean;
    const { done } = run({
      name: "interview",
      builtins: ["read", "web_search"],
      model: config.models.interview ?? null,
      cwd: workDir(),
      jobId: job.id,
      maxTime: "15m",
      prompt: render("interview-prep", {
        company: job.company,
        title: job.title,
        description: job.description ?? "(no description stored)",
        rationale: job.rationale ?? "(none)",
        concerns: job.concerns ?? "(none)",
        weak: weakSpots(job.checklist) || "(none)",
        resume: resumeFor(job.id, job.resume_sha),
        personal: readProfile("personal.yml"),
        stepTitle: step.title,
        stepKind: step.kind,
        stepDetail: step.detail ?? "(none)",
        stepWhen: step.scheduled_at ?? "(not booked)",
        stepNotes: step.done_note ?? "(none)",
        others: others.length ? others.map(stepLine).join("\n") : "(none)",
      }),
      tools: {
        save_brief: {
          description: "Save the finished interview brief (markdown) on the step.",
          parameters: schema({ brief: S.str("The whole brief, in markdown") }),
          handler: args => {
            const brief = arg.str(args, "brief").trim();
            if (brief.length < 200) return "ERROR: that is too short to be a brief. Write the sections and call save_brief again.";
            if (!getStep(step.id)) return "ERROR: this step no longer exists.";
            saveBrief(step.id, brief);
            saved = true;
            return "Saved.";
          },
        },
      },
    });
    const res = await done;
    if (saved) logEvent("system", `Interview prep written: ${step.title}`, job.id, "interview");
    else logEvent("system", `Interview prep not written: ${step.title}${res.error ? ` (${res.error})` : ""}`, job.id, "interview");
    if (res.status !== "completed") break;
  }
}
