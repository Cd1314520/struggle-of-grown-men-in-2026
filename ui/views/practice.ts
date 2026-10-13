// The evidence behind a job counting as a practice application.
import type { JobDetail } from "../../src/api-types";
import { state } from "../store";
import { esc } from "../util";

interface PracticeAssessment {
  version: 1;
  annualBaseMaxUsd: number | null;
  salaryEvidence: string;
  mandatoryNonlocalOnsite: "yes" | "no" | "unclear";
  locationEvidence: string;
}

// The stored assessment, or null when it is missing or not one this page knows how to read.
function parsePractice(raw: string | null): PracticeAssessment | null {
  if (!raw?.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj["version"] !== 1) return null;

  const salary = obj["annualBaseMaxUsd"];
  if (salary !== null && (typeof salary !== "number" || !Number.isFinite(salary) || salary <= 0)) return null;
  if (typeof obj["salaryEvidence"] !== "string") return null;
  const salaryEvidence = obj["salaryEvidence"].trim();
  if (salary !== null && !salaryEvidence) return null;

  const onsite = obj["mandatoryNonlocalOnsite"];
  if (onsite !== "yes" && onsite !== "no" && onsite !== "unclear") return null;
  if (typeof obj["locationEvidence"] !== "string") return null;
  const locationEvidence = obj["locationEvidence"].trim();
  if (onsite === "yes" && !locationEvidence) return null;

  return { version: 1, annualBaseMaxUsd: salary, salaryEvidence, mandatoryNonlocalOnsite: onsite, locationEvidence };
}

export function practiceEvidenceHtml(j: JobDetail) {
  if (state().phase !== "practice" && !j.practice_assessment) return "";
  const pa = parsePractice(j.practice_assessment);
  if (!pa) {
    return `<div class="section practice-evidence"><div class="label">Practice eligibility · <span class="pill bad">Missing/Invalid assessment</span></div><p class="prose hint" style="margin-top:6px">No valid version 1 practice assessment recorded. Fails closed (requires explicit evidence of salary ceiling &le; $80k or mandatory nonlocal attendance).</p></div>`;
  }
  const salary = pa.annualBaseMaxUsd;
  const qualSalary = salary !== null && salary <= 80000;
  const qualLoc = pa.mandatoryNonlocalOnsite === "yes";
  const qual = qualSalary || qualLoc;

  const salaryDisplay = salary !== null ? `$${salary.toLocaleString()}/yr ceiling` : "No qualifying ceiling stated";
  const locDisplay =
    pa.mandatoryNonlocalOnsite === "yes"
      ? "Mandatory nonlocal onsite/hybrid"
      : pa.mandatoryNonlocalOnsite === "no"
        ? "Remote or local to Houston area"
        : "Unclear attendance policy";

  const reasons: string[] = [];
  if (qualSalary) reasons.push(`Salary <= $80k ($${salary.toLocaleString()})`);
  if (qualLoc) reasons.push("Mandatory nonlocal attendance");
  const badgeCls = qual ? "ok" : "bad";
  const badgeText = qual ? `Eligible (${reasons.join(", ")})` : "Not eligible (no qualifying positive evidence)";

  return `<div class="section practice-evidence"><div class="label">Practice eligibility · <span class="pill ${badgeCls}">${esc(badgeText)}</span></div>
    <dl class="kv" style="margin-top:8px">
      <dt>Salary ceiling</dt>
      <dd><span>${esc(salaryDisplay)}</span>${pa.salaryEvidence ? `<div class="hint" style="margin-top:2px">${esc(pa.salaryEvidence)}</div>` : ""}</dd>
      <dt>Attendance</dt>
      <dd><span>${esc(locDisplay)}</span>${pa.locationEvidence ? `<div class="hint" style="margin-top:2px">${esc(pa.locationEvidence)}</div>` : ""}</dd>
    </dl></div>`;
}
