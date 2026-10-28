export type Judgment = "yes" | "no" | "unclear";

export type Listed = "frontier" | "practice";

export interface PracticeEvidence {
  target: "yes" | "no" | null;
  employerEvidence: string;
  agentNative: Judgment | null;
  agentNativeEvidence: string;
  listed: Listed | null;
  against: string;
}

export interface PracticeAssessment extends PracticeEvidence {
  version: 4;
}

export const DEFAULT_TARGETS =
  "A software or tech-first company past early stage (roughly 300+ people, or a large established product) whose core product is the software, including well-funded, scaled AI-native companies. Not an early-stage startup, a non-tech business (insurance, banking, energy, healthcare, retail, manufacturing, logistics, media, education), an IT services, consulting or staffing firm, or government and its contractors. Who the customers are does not decide it: a tech company at scale that sells its own products to governments counts.";
const V3_TYPES: Record<string, string> = {
  tech_scaled: "tech company at scale",
  startup: "early-stage startup",
  non_tech_enterprise: "non-tech enterprise",
  it_services: "IT services or consultancy",
  government: "government or public sector",
};

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
  if (agentNative !== "unclear" && !agentNativeEvidence) return null;

  const listed = obj["listed"] ?? null;
  if (listed !== null && listed !== "frontier" && listed !== "practice") return null;
  const against = target !== null && typeof obj["against"] === "string" ? obj["against"] : "";

  return { version: 4, target, employerEvidence, agentNative, agentNativeEvidence, listed, against };
}

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

export function practiceReason(assessment: PracticeAssessment | null, describing: boolean): string | null {
  const verdict = practiceVerdict(assessment, describing);
  return verdict.qualifies ? verdict.reason : null;
}

export function practiceRefusal(assessment: PracticeAssessment | null, describing: boolean): string | null {
  const verdict = practiceVerdict(assessment, describing);
  return verdict.qualifies ? null : verdict.reason;
}

export const rubricOf = (assessment: PracticeAssessment | null, describing: boolean): "practice" | "real" =>
  assessment && practiceVerdict(assessment, describing).qualifies ? "practice" : "real";

export const needsJudgment = (assessment: PracticeAssessment | null, describing: boolean) =>
  !!assessment && (assessment.agentNative === null || (describing && assessment.target === null));
