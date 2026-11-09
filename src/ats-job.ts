import { existsSync } from "node:fs";
import type { Job } from "./db";
import { resumeFiles } from "./resume";
import { scoreResume, type AtsReport } from "./ats-score";

export function scoreJob(job: Job): AtsReport | null {
  const { pdf } = resumeFiles(job.id, job.resume_sha);
  if (!existsSync(pdf)) return null;
  return scoreResume({ pdf, posting: { url: job.url, title: job.title, description: job.description } });
}
