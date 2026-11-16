import { describe, expect, it } from "bun:test";
import { agyUsage } from "../src/antigravity";
import { claudeUsage } from "../src/claude";
import { codexUsage } from "../src/codex";
import { highlightEvents, lastEventId, logEvent, logUsage, usageSince, workerStepsSince } from "../src/db";
import { overLocateCap } from "../src/locate";

describe("token use, as each CLI reports it", () => {
  it("takes Claude Code's own total and cost when the run finished", () => {
    const total = {
      usage: { input_tokens: 30, cache_creation_input_tokens: 14757, cache_read_input_tokens: 287857, output_tokens: 3992 },
      total_cost_usd: 0.0078,
    };
    expect(claudeUsage(total, [])).toEqual({ input: 14787, cached: 287857, output: 3992, cost: 0.0078 });
  });

  it("adds up the responses of a Claude run stopped before its total, and marks it partial", () => {
    const responses = [
      { input_tokens: 2, cache_creation_input_tokens: 265, cache_read_input_tokens: 28297, output_tokens: 5 },
      { input_tokens: 3, cache_read_input_tokens: 28562, output_tokens: 7 },
    ];
    expect(claudeUsage(null, responses)).toEqual({ input: 270, cached: 56859, output: 12, partial: true });
  });

  it("reads Codex's last running total and allowance from a session file, cached tokens taken out of input", () => {
    const count = (input: number, cached: number, output: number, window: number) =>
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } },
          rate_limits: { primary: { used_percent: window }, secondary: { used_percent: 65 } },
        },
      });
    const rollout = [
      count(17109, 12416, 5, 2),
      '{"type":"response_item","payload":{"type":"message"}}',
      "not json token_count",
      count(249611, 208384, 799, 4),
    ].join("\n");
    expect(codexUsage(rollout)).toEqual({ input: 41227, cached: 208384, output: 799, window: 4, week: 65 });
    expect(codexUsage('{"type":"response_item"}')).toBeNull();
  });

  it("keeps Codex's last total when a later count carries the allowance alone", () => {
    const rollout = [
      JSON.stringify({ payload: { type: "token_count", info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 9 } } } }),
      JSON.stringify({ payload: { type: "token_count", info: null, rate_limits: { primary: { used_percent: 12 }, secondary: null } } }),
    ].join("\n");
    expect(codexUsage(rollout)).toEqual({ input: 60, cached: 40, output: 9, window: 12 });
  });

  it("works out from agy's total whether its input count holds the cached tokens", () => {
    expect(agyUsage({ input_tokens: 1000, cache_read_tokens: 800, output_tokens: 50, thinking_tokens: 10, total_tokens: 1060 })).toEqual({
      input: 200,
      cached: 800,
      output: 60,
    });
    expect(agyUsage({ input_tokens: 200, cache_read_tokens: 800, output_tokens: 50, thinking_tokens: 10, total_tokens: 1060 })).toEqual({
      input: 200,
      cached: 800,
      output: 60,
    });
    expect(agyUsage(undefined)).toBeNull();
  });
});

describe("the usage log", () => {
  it("adds runs up by stage and model, and stays out of the highlights", () => {
    const start = lastEventId();
    logUsage("usage-fill", "codex/gpt-6.1-terra@low", { input: 100, cached: 900, output: 10 }, null);
    logUsage("usage-fill", "codex/gpt-6.1-terra@low", { input: 50, cached: 100, output: 5, window: 7, week: 30 }, null);
    logUsage("usage-fill", "claude-code/claude-haiku-5-5@low", { input: 10, cached: 20, output: 1, cost: 0.002 }, null);
    logUsage("usage-fill", "codex/gpt-6.1-terra@low", { input: 0, cached: 0, output: 0 }, null); // a run that reported nothing
    logUsage("usage-fill", "codex/gpt-6.1-terra@low", null, null);
    const rows = usageSince(1).filter(r => r.stage === "usage-fill");
    expect(rows).toEqual([
      { stage: "usage-fill", model: "codex/gpt-6.1-terra@low", runs: 2, jobs: 0, input: 150, cached: 1000, output: 15, cost: null },
      { stage: "usage-fill", model: "claude-code/claude-haiku-5-5@low", runs: 1, jobs: 0, input: 10, cached: 20, output: 1, cost: 0.002 },
    ]);
    expect(highlightEvents(50).filter(e => e.id > start && e.kind === "usage")).toEqual([]);
  });
});

describe("the locate step cap", () => {
  it("counts a worker's steps whatever job they name", () => {
    const start = lastEventId();
    logEvent("step", "web search", null, "cap-locate");
    logEvent("step", "read page", 1, "cap-locate");
    logEvent("agent", "thinking", null, "cap-locate");
    logEvent("step", "browser click", null, "fill");
    expect(workerStepsSince("cap-locate", start)).toBe(2);
  });

  it("stops a batch at its jobs' allowance, and never when the cap is off", () => {
    expect(overLocateCap(79, 8, 10)).toBe(false);
    expect(overLocateCap(80, 8, 10)).toBe(true);
    expect(overLocateCap(30, 3, 10)).toBe(true);
    expect(overLocateCap(5000, 8, 0)).toBe(false);
  });
});
