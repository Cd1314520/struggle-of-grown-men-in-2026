import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function runScenario(scenario: string, env: Record<string, string> = {}) {
  const root = mkdtempSync(join(tmpdir(), "auto-apply-server-"));
  const data = join(root, "data"),
    profile = join(root, "profile");
  for (const dir of [data, profile]) mkdirSync(dir, { recursive: true });
  try {
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "server-actions.ts"), scenario], {
      cwd: resolve(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: data, AUTO_APPLY_PROFILE: profile, AUTO_APPLY_PORT: "19100", ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = new Response(proc.stdout).text();
    const stderr = new Response(proc.stderr).text();
    const code = await proc.exited;
    assert.equal(code, 0, `${scenario}\n${await stdout}\n${await stderr}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("auto-approvals waiting for a browser", () => {
  it("are held to the practice rules as they stand at start", () => runScenario("standing-approvals"));
});

describe("state polls", () => {
  it("log a broken profile file once, not once per poll", () => runScenario("profile-poll"));
});

describe("job actions over HTTP", () => {
  it("refuses an action the job's status does not allow, and changes nothing", () => runScenario("action-guards"));
  it("refuses a posting it already has, naming the job it matched", () => runScenario("add-posting"));
  it("changes the steps of a sent application, and records the outcomes the user knows of", () => runScenario("steps"));
  it("refuses requests that come from another site or arrive under another host name", () => runScenario("other-sites"));
  it("keeps referral contacts, drafts from referral.yml, and reads an uploaded LinkedIn export", () => runScenario("referrals"));
  it("serves the early outreach page and takes the owner's changes", () => runScenario("early-outreach"));
});
