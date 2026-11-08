import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "../src/config";
import { kvDelete } from "../src/db";
import { isCapacityError } from "../src/errors";
import { fillChoice } from "../src/fill";
import { chainFor, choose, fallbacksFor, hitLimit, limitedUntil, nextChoice, providerOf, stageModels, withFallback } from "../src/providers";
import type { WorkerHandle, WorkerOptions, WorkerResult } from "../src/worker";

const signedIn = mkdtempSync(join(tmpdir(), "claude-account-"));
writeFileSync(join(signedIn, ".credentials.json"), "{}");
const signedOut = mkdtempSync(join(tmpdir(), "claude-account-"));
mkdirSync(signedOut, { recursive: true });
const PROVIDERS = ["codex", "claude:default", `claude:${signedIn}`, `claude:${signedOut}`, "omp"];

const saved = { prep: config.models.prep, fill: config.models.fill, recheck: config.models.recheck };
afterEach(() => {
  delete config.fallback;
  delete config.claudeAccounts;
  delete config.models.fallback;
  Object.assign(config.models, saved);
  for (const p of PROVIDERS) kvDelete(`limit.${p}`);
});

const LIMIT = "Claude usage limit reached (five_hour, resets 2026-10-31T20:00:00.000Z): limit reached";

describe("capacity refusals", () => {
  it("count a usage limit, from either harness, and a passing overload", () => {
    expect(isCapacityError(LIMIT)).toBe(true);
    expect(isCapacityError("You’ve hit your usage limit. Upgrade to Pro or try again at 11:58 PM.")).toBe(true);
    expect(isCapacityError("529 overloaded")).toBe(true);
    expect(isCapacityError("the tool crashed")).toBe(false);
  });

  it("count agy running out of its Google quota", () => {
    const agy = "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h57m57s.";
    expect(isCapacityError(agy)).toBe(true);
    expect(isCapacityError(`Worker ended without a verified outcome (${agy}).`)).toBe(true);
  });

  it("count a harness that is not installed or not signed in, so the next model takes the work", () => {
    expect(isCapacityError("agy is not installed")).toBe(true);
    expect(isCapacityError("agy is not signed in (run agy once in a terminal to sign in)")).toBe(true);
    expect(isCapacityError("codex is not installed")).toBe(true);
    expect(isCapacityError("Chrome is not installed")).toBe(false);
  });
});

