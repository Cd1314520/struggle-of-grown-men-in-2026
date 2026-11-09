import { describe, expect, it } from "bun:test";
import type { JobDetail } from "../../../src/api-types";
import type { Gate } from "../../../src/questions";
import { decisionOf, enteredOf, leadOf, practiceOf, setAsideOf, stepStateOf, timelineOf } from "./model";

const job = (assessment: object | null) => ({ score: 70, practice_assessment: assessment && JSON.stringify(assessment) }) as JobDetail;
const judged = { version: 4, agentNative: "unclear", agentNativeEvidence: "", listed: null, against: "k" };
const HELD = { holdBack: true, describe: "A tech company at scale" };

describe("practice eligibility on the job page", () => {
  it("reads the assessments the server writes today (version 4)", () => {
    const p = practiceOf(job({ ...judged, target: "no", employerEvidence: "Regional insurer; internal claims tooling" }), HELD);
    expect(p?.verdict).toBe("Eligible");
    expect(p?.rows).toContainEqual(["Employer", "Not a target employer", "Regional insurer; internal claims tooling"]);
    expect(p?.rows).toContainEqual(["Agent adoption", "Not clear from the posting", ""]);
  });

  it("reads a version 3 employer type as a judgment against targets", () => {
    const p = practiceOf(job({ ...judged, version: 3, employerType: "tech_scaled", employerEvidence: "Payments infrastructure" }), HELD);
    expect(p?.verdict).toBe("Not eligible");
    expect(p?.rows).toContainEqual(["Employer", "A target employer", "tech company at scale: Payments infrastructure"]);
  });

  it("gives the server's reason when a job is not for practice", () => {
    const p = practiceOf(job({ ...judged, target: "yes", employerEvidence: "Payments infrastructure", listed: "frontier" }), HELD);
    expect(p?.verdict).toBe("Not eligible");
    expect(p?.reason).toBe("The employer is on your frontier list");
    expect(p?.rows[0]).toEqual(["Your lists", "On your frontier list", ""]);
  });

  it("reads older versions as not judged, and says so when nothing usable is stored", () => {
    const old = practiceOf(job({ version: 2, annualBaseMaxUsd: 60000, salaryEvidence: "$60k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }), HELD);
    expect(old?.verdict).toBe("Not eligible");
    expect(old?.rows.map(r => r[1])).toEqual(["Not judged", "Not judged"]);
    expect(practiceOf(job(null), HELD)?.verdict).toBe("Not assessed");
  });

  it("stays out of the way when nothing is held back, unless the job was assessed for it", () => {
    const open = { holdBack: false, describe: "" };
    expect(practiceOf(job(null), open)).toBeNull();
    expect(practiceOf(job({ ...judged, target: null, employerEvidence: "Seed stage" }), open)?.verdict).toBe("Eligible");
  });
});

const gate = (kind: Gate["kind"]) => ({ id: "g1", kind }) as Gate;
const at = (status: JobDetail["status"], more: Partial<JobDetail> = {}) =>
  ({ status, gate: null, submissionAmbiguous: false, recoveryMode: null, pending: null, note: null, ...more }) as JobDetail;

describe("the decision a job waits on", () => {
  it("puts a submission that may already have gone out before every other gate", () => {
    expect(decisionOf(at("needs_manual", { gate: gate("submission_ambiguous"), submissionAmbiguous: true }))).toBe("ambiguous");
    expect(decisionOf(at("awaiting_submit", { gate: gate("confirm_submit"), submissionAmbiguous: true }))).toBe("ambiguous");
    expect(decisionOf(at("filling", { submissionAmbiguous: true }))).toBe("verify");
    expect(decisionOf(at("needs_manual", { recoveryMode: "verify", gate: gate("manual") }))).toBe("verify");
  });

  it("reads each gate and status", () => {
    expect(decisionOf(at("awaiting_approval"))).toBe("review");
    expect(decisionOf(at("needs_input", { gate: gate("question") }))).toBe("question");
    expect(decisionOf(at("needs_input", { gate: gate("cover_letter") }))).toBe("cover_letter");
    expect(decisionOf(at("awaiting_submit", { gate: gate("confirm_submit") }))).toBe("confirm_submit");
    expect(decisionOf(at("needs_manual", { gate: gate("manual") }))).toBe("manual");
    expect(decisionOf(at("failed"))).toBe("failed");
    expect(decisionOf(at("held"))).toBe("held");
    expect(decisionOf(at("rejected", { submissionAmbiguous: true }))).toBe("rejected");
    expect(decisionOf(at("locating"))).toBe("running");
    expect(decisionOf(at("interview"))).toBe("process");
    expect(decisionOf(at("withdrawn"))).toBe("process");
  });
});

describe("the summary a filled application is approved on", () => {
  it("turns the agent's 'Label: value' lines into rows, keeping the file name of the frozen resume", () => {
    const e = enteredOf(
      "Boeing, JR2026523081. Re-observed the review page.\nMy Information: legal name Ada Lovelace; email d@x.com\nResume: exact supplied file /home/d/auto-apply/data/jobs/16913/applied/9b57/resume.pdf retained\nQuestions: 18 or older? Yes.",
    );
    expect("rows" in e && e.rows).toEqual([
      ["", "Boeing, JR2026523081. Re-observed the review page."],
      ["My Information", "legal name Ada Lovelace; email d@x.com"],
      ["Resume", "exact supplied file resume.pdf retained"],
      ["Questions", "18 or older? Yes."],
    ]);
  });

  it("takes a one-paragraph summary a sentence at a time, and leaves a short one as it is", () => {
    const e = enteredOf("Forescout, Dallas. Contact: First Name Ada; Email d@x.com. Resume: verified as resume.pdf. Gender: Decline to Self Identify.");
    expect("rows" in e && e.rows.map(r => r[0])).toEqual(["", "Contact", "Resume", "Gender"]);
    expect(enteredOf("Name, email and resume entered.")).toEqual({ text: "Name, email and resume entered." });
  });
});

describe("a sent application's next steps", () => {
  const now = Date.parse("2026-10-25T12:00:00Z");
  const step = (s: object) => ({ state: "todo", due_at: null, scheduled_at: null, ...s }) as JobDetail["steps"][number];

  it("says whose move it is, naming the step only when several are open", () => {
    const base = { status: "interview", note: null, updated_at: "", submitted_at: "", company: "Loenbro" } as const;
    const next = { whose: "you", at: "2026-10-30", due: true, kind: "assessment", label: "Take-home", quiet: false } as const;
    expect(leadOf({ ...base, next, steps: [step({})] }, now).text).toMatch(/^Your move, due /);
    expect(leadOf({ ...base, next, steps: [step({}), step({ state: "done" })] }, now).text).toMatch(/^Your move: Take-home, due /);
    const them = { ...next, whose: "them", at: "2026-10-15T12:00:00Z", due: false, quiet: true } as const;
    const lead = leadOf({ ...base, next: them, steps: [step({ state: "done" })] }, now);
    expect(lead.tone).toBe("warning");
    expect(lead.text).toMatch(/^No reply from Loenbro for 10 days since .*\. Worth a nudge\?$/);
    const calm = leadOf({ ...base, next: { ...them, quiet: false }, steps: [step({ state: "done" })] }, now);
    expect(calm.tone).toBe("neutral");
    expect(calm.text).toMatch(/^Waiting on Loenbro since (?!.*nudge)/);
  });

  it("reads a step's state against the clock", () => {
    expect(stepStateOf(step({ due_at: "2026-10-20" }), now).label).toBe("Overdue");
    expect(stepStateOf(step({ state: "scheduled", scheduled_at: "2026-10-28T19:30:00Z" }), now).label).toBe("Booked");
    expect(stepStateOf(step({ state: "scheduled", scheduled_at: "2026-10-20T19:30:00Z" }), now)).toMatchObject({ label: "Held", waiting: true });
  });
});

describe("the activity timeline", () => {
  const detail = {
    history: [{ from_status: "needs_manual", to_status: "rejected", note: "Cleared: site_down", approved_by: null, at: "2026-10-25 01:57:06" }],
    blockers: [{ id: 1, job_id: 1, cause: "site_down", detail: "Workday maintenance", at: "2026-10-24 06:57:42" }],
    events: [
      { worker: null, kind: "user", message: "reject: Cleared: site_down", at: "2026-10-25 01:57:06" },
      { worker: "fill", kind: "gate", message: "manual: Workday maintenance", at: "2026-10-24 06:57:42" },
      { worker: "fill", kind: "system", message: "fill worker aborted: ", at: "2026-10-24 06:57:42" },
      { worker: "fill", kind: "step", message: "Parking the draft", at: "2026-10-24 06:57:40" },
      { worker: "fill", kind: "tool", message: 'checkpoint {"step":"x"}', at: "2026-10-24 06:57:39" },
      { worker: "fill", kind: "step", message: "Inspecting the portal", at: "2026-10-24 06:56:00" },
    ],
  } as unknown as JobDetail;

  it("says each thing once, as the owner's own action where it was theirs", () => {
    const t = timelineOf(detail);
    expect(t.map(e => e.type)).toEqual(["event", "blocker", "run"]);
    expect(t[0]).toMatchObject({ title: "You rejected it", detail: "Cleared: site_down" });
  });

  it("folds a worker's steps into one run and leaves out tool calls", () => {
    expect(timelineOf(detail).at(-1)).toMatchObject({ type: "run", worker: "fill", steps: ["Parking the draft", "Inspecting the portal"] });
  });
});

describe("why a job was set aside", () => {
  const change = (from_status: JobDetail["status"]) => ({
    from_status,
    to_status: "rejected" as const,
    note: null,
    approved_by: null,
    at: "2026-10-24 10:00:00",
  });
  it("names it as the Archive does, not by the raw note", () => {
    expect(
      setAsideOf({
        note: "not a practice job: the employer is on your frontier list; held without a full assessment until it is released",
        history: [],
        hold_reason: "target",
      })?.label,
    ).toBe("Frontier employer");
  });
  it("names a triage hold by its hold reason, whatever the note says", () => {
    expect(setAsideOf({ note: "held back at triage", history: [], hold_reason: "triage" })?.label).toBe("Held at triage");
  });
  it("falls back to where the owner stopped it when there is no note", () => {
    expect(setAsideOf({ note: null, history: [change("awaiting_approval")], hold_reason: null })?.label).toBe("Turned down at review");
  });
});
