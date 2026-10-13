// Whether a job counts as a practice application, and the evidence behind that. The rule itself is the
// server's (src/practice.ts, a pure module this bundle includes), so the page cannot disagree with it.
import type { JobDetail } from "../../src/api-types";
import { parsePracticeAssessment, practiceVerdict } from "../../src/practice";
import { state } from "../store";
import { cap, esc } from "../util";

const ATTENDANCE = { yes: "Mandatory nonlocal onsite/hybrid", no: "Remote or local to Houston area", unclear: "Unclear attendance policy" };
const TECH = { yes: "High-end tech work", no: "Not high-end tech work" };

// Shown for every job while practising, and afterwards for any job that was assessed for it.
const applies = (j: JobDetail) => state().phase === "practice" || !!j.practice_assessment;
const verdictOf = (j: JobDetail) => {
  const assessment = parsePracticeAssessment(j.practice_assessment);
  const { qualifies, reason } = practiceVerdict(assessment);
  return { assessment, qualifies, reason: cap(reason.replace(/^practice: /, "")) };
};

// At the top of the job: the answer at a glance.
export function practicePill(j: JobDetail) {
  if (!applies(j) || j.score == null) return "";
  const { assessment, qualifies, reason } = verdictOf(j);
  return `<span class="pill ${qualifies ? "ok" : "bad"}" title="${esc(reason)}">${qualifies ? "Practice" : assessment ? "Not practice" : "Practice not assessed"}</span>`;
}

const row = (label: string, value: string, evidence: string) =>
  `<dt>${label}</dt><dd><span>${esc(value)}</span>${evidence ? `<div class="hint" style="margin-top:2px">${esc(evidence)}</div>` : ""}</dd>`;

export function practiceEvidenceHtml(j: JobDetail) {
  if (!applies(j)) return "";
  const { assessment: pa, qualifies, reason } = verdictOf(j);
  if (!pa)
    return `<div class="section practice-evidence"><div class="label">Practice eligibility · <span class="pill bad">Missing/Invalid assessment</span></div><p class="prose hint" style="margin-top:6px">No valid practice assessment is recorded, so this job is treated as not for practice until it is assessed again.</p></div>`;
  const pay = pa.annualBaseMaxUsd;
  return `<div class="section practice-evidence"><div class="label">Practice eligibility · <span class="pill ${qualifies ? "ok" : "bad"}">${qualifies ? "Eligible" : "Not eligible"}</span></div>
    <p class="prose" style="margin-top:6px">${esc(reason)}.</p>
    <dl class="kv" style="margin-top:8px">
      ${row("Salary ceiling", pay !== null ? `$${pay.toLocaleString("en-US")}/yr ceiling` : "No ceiling posted", pa.salaryEvidence)}
      ${row("Attendance", ATTENDANCE[pa.mandatoryNonlocalOnsite], pa.locationEvidence)}
      ${row("Company and work", pa.highEndTech ? TECH[pa.highEndTech] : "Not judged", pa.highEndTechEvidence)}
    </dl></div>`;
}
