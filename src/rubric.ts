// Scoring is arithmetic over a checklist. The agent only answers yes / no / unclear per statement;
// weights, thresholds and the pass / hold / skip decision live here and in profile/rubric.yml.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { config, PROFILE } from "./config";
import { assessPractice, practiceVerdict, type Listed, type PracticeAssessment } from "./practice";

type Phase = "practice" | "real";
export type Answer = "yes" | "no" | "unclear";
const ANSWERS: readonly Answer[] = ["yes", "no", "unclear"];
interface Criterion {
  id: string;
  label?: string; // short form for the at-a-glance view
  statement: string;
  required?: boolean;
  weight?: number;
  screen?: boolean; // false: a requirement the screen leaves to the full assessment
}
interface PhaseRubric {
  threshold: number;
  criteria: Criterion[];
}
interface Rubric extends Record<Phase, PhaseRubric> {
  unclear: number;
}

export interface ChecklistItem {
  key: string; // "<phase>.<id>"
  phase: Phase;
  label: string;
  statement: string;
  required: boolean;
  weight: number;
  answer: Answer;
  evidence: string;
  points: number;
}
export interface Verdict {
  decision: "apply" | "hold" | "skip";
  score: number; // for the current phase
  threshold: number;
  reason: string;
  items: ChecklistItem[];
  practice: PracticeAssessment | null;
}

export function loadRubric(file = join(PROFILE, "rubric.yml")): Rubric {
  // Hand-edited file: nothing is there until checked.
  const r = YAML.parse(readFileSync(file, "utf8")) as (Partial<Record<Phase, Partial<PhaseRubric>>> & { unclear?: number }) | null;
  for (const phase of ["practice", "real"] as const) {
    const criteria = r?.[phase]?.criteria;
    if (!criteria?.length) throw new Error(`profile/rubric.yml: no criteria for phase "${phase}"`);
    for (const c of criteria) {
      if (!c.id || !c.statement) throw new Error(`profile/rubric.yml: every ${phase} criterion needs an id and a statement`);
      if (!c.required && typeof c.weight !== "number") throw new Error(`profile/rubric.yml: ${phase}.${c.id} needs "required: true" or a weight`);
    }
  }
  return r as Rubric;
}

// In practice the real rubric is answered too, to decide what to hold back.
const phasesToAsk = (): Phase[] => (config.phase === "practice" ? ["practice", "real"] : ["real"]);

export const currentThreshold = () => loadRubric()[config.phase].threshold;

export function checklistText(r = loadRubric()) {
  return phasesToAsk()
    .flatMap(phase => r[phase].criteria.map(c => `- \`${phase}.${c.id}\`: ${c.statement}`))
    .join("\n");
}

// ---- the screen: a cheap read of the posting before the full assessment

// The rubrics that can decide a job. In practice, whether it is a practice job is the full
// assessment's judgment unless the employer is listed, so a job is only ruled out when it fails both.
function decidingPhases(listed: Listed | null): Phase[] {
  if (config.phase === "real" || listed === "frontier") return ["real"];
  return listed === "practice" ? ["practice"] : ["practice", "real"];
}

const screened = (r: Rubric, phase: Phase) => r[phase].criteria.filter(c => c.required && c.screen !== false);

export function screenChecklistText(listed: Listed | null, r = loadRubric()) {
  return decidingPhases(listed)
    .flatMap(phase => screened(r, phase).map(c => `- \`${phase}.${c.id}\`: ${c.statement}`))
    .join("\n");
}

// Why the screen rules the job out, null when the full assessment should read it, or an error
// string when the answers are incomplete. Only a "no" rules out, as with requirements in evaluate.
export function screenVerdict(raw: unknown, listed: Listed | null): { out: string | null } | string {
  const r = loadRubric();
  const answers = new Map<string, Answer>();
  for (const a of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (!a || typeof a !== "object" || !("id" in a) || typeof a.id !== "string") return "every answer needs an id";
    const answer = "answer" in a ? ANSWERS.find(x => x === a.answer) : undefined;
    if (!answer) return `answer for ${a.id} must be yes, no or unclear`;
    answers.set(a.id, answer);
  }
  const phases = decidingPhases(listed);
  const missing = phases.flatMap(phase => screened(r, phase).map(c => `${phase}.${c.id}`)).filter(k => !answers.has(k));
  if (missing.length) return `missing answers for: ${missing.join(", ")}`;
  const failed = phases.map(phase => ({
    phase,
    ids: screened(r, phase)
      .filter(c => answers.get(`${phase}.${c.id}`) === "no")
      .map(c => c.id),
  }));
  if (failed.some(f => !f.ids.length)) return { out: null };
  return { out: `screened out: failed ${failed.map(f => `${f.phase} requirement: ${f.ids.join(", ")}`).join("; ")}` };
}

