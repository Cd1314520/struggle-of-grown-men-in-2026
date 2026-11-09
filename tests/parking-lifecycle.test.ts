import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

async function runScenarios(scenarios: string[]) {
  const root = mkdtempSync(join(tmpdir(), "auto-apply-parking-"));
  const data = join(root, "data");
  const profile = join(root, "profile");
  const resume = join(root, "resume");
  for (const dir of [data, profile, resume]) mkdirSync(dir, { recursive: true });
  try {
    for (const scenario of scenarios) {
      const proc = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "parking-lifecycle.ts"), scenario], {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, AUTO_APPLY_DATA: data, AUTO_APPLY_PROFILE: profile, AUTO_APPLY_RESUME_DIR: resume, AUTO_APPLY_PORT: "19000" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new Response(proc.stdout).text();
      const stderr = new Response(proc.stderr).text();
      const code = await proc.exited;
      assert.equal(code, 0, `${scenario}\n${await stdout}\n${await stderr}`);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe("durable parking lifecycle", () => {
  it("exits before releasing an ordinary question's slot and starts another job", () => runScenarios(["release"]));
  it("preserves a fast answer against old cleanup/callbacks and resumes the same frozen artifact", () => runScenarios(["quick-answer"]));
  it("drops an application whose form requires a cover letter, without parking it", () => runScenarios(["skip"]));
  it("parks a required cover letter on the agent's draft and hands the approved letter back", () => runScenarios(["cover-letter"]));
  it("releases stopped manual blockers and resumes their frozen drafts later", () => runScenarios(["manual"]));
  it("retries a browser stop once, at once, before it waits for the user", () => runScenarios(["retry-browser"]));
  it("retries a site outage after a few hours", () => runScenarios(["retry-site-down"]));
  it("keeps a new application to a stopped blocker's employer waiting until that one is finished", () => runScenarios(["manual-same-employer"]));
  it("applies to the most recently opened posting first", () => runScenarios(["freshest-first"]));
  it("spreads new applications to older postings over the day, but not one opened today", () => runScenarios(["paced"]));
  it("resumes the same draft after a capacity refusal, once the back-off ends", () => runScenarios(["capacity"]));
  it("resumes a draft stopped by a usage limit on the fallback model at once, and waits when that runs out too", () => runScenarios(["usage-limit"]));
  it("logs a worker that ends without reporting as an unknown blocker, and requires a cause for a failure", () => runScenarios(["crash"]));
  it("rejects missing-tab inspection without leasing the slot and allows recovery", () => runScenarios(["manual-lost-tab"]));
  it("holds capacity only during explicit inspection and releases without dismissing the gate", () => runScenarios(["manual-reservation"]));
  it("keeps asynchronous browser activation isolated when its gate changes", () => runScenarios(["manual-activation-race"]));
  it("preserves an unchanged unused final approval through durable manual return-control", () => runScenarios(["manual-approval"]));
  it("preserves pending review changes through manual return without authorizing submission", () => runScenarios(["manual-changes"]));
  it("consumes unchanged final approval only on re-observation and refuses ambiguous submission retry", () => runScenarios(["confirm"]));
  it("requires a new final approval when the observed summary changes", () => runScenarios(["changed-summary"]));
  it("preserves open/answered gates across process restart and quarantines the final-submit marker", () => runScenarios(["restart-setup", "restart-resume"]));
  it("keeps a queued verification across a restart and returns an interrupted one to ambiguity", () =>
    runScenarios(["restart-verify-setup", "restart-verify-resume"]));
  it("does not retry a newer handoff because of a blocker recorded for an older gate", () => runScenarios(["stale-blocker"]));
  it("rejects tampered frozen source/PDF rather than substituting a modified working resume", () => runScenarios(["frozen"]));
  it("retains parked draft tabs and never screenshots another job when the requested tab disappeared", () => runScenarios(["browser"]));
  it("prevents browser.open adoption of parked/manual tabs and resumes the exact unsaved draft through scoped CDP", () => runScenarios(["target-isolation"]));
  it("resumes an eligible draft then a fresh job beyond 1000 wrong-slot approved drafts", () => runScenarios(["blocked-prefix"]));
  it("moves a draft parked in a browser beyond concurrency.fill to one that opens, telling the worker its tab is gone", () => runScenarios(["stranded-slot"]));
  it("skips an employer-blocked recovery without starving another saved recovery or fresh work", () => runScenarios(["recovery-prefix"]));
  it("recovers a manual pre-submit failure with original notes and no parked lease", () => runScenarios(["recovery-manual"]));
  it("enforces verification mode guards forbidding submission and directing result reporting", () => runScenarios(["recovery-verify-guards"]));
  it("preserves submission ambiguity on inconclusive verification without auto-looping", () => runScenarios(["recovery-verify-inconclusive"]));
  it("transitions verified submitted application to terminal submitted state and cleans markers", () => runScenarios(["recovery-verify-submitted"]));
  it("atomically resolves draft ambiguity and requires fresh final approval on normal fill resumption", () => runScenarios(["recovery-verify-draft"]));
  it("consumer-visible terminal result releases scheduler/employer slot only after process exit, clearing submit marker without ambiguity gate", () =>
    runScenarios(["terminal-success"]));
  it("conclusively closed posting releases slot and same-employer lock only after process exit and rejects stale callbacks", () =>
    runScenarios(["terminal-closed"]));
  it("preserves submit marker and durable gates when terminal persistence fails", () => runScenarios(["terminal-persistence-failure"]));
});
