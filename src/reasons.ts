import type { Listed } from "./practice";
import type { HoldReason, Status } from "./status";

export interface Reason {
  label: string;
  detail: string | null;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const strip = (note: string) =>
  note
    .trim()
    .replace(/^needs your review:\s*/i, "")
    .replace(/^not a practice job:\s*/i, "")
    .replace(/;\s*real score \d+ \(threshold \d+\)$/i, "");

const FRONTIER: Listed = "frontier";
const TARGET = "a target employer";
const TECH_SCALED = "tech company at scale";

type Rule = readonly [label: (note: string) => string | null, detail?: string | ((note: string) => string)];
const TARGET_RULES: readonly Rule[] = [
  [n => (n.toLowerCase().includes(FRONTIER) ? "Frontier employer" : null)],
  [n => (n.toLowerCase().includes(TARGET) ? "Target employer" : null), n => /\((.+)\)(; .*)?$/.exec(n)?.[1] ?? cap(n)],
  [n => (n.toLowerCase().includes(TECH_SCALED) ? cap(TECH_SCALED) : null), n => /\((.+)\)$/.exec(n)?.[1] ?? cap(n)],
];
const RULES: readonly Rule[] = [...TARGET_RULES, [n => (/\(auto apply allows \d+/i.test(n) ? "Already applying at this employer" : null)]];

const STOPPED: Partial<Record<Status, string>> = {
  awaiting_approval: "Turned down at review",
  approved: "Stopped before applying",
  filling: "Stopped while applying",
  needs_input: "Stopped while waiting on an answer",
  needs_manual: "Stopped at a browser hand-off",
  awaiting_submit: "Stopped before submitting",
  failed: "Cleared after failing",
};

const TRIAGE: Reason = { label: "Held at triage", detail: "Held back on the title, company and place alone, before a full assessment" };

function ruled(rules: readonly Rule[], text: string): Reason {
  for (const [labelOf, detailOf = cap(text)] of rules) {
    const label = labelOf(text);
    if (!label) continue;
    const detail = typeof detailOf === "function" ? detailOf(text) : detailOf;
    return { label, detail: detail && detail !== label ? detail : null };
  }
  return { label: cap(text), detail: null };
}

export function setAsideReason(note: string | null, from: Status | null, holdReason: HoldReason | null): Reason | null {
  if (holdReason === "triage") return TRIAGE;
  const text = strip(note ?? "");
  if (!text) {
    const label = from ? STOPPED[from] : undefined;
    return label ? { label, detail: null } : null;
  }
  if (holdReason === "review" || holdReason === "user") return { label: cap(text), detail: null };
  return ruled(holdReason === "target" ? TARGET_RULES : RULES, text);
}