function scorePhase(r: Rubric, phase: Phase, answers: Map<string, { answer: Answer; evidence: string }>) {
  const items: ChecklistItem[] = r[phase].criteria.map(c => {
    const key = `${phase}.${c.id}`;
    const a = answers.get(key);
    if (!a) throw new Error(`no answer for ${key}`);
    const weight = c.required ? 0 : (c.weight ?? 0);
    const points = a.answer === "yes" ? weight : a.answer === "unclear" && weight > 0 ? weight * r.unclear : 0;
    return {
      key,
      phase,
      label: c.label ?? c.id.replace(/_/g, " "),
      statement: c.statement,
      required: !!c.required,
      weight,
      answer: a.answer,
      evidence: a.evidence,
      points,
    };
  });
  const possible = items.reduce((sum, i) => sum + Math.max(0, i.weight), 0);
  const earned = items.reduce((sum, i) => sum + i.points, 0);
  const score = possible ? Math.round((Math.max(0, earned) / possible) * 100) : 0;
  const failed = items.filter(i => i.required && i.answer === "no");
  return { items, score, failed, threshold: r[phase].threshold };
}

// Returns an error string when the answers are incomplete, otherwise the computed verdict.
export function evaluate(raw: unknown, practiceEvidence?: unknown): Verdict | string {
  const r = loadRubric();
  const answers = new Map<string, { answer: Answer; evidence: string }>();
  for (const a of Array.isArray(raw) ? (raw as unknown[]) : []) {
    if (!a || typeof a !== "object" || !("id" in a) || typeof a.id !== "string") return "every answer needs an id";
    const answer = "answer" in a ? ANSWERS.find(x => x === a.answer) : undefined;
    if (!answer) return `answer for ${a.id} must be yes, no or unclear`;
    answers.set(a.id, { answer, evidence: ("evidence" in a && typeof a.evidence === "string" ? a.evidence : "").slice(0, 300) });
  }
  const expected = phasesToAsk().flatMap(phase => r[phase].criteria.map(c => `${phase}.${c.id}`));
  const missing = expected.filter(k => !answers.has(k));
  if (missing.length) return `missing answers for: ${missing.join(", ")}`;

  const current = scorePhase(r, config.phase, answers);
  const items = [...current.items];
  if (config.phase === "practice") {
    const real = scorePhase(r, "real", answers);
    items.push(...real.items);
    const practice = assessPractice(practiceEvidence);
    const { qualifies, reason } = practiceVerdict(practice);
    // Not one to practise on: whether it is worth keeping for later is the real search's question,
    // so the real rubric decides between holding and skipping it, not the practice fit.
    if (!qualifies) {
      const kept = { score: real.score, threshold: real.threshold, items, practice };
      if (real.failed.length)
        return {
          ...kept,
          decision: "skip",
          reason: `not a practice job, and failed real requirement: ${real.failed.map(i => i.key.split(".")[1]).join(", ")}`,
        };
      if (real.score < real.threshold)
        return { ...kept, decision: "skip", reason: `not a practice job, and real score ${real.score} below threshold ${real.threshold}` };
      return { ...kept, decision: "hold", reason: `not a practice job: ${reason}; real score ${real.score} (threshold ${real.threshold})` };
    }
    if (current.failed.length)
      return {
        decision: "skip",
        score: current.score,
        threshold: current.threshold,
        items,
        practice,
        reason: `failed requirement: ${current.failed.map(i => i.key.split(".")[1]).join(", ")}`,
      };
    if (current.score < current.threshold)
      return {
        decision: "skip",
        score: current.score,
        threshold: current.threshold,
        items,
        practice,
        reason: `score ${current.score} below threshold ${current.threshold}`,
      };
    return {
      decision: "apply",
      score: current.score,
      threshold: current.threshold,
      items,
      practice,
      reason: `${reason}; score ${current.score} (threshold ${current.threshold})`,
    };
  }
  if (current.failed.length)
    return {
      decision: "skip",
      score: current.score,
      threshold: current.threshold,
      items,
      practice: null,
      reason: `failed requirement: ${current.failed.map(i => i.key.split(".")[1]).join(", ")}`,
    };
  if (current.score < current.threshold)
    return {
      decision: "skip",
      score: current.score,
      threshold: current.threshold,
      items,
      practice: null,
      reason: `score ${current.score} below threshold ${current.threshold}`,
    };
  return {
    decision: "apply",
    score: current.score,
    threshold: current.threshold,
    items,
    practice: null,
    reason: `score ${current.score} (threshold ${current.threshold})`,
  };
}
