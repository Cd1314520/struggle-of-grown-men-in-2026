export interface PracticeEvidence {
  annualBaseMaxUsd: number | null;
  salaryEvidence: string;
  mandatoryNonlocalOnsite: "yes" | "no" | "unclear";
  locationEvidence: string;
}

export interface PracticeAssessment extends PracticeEvidence {
  version: 1;
}

/**
 * Validates raw practice evidence and constructs a PracticeAssessment (version: 1).
 * Fails closed (returns null) on invalid types, non-finite/non-positive salary,
 * or empty evidence for positive claims. Model does not supply version.
 */
export function assessPractice(raw: unknown): PracticeAssessment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Validate annualBaseMaxUsd
  const rawSalary = obj.annualBaseMaxUsd;
  let annualBaseMaxUsd: number | null = null;
  if (rawSalary === null) {
    annualBaseMaxUsd = null;
  } else if (typeof rawSalary === "number") {
    if (!Number.isFinite(rawSalary) || rawSalary <= 0) {
      return null;
    }
    annualBaseMaxUsd = rawSalary;
  } else {
    return null;
  }

  // Validate salaryEvidence
  if (typeof obj.salaryEvidence !== "string") {
    return null;
  }
  const salaryEvidence = obj.salaryEvidence.trim();
  if (annualBaseMaxUsd !== null && salaryEvidence.length === 0) {
    return null;
  }

  // Validate mandatoryNonlocalOnsite
  const rawLocation = obj.mandatoryNonlocalOnsite;
  if (rawLocation !== "yes" && rawLocation !== "no" && rawLocation !== "unclear") {
    return null;
  }
  const mandatoryNonlocalOnsite: "yes" | "no" | "unclear" = rawLocation;

  // Validate locationEvidence
  if (typeof obj.locationEvidence !== "string") {
    return null;
  }
  const locationEvidence = obj.locationEvidence.trim();
  if (mandatoryNonlocalOnsite === "yes" && locationEvidence.length === 0) {
    return null;
  }

  return {
    version: 1,
    annualBaseMaxUsd,
    salaryEvidence,
    mandatoryNonlocalOnsite,
    locationEvidence,
  };
}

/**
 * Parses persisted practice assessment JSON.
 * Fails closed (returns null) on malformed JSON, old/unsupported version (version must be 1),
 * or schema mismatch.
 */
export function parsePracticeAssessment(serialized: string | null | undefined): PracticeAssessment | null {
  if (typeof serialized !== "string") return null;
  const trimmed = serialized.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    // Strict version check: persisted version must be exactly 1
    if ((parsed as Record<string, unknown>).version !== 1) {
      return null;
    }
    const assessed = assessPractice(parsed);
    if (!assessed) return null;
    return assessed;
  } catch {
    return null;
  }
}

/**
 * Returns a qualifying evidence-backed reason, or null if the job does not qualify for practice.
 * Qualifies when:
 * 1) posted annual USD base ceiling <= 80,000 (inclusive)
 * OR
 * 2) mandatory nonlocal onsite / hybrid (mandatoryNonlocalOnsite === 'yes')
 *
 * Never infers eligibility from low real score or absence of evidence.
 */
export function practiceReason(assessment: PracticeAssessment | null): string | null {
  if (!assessment) return null;

  const reasons: string[] = [];
  if (assessment.annualBaseMaxUsd !== null && assessment.annualBaseMaxUsd <= 80000) {
    reasons.push(`posted base ceiling $${Math.round(assessment.annualBaseMaxUsd).toLocaleString()} <= $80,000`);
  }
  if (assessment.mandatoryNonlocalOnsite === "yes") {
    reasons.push("mandatory nonlocal onsite/hybrid");
  }

  if (reasons.length === 0) return null;
  return `practice: ${reasons.join(" and ")}`;
}
