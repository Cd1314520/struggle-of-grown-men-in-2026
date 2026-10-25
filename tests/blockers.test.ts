import { describe, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each scenario imports the production modules in a fresh process with throwaway state.
const prelude = `
import assert from "node:assert/strict";
import { db } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import * as blockers from ${JSON.stringify(join(import.meta.dir, "../src/blockers.ts"))};
function job(id, status = "needs_manual") {
  db.query("INSERT INTO jobs (id, url, source, company, title, status) VALUES (?, ?, 'test', 'Acme', ?, ?)").run(id, "https://ats.example/jobs/" + id, "Engineer " + id, status);
}
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-blockers-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Blockers scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("blockers", () => {
  it("accepts every cause the code knows, and nothing else", () => {
    scenario(`
      job(1);
      for (const cause of blockers.BLOCKER_CAUSES) blockers.recordBlocker(1, cause, "  seen: " + cause + "  ");
      assert.deepEqual(blockers.jobBlockers(1).map(b => b.cause), [...blockers.BLOCKER_CAUSES]);
      assert.equal(blockers.jobBlockers(1)[0].detail, "seen: site_down");
      assert.throws(() => blockers.recordBlocker(1, "bogus", "x"), /CHECK constraint failed/);
      assert.equal(blockers.WORKER_CAUSES.includes("unknown"), false);
    `);
  });

  it("lists every stop newest first with the job as it stands now, and outlives the job's status", () => {
    scenario(`
      job(1);
      job(2);
      db.query("INSERT INTO blockers (job_id, cause, detail, at) VALUES (1, 'site_down', 'Workday maintenance', '2026-10-01 10:00:00')").run();
      db.query("INSERT INTO blockers (job_id, cause, detail, at) VALUES (2, 'login', 'Invalid email or password', '2026-10-02 10:00:00')").run();
      db.query("UPDATE jobs SET status = 'rejected' WHERE id = 1").run();
      assert.deepEqual(
        blockers.listBlockers().map(b => [b.job_id, b.cause, b.status, b.company, b.url]),
        [
          [2, "login", "needs_manual", "Acme", "https://ats.example/jobs/2"],
          [1, "site_down", "rejected", "Acme", "https://ats.example/jobs/1"],
        ],
      );
      db.query("DELETE FROM jobs WHERE id = 2").run();
      assert.deepEqual(blockers.jobBlockers(2), []);
    `);
  });
});
