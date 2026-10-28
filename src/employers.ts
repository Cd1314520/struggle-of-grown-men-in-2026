import YAML from "yaml";
import { companyKey, employerAssessments, type Job } from "./db";
import { config, readProfile } from "./config";
import { parsePracticeAssessment, targetsKey, type Listed, type PracticeAssessment } from "./practice";

interface EmployerLists {
  frontier: string[];
  practice: string[];
}

const names = (v: unknown) => (Array.isArray(v) ? v.filter((n): n is string => typeof n === "string" && !!n.trim()) : []);

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

export function employersText(lists = loadEmployers()) {
  const line = (l: string[]) => (l.length ? l.join(", ") : "(none)");
  return `- Frontier (agent-native, at scale; real targets): ${line(lists.frontier)}\n- Practice (behind; fine to practise on): ${line(lists.practice)}`;
}

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
