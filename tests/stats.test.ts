import { describe, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each scenario imports the production modules in a fresh process with throwaway state, in a fixed
// zone so that local days are known: noon on Oct 25 2026 in Chicago (UTC-5) is the clock.
const prelude = `
import assert from "node:assert/strict";
import { db, notifyJobChange } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import { computeStats as stats, stats as kept, STATS_DAYS } from ${JSON.stringify(join(import.meta.dir, "../src/stats.ts"))};
const NOW = Date.parse("2026-10-25T17:00:00Z");
let next = 1;
function job(fields = {}) {
  const id = next++;
  const row = { url: "https://ats.example/jobs/" + id, source: "test", company: "Acme", title: "Engineer " + id, status: "found", found_at: "2026-10-25 15:00:00", ...fields };
  const names = Object.keys(row);
  db.query("INSERT INTO jobs (id, " + names.join(", ") + ") VALUES (?" + ", ?".repeat(names.length) + ")").run(id, ...names.map(name => row[name]));
  return id;
}
const day = (s, d) => s.days.indexOf(d);
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-stats-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, TZ: "America/Chicago", AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Stats scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("stats", () => {
  it("covers the last 30 local days, today last, with zeros on an empty database", () => {
    scenario(`
      const s = stats(NOW);
      assert.equal(s.days.length, STATS_DAYS);
      assert.equal(s.days.at(-1), "2026-10-25");
      assert.equal(s.days[0], "2026-09-26");
      assert.deepEqual(s.applied, Array(STATS_DAYS).fill(0));
      assert.deepEqual(s.funnel, { found: 0, assessed: 0, recommended: 0, approved: 0, applied: 0, responded: 0 });
      assert.deepEqual(s.response, { sent: 0, heard: 0 });
      assert.deepEqual(s.approvals, { auto: 0, user: 0 });
    `);
  });

  it("counts postings found and applications sent on the local day they happened", () => {
    scenario(`
      job({ found_at: "2026-10-25 15:00:00" });
      // 02:00 UTC on the 25th is still the evening of the 24th in Chicago.
      job({ found_at: "2026-10-25 02:00:00" });
      job({ found_at: "2026-10-20 12:00:00", status: "submitted", score: 90, submitted_at: "2026-10-25T03:30:00.000Z" });
      job({ found_at: "2026-10-20 12:00:00", status: "submitted", score: 90, submitted_at: "2026-10-23T18:00:00.000Z" });
      // Before the window: in neither series.
      job({ found_at: "2026-09-01 12:00:00", status: "submitted", score: 90, submitted_at: "2026-09-02T12:00:00.000Z" });
      const s = stats(NOW);
      assert.equal(s.found[day(s, "2026-10-25")], 1);
      assert.equal(s.found[day(s, "2026-10-24")], 1);
      assert.equal(s.found[day(s, "2026-10-20")], 2);
      assert.equal(s.found.reduce((a, b) => a + b), 4);
      assert.equal(s.applied[day(s, "2026-10-24")], 1);
      assert.equal(s.applied[day(s, "2026-10-23")], 1);
      assert.equal(s.applied.reduce((a, b) => a + b), 2);
      assert.deepEqual(s.response, { sent: 2, heard: 0 });
    `);
  });

  it("counts each employer's answer once a day, from the status history", () => {
    scenario(`
      const a = job({ status: "submitted", score: 90, submitted_at: "2026-10-20T12:00:00.000Z" });
      const b = job({ status: "submitted", score: 90, submitted_at: "2026-10-20T12:00:00.000Z" });
      db.query("UPDATE jobs SET status = 'interview' WHERE id = ?").run(a);
      db.query("UPDATE jobs SET status = 'rejected_by_company' WHERE id = ?").run(b);
      db.query("UPDATE status_changes SET at = '2026-10-24 15:00:00'").run();
      // The same application moving on again that day is still one answer.
      db.query("INSERT INTO status_changes (job_id, from_status, to_status, at) VALUES (?, 'interview', 'offer', '2026-10-24 16:00:00')").run(a);
      const s = stats(NOW);
      assert.equal(s.responses[day(s, "2026-10-24")], 2);
      assert.equal(s.responses.reduce((x, y) => x + y), 2);
      assert.deepEqual(s.response, { sent: 2, heard: 2 });
    `);
  });

  it("follows the postings found in the window through each stage, never widening", () => {
    scenario(`
      job({ status: "skipped" }); // screened out on its title
      job({ status: "skipped", score: 30 }); // assessed, below the bar
      job({ status: "triaged", score: 70 }); // re-queued for assessment: not recommended yet
      job({ status: "awaiting_approval", score: 75 });
      job({ status: "held", score: 85 });
      job({ status: "rejected", score: 66 });
      job({ status: "filling", score: 90, approved_by: "auto" });
      job({ status: "submitted", score: 92, approved_by: "user", submitted_at: "2026-10-25T14:00:00.000Z" });
      job({ status: "interview", score: 95, approved_by: "auto", submitted_at: "2026-10-24T14:00:00.000Z" });
      job({ status: "rejected_by_company", score: 80, submitted_at: "2026-10-22T14:00:00.000Z" });
      // An outcome recorded by hand on a job never sent counts as no answer to an application.
      job({ status: "offer", score: 88 });
      job({ status: "awaiting_approval", score: 99, found_at: "2026-08-01 12:00:00" }); // found before the window
      const s = stats(NOW);
      assert.deepEqual(s.funnel, { found: 11, assessed: 10, recommended: 8, approved: 4, applied: 3, responded: 2 });
    `);
  });

  it("bands every application sent by Fit score, counting who moved it on and who turned it down", () => {
    scenario(`
      const sent = "2026-10-20T14:00:00.000Z";
      job({ status: "interview", score: 85, submitted_at: sent });
      const tested = job({ status: "rejected_by_company", score: 82, submitted_at: sent }); // an assessment, then a no: moved on
      db.query("INSERT INTO application_steps (job_id, kind, title, source) VALUES (?, 'assessment', 'Online test', 'mail')").run(tested);
      job({ status: "submitted", score: 81, submitted_at: sent });
      job({ status: "rejected_by_company", score: 72, submitted_at: sent });
      const called = job({ status: "rejected_by_company", score: 64, submitted_at: sent }); // an interview once, a no later
      db.query("INSERT INTO status_changes (job_id, from_status, to_status) VALUES (?, 'submitted', 'interview')").run(called);
      job({ status: "submitted", submitted_at: sent }); // imported, never assessed
      job({ status: "awaiting_approval", score: 90 }); // not sent
      const by = Object.fromEntries(stats(NOW).calibration.map(b => [b.label, [b.sent, b.advanced, b.rejected]]));
      assert.deepEqual(by, { "80 and up": [3, 2, 0], "70 to 79": [1, 0, 1], "60 to 69": [1, 1, 0], "Under 60": [0, 0, 0], "No score": [1, 0, 0] });
    `);
  });

  it("keeps its numbers until a job changes, and then for a few seconds more", () => {
    scenario(`
      assert.equal(kept(NOW).funnel.found, 0);
      notifyJobChange(job());
      assert.equal(kept(NOW + 5_000).funnel.found, 0);
      assert.equal(kept(NOW + 25_000).funnel.found, 1);
      job(); // written without telling anyone: nothing to recount for
      assert.equal(kept(NOW + 120_000).funnel.found, 1);
    `);
  });

  it("splits approvals in the window by who gave them, once per job", () => {
    scenario(`
      const a = job({ status: "awaiting_approval", score: 90 });
      const b = job({ status: "awaiting_approval", score: 90 });
      const c = job({ status: "awaiting_approval", score: 90 });
      db.query("UPDATE jobs SET status = 'approved', approved_by = 'auto' WHERE id IN (?, ?)").run(a, b);
      db.query("UPDATE jobs SET status = 'approved', approved_by = 'user' WHERE id = ?").run(c);
      // A retry approves the same job again.
      db.query("UPDATE jobs SET status = 'failed' WHERE id = ?").run(a);
      db.query("UPDATE jobs SET status = 'approved' WHERE id = ?").run(a);
      db.query("UPDATE status_changes SET at = '2026-10-25 12:00:00'").run();
      assert.deepEqual(stats(NOW).approvals, { auto: 2, user: 1 });
    `);
  });
});
