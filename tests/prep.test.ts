import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { getJob, insertJob, updateJob } from "../src/db";
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

// Records the workers prep starts; `screen` answers the screen's tool the way a worker would.
function fakeRun(screen?: (report: (args: ToolArgs) => unknown) => void, error?: string) {
  const started: string[] = [];
  const run: RunWorker = (opts: WorkerOptions) => {
    started.push(opts.name);
    if (opts.name === "screen") screen?.(args => opts.tools["screen_result"]?.handler(args));
    return { done: Promise.resolve({ status: error ? "error" : "completed", lastText: "", ...(error ? { error } : {}) }), abort: () => undefined };
  };
  return { run, started };
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
