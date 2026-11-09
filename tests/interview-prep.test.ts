import { describe, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const src = (name: string) => JSON.stringify(join(import.meta.dir, "../src", name));
const prelude = `
import assert from "node:assert/strict";
import { db, getJob } from ${src("db.ts")};
import * as steps from ${src("steps.ts")};
import { briefInterviews } from ${src("interview-prep.ts")};
function job(id, status = "submitted") {
  db.query("INSERT INTO jobs (id, url, source, company, title, status, description, submitted_at) VALUES (?, ?, 'test', 'Acme', ?, ?, 'Build things.', '2026-10-01T00:00:00Z')").run(id, "https://ats.example/jobs/" + id, "Engineer " + id, status);
}
function step(job_id, over = {}) {
  const row = { kind: "interview", state: "todo", scheduled_at: null, brief: null, brief_tries: 0, ...over };
  return db.query("INSERT INTO application_steps (job_id, kind, title, state, scheduled_at, source, brief, brief_tries) VALUES (?, ?, 'Screen', ?, ?, 'user', ?, ?) RETURNING id")
    .get(job_id, row.kind, row.state, row.scheduled_at, row.brief, row.brief_tries).id;
}
const DAY = 86400000;
const at = ms => new Date(ms).toISOString();
const ids = () => steps.stepsNeedingBrief(10).map(s => s.id);
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-brief-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", `${prelude}\n(async () => {\n${body}\ndb.close();\n})();`], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Brief scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("interview briefs", () => {
  it("picks only open interview steps of live applications that have no brief and fewer than two tries", () => {
    scenario(`
    job(1); job(2, "interview"); job(3, "rejected_by_company");
    const todo = step(1);
    const booked = step(1, { state: "scheduled", scheduled_at: at(Date.now() + DAY) });
    step(1, { state: "scheduled", scheduled_at: at(Date.now() - DAY) });
    step(1, { state: "done" });
    step(1, { kind: "assessment" });
    step(1, { brief: "already written" });
    step(1, { brief_tries: 2 });
    const tried = step(2, { brief_tries: 1 });
    step(3);
    assert.deepEqual(ids(), [todo, booked, tried]);
    assert.deepEqual(steps.stepsNeedingBrief(2).map(s => s.id), [todo, booked]);
    steps.saveBrief(todo, "# Brief");
    assert.deepEqual(ids(), [booked, tried]);
    steps.clearBrief(todo);
    assert.equal(steps.getStep(todo).brief, null);
    assert.deepEqual(ids(), [todo, booked, tried]);
    `);
  });

  it("saves the brief a worker submits, and leaves a run that never submits one with its try counted", () => {
    scenario(`
    job(1);
    const a = step(1), b = step(1);
    const prompts = [];
    let n = 0;
    const run = opts => {
      prompts.push(opts.prompt);
      assert.equal(opts.name, "interview");
      assert.deepEqual(Object.keys(opts.tools), ["save_brief"]);
      const turn = n++;
      return {
        done: (async () => {
          if (turn === 0) {
            assert.match(await opts.tools.save_brief.handler({ brief: "short" }), /^ERROR/);
            assert.equal(await opts.tools.save_brief.handler({ brief: "## What this round likely is\\n" + "x".repeat(300) }), "Saved.");
          }
          return { status: "completed", lastText: "" };
        })(),
        abort() {},
      };
    };
    await briefInterviews(run);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /Acme, Engineer 1/);
    const first = steps.getStep(a), second = steps.getStep(b);
    assert.match(first.brief, /^## What this round likely is/);
    assert.ok(first.brief_at);
    assert.equal(first.brief_tries, 1);
    assert.equal(second.brief, null);
    assert.equal(second.brief_tries, 1);
    await briefInterviews(run);
    assert.equal(steps.getStep(b).brief_tries, 2);
    await briefInterviews(run);
    assert.equal(prompts.length, 3);
    assert.deepEqual(ids(), []);
    `);
  });
});
