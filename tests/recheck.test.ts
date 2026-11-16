import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { answerProblem } from "../src/recheck";

const src = (name: string) => JSON.stringify(join(import.meta.dir, `../src/${name}.ts`));
const prelude = `
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db, getJob, kvSet, updateJob } from ${src("db")};
import { parkGate, getGate } from ${src("questions")};
import { recheckDue, recheckOpenQuestions } from ${src("recheck")};
function job(id, company) {
  db.query("INSERT INTO jobs (id,url,source,company,title,status,resume_sha,resume_frozen_at) VALUES (?,?,?,?,?,'filling','frozen-sha','2026-10-10T00:00:00Z')").run(id, "https://ats.example/jobs/" + id, "test", company, "Engineer");
}
const ask = (text, options) => ({ kind: "question", text, context: "Required field", options });
function worker(calls, replies, prompts = []) {
  return opts => {
    prompts.push(opts.prompt);
    for (const [tool, args] of calls) replies.push(opts.tools[tool].handler(args));
    return { done: Promise.resolve({ status: "completed", lastText: "" }), abort() {} };
  };
}
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-recheck-"));
  try {
    mkdirSync(join(dir, "profile"));
    writeFileSync(join(dir, "profile", "personal.yml"), "first_name: Pat\naddress:\n  city: Austin\n  state: TX\n");
    writeFileSync(join(dir, "profile", "answers.md"), "### Are you Hispanic or Latino?\nNo.\n");
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Recheck scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("answer checks", () => {
  it("takes an option verbatim, several where more than one may be picked, or any text for a free-text question", () => {
    expect(answerProblem(["Yes", "No"], "No")).toBeNull();
    expect(answerProblem(["8-10 AM", "10-12 AM"], "8-10 AM; 10-12 AM")).toBeNull();
    expect(answerProblem([], "Fort Bend")).toBeNull();
    expect(answerProblem(["Yes", "No"], "no")).toContain("not one of the options");
    expect(answerProblem([], "  ")).toBe("the answer is blank");
  });
});

describe("recheck", () => {
  it("answers what the profile settles, resumes those applications, and leaves the rest parked", () => {
    scenario(`
    job(1, "Acme"); job(2, "Beta"); job(3, "Gamma");
    for (const id of [1, 2, 3]) updateJob(id, { posted_at: new Date(Date.now() - (4 - id) * 864e5).toISOString() });
    const hispanic = parkGate(1, ask("Are you Hispanic or Latino?", ["Yes", "No"]), null);
    const title = parkGate(2, ask("Title", ["Mr.", "Ms."]), null);
    const ssn = parkGate(3, ask("Social Security Number", []), null);
    const replies = [], prompts = [];
    await recheckOpenQuestions(worker([
      ["answer_question", { number: 99, answer: "No", basis: "x" }],
      ["answer_question", { number: 2, answer: "Mister", basis: "low-stakes" }],
      ["answer_question", { number: 2, answer: "Mr.", basis: "low-stakes" }],
      ["answer_question", { number: 3, answer: "No", basis: "Are you Hispanic or Latino?" }],
      ["recheck_done", { summary: "too early" }],
      ["leave_question", { number: 1, reason: "  " }],
      ["leave_question", { number: 1, reason: "needs the number itself" }],
      ["recheck_done", { summary: "answered 2, left SSN" }],
    ], replies, prompts));
    assert.ok(prompts[0].includes("1. Gamma") && prompts[0].includes("3. Acme"));
    assert.ok(prompts[0].includes("Hispanic or Latino?\\nNo."));
    // A free-text answer it writes goes through the humanizer rules first.
    assert.ok(prompts[0].includes("Editing a free-text answer") && prompts[0].includes("# Humanizer: remove AI writing patterns"));
    assert.ok(prompts[0].includes("## Resume") && prompts[0].includes("#show"));
    assert.ok(replies[0].startsWith("ERROR") && replies[1].startsWith("ERROR"));
    assert.ok(replies[4].startsWith("ERROR") && replies[4].includes("question 1"));
    assert.ok(replies[5].startsWith("ERROR"));
    assert.equal(replies[6], "Left for the candidate.");
    assert.equal(getGate(title.id).answer, "Mr.");
    assert.equal(getGate(hispanic.id).answer, "No");
    assert.equal(getGate(ssn.id).state, "open");
    assert.equal(getJob(1).status, "approved");
    assert.equal(getJob(3).status, "needs_input");
    const left = db.query("SELECT message FROM events WHERE job_id = 3 AND worker = 'recheck'").all().map(e => e.message);
    assert.deepEqual(left, ['Left for you: "Social Security Number" — needs the number itself']);
    `);
  });

  it("leaves an essay question to the owner on a job whose prose they write themselves", () => {
    scenario(`
    const { config } = await import(${src("config")});
    config.ownWritingAbove = 80;
    job(1, "Acme"); job(2, "Beta"); job(3, "Gamma");
    updateJob(1, { score: 91 }); updateJob(2, { score: 80 }); updateJob(3, { score: 91 });
    for (const id of [1, 2, 3]) updateJob(id, { posted_at: new Date(Date.now() - id * 864e5).toISOString() });
    const essay = { ...ask("Why do you want to work here?", []), why: "free_text" };
    const mine = parkGate(1, essay, null);
    const agents = parkGate(2, essay, null);
    const fact = parkGate(3, { ...ask("Title", ["Mr.", "Ms."]), why: "other" }, null);
    const prompts = [];
    await recheckOpenQuestions(worker([
      ["answer_question", { number: 1, answer: "Because of the robots.", basis: "resume" }],
      ["answer_question", { number: 2, answer: "Mr.", basis: "low-stakes" }],
      ["recheck_done", { summary: "answered 2" }],
    ], [], prompts));
    assert.ok(prompts[0].includes("1. Beta") && prompts[0].includes("2. Gamma"));
    assert.ok(!prompts[0].includes("Acme"), "the owner's essay is not offered to the recheck");
    assert.equal(getGate(mine.id).state, "open");
    assert.equal(getJob(1).status, "needs_input");
    assert.equal(getGate(agents.id).answer, "Because of the robots.");
    assert.equal(getGate(fact.id).answer, "Mr.");
    `);
  });

  it("runs again only once the profile has changed and settled, and retries a run that did not finish", () => {
    scenario(`
    job(1, "Acme");
    parkGate(1, ask("Title", ["Mr.", "Ms."]), null);
    const settled = () => kvSet("recheck.seenAt", "2000-01-01T00:00:00Z");
    assert.equal(recheckDue(), false);
    settled();
    assert.equal(recheckDue(), true);
    await recheckOpenQuestions(worker([], []));
    assert.equal(recheckDue(), false);
    kvSet("recheck.triedAt", "2000-01-01T00:00:00Z");
    assert.equal(recheckDue(), true);
    await recheckOpenQuestions(worker([["leave_question", { number: 1, reason: "needs the candidate" }], ["recheck_done", { summary: "left it" }]], []));
    assert.equal(recheckDue(), false);
    writeFileSync(process.env.AUTO_APPLY_PROFILE + "/answers.md", "### Title\\nMr.\\n");
    assert.equal(recheckDue(), false);
    settled();
    assert.equal(recheckDue(), true);
    `);
  });

  it("also runs for question gates it has not considered, and only those", () => {
    scenario(`
    job(1, "Acme"); job(2, "Beta");
    parkGate(1, ask("Title", ["Mr.", "Ms."]), null);
    db.query("UPDATE question_gates SET created_at = '1999-01-01T00:00:00Z' WHERE job_id = 1").run();
    const prompts = [];
    assert.equal(recheckDue(), false);
    kvSet("recheck.seenAt", "2000-01-01T00:00:00Z");
    assert.equal(recheckDue(), true);
    await recheckOpenQuestions(worker([["leave_question", { number: 1, reason: "needs the candidate" }], ["recheck_done", { summary: "left it" }]], [], prompts));
    assert.equal(recheckDue(), false);
    parkGate(2, ask("Pronouns", []), null);
    assert.equal(recheckDue(), false);
    kvSet("recheck.considered", "2000-01-01T00:00:00Z");
    db.query("UPDATE question_gates SET created_at = '2000-06-01T00:00:00Z' WHERE job_id = 2").run();
    assert.equal(recheckDue(), true);
    await recheckOpenQuestions(worker([["leave_question", { number: 1, reason: "no pronouns in the details" }], ["recheck_done", { summary: "left it" }]], [], prompts));
    assert.ok(prompts[1].includes("Pronouns") && !prompts[1].includes("Question: Title"));
    assert.equal(recheckDue(), false);
    const events = db.query("SELECT message FROM events WHERE job_id = 2 AND worker = 'recheck'").all().map(e => e.message);
    assert.deepEqual(events, ['Left for you: "Pronouns" — no pronouns in the details']);
    `);
  });
});
