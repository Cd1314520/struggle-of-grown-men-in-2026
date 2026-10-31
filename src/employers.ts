// Employers whose category the candidate settled by hand (profile/employers.yml). Whether an
// organisation is agent-native shows poorly in a posting, so a listed employer overrides what an
// assessment judges: `frontier` ones are never spent on practice, `practice` ones always may be.
import YAML from "yaml";
import { companyKey, employerAssessments, type Job } from "./db";
import { config, readProfile } from "./config";
import { parsePracticeAssessment, targetsKey, type Listed, type PracticeAssessment } from "./practice";

interface EmployerLists {
  frontier: string[];
  practice: string[];
}

const names = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === "string" && !!n.trim()) : []);

// Read on every call, like rubric.yml: edits take effect on the next job.
export function loadEmployers(): EmployerLists {
  try {
    const parsed = YAML.parse(readProfile("employers.yml")) as Record<string, unknown> | null;
    return { frontier: names(parsed?.["frontier"]), practice: names(parsed?.["practice"]) };
  } catch {
    return { frontier: [], practice: [] };
  }
}

export function employerListing(company: string, lists = loadEmployers()): Listed | null {
  const key = companyKey(company);
  if (!key) return null;
  if (lists.frontier.some(n => companyKey(n) === key)) return "frontier";
  if (lists.practice.some(n => companyKey(n) === key)) return "practice";
  return null;
}

// The lists as the triage, prep and discover prompts show them. Given `companies`, only the listed
// employers among them: triage and prep judge those alone, and the whole list would go with every call.
export function employersText(lists = loadEmployers(), companies?: string[]) {
  const keys = companies && new Set(companies.map(companyKey));
  const only = (l: string[]) => (keys ? l.filter(n => keys.has(companyKey(n))) : l);
  const line = (l: string[]) => (only(l).length ? only(l).join(", ") : keys ? "(none of these employers)" : "(none)");
  return `- Frontier (agent-native, at scale; real targets): ${line(lists.frontier)}\n- Practice (behind; fine to practise on): ${line(lists.practice)}`;
}

// What earlier assessments made of a job's employer against the description of a target employer in
// use now, so one employer is judged the same way every time. One that judged it a target settles it:
// holding a job back costs a review, while practising on a target costs its record of the candidate.
// Otherwise the most recent judgment stands. Only full assessments count, not the copies held jobs
// carry. `jobId` is the job the judgment was made on.
export function rememberedEmployer(job: Pick<Job, "id" | "company_key">): { assessment: PracticeAssessment; jobId: number } | null {
  const key = targetsKey(config.targets.describe ?? "");
  if (!key) return null;
  let latest = null as { assessment: PracticeAssessment; jobId: number } | null;
  for (const row of employerAssessments(job)) {
    const assessment = parsePracticeAssessment(row.practice_assessment);
    if (!assessment?.target || assessment.against !== key) continue;
    if (assessment.target === "yes") return { assessment, jobId: row.id };
    latest ??= { assessment, jobId: row.id };
  }
  return latest;
}
