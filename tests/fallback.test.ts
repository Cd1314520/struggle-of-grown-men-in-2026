import { afterEach, describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { kvSet } from "../src/db";
import { isCapacityError, isUsageLimit, limitResetsAt } from "../src/errors";
import { fillModel } from "../src/fill";
import { backedOff, backOff, backoffUntil, isLimited, limitedUntil, limitModel } from "../src/limits";
import { availableModel, modelChain, nextFallback, withFallback, type WorkerHandle, type WorkerOptions, type WorkerResult } from "../src/worker";

const MODELS = ["claude-code/sonnet", "claude-code/opus", "codex/gpt-6-luna", "codex/gpt-6-sol", "claude-code/haiku", "openai/gpt-6"];
const saved = { prep: config.models.prep, fill: config.models.fill, fallback: config.models.fallback };
afterEach(() => {
  config.models.prep = saved.prep;
  config.models.fill = saved.fill;
  if (saved.fallback) config.models.fallback = saved.fallback;
  else delete config.models.fallback;
  for (const m of MODELS) kvSet(`limited.${m}`, "0");
  kvSet("backoff.until", "0");
});

const LIMIT = "Claude usage limit reached (five_hour, resets 2026-10-31T20:00:00.000Z): limit reached";

// A runner whose workers end as `outcome` says for their model, recording the models it was asked for.
function runner(outcome: (model: string | null) => WorkerResult) {
  const models: (string | null)[] = [];
  const aborted: (string | null)[] = [];
  const run = (opts: WorkerOptions): WorkerHandle => {
    const model = opts.model ?? null;
    models.push(model);
    return {
      done: Promise.resolve({ ...outcome(model), lastText: "" }),
      abort: () => {
        aborted.push(model);
      },
    };
  };
  return { run, models, aborted };
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

describe("usage limits", () => {
  it("are told apart from a passing overload, and still count as capacity", () => {
    expect(isUsageLimit(LIMIT)).toBe(true);
    expect(isUsageLimit("You've hit your usage limit. Try again in 2 hours.")).toBe(true);
    expect(isUsageLimit("Codex is at capacity, please try again later")).toBe(false);
    expect(isUsageLimit("529 overloaded")).toBe(false);
    expect(isCapacityError(LIMIT)).toBe(true);
  });

  it("say when they lift, when they say it in a form that names the moment", () => {
    const now = Date.parse("2026-10-31T12:00:00.000Z");
    expect(limitResetsAt("Claude usage limit reached (five_hour, resets 2026-10-31T17:00:00.000Z): limit reached", now)).toBe(
      Date.parse("2026-10-31T17:00:00.000Z"),
    );
    expect(limitResetsAt("You've hit your usage limit. Try again in 2 hours.", now)).toBe(now + 2 * 3_600_000);
    expect(limitResetsAt("You've hit your usage limit. Try again in 1 hour 30 minutes.", now)).toBe(now + 90 * 60_000);
    expect(limitResetsAt("You've hit your usage limit. Try again in 3 days and 4 hours.", now)).toBe(now + 3 * 86_400_000 + 4 * 3_600_000);
    expect(limitResetsAt("You've hit your usage limit. Try again at 3:05 PM.", now)).toBeNull();
    // A reset already past says nothing about the next one.
    expect(limitResetsAt("Claude usage limit reached (five_hour, resets 2026-10-31T11:00:00.000Z)", now)).toBeNull();
    expect(limitResetsAt("529 overloaded", now)).toBeNull();
  });

  it("keep a model limited until the reset, or for an hour when none was said", () => {
    const soon = Date.now() + 5 * 60_000;
    limitModel("claude-code/opus", soon);
    expect(limitedUntil("claude-code/opus")).toBe(soon);
    expect(isLimited("claude-code/opus")).toBe(true);
    expect(isLimited("codex/gpt-6-sol")).toBe(false);
    const guessed = limitModel("codex/gpt-6-sol", null);
    expect(Math.round((guessed - Date.now()) / 60_000)).toBe(60);
    limitModel("claude-code/opus", Date.now() - 1);
    expect(isLimited("claude-code/opus")).toBe(false);
  });

  it("pause the app until a given reset instead of the doubling pause", () => {
    const reset = Date.now() + 3 * 3_600_000;
    expect(backOff(reset)).toBe(reset);
    expect(backedOff()).toBe(true);
    expect(backoffUntil()).toBe(reset);
    expect(backOff(reset + 1)).toBeNull();
  });
});

describe("a stage's fallback models", () => {
  it("follow its own model in order, each once", () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: ["codex/gpt-6-luna", "claude-code/sonnet", "codex/gpt-6-luna", "openai/gpt-6"] };
    expect(modelChain("prep")).toEqual(["claude-code/sonnet", "codex/gpt-6-luna", "openai/gpt-6"]);
    expect(nextFallback("prep", "claude-code/sonnet")).toBe("codex/gpt-6-luna");
    expect(nextFallback("prep", "openai/gpt-6")).toBeNull();
    expect(nextFallback("prep", "somewhere/else")).toBeNull();
    expect(nextFallback(null, "claude-code/sonnet")).toBeNull();
  });

  it("skip a model while it is at its own usage limit, and take it back once that resets", () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: ["codex/gpt-6-luna", "claude-code/haiku"] };
    limitModel("codex/gpt-6-luna", Date.now() + 60_000);
    expect(nextFallback("prep", "claude-code/sonnet")).toBe("claude-code/haiku");
    expect(availableModel("prep", "claude-code/sonnet")).toBe("claude-code/sonnet");
    limitModel("claude-code/sonnet", Date.now() + 60_000);
    expect(availableModel("prep", "claude-code/sonnet")).toBe("claude-code/haiku");
    limitModel("claude-code/haiku", Date.now() + 60_000);
    expect(availableModel("prep", "claude-code/sonnet")).toBe("claude-code/sonnet");
    expect(nextFallback("prep", "claude-code/sonnet")).toBeNull();
    limitModel("claude-code/sonnet", Date.now() - 1);
    expect(availableModel("prep", "claude-code/sonnet")).toBe("claude-code/sonnet");
  });

  it("give a fill the first model that is not limited", () => {
    config.models.fill = "claude-code/opus";
    config.models.fallback = { fill: "codex/gpt-6-sol" };
    expect(fillModel()).toBe("claude-code/opus");
    limitModel("claude-code/opus", Date.now() + 60_000);
    expect(fillModel()).toBe("codex/gpt-6-sol");
  });

  it("are none unless configured", () => {
    config.models.prep = "claude-code/sonnet";
    delete config.models.fallback;
    expect(modelChain("prep")).toEqual(["claude-code/sonnet"]);
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    expect(modelChain("prep")).toEqual(["claude-code/sonnet", "codex/gpt-6-luna"]);
  });
});

