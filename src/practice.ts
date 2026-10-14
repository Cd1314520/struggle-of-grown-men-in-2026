// Which jobs are for practice. Pure, with no imports: the web UI bundles this file to show the same
// verdict (ui/views/practice.ts), so it must stay free of server code.
//
// A job is for practice when its employer is one the candidate would turn down for the real search:
// the work would not be at real scale in an agent-native organisation. Pay and location no longer
// decide it: the candidate puts experience above both and will relocate.

// What kind of employer it is. Only `tech_scaled` can be a real target.
export const EMPLOYER_TYPES = ["tech_scaled", "startup", "non_tech_enterprise", "it_services", "government"] as const;
export type EmployerType = (typeof EMPLOYER_TYPES)[number];
export type Judgment = "yes" | "no" | "unclear";

export const EMPLOYER_LABELS: Record<EmployerType, string> = {
  tech_scaled: "tech company at scale",
  startup: "early-stage startup",
  non_tech_enterprise: "non-tech enterprise",
  it_services: "IT services or consultancy",
  government: "government or public sector",
};

// Employers settled by hand in profile/employers.yml. The host fills this in, never the worker.
export type Listed = "frontier" | "practice";

export interface PracticeEvidence {
  // null: not judged (assessments from before version 3, which judged pay and location instead).
  employerType: EmployerType | null;
  employerEvidence: string;
  // Whether the engineering organisation visibly builds and ships with agents.
  agentNative: Judgment | null;
  agentNativeEvidence: string;
  listed: Listed | null;
}

export interface PracticeAssessment extends PracticeEvidence {
  version: 3;
}

const notJudged = (): PracticeAssessment => ({
  version: 3,
  employerType: null,
  employerEvidence: "",
  agentNative: null,
  agentNativeEvidence: "",
  listed: null,
});

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v === undefined ? "" : null);

/**
 * Validates raw practice evidence and constructs a PracticeAssessment (version: 3).
 * Fails closed (returns null) on unknown values or a judgment without evidence. The model does not
 * supply version, and its `listed` is whatever the host wrote over it.
 */
export function assessPractice(raw: unknown): PracticeAssessment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const employerType = obj["employerType"];
  if (!EMPLOYER_TYPES.includes(employerType as EmployerType)) return null;
  const employerEvidence = text(obj["employerEvidence"]);
  if (!employerEvidence) return null;

  const agentNative = obj["agentNative"];
  if (agentNative !== "yes" && agentNative !== "no" && agentNative !== "unclear") return null;
  const agentNativeEvidence = text(obj["agentNativeEvidence"]);
  if (agentNativeEvidence === null) return null;
  // "Unclear" needs no quote; a yes or no does.
  if (agentNative !== "unclear" && !agentNativeEvidence) return null;

  const listed = obj["listed"] ?? null;
  if (listed !== null && listed !== "frontier" && listed !== "practice") return null;

  return { version: 3, employerType: employerType as EmployerType, employerEvidence, agentNative, agentNativeEvidence, listed };
}

/**
 * Parses persisted practice assessment JSON.
 * Fails closed (returns null) on malformed JSON, an unknown version, or schema mismatch. Versions 1
 * and 2 judged pay and location, which no longer decide anything: they read as not judged.
 */
export function parsePracticeAssessment(serialized: string | null | undefined): PracticeAssessment | null {
  if (typeof serialized !== "string") return null;
  const trimmed = serialized.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const version = (parsed as Record<string, unknown>)["version"];
    if (version === 1 || version === 2) return notJudged();
    if (version !== 3) return null;
    return assessPractice(parsed);
  } catch {
    return null;
  }
}

/**
 * Whether a job is one for practice, and why or why not. It is, when the employer is one the real
 * search rules out and nothing says it is a job to keep for later:
 * 1) the employer is on the practice list in profile/employers.yml; or
 * 2) it is not on the frontier list and was judged an early-stage startup, a non-tech enterprise, an
 *    IT services firm or consultancy, or government.
 * A tech company at scale is always held for the real search, however its agent adoption was judged:
 * large employers keep one record of a candidate across teams, so a practice rejection from a slow
 * team counts against a later application to a strong one.
 *
 * Never infers eligibility from a low real score or from the absence of evidence.
 */
export function practiceVerdict(assessment: PracticeAssessment | null): { qualifies: true; reason: string } | { qualifies: false; reason: string } {
  const no = (reason: string) => ({ qualifies: false as const, reason });
  const yes = (reason: string) => ({ qualifies: true as const, reason: `practice: ${reason}` });
  if (!assessment) return no("no usable practice assessment");
  if (assessment.listed === "frontier") return no("the employer is on your frontier list");
  if (assessment.listed === "practice") return yes("the employer is on your practice list");
  const { employerType, employerEvidence, agentNative } = assessment;
  if (employerType === null || agentNative === null) return no("the employer has not been judged under the current practice rules");
  if (employerType !== "tech_scaled") return yes(`${EMPLOYER_LABELS[employerType]} (${employerEvidence})`);
  return no(`a tech company at scale, kept for the real search (${employerEvidence})`);
}

// The qualifying reason, or null if the job does not qualify for practice.
export function practiceReason(assessment: PracticeAssessment | null): string | null {
  const verdict = practiceVerdict(assessment);
  return verdict.qualifies ? verdict.reason : null;
}

// Why a job is not one for practice; null when it is.
export function practiceRefusal(assessment: PracticeAssessment | null): string | null {
  const verdict = practiceVerdict(assessment);
  return verdict.qualifies ? null : verdict.reason;
}

// An assessment made under older rules, which never judged the employer: assessing the job again settles it.
export const needsJudgment = (assessment: PracticeAssessment | null) => !!assessment && (assessment.employerType === null || assessment.agentNative === null);
