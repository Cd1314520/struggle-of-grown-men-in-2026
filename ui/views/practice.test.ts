import { describe, expect, it } from "bun:test";
import type { AppState, JobDetail } from "../../src/api-types";
import { setState } from "../store";
import { practiceEvidenceHtml, practicePill } from "./practice";

setState({ phase: "practice" } as AppState);
const job = (assessment: object | null) => ({ score: 70, practice_assessment: assessment && JSON.stringify(assessment) }) as JobDetail;
const evidence = { salaryEvidence: "", mandatoryNonlocalOnsite: "no", locationEvidence: "" };

describe("practice eligibility on the job page", () => {
  it("reads the assessments the server writes today (version 2)", () => {
    const j = job({
      ...evidence,
      version: 2,
      annualBaseMaxUsd: null,
      mandatoryNonlocalOnsite: "yes",
      locationEvidence: "Five days a week in Denver",
      highEndTech: "no",
      highEndTechEvidence: "Internal IT tooling",
    });
    const html = practiceEvidenceHtml(j);
    expect(html).toContain('<span class="pill ok">Eligible</span>');
    expect(html).toContain("Not high-end tech work");
    expect(html).toContain("Internal IT tooling");
    expect(practicePill(j)).toContain(">Practice<");
  });

  it("gives the server's reason when a job is not for practice", () => {
    const j = job({ ...evidence, version: 2, annualBaseMaxUsd: 150000, salaryEvidence: "$120k-$150k", highEndTech: null, highEndTechEvidence: "" });
    expect(practiceEvidenceHtml(j)).toContain("Posted base ceiling $150,000 is above the $100,000 practice limit.");
    expect(practicePill(j)).toContain(">Not practice<");
  });

  it("still reads version 1, and says so when nothing usable is stored", () => {
    expect(practiceEvidenceHtml(job({ ...evidence, version: 1, annualBaseMaxUsd: 60000, salaryEvidence: "$60k" }))).toContain("Eligible");
    expect(practiceEvidenceHtml(job(null))).toContain("Missing/Invalid assessment");
    expect(practicePill(job(null))).toContain("Practice not assessed");
  });
});
