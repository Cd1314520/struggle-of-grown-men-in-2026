import { describe, expect, it } from "bun:test";
import type { AppState, JobDetail } from "../../src/api-types";
import { setState } from "../store";
import { practiceEvidenceHtml, practicePill } from "./practice";

setState({ phase: "practice" } as AppState);
const job = (assessment: object | null) => ({ score: 70, practice_assessment: assessment && JSON.stringify(assessment) }) as JobDetail;
const judged = { version: 3, agentNative: "unclear", agentNativeEvidence: "", listed: null };

describe("practice eligibility on the job page", () => {
  it("reads the assessments the server writes today (version 3)", () => {
    const j = job({ ...judged, employerType: "non_tech_enterprise", employerEvidence: "Regional insurer; internal claims tooling" });
    const html = practiceEvidenceHtml(j);
    expect(html).toContain('<span class="pill ok">Eligible</span>');
    expect(html).toContain("Non-tech enterprise");
    expect(html).toContain("Regional insurer; internal claims tooling");
    expect(practicePill(j)).toContain(">Practice<");
  });

  it("gives the server's reason when a job is not for practice", () => {
    const j = job({ ...judged, employerType: "tech_scaled", employerEvidence: "Payments infrastructure", listed: "frontier" });
    expect(practiceEvidenceHtml(j)).toContain("The employer is on your frontier list.");
    expect(practiceEvidenceHtml(j)).toContain("On your frontier list");
    expect(practicePill(j)).toContain(">Not practice<");
  });

  it("reads older versions as not judged, and says so when nothing usable is stored", () => {
    const old = practiceEvidenceHtml(job({ version: 2, annualBaseMaxUsd: 60000, salaryEvidence: "$60k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }));
    expect(old).toContain("Not eligible");
    expect(old).toContain("Not judged");
    expect(practiceEvidenceHtml(job(null))).toContain("Missing/Invalid assessment");
    expect(practicePill(job(null))).toContain("Practice not assessed");
  });
});