describe("which model and account a worker runs on", () => {
  it("keeps the stage's own model while it has usage", () => {
    config.models.prep = "codex/gpt-6.1-terra";
    config.fallback = ["claude-code/sonnet"];
    expect(choose("prep")).toEqual({ model: "codex/gpt-6.1-terra", provider: "codex", env: {} });
    config.models.prep = null;
    expect(choose("prep")).toEqual({ model: null, provider: "omp", env: {} });
  });

  it("names the provider a worker ran on, by its model and Claude account", () => {
    expect(providerOf("codex/gpt-6-sol")).toBe("codex");
    expect(providerOf("claude-code/opus")).toBe("claude:default");
    expect(providerOf("claude-code/opus", { CLAUDE_CONFIG_DIR: signedIn, DISPLAY: ":99" })).toBe(`claude:${signedIn}`);
    expect(providerOf(null)).toBe("omp");
  });

  it("takes the global fallback list, unless the stage has its own, which replaces it", () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna", "claude-code/haiku"];
    expect(fallbacksFor("prep")).toEqual(["codex/gpt-6-luna", "claude-code/haiku"]);
    config.models.fallback = { prep: "codex/gpt-6-sol" };
    expect(fallbacksFor("prep")).toEqual(["codex/gpt-6-sol"]);
    expect(stageModels("prep")).toEqual(["claude-code/sonnet", "codex/gpt-6-sol"]);
    // Other stages keep the global list.
    expect(fallbacksFor("fill")).toEqual(["codex/gpt-6-luna", "claude-code/haiku"]);
    // Each model once, the stage's own first.
    config.models.fallback = { prep: ["claude-code/sonnet", "codex/gpt-6-sol", "codex/gpt-6-sol"] };
    expect(stageModels("prep")).toEqual(["claude-code/sonnet", "codex/gpt-6-sol"]);
  });

  it("moves to the fallback model, then each signed-in Claude account, and pauses only when all are out", () => {
    config.models.prep = "codex/gpt-6.1-terra";
    config.fallback = ["claude-code/sonnet"];
    config.claudeAccounts = [signedIn, signedOut];
    const reset = Date.now() + 3_600_000;

    expect(hitLimit("prep", config.models.prep, "codex", reset)).toBeNull();
    expect(limitedUntil("codex")).toBe(reset + 30_000);
    expect(choose("prep")).toEqual({ model: "claude-code/sonnet", provider: "claude:default", env: {} });

    expect(hitLimit("prep", config.models.prep, "claude:default", reset + 1000)).toBeNull();
    // An account never signed in is skipped.
    expect(choose("prep")).toEqual({ model: "claude-code/sonnet", provider: `claude:${signedIn}`, env: { CLAUDE_CONFIG_DIR: signedIn } });

    // With every one out, the app waits for the first to come back, just after its reset.
    expect(hitLimit("prep", config.models.prep, `claude:${signedIn}`, reset + 2000)).toBe(reset + 30_000);
    // And the stage's own model is tried first when the pause ends.
    expect(choose("prep").provider).toBe("codex");
  });

  it("gives a refusal without a reset time 5 minutes out, and a passed reset no longer", () => {
    config.models.prep = "claude-code/sonnet";
    expect(hitLimit("prep", config.models.prep, "claude:default")).not.toBeNull();
    expect(limitedUntil("claude:default")).toBeGreaterThan(Date.now() + 4 * 60_000);
    expect(limitedUntil("claude:default")).toBeLessThan(Date.now() + 6 * 60_000);
    kvDelete("limit.claude:default");
    hitLimit("prep", config.models.prep, "claude:default", Date.now() - 1000);
    expect(limitedUntil("claude:default")).toBeLessThan(Date.now() + 6 * 60_000);
  });

  it("finds the next open choice after the one that was refused", () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna", "openai/gpt-6"];
    const first = choose("prep");
    hitLimit("prep", config.models.prep, "codex", Date.now() + 60_000);
    expect(nextChoice("prep", config.models.prep, first)).toEqual({ model: "openai/gpt-6", provider: "omp", env: {} });
    expect(chainFor("prep", null).map(c => c.provider)).toEqual(["claude:default", "codex", "omp"]);
  });

  it("gives a fill the first model and account that are not out", () => {
    config.models.fill = "claude-code/opus";
    config.fallback = ["codex/gpt-6-sol"];
    expect(fillChoice().model).toBe("claude-code/opus");
    hitLimit("fill", config.models.fill, "claude:default", Date.now() + 60_000);
    expect(fillChoice()).toEqual({ model: "codex/gpt-6-sol", provider: "codex", env: {} });
  });
});

// A runner whose workers end as `outcome` says for their model, recording what it was asked to run.
function runner(outcome: (model: string | null) => WorkerResult) {
  const runs: { model: string | null; env: Record<string, string> }[] = [];
  const aborted: (string | null)[] = [];
  const run = (opts: WorkerOptions): WorkerHandle => {
    const model = opts.model ?? null;
    runs.push({ model, env: opts.env ?? {} });
    return {
      done: Promise.resolve({ ...outcome(model), lastText: "" }),
      abort: () => {
        aborted.push(model);
      },
    };
  };
  return { run, runs, models: () => runs.map(r => r.model), aborted };
}
const opts = (more: Partial<WorkerOptions> = {}): WorkerOptions => ({
  name: "prep",
  prompt: "Assess.",
  cwd: ".",
  tools: {},
  builtins: [],
  model: config.models.prep,
  ...more,
});
// What the scheduler adds below withFallback: a refusal marks its provider out.
const marking = (run: ReturnType<typeof runner>["run"]) => (o: WorkerOptions) => {
  const handle = run(o);
  void handle.done.then(r => {
    if (isCapacityError(r.error)) hitLimit("prep", o.model, providerOf(o.model, o.env), Date.now() + 60_000);
  });
  return handle;
};