describe("a worker that ends on a usage limit", () => {
  it("runs again at once on the fallback model", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    const r = runner(model => (model === "claude-code/sonnet" ? { status: "error", error: LIMIT } : { status: "completed" }));
    const result = await withFallback(r.run)(opts()).done;
    expect(result.status).toBe("completed");
    expect(r.models).toEqual(["claude-code/sonnet", "codex/gpt-6-luna"]);
  });

  it("tries each fallback once, and ends on the last limit when every one is out", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: ["codex/gpt-6-luna", "claude-code/haiku"] };
    const r = runner(() => ({ status: "error", error: LIMIT }));
    const result = await withFallback(r.run)(opts()).done;
    expect(result).toEqual({ status: "error", error: LIMIT, lastText: "" });
    expect(r.models).toEqual(["claude-code/sonnet", "codex/gpt-6-luna", "claude-code/haiku"]);
  });

  it("finds its stage's fallback under `stage` when its name is not a stage", async () => {
    config.models.fallback = { recheck: "codex/gpt-6-luna" };
    const r = runner(model => (model === "claude-code/opus" ? { status: "error", error: LIMIT } : { status: "completed" }));
    await withFallback(r.run)(opts({ name: "bank", stage: "recheck", model: "claude-code/opus" })).done;
    expect(r.models).toEqual(["claude-code/opus", "codex/gpt-6-luna"]);
  });

  it("is not retried for any other failure, without a fallback, or in a browser", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    const overloaded = runner(() => ({ status: "error", error: "529 overloaded" }));
    await withFallback(overloaded.run)(opts()).done;
    expect(overloaded.models).toEqual(["claude-code/sonnet"]);

    const browser = runner(() => ({ status: "error", error: LIMIT }));
    await withFallback(browser.run)(opts({ browser: true })).done;
    expect(browser.models).toEqual(["claude-code/sonnet"]);

    delete config.models.fallback;
    const none = runner(() => ({ status: "error", error: LIMIT }));
    expect((await withFallback(none.run)(opts()).done).error).toBe(LIMIT);
    expect(none.models).toEqual(["claude-code/sonnet"]);
  });

  it("is not run again once it has called a host tool, which may have changed something", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    const reported: string[] = [];
    const r = runner(() => ({ status: "error", error: LIMIT }));
    const run = (o: WorkerOptions) => {
      void o.tools["finish_prep"]?.handler({});
      return r.run(o);
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
    expect(r.models).toEqual(["claude-code/sonnet"]);
    expect(reported).toEqual(["finish_prep"]);
  });

  it("starts new work on the fallback while the stage's own model is at its limit", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    limitModel("claude-code/sonnet", Date.now() + 60_000);
    const r = runner(() => ({ status: "completed" }));
    expect((await withFallback(r.run)(opts()).done).status).toBe("completed");
    expect(r.models).toEqual(["codex/gpt-6-luna"]);
  });

  it("is not run again once aborted", async () => {
    config.models.prep = "claude-code/sonnet";
    config.models.fallback = { prep: "codex/gpt-6-luna" };
    const r = runner(() => ({ status: "error", error: LIMIT }));
    const handle = withFallback(r.run)(opts());
    handle.abort();
    await handle.done;
    expect(r.models).toEqual(["claude-code/sonnet"]);
    expect(r.aborted).toEqual(["claude-code/sonnet"]);
  });
});
