import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MIGRATIONS, migrate } from "../src/schema";

const prelude = `
import assert from "node:assert/strict";
import { db, getJob, statusHistory } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import * as steps from ${JSON.stringify(join(import.meta.dir, "../src/steps.ts"))};
import { applicationList } from ${JSON.stringify(join(import.meta.dir, "../src/track.ts"))};
function job(id, status = "submitted") {
  db.query("INSERT INTO jobs (id, url, source, company, title, status, submitted_at) VALUES (?, ?, 'test', 'Acme', ?, ?, '2026-10-01T00:00:00Z')").run(id, "https://ats.example/jobs/" + id, "Engineer " + id, status);
}
const DAY = 86400000;
const at = ms => new Date(ms).toISOString();
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-steps-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Steps scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("application steps", () => {
  it("moves a sent application into process with its first step, and adds a message's request once", () => {
    scenario(`
    job(1);
    const first = steps.addStep(getJob(1), { kind: "assessment", title: "Codility OA", due_at: "2026-10-27", link: "https://codility.example/t/1", source: "mail", message_id: "m1" });
    assert.equal(first.added, true);
    assert.equal(getJob(1).status, "interview");
    assert.equal(getJob(1).note, "Codility OA");
    assert.deepEqual(steps.addStep(getJob(1), { kind: "assessment", title: "Codility OA again", source: "mail", message_id: "m1" }), { id: first.id, added: false });
    assert.equal(steps.addStep(getJob(1), { kind: "schedule", title: "Book a call", source: "mail", message_id: "m1" }).added, true);
    assert.equal(steps.jobSteps(1).length, 2);
    assert.equal(statusHistory(1).filter(c => c.to_status === "interview").length, 1);

    job(2, "rejected_by_company");
    assert.throws(() => steps.addStep(getJob(2), { kind: "other", title: "x", source: "user" }), /in process/);
    assert.throws(() => steps.addStep(getJob(1), { kind: "other", title: "  ", source: "user" }), /title/);
    assert.throws(() => steps.addStep(getJob(1), { kind: "other", title: "x", due_at: "next week", source: "user" }), /not a date/);
  `);
  });

  it("says whose move it is from the steps' states", () => {
    scenario(`
    job(1);
    const now = Date.now();
    const a = steps.addStep(getJob(1), { kind: "assessment", title: "OA", source: "mail" }).id;
    const b = steps.addStep(getJob(1), { kind: "questionnaire", title: "Form", due_at: "2026-10-25", source: "mail" }).id;
    let next = steps.nextSteps(now).get(1);
    assert.equal(next.whose, "you"); assert.equal(next.label, "Form"); assert.equal(next.due, true);
    steps.changeStep(b, { state: "done", note: "sent it" });
    assert.equal(steps.getStep(b).done_note, "sent it");
    assert.ok(steps.getStep(b).done_at);
    assert.equal(steps.nextSteps(now).get(1).label, "OA");
    steps.changeStep(a, { state: "done" });
    next = steps.nextSteps(now).get(1);
    assert.equal(next.whose, "them"); assert.equal(next.quiet, false);
    assert.equal(steps.nextSteps(Date.now() + 8 * DAY).get(1).quiet, true);
    const c = steps.addStep(getJob(1), { kind: "schedule", title: "Onsite", source: "user" }).id;
    assert.throws(() => steps.changeStep(c, { state: "scheduled" }), /time/);
    steps.changeStep(c, { state: "scheduled", scheduled_at: at(now + 2 * DAY) });
    next = steps.nextSteps(now).get(1);
    assert.equal(next.whose, "upcoming"); assert.equal(next.label, "Onsite");
    next = steps.nextSteps(now + 3 * DAY).get(1);
    assert.equal(next.whose, "them"); assert.equal(next.at, at(now + 2 * DAY));
    steps.changeStep(a, { state: "todo" });
    assert.equal(steps.getStep(a).done_at, null);
    assert.deepEqual(steps.openSteps([1]).map(s => s.id), [a, b, c]);
  `);
  });

  it("settles open steps with the outcome, and reopening returns to where the steps say", () => {
    scenario(`
    job(1);
    const a = steps.addStep(getJob(1), { kind: "assessment", title: "OA", source: "mail" }).id;
    steps.recordOutcome(1, "rejected_by_company", "not moving forward");
    assert.equal(getJob(1).status, "rejected_by_company");
    assert.equal(steps.getStep(a).state, "closed");
    assert.equal(steps.nextSteps().has(1), false);
    steps.recordOutcome(1, "reopen", "reopened by you");
    assert.equal(getJob(1).status, "interview");
    steps.recordOutcome(1, "withdrawn", "took another offer");
    assert.equal(getJob(1).status, "withdrawn");

    job(2);
    steps.recordOutcome(2, "withdrawn", "no longer interested");
    steps.recordOutcome(2, "reopen", "reopened by you");
    assert.equal(getJob(2).status, "submitted");
  `);
  });

  it("returns an application to waiting when its only steps are removed as mistakes", () => {
    scenario(`
    job(1);
    const a = steps.addStep(getJob(1), { kind: "questionnaire", title: "Feedback survey", source: "mail", message_id: "m1" }).id;
    const b = steps.addStep(getJob(1), { kind: "other", title: "Create an account", source: "mail", message_id: "m1" }).id;
    steps.removeStep(a);
    assert.equal(getJob(1).status, "interview");
    steps.removeStep(b);
    assert.equal(getJob(1).status, "submitted");

    job(2);
    const c = steps.addStep(getJob(2), { kind: "other", title: "x", source: "mail" }).id;
    steps.recordOutcome(2, "rejected_by_company", "not moving forward");
    steps.removeStep(c);
    assert.equal(getJob(2).status, "rejected_by_company");
  `);
  });

  it("lists steps still to do that are due within the window", () => {
    scenario(`
    job(1);
    const now = Date.parse("2026-10-23T12:00:00Z");
    steps.addStep(getJob(1), { kind: "assessment", title: "Soon", due_at: at(now + DAY), source: "mail" });
    steps.addStep(getJob(1), { kind: "assessment", title: "Later", due_at: at(now + 5 * DAY), source: "mail" });
    steps.addStep(getJob(1), { kind: "assessment", title: "No deadline", source: "mail" });
    const done = steps.addStep(getJob(1), { kind: "assessment", title: "Done already", due_at: at(now + DAY), source: "mail" }).id;
    steps.changeStep(done, { state: "done" });
    assert.deepEqual(steps.dueSoon(48, now).map(s => [s.title, s.company]), [["Soon", "Acme"]]);
  `);
  });
});

describe("the mailbox agent's brief", () => {
  it("lists each open application with its open steps and whose move each one is", () => {
    scenario(`
    job(1); job(2);
    const now = Date.parse("2026-10-23T12:00:00Z");
    const a = steps.addStep(getJob(1), { kind: "assessment", title: "Codility OA", source: "mail" }).id;
    const b = steps.addStep(getJob(1), { kind: "questionnaire", title: "Form", due_at: "2026-10-25", source: "mail" }).id;
    const c = steps.addStep(getJob(1), { kind: "schedule", title: "Onsite", source: "mail" }).id;
    const d = steps.addStep(getJob(1), { kind: "interview", title: "Screen", source: "mail" }).id;
    steps.changeStep(a, { state: "done" });
    steps.changeStep(c, { state: "scheduled", scheduled_at: "2026-10-30T15:00:00Z" });
    steps.changeStep(d, { state: "scheduled", scheduled_at: "2026-10-20T15:00:00Z" });
    const today = new Date().toISOString().slice(0, 10);
    assert.equal(applicationList([getJob(1), getJob(2)], steps.openSteps([1, 2]), now), [
      "1 | Acme | Engineer 1 | 2026-10-01",
      "   step " + a + ' · assessment · "Codility OA" · done by the candidate ' + today + ": waiting on Acme",
      "   step " + b + ' · questionnaire · "Form" · to do: the candidate' + "'s move, due 2026-10-25",
      "   step " + c + ' · schedule · "Onsite" · booked for 2026-10-30T15:00:00.000Z',
      "   step " + d + ' · interview · "Screen" · held 2026-10-20T15:00:00.000Z: waiting on Acme',
      "2 | Acme | Engineer 2 | 2026-10-01",
    ].join(String.fromCharCode(10)));
  `);
  });

  it("keeps a rejection read earlier in the run from being undone by later mail", () => {
    scenario(`
    const { kvSet } = await import(${JSON.stringify(join(import.meta.dir, "../src/db.ts"))});
    const { trackMailbox } = await import(${JSON.stringify(join(import.meta.dir, "../src/track.ts"))});
    kvSet("gmail.refresh", "token");
    job(1);
    const a = steps.addStep(getJob(1), { kind: "assessment", title: "OA", source: "mail" }).id;
    const replies = [];
    await trackMailbox(opts => {
      const call = (name, args) => replies.push(opts.tools[name].handler(args));
      call("record_outcome", { job_id: 1, status: "rejected_by_company", note: "not moving forward" });
      call("add_step", { job_id: 1, kind: "questionnaire", title: "Survey", message_id: "m2" });
      call("update_step", { step_id: a, state: "done", note: "got it" });
      return { done: Promise.resolve({ status: "completed", lastText: "" }), abort: () => undefined };
    });
    assert.equal(replies[0], "Recorded.");
    assert.match(replies[1], /^ERROR: .*in process/);
    assert.match(replies[2], /^ERROR: .*rejected/);
    assert.equal(getJob(1).status, "rejected_by_company");
    assert.deepEqual(steps.jobSteps(1).map(s => s.state), ["closed"]);
  `);
  });
});

describe("the application steps migration", () => {
  it("turns each application in interview into one step to sort out, with what its mail said", () => {
    const dir = mkdtempSync(join(tmpdir(), "auto-apply-steps-"));
    const db = new Database(join(dir, "app.db"), { create: true });
    try {
      migrate(db, MIGRATIONS.slice(0, 4));
      db.run(
        "INSERT INTO jobs (id, url, source, company, title, status, note) VALUES (1, 'https://a/1', 't', 'Acme', 'Eng', 'interview', 'Book a call: calendly.example/x'), (2, 'https://a/2', 't', 'Acme', 'Eng 2', 'interview', NULL), (3, 'https://a/3', 't', 'Acme', 'Eng 3', 'submitted', 'received')",
      );
      migrate(db);
      expect(db.query("SELECT job_id, kind, title, state, source FROM application_steps ORDER BY job_id").all()).toEqual([
        { job_id: 1, kind: "other", title: "Book a call: calendly.example/x", state: "todo", source: "mail" },
        { job_id: 2, kind: "other", title: "Next step from the employer", state: "todo", source: "mail" },
      ]);
      db.run("DELETE FROM jobs WHERE id = 1");
      expect(db.query("SELECT job_id FROM application_steps").all()).toEqual([{ job_id: 2 }]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
