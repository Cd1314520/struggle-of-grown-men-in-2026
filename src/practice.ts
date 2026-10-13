// Which jobs are for practice. Pure, with no imports: the web UI bundles this file to show the same
// verdict (ui/views/practice.ts), so it must stay free of server code.

// A posted ceiling at or under this is a reason to decline on its own.
export const LOW_PAY_MAX_USD = 80_000;
// Mandatory attendance somewhere else is a reason to decline too, but it does not make a well-paid
// role practice: above this ceiling the job is one to keep for later, wherever it is.
export const ONSITE_PAY_MAX_USD = 100_000;

export interface PracticeEvidence {
  annualBaseMaxUsd: number | null;
  salaryEvidence: string;
  mandatoryNonlocalOnsite: "yes" | "no" | "unclear";
  locationEvidence: string;
  // Whether the company and the work are high-end tech: hard distributed or high-scale problems at a
  // tech or tech-adjacent employer. It stands in for the pay when the posting does not state it.
  // null: not judged (assessments from before version 2).
  highEndTech: "yes" | "no" | null;
  highEndTechEvidence: string;
}

export interface PracticeAssessment extends PracticeEvidence {
  version: 2;
}

/**
 * Validates raw practice evidence and constructs a PracticeAssessment (version: 2).
 * Fails closed (returns null) on invalid types, non-finite/non-positive salary,
 * or empty evidence for positive claims. Model does not supply version.
 */
export function assessPractice(raw: unknown): PracticeAssessment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const obj = raw as Record<string, unknown>;

  // Validate annualBaseMaxUsd
  const rawSalary = obj["annualBaseMaxUsd"];
  let annualBaseMaxUsd: number | null;
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
  if (typeof obj["salaryEvidence"] !== "string") {
    return null;
  }
  const salaryEvidence = obj["salaryEvidence"].trim();
  if (annualBaseMaxUsd !== null && salaryEvidence.length === 0) {
    return null;
  }

  // Validate mandatoryNonlocalOnsite
  const rawLocation = obj["mandatoryNonlocalOnsite"];
  if (rawLocation !== "yes" && rawLocation !== "no" && rawLocation !== "unclear") {
    return null;
  }
  const mandatoryNonlocalOnsite: "yes" | "no" | "unclear" = rawLocation;

  // Validate locationEvidence
  if (typeof obj["locationEvidence"] !== "string") {
    return null;
  }
  const locationEvidence = obj["locationEvidence"].trim();
  if (mandatoryNonlocalOnsite === "yes" && locationEvidence.length === 0) {
    return null;
  }

  // Absent in assessments stored before version 2: kept, as "not judged". A worker must supply it (prep.ts).
  const rawTech = obj["highEndTech"];
  if (rawTech !== undefined && rawTech !== null && rawTech !== "yes" && rawTech !== "no") {
    return null;
  }
  const highEndTech: "yes" | "no" | null = rawTech ?? null;
  const rawTechEvidence = obj["highEndTechEvidence"];
  if (rawTechEvidence !== undefined && typeof rawTechEvidence !== "string") {
    return null;
  }
  const highEndTechEvidence = (rawTechEvidence ?? "").trim();
  if (highEndTech !== null && highEndTechEvidence.length === 0) {
    return null;
  }

  return {
    version: 2,
    annualBaseMaxUsd,
    salaryEvidence,
    mandatoryNonlocalOnsite,
    locationEvidence,
    highEndTech,
    highEndTechEvidence,
  };
}

/**
 * Parses persisted practice assessment JSON.
 * Fails closed (returns null) on malformed JSON, an unknown version (it must be 1 or 2),
 * or schema mismatch.
 */
export function parsePracticeAssessment(serialized: string | null | undefined): PracticeAssessment | null {
  if (typeof serialized !== "string") return null;
  const trimmed = serialized.trim();
  if (!trimmed) return null;

  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    // Version 1 lacks the high-end tech judgment and reads as "not judged"; nothing else is known.
    const version = (parsed as Record<string, unknown>)["version"];
    if (version !== 1 && version !== 2) {
      return null;
    }
    const assessed = assessPractice(parsed);
    if (!assessed) return null;
    return assessed;
  } catch {
    return null;
  }
}

const usd = (amount: number) => `$${Math.round(amount).toLocaleString("en-US")}`;

/**
 * Whether a job is one for practice, and why or why not. It is, when there is evidence the candidate
 * would decline it and nothing says it is a job to keep for later:
 * 1) the posted annual USD base ceiling is at most LOW_PAY_MAX_USD, wherever the job is; or
 * 2) attendance is mandatory outside the commute (mandatoryNonlocalOnsite === 'yes') and either
 *    a) the posted ceiling is at most ONSITE_PAY_MAX_USD, or
 *    b) no ceiling is posted and the company and work were judged not to be high-end tech.
 *
 * Never infers eligibility from a low real score or from the absence of evidence.
 */
export function practiceVerdict(assessment: PracticeAssessment | null): { qualifies: true; reason: string } | { qualifies: false; reason: string } {
  const no = (reason: string) => ({ qualifies: false as const, reason });
  const yes = (reason: string) => ({ qualifies: true as const, reason: `practice: ${reason}` });
  if (!assessment) return no("no usable practice assessment");
  const { annualBaseMaxUsd: pay, mandatoryNonlocalOnsite: onsite, highEndTech } = assessment;
  const away = onsite === "yes";

  if (pay !== null) {
    if (pay <= LOW_PAY_MAX_USD) return yes(`posted base ceiling ${usd(pay)} <= ${usd(LOW_PAY_MAX_USD)}${away ? " and mandatory nonlocal onsite/hybrid" : ""}`);
    if (pay > ONSITE_PAY_MAX_USD) return no(`posted base ceiling ${usd(pay)} is above the ${usd(ONSITE_PAY_MAX_USD)} practice limit`);
    if (away) return yes(`mandatory nonlocal onsite/hybrid with posted base ceiling ${usd(pay)} <= ${usd(ONSITE_PAY_MAX_USD)}`);
    return no(`posted base ceiling ${usd(pay)} is above ${usd(LOW_PAY_MAX_USD)} and attendance elsewhere is not mandatory`);
  }
  if (!away) return no("pay is not posted and attendance elsewhere is not mandatory");
  if (highEndTech === null) return no("pay is not posted and the company and work have not been judged yet");
  if (highEndTech === "yes") return no(`pay is not posted and this is high-end tech work (${assessment.highEndTechEvidence})`);
  return yes("mandatory nonlocal onsite/hybrid; pay not posted, and not high-end tech work");
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

// An assessment that only lacks the judgment a newer rule asks for: assessing the job again settles it.
export const needsJudgment = (assessment: PracticeAssessment | null) =>
  !!assessment && assessment.annualBaseMaxUsd === null && assessment.mandatoryNonlocalOnsite === "yes" && assessment.highEndTech === null;
