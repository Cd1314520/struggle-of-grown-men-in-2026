import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { needsPrep } from "../src/interview";

// Each scenario imports the production modules in a fresh process with throwaway state and profile.
const src = (name: string) => JSON.stringify(join(import.meta.dir, `../src/${name}.ts`));
const prelude = `
import assert from "node:assert/strict";
import { db, getJob, kvGet } from ${src("db")};
import { addStep, jobSteps } from ${src("steps")};
import { interviewPrep, writePrepNote } from ${src("interview")};
db.query("INSERT INTO jobs (id,url,source,company,title,status,description) VALUES (1,'https://ats.example/jobs/1','test','Acme','Firmware Intern','submitted','Write firmware for motor drivers.')").run();
const job = () => getJob(1);
// A worker that makes the given tool calls in order, recording each reply and the prompt.
function worker(calls, seen) {
  return opts => {
    seen.prompt = opts.prompt;
    seen.stage = opts.stage;
    for (const [tool, args] of calls) seen.reply = opts.tools[tool].handler(args);
    return { done: Promise.resolve({ status: "completed", lastText: "" }), abort() {} };
  };
}
`;
function scenario(body: string, stories = "# Stories\n\n## 1. The dead I2C bus\n- Fixed the wiring.\n") {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-interview-"));
  try {
    mkdirSync(join(dir, "profile"));
    writeFileSync(join(dir, "profile", "answers.md"), "# Standard answers\n");
    if (stories) writeFileSync(join(dir, "profile", "story-bank.md"), stories);
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Interview scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("interview prep", () => {
  it("is wanted for an interview, an offer, or a step where someone talks to or tests the candidate", () => {
    expect(needsPrep({ status: "submitted" }, [])).toBe(false);
    expect(needsPrep({ status: "submitted" }, [{ kind: "questionnaire" }])).toBe(false);
    expect(needsPrep({ status: "submitted" }, [{ kind: "assessment" }])).toBe(true);
    expect(needsPrep({ status: "interview" }, [])).toBe(true);
  });

  it("shows the story bank once the employer moves on, and saves the note a worker writes from it", () => {
    scenario(`
    assert.equal(interviewPrep(job(), jobSteps(1)), null, "nothing to prepare for yet");
    addStep(job(), { kind: "interview", title: "Phone screen", source: "user" });
    const prep = interviewPrep(job(), jobSteps(1));
    assert.match(prep.stories, /dead I2C bus/);
    assert.equal(prep.note, null);
    const seen = {};
    assert.equal(writePrepNote(worker([["save_prep_note", { note: "## What the role needs\\n- Motor drivers" }]], seen), job(), jobSteps(1)), null);
    assert.equal(seen.stage, "prep");
    assert.match(seen.prompt, /Firmware Intern at Acme/);
    assert.match(seen.prompt, /interview: Phone screen/);
    assert.match(seen.prompt, /dead I2C bus/);
    assert.match(seen.prompt, /Write firmware for motor drivers/);
    assert.match(seen.reply, /^Saved/);
    await new Promise(r => setTimeout(r, 0));
    const after = interviewPrep(job(), jobSteps(1));
    assert.equal(after.note, "## What the role needs\\n- Motor drivers");
    assert.ok(after.noteAt);
    assert.equal(after.writing, false);
    `);
  });

  it("stays off without a story bank", () => {
    scenario(
      `
    db.query("UPDATE jobs SET status = 'interview' WHERE id = 1").run();
    assert.equal(interviewPrep(job(), []), null);
    assert.match(writePrepNote(() => { throw new Error("no worker should start"); }, job(), []), /no story bank/);
    `,
      "",
    );
  });
});