describe("a worker refused for capacity", () => {
  it("runs again at once on the next model, for a usage limit or an overload", async () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna", "openai/gpt-6"];
    const r = runner(model =>
      model === "claude-code/sonnet"
        ? { status: "error", error: LIMIT }
        : model === "codex/gpt-6-luna"
          ? { status: "error", error: "529 overloaded" }
          : { status: "completed" },
    );
    const result = await withFallback(marking(r.run))(opts()).done;
    expect(result.status).toBe("completed");
    expect(r.models()).toEqual(["claude-code/sonnet", "codex/gpt-6-luna", "openai/gpt-6"]);
  });

  it("runs again on another Claude account, with that account's config directory", async () => {
    config.models.prep = "claude-code/sonnet";
    config.claudeAccounts = [signedIn];
    const r = runner(() => ({ status: "error", error: LIMIT }));
    await withFallback(marking(r.run))(opts()).done;
    expect(r.runs).toEqual([
      { model: "claude-code/sonnet", env: {} },
      { model: "claude-code/sonnet", env: { CLAUDE_CONFIG_DIR: signedIn } },
    ]);
  });

  it("starts new work on the fallback while the stage's own provider is out", async () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna"];
    hitLimit("prep", config.models.prep, "claude:default", Date.now() + 60_000);
    const r = runner(() => ({ status: "completed" }));
    expect((await withFallback(r.run)(opts()).done).status).toBe("completed");
    expect(r.models()).toEqual(["codex/gpt-6-luna"]);
  });

  it("finds its stage's chain under `stage` when its name is not a stage", async () => {
    config.models.recheck = "claude-code/opus";
    config.models.fallback = { recheck: "codex/gpt-6-luna" };
    const r = runner(model => (model === "claude-code/opus" ? { status: "error", error: LIMIT } : { status: "completed" }));
    await withFallback(marking(r.run))(opts({ name: "bank", stage: "recheck", model: "claude-code/opus" })).done;
    expect(r.models()).toEqual(["claude-code/opus", "codex/gpt-6-luna"]);
  });

  it("is not run again for any other failure, with nothing left, in a browser, or once aborted", async () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna"];
    const failed = runner(() => ({ status: "error", error: "the tool crashed" }));
    await withFallback(marking(failed.run))(opts()).done;
    expect(failed.models()).toEqual(["claude-code/sonnet"]);

    const browser = runner(() => ({ status: "error", error: LIMIT }));
    await withFallback(marking(browser.run))(opts({ browser: true })).done;
    expect(browser.models()).toEqual(["claude-code/sonnet"]);

    delete config.fallback;
    kvDelete("limit.claude:default");
    const none = runner(() => ({ status: "error", error: LIMIT }));
    expect((await withFallback(marking(none.run))(opts()).done).error).toBe(LIMIT);
    expect(none.models()).toEqual(["claude-code/sonnet"]);

    config.fallback = ["codex/gpt-6-luna"];
    kvDelete("limit.claude:default");
    const stopped = runner(() => ({ status: "error", error: LIMIT }));
    const handle = withFallback(marking(stopped.run))(opts());
    handle.abort();
    await handle.done;
    expect(stopped.models()).toEqual(["claude-code/sonnet"]);
    expect(stopped.aborted).toEqual(["claude-code/sonnet"]);
  });

  it("is not run again once it has called a host tool, which may have changed something", async () => {
    config.models.prep = "claude-code/sonnet";
    config.fallback = ["codex/gpt-6-luna"];
    const reported: string[] = [];
    const r = runner(() => ({ status: "error", error: LIMIT }));
    const run = (o: WorkerOptions) => {
      void o.tools["finish_prep"]?.handler({});
      return marking(r.run)(o);
    };
    const tools = {
      finish_prep: {
        description: "Hand in the resume.",
        parameters: {},
        handler: () => {
          reported.push("finish_prep");
          return "Recorded.";
        },
      },
    };
    expect((await withFallback(run)(opts({ tools })).done).error).toBe(LIMIT);
    expect(r.models()).toEqual(["claude-code/sonnet"]);
    expect(reported).toEqual(["finish_prep"]);
  });
});
