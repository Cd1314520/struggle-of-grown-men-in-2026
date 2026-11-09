import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function scenario(name: string, phases = [name]) {
  const directory = mkdtempSync(join(tmpdir(), "auto-apply-digest-test-"));
  try {
    for (const phase of phases) {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures", "digest-scenario.ts"), phase], {
        env: {
          ...process.env,
          AUTO_APPLY_DATA: directory,
          AUTO_APPLY_PROFILE: join(directory, "profile"),
          AUTO_APPLY_PORT: "18787",
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("question digest delivery", () => {
  it("mentions steps due within two days once per deadline, alone or beside questions", async () => {
    await scenario("steps");
  });
  it("honors Chicago 09:00, one scheduled message per local day, and forced dedup", async () => {
    await scenario("schedule");
  });
  it("tracks Chicago DST rather than a fixed UTC hour", async () => {
    await scenario("dst");
  });
  it("does not re-notify group membership changes; changed context/options remain distinct", async () => {
    await scenario("groups");
  });
  it("retries definite rejection with the persisted Message-ID and marks only confirmed delivery", async () => {
    await scenario("rejection");
  });
  it("requires exact custom delivery identity, Sent labels and self From/To despite RFC-ID rewriting", async () => {
    await scenario("ambiguous");
  });
  it("reconciles an accepted message with a lost acknowledgement and rewritten RFC-ID without another send", async () => {
    await scenario("lost-ack");
  });
  it("fails an uncertain delivery with no Sent match after an hour and re-sends it with the same Message-ID", async () => {
    await scenario("stale-uncertain");
  });
  it("reconciles a stale uncertain delivery when the message did reach Sent", async () => {
    await scenario("stale-uncertain-matched");
  });
  it("waits out the doubling backoff between failed attempts and counts each attempt", async () => {
    await scenario("failed-backoff");
  });
  it("abandons a delivery after five attempts and creates the next digest with the same groups", async () => {
    await scenario("abandon");
  });
  it("recovers after process death using the persisted body reference despite a rewritten RFC-ID", async () => {
    await scenario("restart", ["restart-before", "restart-after"]);
  });
  it("refuses configured, cached, and authenticated mailbox mismatches", async () => {
    await scenario("identity");
  });
  it("binds send and Sent reconciliation to the token verified before a concurrent OAuth cache swap", async () => {
    await scenario("token-swap");
  });
  it("serializes concurrent sends and honors disabled configuration even with force", async () => {
    await scenario("concurrent");
  });
  it("keeps stored answers, context values and non-question summaries out of mail", async () => {
    await scenario("privacy");
  });
});
