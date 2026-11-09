import type { BlockerCause } from "./blockers";
import type { Listed } from "./practice";
import type { GateKind } from "./questions";
import type { Status } from "./status";

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
    .replace(/^cleared:\s*/i, "")
    .replace(/;\s*real score \d+ \(threshold \d+\)$/i, "");

const FRONTIER: Listed = "frontier";
const TARGET = "a target employer";
const TECH_SCALED = "tech company at scale";

const GATE: Record<GateKind, string> = {
  question: "a question",
  cover_letter: "a cover letter",
  confirm_submit: "the submit check",
  manual: "a browser hand-off",
  submission_ambiguous: "an unclear submission",
};
const CAUSE: Record<BlockerCause, string> = {
  site_down: "Site was down",
  login: "Couldn't log in",
  captcha: "Blocked by a CAPTCHA",
  email_code: "Needed an emailed code",
  no_form: "No online form",
  needs_you: "Needed you",
  browser: "Browser glitch",
  no_response: "No response to submit",
  unknown: "Stopped without reporting",
  other: "Stopped for another reason",
};
const known = <K extends string>(labels: Record<K, string>, key: string | undefined): string | null =>
  key !== undefined && Object.hasOwn(labels, key) ? labels[key as K] : null;
const matches = (re: RegExp, label: string) => (note: string) => (re.test(note) ? label : null);

type Rule = readonly [label: (note: string) => string | null, detail?: string | ((note: string) => string)];
const RULES: readonly Rule[] = [
  [matches(/^held back (at triage|during the \w+ phase)$/i, "Held at triage"), "Held back on the title, company and place alone, before a full assessment"],
  [n => (n.toLowerCase().includes(FRONTIER) ? "Frontier employer" : null)],
  [n => (n.toLowerCase().includes(TARGET) ? "Target employer" : null), n => /\((.+)\)(; .*)?$/.exec(n)?.[1] ?? cap(n)],
  [n => (n.toLowerCase().includes(TECH_SCALED) ? cap(TECH_SCALED) : null), n => /\((.+)\)$/.exec(n)?.[1] ?? cap(n)],
  [matches(/\(auto apply allows \d+/i, "Already applying at this employer")],
  [matches(/^posted base ceiling .* above the .* practice limit$/i, "Pay above the practice limit")],
  [
    n => {
      const gate = known(GATE, /^stuck on an? (\w+) gate for over a day$/i.exec(n)?.[1]);
      return gate && `Stuck a day on ${gate}`;
    },
    "",
  ],
  [n => known(CAUSE, /^(\w+) \(see blockers\)$/i.exec(n)?.[1]), ""],
];

const STOPPED: Partial<Record<Status, string>> = {
  awaiting_approval: "Turned down at review",
  approved: "Stopped before applying",
  filling: "Stopped while applying",
  needs_input: "Stopped while waiting on an answer",
  needs_manual: "Stopped at a browser hand-off",
  awaiting_submit: "Stopped before submitting",
  failed: "Cleared after failing",
};

export function setAsideReason(note: string | null, from: Status | null = null): Reason | null {
  const text = strip(note ?? "");
  if (!text) {
    const label = from ? STOPPED[from] : undefined;
    return label ? { label, detail: null } : null;
  }
  for (const [labelOf, detailOf = cap(text)] of RULES) {
    const label = labelOf(text);
    if (!label) continue;
    const detail = typeof detailOf === "function" ? detailOf(text) : detailOf;
    return { label, detail: detail && detail !== label ? detail : null };
  }
  return { label: cap(text), detail: null };
}
