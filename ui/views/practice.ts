// Whether a job counts as a practice application, and the evidence behind that. The rule itself is the
// server's (src/practice.ts, a pure module this bundle includes), so the page cannot disagree with it.
import type { JobDetail } from "../../src/api-types";
import { EMPLOYER_LABELS, parsePracticeAssessment, practiceVerdict } from "../../src/practice";
import { state } from "../store";
import { cap, esc } from "../util";

const AGENTS = { yes: "Agent-native", no: "Behind on agent adoption", unclear: "Not clear from the posting" };
const LISTED = { frontier: "On your frontier list", practice: "On your practice list" };

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
  return `<div class="section practice-evidence"><div class="label">Practice eligibility · <span class="pill ${qualifies ? "ok" : "bad"}">${qualifies ? "Eligible" : "Not eligible"}</span></div>
    <p class="prose" style="margin-top:6px">${esc(reason)}.</p>
    <dl class="kv" style="margin-top:8px">
      ${pa.listed ? row("Your lists", LISTED[pa.listed], "") : ""}
      ${row("Employer", pa.employerType ? cap(EMPLOYER_LABELS[pa.employerType]) : "Not judged", pa.employerEvidence)}
      ${row("Agent adoption", pa.agentNative ? AGENTS[pa.agentNative] : "Not judged", pa.agentNativeEvidence)}
    </dl></div>`;
}
