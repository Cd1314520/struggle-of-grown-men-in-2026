// How the app's states read: one word or two, and a tone. Every page takes its wording from here, so a
// status reads the same wherever it shows.
import type { BlockerCause } from "../../src/blockers";
import type { GateKind } from "../../src/questions";
import type { Status } from "../../src/status";
import type { StepKind } from "../../src/steps";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export const STATUS: Record<Status, readonly [label: string, tone: Tone]> = {
  found: ["Found", "neutral"],
  locating: ["Finding posting", "info"],
  triaged: ["Not assessed", "neutral"],
  prepping: ["Assessing", "info"],
  awaiting_approval: ["To review", "accent"],
  approved: ["Queued", "info"],
  filling: ["Applying", "info"],
  needs_input: ["Needs answer", "warning"],
  awaiting_submit: ["Confirm submit", "warning"],
  needs_manual: ["Hand-off", "warning"],
  // Sent and waiting: green is kept for an employer's yes, so most of Applications isn't green for no reply.
  submitted: ["Applied", "info"],
  interview: ["In process", "success"],
  offer: ["Offer", "success"],
  rejected_by_company: ["Declined", "danger"],
  withdrawn: ["Withdrawn", "neutral"],
  held: ["Held", "neutral"],
  skipped: ["Skipped", "neutral"],
  rejected: ["Rejected", "neutral"],
  failed: ["Failed", "danger"],
};

// What an open gate asks of the user.
export const GATE: Record<GateKind, string> = {
  question: "Question",
  cover_letter: "Cover letter",
  confirm_submit: "Confirm submit",
  manual: "Browser hand-off",
  submission_ambiguous: "Check if sent",
};

export const CAUSE: Record<BlockerCause, string> = {
  site_down: "Site down",
  login: "Can't log in",
  captcha: "CAPTCHA",
  email_code: "Emailed code",
  no_form: "No online form",
  needs_you: "Needs you",
  browser: "Browser glitch",
  no_response: "No response to submit",
  unknown: "Stopped without reporting",
  other: "Other",
};

export const STEP_KIND: Record<StepKind, string> = {
  questionnaire: "Questionnaire",
  assessment: "Assessment",
  schedule: "Booking",
  interview: "Interview",
  info_request: "Information request",
  other: "Step",
};

// The profile files by what the owner calls them; profileProblems names the resume "resume".
export const PROFILE_LABEL: Record<string, string> = {
  "targets.md": "Targets",
  "rubric.yml": "Rubric",
  "main.typ": "Resume",
  resume: "Resume",
  "resume-notes.md": "Resume notes",
  "answers.md": "Answers",
  "personal.yml": "Personal",
  "companies.yml": "Companies",
  "employers.yml": "Employers",
};
