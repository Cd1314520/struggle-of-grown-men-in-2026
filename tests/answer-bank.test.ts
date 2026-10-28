import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { editText } from "../src/answer-bank";

// Each scenario imports the production modules in a fresh process with throwaway state and profile.
const src = (name: string) => JSON.stringify(join(import.meta.dir, `../src/${name}.ts`));
const prelude = `
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { db, kvSet } from ${src("db")};
import { answerGate, parkGate, unfiledAnswers } from ${src("questions")};
import { bankDue, fileKeptAnswers } from ${src("answer-bank")};
const profile = process.env.AUTO_APPLY_PROFILE, data = process.env.AUTO_APPLY_DATA;
const answers = () => readFileSync(profile + "/answers.md", "utf8");
function job(id, company) {
  db.query("INSERT INTO jobs (id,url,source,company,title,status,resume_sha,resume_frozen_at) VALUES (?,?,?,?,?,'filling','frozen-sha','2026-10-10T00:00:00Z')").run(id, "https://ats.example/jobs/" + id, "test", company, "Engineer");
}
const ask = (text, options) => ({ kind: "question", text, context: "Required field", options });
// A worker that makes the given tool calls in order, recording each reply.
function worker(calls, replies, prompts = []) {
  return opts => {
    prompts.push(opts.prompt);
    for (const [tool, args] of calls) replies.push(opts.tools[tool].handler(args));
    return { done: Promise.resolve({ status: "completed", lastText: "" }), abort() {} };
  };
}
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-bank-"));
  try {
    mkdirSync(join(dir, "profile"));
    writeFileSync(join(dir, "profile", "personal.yml"), "first_name: Pat\n");
    writeFileSync(join(dir, "profile", "answers.md"), "# Standard answers\n\n## Location\n\n### Willing to relocate?\nNo.\n\n## Added from applications\n");
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Answer bank scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("editing answers.md", () => {
  it("replaces text found once, adds at the end for empty old text, and refuses the rest", () => {
    expect(editText("### A\nNo.\n", "No.", "Yes.")).toBe("### A\nYes.\n");
    expect(editText("### A\nNo.\n\n", "", "### B\nYes.\n")).toBe("### A\nNo.\n\n### B\nYes.\n");
    expect(() => editText("### A\nNo.\n", "Maybe.", "Yes.")).toThrow(/not in answers.md/);
    expect(() => editText("No.\nNo.\n", "No.", "Yes.")).toThrow(/more than once/);
  });
});

describe("answer bank", () => {
  it("files kept answers into answers.md, keeping the file as it was, and leaves application-only answers out", () => {
    scenario(`
    job(1, "Acme"); job(2, "Beta"); job(3, "Gamma");
    answerGate(parkGate(1, ask("Would you relocate to Denver?", ["Yes", "No"]), null).id, "Yes", "bank");
    answerGate(parkGate(2, ask("Desired salary", []), null).id, "150000", "bank");
    answerGate(parkGate(3, ask("Start date", []), null).id, "June 1", "application");
    assert.equal(bankDue(), true);
    const replies = [], prompts = [];
    assert.equal(await fileKeptAnswers(worker([
      ["edit_answers", { old_text: "Maybe.", new_text: "x" }],
      ["edit_answers", { old_text: "### Willing to relocate?\\nNo.", new_text: "### Willing to relocate?\\nYes, to Denver; no elsewhere." }],
      ["edit_answers", { old_text: "", new_text: "### Desired salary\\n150000" }],
      ["answers_filed", { summary: "1 widened relocation; 2 added salary" }],
    ], replies, prompts)), true);
    assert.ok(prompts[0].includes("1. Acme, applying for Engineer") && prompts[0].includes("Answer: 150000") && !prompts[0].includes("June 1"));
    assert.ok(prompts[0].includes("### Willing to relocate?\\nNo."));
    assert.ok(replies[0].startsWith("ERROR") && replies[0].includes("## Location"));
    assert.equal(answers(), "# Standard answers\\n\\n## Location\\n\\n### Willing to relocate?\\nYes, to Denver; no elsewhere.\\n\\n## Added from applications\\n\\n### Desired salary\\n150000\\n");
    const [copy] = readdirSync(data + "/answer-bank");
    assert.ok(readFileSync(data + "/answer-bank/" + copy, "utf8").includes("### Willing to relocate?\\nNo."));
    assert.deepEqual(unfiledAnswers(10), []);
    assert.equal(bankDue(), false);
    `);
  });

  it("tries a run that did not finish again within the hour, without losing what waits", () => {
    scenario(`
    job(1, "Acme");
    answerGate(parkGate(1, ask("Desired salary", []), null).id, "150000", "bank");
    assert.equal(await fileKeptAnswers(worker([], [])), false);
    assert.equal(unfiledAnswers(10).length, 1);
    assert.equal(bankDue(), false);
    kvSet("bank.failedAt", "2000-01-01T00:00:00Z");
    assert.equal(bankDue(), true);
    kvSet("bank.failedAt", new Date().toISOString());
    assert.equal(await fileKeptAnswers(worker([["answers_filed", { summary: "1 left out: says nothing beyond the form" }]], [])), false);
    assert.equal(bankDue(), false);
    job(2, "Beta");
    answerGate(parkGate(2, ask("Desired salary", []), null).id, "160000", "bank");
    assert.equal(bankDue(), true); // a run that finished leaves no retry for the next answer to wait out
    `);
  });
});
