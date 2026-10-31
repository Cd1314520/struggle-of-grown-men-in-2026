import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { getJob, insertJob, kvSet, updateJob } from "../src/db";
import { countOne, usedToday } from "../src/limits";
import type { RunWorker, ToolArgs, WorkerOptions } from "../src/worker";
import { prep } from "../src/prep";
import { checklistText, screenChecklistText, screenVerdict } from "../src/rubric";
import { to } from "../src/status";

const initial = { approval: config.approval, targets: { ...config.targets }, autoApply: { ...config.autoApply } };
afterEach(() => Object.assign(config, { approval: initial.approval, targets: { ...initial.targets }, autoApply: { ...initial.autoApply } }));

// An answer for every statement the screen asks, "yes" unless overridden.
function screenAnswers(overrides: Record<string, string> = {}, text = screenChecklistText(null)) {
  return [...text.matchAll(/`([\w.]+)`/g)].map(([, id = ""]) => ({ id, answer: overrides[id] ?? "yes", evidence: "quote" }));
}

describe("screen verdict", () => {
  it("rules a job out only when it fails both rubrics", () => {
    config.targets.holdBack = true;
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no" }), null)).toEqual({ out: null });
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no", "real.not_senior": "unclear" }), null)).toEqual({ out: null });
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no", "real.not_senior": "no" }), null)).toEqual({
      out: "screened out: failed practice requirement: not_senior; real requirement: not_senior",
    });
  });

  it("asks only the rubric that decides a listed employer", () => {
    config.targets.holdBack = true;
    const frontier = screenChecklistText("frontier");
    expect(frontier).not.toContain("practice.");
    expect(screenVerdict(screenAnswers({ "real.not_senior": "no" }, frontier), "frontier")).toEqual({
      out: "screened out: failed real requirement: not_senior",
    });
    expect(screenChecklistText("practice")).not.toContain("real.");
  });

  it("asks for every statement", () => {
    config.targets.holdBack = true;
    expect(screenVerdict(screenAnswers().slice(1), null)).toMatch(/^missing answers for: /);
  });
});

// Records the workers prep starts and their prompts; `screen` answers the screen's tool the way a worker
// would, and `assess` the full assessment's submit_checklist (given its prompt).
function fakeRun(
  screen?: (report: (args: ToolArgs) => unknown) => void,
  error?: string,
  assess?: (report: (args: ToolArgs) => unknown, prompt: string) => void,
) {
  const started: string[] = [];
  const prompts: string[] = [];
  const run: RunWorker = (opts: WorkerOptions) => {
    started.push(opts.name);
    prompts.push(opts.prompt);
    if (opts.name === "screen") screen?.(args => opts.tools["screen_result"]?.handler(args));
    if (opts.name === "prep") assess?.(args => opts.tools["submit_checklist"]?.handler(args), opts.prompt);
    return { done: Promise.resolve({ status: error ? "error" : "completed", lastText: "", ...(error ? { error } : {}) }), abort: () => undefined };
  };
  return { run, started, prompts };
}

let n = 0;
function preppingJob(company: string, description: string | null = "A posting long enough to read.") {
  const id = insertJob({ url: `https://example.com/jobs/${++n}`, source: "greenhouse", company, title: `Engineer ${n}`, location: "Austin, TX", description });
  if (!id) throw new Error("job not inserted");
  countOne("prep");
  updateJob(id, to.prepping());
  const job = getJob(id);
  if (!job) throw new Error("job not found");
  return job;
}

