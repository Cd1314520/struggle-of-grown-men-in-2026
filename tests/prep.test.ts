import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { db, getJob, insertJob, moveJob, updateJob } from "../src/db";
import { countOne, usedToday } from "../src/limits";
import type { RunWorker, ToolArgs, WorkerOptions } from "../src/worker";
import { prep } from "../src/prep";
import { screenChecklistText, screenVerdict } from "../src/rubric";
import { to } from "../src/status";

const initial = { approval: config.approval, targets: { ...config.targets }, autoApply: { ...config.autoApply } };
afterEach(() => Object.assign(config, { approval: initial.approval, targets: { ...initial.targets }, autoApply: { ...initial.autoApply } }));

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
  db.run("UPDATE jobs SET status = 'prepping' WHERE id = ?", [id]);
  const job = getJob(id);
  if (!job) throw new Error("job not found");
  return job;
}

describe("prep before the full assessment", () => {
  it("skips a job whose employer auto apply has used up, without starting a worker", async () => {
    config.approval = "auto";
    config.autoApply = { ...config.autoApply, perEmployer: 1 };
    const sent = preppingJob("Used Up Co");
    db.run("UPDATE jobs SET status = 'submitted' WHERE id = ?", [sent.id]);
    const job = preppingJob("Used Up Co");
    const before = usedToday("prep");
    const { run, started } = fakeRun();
    await prep(job, run);
    expect(started).toEqual([]);
    expect(getJob(job.id)).toMatchObject({ status: "skipped", note: "already applying to 1 other role at this employer (auto apply allows 1)" });
    expect(usedToday("prep")).toBe(before - 1);
  });

  it("lets a further role through once the employer's application closes, unless it closed after an interview", async () => {
    config.approval = "auto";
    config.autoApply = { ...config.autoApply, perEmployer: 1, cooldownDays: 180 };
    const declined = preppingJob("Declined Co");
    db.run("UPDATE jobs SET status = 'rejected_by_company', submitted_at = datetime('now') WHERE id = ?", [declined.id]);
    const next = preppingJob("Declined Co");
    const { run, started } = fakeRun();
    await prep(next, run);
    expect(started).not.toEqual([]);

    const interviewed = preppingJob("Interviewed Co");
    db.run("UPDATE jobs SET status = 'rejected_by_company', submitted_at = datetime('now') WHERE id = ?", [interviewed.id]);
    db.run("INSERT INTO application_steps (job_id, kind, title, source) VALUES (?, 'interview', 'Onsite', 'user')", [interviewed.id]);
    const after = preppingJob("Interviewed Co");
    await prep(after, fakeRun().run);
    expect(getJob(after.id)?.status).toBe("skipped");
    expect(getJob(after.id)?.note).toMatch(/turned you down after interviewing on \d{4}-\d{2}-\d{2} \(auto apply waits 180 days\)$/);
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

  it("puts a job back in the queue when the provider refused the screen", async () => {
    config.targets.holdBack = true;
    const job = preppingJob("Busy Co");
    const { run, started } = fakeRun(undefined, "Codex is at capacity, please try again later");
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(getJob(job.id)?.status).toBe("triaged");
  });

  it("drops its outcome when the job was taken out of prep while the worker ran", async () => {
    config.targets.holdBack = true;
    const job = preppingJob("Withdrawn Co");
    const { run, started } = fakeRun(report => {
      moveJob(job.id, "prepping", { status: "triaged", note: "released by hand" });
      report({ answers: screenAnswers({ "practice.not_senior": "no", "real.not_senior": "no" }) });
    });
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(getJob(job.id)).toMatchObject({ status: "triaged", note: "released by hand" });
  });
});

function assessedJob(company: string, employerType: string) {
  const job = preppingJob(company);
  const practice = { version: 3, employerType, employerEvidence: `${company} evidence`, agentNative: "unclear", agentNativeEvidence: "", listed: null };
  if (!moveJob(job.id, "prepping", { ...to.held("assessed", "target"), checklist: "[]", practice_assessment: JSON.stringify(practice) }))
    throw new Error("job not held");
  return job;
}

describe("prep for an employer judged before", () => {
  it("holds a job at an employer judged a target after only the real screen", async () => {
    config.targets.holdBack = true;
    const earlier = assessedJob("Scaled Co", "tech_scaled");
    assessedJob("Scaled Co", "startup");
    const job = preppingJob("Scaled Co");
    updateJob(job.id, { feedback: "worth a look" });
    const before = usedToday("prep");
    const { run, started, prompts } = fakeRun(report => report({ answers: screenAnswers({}, screenChecklistText("frontier")) }));
    await prep(job, run);
    expect(started).toEqual(["screen"]);
    expect(prompts[0]).not.toContain("practice.");
    const held = getJob(job.id);
    expect(held?.status).toBe("held");
    expect(held?.note).toContain(`a target employer, as judged on job #${earlier.id} (tech company at scale: Scaled Co evidence)`);
    expect(JSON.parse(held?.practice_assessment ?? "null")).toMatchObject({ target: "yes" });
    expect(held).toMatchObject({ hold_reason: "target", feedback: null });
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
    updateJob(job.id, { feedback: "apply to this one", hand_picked: 1 });
    const { run, started } = fakeRun();
    await prep(getJob(job.id) ?? job, run);
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
