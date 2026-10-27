// Which jobs are for practice. Pure, with no imports: the web UI bundles this file to show the same
// verdict (ui/pages/job/model.ts), so it must stay free of server code.
//
// A job is for practice when its employer is not a target: not on the candidate's frontier list,
// and not one the assessment judged to fit their description of a target employer (`targets.describe`
// in config.yml). Pay and location do not decide it.

export type Judgment = "yes" | "no" | "unclear";

// Employers settled by hand in profile/employers.yml. The host fills this in, never the worker.
export type Listed = "frontier" | "practice";

export interface PracticeEvidence {
  // Whether the employer fits the description of a target employer. null: not judged, because no
  // description was in use.
  target: "yes" | "no" | null;
  employerEvidence: string;
  // Whether the engineering organisation visibly builds and ships with agents.
  agentNative: Judgment | null;
  agentNativeEvidence: string;
  listed: Listed | null;
  // targetsKey() of the description `target` was judged against; "" when it was not judged.
  against: string;
}

export interface PracticeAssessment extends PracticeEvidence {
  version: 4;
}

// What version 3 assessments judged, as a fixed list of employer types of which only a tech company
// at scale was a target. It is config.yml's default `targets.describe`, so their judgments carry over
// for as long as that description is the one in use.
export const DEFAULT_TARGETS =
  "A software or tech-first company past early stage (roughly 300+ people, or a large established product) whose core product is the software, including well-funded, scaled AI-native companies. Not an early-stage startup, a non-tech business (insurance, banking, energy, healthcare, retail, manufacturing, logistics, media, education), an IT services, consulting or staffing firm, or government and its contractors. Who the customers are does not decide it: a tech company at scale that sells its own products to governments counts.";
const V3_TYPES: Record<string, string> = {
  tech_scaled: "tech company at scale",
  startup: "early-stage startup",
  non_tech_enterprise: "non-tech enterprise",
  it_services: "IT services or consultancy",
  government: "government or public sector",
};

// A short fingerprint of a description, so a judgment is reused only against the words it was made on.
export function targetsKey(describe: string): string {
  const words = describe.trim().toLowerCase().replace(/\s+/g, " ");
  if (!words) return "";
  let hash = 0x811c9dc5;
  for (let i = 0; i < words.length; i++) hash = Math.imul(hash ^ words.charCodeAt(i), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const notJudged = (): PracticeAssessment => ({
  version: 4,
  target: null,
  employerEvidence: "",
  agentNative: null,
  agentNativeEvidence: "",
  listed: null,
  against: "",
});

const text = (v: unknown) => (typeof v === "string" ? v.trim() : v === undefined ? "" : null);

/**
 * Validates raw practice evidence and constructs a PracticeAssessment (version: 4).
 * Fails closed (returns null) on unknown values or a judgment without evidence. The model does not
 * supply version, `listed` or `against`: the host writes them over whatever it sent.
 */
export function assessPractice(raw: unknown): PracticeAssessment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const target = obj["target"] ?? null;
  if (target !== null && target !== "yes" && target !== "no") return null;
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
  const against = target !== null && typeof obj["against"] === "string" ? obj["against"] : "";

  return { version: 4, target, employerEvidence, agentNative, agentNativeEvidence, listed, against };
}

/**
 * Parses persisted practice assessment JSON.
 * Fails closed (returns null) on malformed JSON, an unknown version, or schema mismatch. Versions 1
 * and 2 judged pay and location, which no longer decide anything: they read as not judged. Version 3
 * named one of five employer types, read as a judgment against DEFAULT_TARGETS.
 */
export function parsePracticeAssessment(serialized: string | null | undefined): PracticeAssessment | null {
  if (typeof serialized !== "string") return null;
  const trimmed = serialized.trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const version = obj["version"];
    if (version === 1 || version === 2) return notJudged();
    if (version === 3) {
      const type = V3_TYPES[String(obj["employerType"])];
      const evidence = obj["employerEvidence"];
      if (!type || typeof evidence !== "string" || !evidence.trim()) return null;
      return assessPractice({
        ...obj,
        target: obj["employerType"] === "tech_scaled" ? "yes" : "no",
        employerEvidence: `${type}: ${evidence.trim()}`,
        against: targetsKey(DEFAULT_TARGETS),
      });
    }
    if (version !== 4) return null;
    return assessPractice(parsed);
  } catch {
    return null;
  }
}

/**
 * Whether a job is one for practice, and why or why not. It is, when nothing marks its employer as a
 * target:
 * 1) the employer is on the practice list in profile/employers.yml; or
 * 2) it is not on the frontier list and, when the candidate describes target employers (`describing`),
 *    was judged not to fit that description.
 * A target is never practice, however its agent adoption was judged: large employers keep one record
 * of a candidate across teams, so a practice rejection from a slow team counts against a later
 * application to a strong one.
 *
 * Never infers eligibility from a low real score or from the absence of evidence.
 */
export function practiceVerdict(
  assessment: PracticeAssessment | null,
  describing: boolean,
): { qualifies: true; reason: string } | { qualifies: false; reason: string } {
  const no = (reason: string) => ({ qualifies: false as const, reason });
  const yes = (reason: string) => ({ qualifies: true as const, reason: `practice: ${reason}` });
  if (!assessment) return no("no usable practice assessment");
  if (assessment.listed === "frontier") return no("the employer is on your frontier list");
  if (assessment.listed === "practice") return yes("the employer is on your practice list");
  if (assessment.agentNative === null) return no("the employer has not been judged under the current practice rules");
  if (!describing) return yes(`not on your frontier list (${assessment.employerEvidence})`);
  if (assessment.target === null) return no("the employer has not been judged against your description of a target employer");
  if (assessment.target === "no") return yes(`not a target employer (${assessment.employerEvidence})`);
  return no(`a target employer, kept for later (${assessment.employerEvidence})`);
}

// The qualifying reason, or null if the job does not qualify for practice.
export function practiceReason(assessment: PracticeAssessment | null, describing: boolean): string | null {
  const verdict = practiceVerdict(assessment, describing);
  return verdict.qualifies ? verdict.reason : null;
}

// Why a job is not one for practice; null when it is.
export function practiceRefusal(assessment: PracticeAssessment | null, describing: boolean): string | null {
  const verdict = practiceVerdict(assessment, describing);
  return verdict.qualifies ? null : verdict.reason;
}

// The rubric a job's score is on (src/rubric.ts): practice when its employer is not a target, real for
// a target. A job assessed without employer evidence was scored on the real one.
export const rubricOf = (assessment: PracticeAssessment | null, describing: boolean): "practice" | "real" =>
  assessment && practiceVerdict(assessment, describing).qualifies ? "practice" : "real";

// An assessment made under older rules, which never judged what is asked now: assessing the job again settles it.
export const needsJudgment = (assessment: PracticeAssessment | null, describing: boolean) =>
  !!assessment && (assessment.agentNative === null || (describing && assessment.target === null));