describe("prep before the full assessment", () => {
  it("skips a job whose employer auto apply has used up, without starting a worker", async () => {
    config.approval = "auto";
    config.autoApply = { ...config.autoApply, perEmployer: 1 };
    const sent = preppingJob("Used Up Co");
    updateJob(sent.id, { status: "submitted" });
    const job = preppingJob("Used Up Co");
    const before = usedToday("prep");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual([]);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "already applying to 1 other role at this employer (auto apply allows 1)" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("skips a job the screen rules out, and gives back the day's count", async () => {
    config.targets.holdBack = true;
    const job = preppingJob("Screened Co");
    const before = usedToday("prep");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers({ "practice.not_senior": "no", "real.not_senior": "no" }) }));
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "screened out: failed practice requirement: not_senior; real requirement: not_senior" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("skips a job whose description asks for 5 or more years, without starting a worker", async () => {
    const job = preppingJob("Senior Years Co", "Requirements\n- 6+ years of professional software experience");
    const before = usedToday("prep");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual([]);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "senior level: the posting asks for 6+ years of experience" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("does not ask the full assessment again what the screen answered yes", async () => {
    config.targets.holdBack = false;
    const job = preppingJob("Answered Co");
    let reply = "";
    let asked: string[] = [];
    const { run, started, prompts } = fakeRun(
      report => report({ answers: screenAnswers({ "practice.applies_online": "unclear" }) }),
      undefined,
      (report, prompt) => {
        asked = [...prompt.matchAll(/^- `((?:practice|real)\.\w+)`:/gm)].map(([, id = ""]) => id);
        const practice = { target: "no", employerEvidence: "A small insurer.", agentNative: "unclear", agentNativeEvidence: "" };
        reply = String(report({ answers: asked.map(id => ({ id, answer: "yes", evidence: "full read" })), practice }));
      },
    );
    await prep(job, run);
    expect(started).toEqual(["screen", "prep"]);
    const screened = screenChecklistText(null);
    // Asked again: what the screen left unclear, and every statement it does not ask.
    expect(asked).toContain("practice.applies_online");
    expect(asked).toContain("practice.degree_fits");
    expect(asked).not.toContain("practice.not_senior");
    expect(asked).not.toContain("real.no_cover_letter");
    expect(asked.length).toBe(checklistText().split("\n").length - (screened.split("\n").length - 1));
    // Every statement still scored, with the screen's evidence for the ones it settled.
    expect(reply).toMatch(/^Checklist recorded/);
    const items = JSON.parse(getJob(job.id)?.checklist ?? "[]") as { key: string; evidence: string }[];
    expect(items.length).toBe(checklistText().split("\n").length);
    expect(items.find(i => i.key === "practice.not_senior")?.evidence).toBe("quote");
    expect(items.find(i => i.key === "practice.applies_online")?.evidence).toBe("full read");
    // The prompt is shorter by the screened statements, and names this employer only.
    const saved = checklistText().length - (prompts[1]?.match(/^- `(?:practice|real)\.\w+`:.*$/gm) ?? []).join("\n").length;
    expect(saved).toBeGreaterThan(1500);
    expect(prompts[1]).toContain("(none of these employers)");
  });

  it("puts a job back in the queue when the provider refused the screen", async () => {
    config.targets.holdBack = true;
    const job = preppingJob("Busy Co");
    const { run, started } = fakeRun(undefined, "Codex is at capacity, please try again later");
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(getJob(job.id)?.status).toBe("triaged");
  });
});

// A job at `company` that a full assessment judged to be `employerType`.
function assessedJob(company: string, employerType: string) {
  const job = preppingJob(company);
  const practice = { version: 3, employerType, employerEvidence: `${company} evidence`, agentNative: "unclear", agentNativeEvidence: "", listed: null };
  updateJob(job.id, { ...to.held("assessed"), checklist: "[]", practice_assessment: JSON.stringify(practice) });
  return job;
}

describe("prep for an employer judged before", () => {
  it("holds a job at an employer judged a target after only the real screen", async () => {
    config.targets.holdBack = true;
    const earlier = assessedJob("Scaled Co", "tech_scaled");
    assessedJob("Scaled Co", "startup");
    const job = preppingJob("Scaled Co");
    const before = usedToday("prep");
    const { run, started, prompts } = fakeRun(report => report({ answers: screenAnswers({}, screenChecklistText("frontier")) }));
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(prompts[0]).not.toContain("practice.");
    const held = getJob(job.id);
    expect(held?.status).toBe("held");
    // Judged before targets were described in words: the default description is that judgment.
    expect(held?.note).toContain(`a target employer, as judged on job #${earlier.id} (tech company at scale: Scaled Co evidence)`);
    expect(JSON.parse(held?.practice_assessment ?? "null")).toMatchObject({ target: "yes" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("still skips a job the real screen rules out", async () => {
    config.targets.holdBack = true;
    assessedJob("Scaled Senior Co", "tech_scaled");
    const job = preppingJob("Scaled Senior Co");
    const { run } = fakeRun(report => report({ answers: screenAnswers({ "real.not_senior": "no" }, screenChecklistText("frontier")) }));
    await prep(job, run);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "screened out: failed real requirement: not_senior" });
  });

  it("gives a practice employer the full assessment", async () => {
    config.targets.holdBack = true;
    assessedJob("Insurer Co", "non_tech_enterprise");
    const job = preppingJob("Insurer Co");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers() }));
    await prep(job, run);
    expect(started).toEqual(["screen", "prep"]);
  });

  it("assesses a job the candidate asked for, whatever the employer", async () => {
    config.targets.holdBack = true;
    assessedJob("Asked For Co", "tech_scaled");
    const job = preppingJob("Asked For Co");
    kvSet(`feedback.${job.id}`, "apply to this one");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual(["prep"]);
  });

  it("gives a target employer the full assessment when nothing is held back", async () => {
    config.targets.holdBack = false;
    assessedJob("Open Scaled Co", "tech_scaled");
    const job = preppingJob("Open Scaled Co");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers() }));
    await prep(job, run);
    expect(started).toEqual(["screen", "prep"]);
  });

  it("judges employers afresh once targets are described in other words", async () => {
    config.targets.holdBack = true;
    config.targets.describe = "A company that makes developer tools";
    assessedJob("Rephrased Co", "tech_scaled");
    const job = preppingJob("Rephrased Co");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers() }));
    await prep(job, run);
    expect(started).toEqual(["screen", "prep"]);
  });
});
