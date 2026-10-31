import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config";
import { kvDelete } from "../src/db";
import { choose, hitLimit, limitedUntil } from "../src/providers";

const signedIn = mkdtempSync(join(tmpdir(), "claude-account-"));
writeFileSync(join(signedIn, ".credentials.json"), "{}");
const signedOut = mkdtempSync(join(tmpdir(), "claude-account-"));
mkdirSync(signedOut, { recursive: true });
const PROVIDERS = ["codex", "claude:default", `claude:${signedIn}`, `claude:${signedOut}`, "omp"];

afterEach(() => {
  delete config.fallback;
  delete config.claudeAccounts;
  for (const p of PROVIDERS) kvDelete(`limit.${p}`);
});

describe("which model and account a worker runs on", () => {
  it("keeps the stage's own model while it has usage", () => {
    config.fallback = ["claude-code/sonnet"];
    expect(choose("codex/gpt-6.1-terra")).toEqual({ model: "codex/gpt-6.1-terra", provider: "codex", env: {} });
    expect(choose(null)).toEqual({ model: null, provider: "omp", env: {} });
  });

  it("moves to the fallback model, then each signed-in Claude account, and pauses only when all are out", () => {
    config.fallback = ["claude-code/sonnet"];
    config.claudeAccounts = [signedIn, signedOut];
    const reset = Date.now() + 3_600_000;

    expect(hitLimit("codex/gpt-6.1-terra", "codex", reset)).toBeNull();
    expect(limitedUntil("codex")).toBe(reset);
    expect(choose("codex/gpt-6.1-terra")).toEqual({ model: "claude-code/sonnet", provider: "claude:default", env: {} });

    expect(hitLimit("codex/gpt-6.1-terra", "claude:default", reset + 1000)).toBeNull();
    // An account never signed in is skipped.
    expect(choose("codex/gpt-6.1-terra")).toEqual({ model: "claude-code/sonnet", provider: `claude:${signedIn}`, env: { CLAUDE_CONFIG_DIR: signedIn } });

    expect(hitLimit("codex/gpt-6.1-terra", `claude:${signedIn}`, reset + 2000)).toBe(reset);
    // With every one out, the stage's own model is tried again when the pause ends.
    expect(choose("codex/gpt-6.1-terra").provider).toBe("codex");
  });

  it("gives a refusal without a reset time a short pause, and a passed limit no hold", () => {
    expect(hitLimit("claude-code/sonnet", "claude:default")).toBeGreaterThan(Date.now());
    expect(limitedUntil("claude:default")).toBeLessThan(Date.now() + 10 * 60_000);
    kvDelete("limit.claude:default");
    expect(hitLimit("claude-code/sonnet", "claude:default", Date.now() - 1000)).toBeGreaterThan(Date.now());
  });
});
