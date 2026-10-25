import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { getJob, insertJob, kvSet, updateJob } from "../src/db";
import { countOne, usedToday } from "../src/limits";
import type { RunWorker, ToolArgs, WorkerOptions } from "../src/omp";
import { prep } from "../src/prep";
import { screenChecklistText, screenVerdict } from "../src/rubric";
import { to } from "../src/status";

const initial = { phase: config.phase, autoApply: { ...config.autoApply } };
afterEach(() => Object.assign(config, { phase: initial.phase, autoApply: { ...initial.autoApply } }));

// An answer for every statement the screen asks, "yes" unless overridden.
function screenAnswers(overrides: Record<string, string> = {}, text = screenChecklistText(null)) {
  return [...text.matchAll(/`([\w.]+)`/g)].map(([, id = ""]) => ({ id, answer: overrides[id] ?? "yes", evidence: "quote" }));
}

describe("screen verdict", () => {
  it("rules a practice-phase job out only when it fails both rubrics", () => {
    config.phase = "practice";
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no" }), null)).toEqual({ out: null });
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no", "real.not_senior": "unclear" }), null)).toEqual({ out: null });
    expect(screenVerdict(screenAnswers({ "practice.not_senior": "no", "real.not_senior": "no" }), null)).toEqual({
      out: "screened out: failed practice requirement: not_senior; real requirement: not_senior",
    });
  });

  it("asks only the rubric that decides a listed employer", () => {
    config.phase = "practice";
    const frontier = screenChecklistText("frontier");
    expect(frontier).not.toContain("practice.");
    expect(screenVerdict(screenAnswers({ "real.not_senior": "no" }, frontier), "frontier")).toEqual({
      out: "screened out: failed real requirement: not_senior",
    });
    expect(screenChecklistText("practice")).not.toContain("real.");
  });

  it("asks for every statement", () => {
    config.phase = "practice";
    expect(screenVerdict(screenAnswers().slice(1), null)).toMatch(/^missing answers for: /);
  });
});

// Records the workers prep starts and their prompts; `screen` answers the screen's tool the way a worker would.
function fakeRun(screen?: (report: (args: ToolArgs) => unknown) => void, error?: string) {
  const started: string[] = [];
  const prompts: string[] = [];
  const run: RunWorker = (opts: WorkerOptions) => {
    started.push(opts.name);
    prompts.push(opts.prompt);
    if (opts.name === "screen") screen?.(args => opts.tools["screen_result"]?.handler(args));
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
    config.phase = "practice";
    config.autoApply = { ...config.autoApply, enabled: true, phases: ["practice"], perEmployer: 1 };
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
    config.phase = "practice";
    const job = preppingJob("Screened Co");
    const before = usedToday("prep");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers({ "practice.not_senior": "no", "real.not_senior": "no" }) }));
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "screened out: failed practice requirement: not_senior; real requirement: not_senior" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("puts a job back in the queue when the provider refused the screen", async () => {
    config.phase = "practice";
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
  it("holds a practice-phase job at a tech company at scale after only the real screen", async () => {
    config.phase = "practice";
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
    expect(held?.note).toContain(`a tech company at scale, as judged on job #${earlier.id} (Scaled Co evidence)`);
    expect(JSON.parse(held?.practice_assessment ?? "null")).toMatchObject({ employerType: "tech_scaled" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("still skips a job the real screen rules out", async () => {
    config.phase = "practice";
    assessedJob("Scaled Senior Co", "tech_scaled");
    const job = preppingJob("Scaled Senior Co");
    const { run } = fakeRun(report => report({ answers: screenAnswers({ "real.not_senior": "no" }, screenChecklistText("frontier")) }));
    await prep(job, run);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "screened out: failed real requirement: not_senior" });
  });

  it("gives a practice employer the full assessment", async () => {
    config.phase = "practice";
    assessedJob("Insurer Co", "non_tech_enterprise");
    const job = preppingJob("Insurer Co");
    const { run, started } = fakeRun(report => report({ answers: screenAnswers() }));
    await prep(job, run);
    expect(started).toEqual(["screen", "prep"]);
  });

  it("assesses a job the candidate asked for, whatever the employer", async () => {
    config.phase = "practice";
    assessedJob("Asked For Co", "tech_scaled");
    const job = preppingJob("Asked For Co");
    kvSet(`feedback.${job.id}`, "apply to this one");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual(["prep"]);
  });

  it("skips a real-phase job at an employer judged not a tech company at scale, without a worker", async () => {
    config.phase = "real";
    assessedJob("Agency Co", "it_services");
    const job = preppingJob("Agency Co");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual([]);
    expect(getJob(job.id)?.status).toBe("skipped");
    expect(getJob(job.id)?.note).toContain("failed real requirement: employer_ok (IT services or consultancy");
  });
});
