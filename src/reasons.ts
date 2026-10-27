// Why a job was held or rejected, in a few words a list can show. Thousands of held jobs share the
// same few notes, so the reason names what tells one from another and leaves the rest (the employer's
// size evidence, the score again) to `detail`, which the list shows on hover.
import type { BlockerCause } from "./blockers";
import type { Listed } from "./practice";
import type { GateKind } from "./questions";
import type { Status } from "./status";

export interface Reason {
  label: string; // sentence case, a few words
  detail: string | null; // the note in full, when the label leaves something out
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// What the writers put around the part that differs: auto apply's "needs your review: …" (auto.ts,
// scheduler.ts, fill.ts), the rubric's "not a practice job: …; real score 88 (threshold 65)" (rubric.ts),
// and a clear-out's "Cleared: …".
const strip = (note: string) =>
  note
    .trim()
    .replace(/^needs your review:\s*/i, "")
    .replace(/^not a practice job:\s*/i, "")
    .replace(/^cleared:\s*/i, "")
    .replace(/;\s*real score \d+ \(threshold \d+\)$/i, "");

// The words practice.ts judges employers in, so its notes and these reasons cannot drift apart. Notes
// written before targets were described in words name the one employer type that was a target.
const FRONTIER: Listed = "frontier";
const TARGET = "a target employer";
const TECH_SCALED = "tech company at scale";

// Keyed by kind, so a new gate kind or stop cause fails the typecheck until it has words here.
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

// [the label, if the stripped note is of this kind; its detail]. The first rule that gives a label
// names the reason. With no detail given, the detail is the note in full; "" gives none.
type Rule = readonly [label: (note: string) => string | null, detail?: string | ((note: string) => string)];
const RULES: readonly Rule[] = [
  // Triage (scan.ts) sees only the title, company and place.
  [matches(/^held back (at triage|during the \w+ phase)$/i, "Held at triage"), "Held back on the title, company and place alone, before a full assessment"],
  [n => (n.toLowerCase().includes(FRONTIER) ? "Frontier employer" : null)],
  // practiceVerdict's "a target employer, kept for later (<the assessment's evidence>)".
  [n => (n.toLowerCase().includes(TARGET) ? "Target employer" : null), n => /\((.+)\)(; .*)?$/.exec(n)?.[1] ?? cap(n)],
  [n => (n.toLowerCase().includes(TECH_SCALED) ? cap(TECH_SCALED) : null), n => /\((.+)\)$/.exec(n)?.[1] ?? cap(n)],
  // employerCapNote (auto.ts), and the wordings before it: "second parked role at X (auto apply allows 1 per employer)".
  [matches(/\(auto apply allows \d+/i, "Already applying at this employer")],
  // The pay rule of practice assessments before version 3, which no longer decides anything.
  [matches(/^posted base ceiling .* above the .* practice limit$/i, "Pay above the practice limit")],
  // Clear-outs of stuck applications, typed as the reject's text: "Cleared: stuck on a question gate
  // for over a day", "Cleared: site_down (see Blockers)".
  [
    n => {
      const gate = known(GATE, /^stuck on an? (\w+) gate for over a day$/i.exec(n)?.[1]);
      return gate && `Stuck a day on ${gate}`;
    },
    "",
  ],
  [n => known(CAUSE, /^(\w+) \(see blockers\)$/i.exec(n)?.[1]), ""],
];

// What the job's status was before it was rejected with no note: where the owner stopped it.
const STOPPED: Partial<Record<Status, string>> = {
  awaiting_approval: "Turned down at review",
  approved: "Stopped before applying",
  filling: "Stopped while applying",
  needs_input: "Stopped while waiting on an answer",
  needs_manual: "Stopped at a browser hand-off",
  awaiting_submit: "Stopped before submitting",
  failed: "Cleared after failing",
};

// `from`: the status the job left for this one, for a rejection without a note.
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
