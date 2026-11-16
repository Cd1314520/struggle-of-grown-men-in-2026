// Interview prep: the candidate's story bank (profile/story-bank.md, optional and never edited by the
// app) shown on an application the employer has moved on, and a short prep note a worker writes on
// request from the posting, the assessment, the resume, the answer bank and the stories.
import { existsSync, readFileSync } from "node:fs";
import { config, readProfile, STOCK_MAIN } from "./config";
import { kvGet, kvSet, logEvent, type Job } from "./db";
import { resumeFiles } from "./resume";
import type { Step } from "./steps";
import { arg, S, schema, type RunWorker } from "./worker";
import { render, workDir } from "./worker-tools";

export interface InterviewPrep {
  stories: string; // profile/story-bank.md as it stands
  note: string | null;
  noteAt: string | null;
  writing: boolean;
}

// Steps that mean someone will talk to, or test, the candidate.
const PREP_KINDS: readonly Step["kind"][] = ["interview", "assessment", "schedule"];
const writing = new Set<number>();
const noteKey = (jobId: number) => `interview.note.${jobId}`;

export const needsPrep = (job: Pick<Job, "status">, steps: readonly Pick<Step, "kind">[]) =>
  ["interview", "offer"].includes(job.status) || steps.some(s => PREP_KINDS.includes(s.kind));

// What the job's page shows, or null when there is no story bank or nothing to prepare for.
export function interviewPrep(job: Job, steps: readonly Step[]): InterviewPrep | null {
  const stories = readProfile("story-bank.md").trim();
  if (!stories || !needsPrep(job, steps)) return null;
  const saved = kvGet(noteKey(job.id));
  const note = saved ? (JSON.parse(saved) as { note: string; at: string }) : null;
  return { stories, note: note?.note ?? null, noteAt: note?.at ?? null, writing: writing.has(job.id) };
}

const stepLines = (steps: readonly Step[]) =>
  steps.length
    ? steps.map(s => `- ${s.kind}: ${s.title}${s.scheduled_at ? `, at ${s.scheduled_at}` : ""}${s.detail ? `. ${s.detail}` : ""}`).join("\n")
    : "(none recorded)";

// Writes the prep note for one application. Returns what went wrong, or null once it has started.
export function writePrepNote(run: RunWorker, job: Job, steps: readonly Step[]): string | null {
  if (writing.has(job.id)) return "a prep note is already being written";
  if (!interviewPrep(job, steps)) return "no story bank, or nothing to prepare for on this application";
  const resume = resumeFiles(job.id, job.resume_sha).main;
  writing.add(job.id);
  let saved = false as boolean; // set from the tool callback
  const { done } = run({
    name: "interview",
    stage: "prep",
    builtins: [],
    model: config.models.prep,
    cwd: workDir(),
    jobId: job.id,
    maxTime: "15m",
    prompt: render("interview", {
      company: job.company,
      title: job.title,
      description: job.description || "(not captured)",
      rationale: job.rationale ?? "(none)",
      concerns: job.concerns ?? "(none)",
      steps: stepLines(steps),
      resume: readFileSync(existsSync(resume) ? resume : STOCK_MAIN, "utf8"),
      answers: readProfile("answers.md"),
      stories: readProfile("story-bank.md"),
    }),
    tools: {
      save_prep_note: {
        description: "Save the finished prep note for the candidate. Call once; this ends your work.",
        parameters: schema({ note: S.str("The prep note, in Markdown") }),
        handler: args => {
          kvSet(noteKey(job.id), JSON.stringify({ note: arg.str(args, "note").trim(), at: new Date().toISOString() }));
          saved = true;
          logEvent("system", "Interview prep note written", job.id, "interview");
          return "Saved. Stop now.";
        },
      },
    },
  });
  void done
    .catch(() => undefined)
    .finally(() => {
      writing.delete(job.id);
      if (!saved) logEvent("error", "Interview prep note did not finish", job.id, "interview");
    });
  return null;
}
