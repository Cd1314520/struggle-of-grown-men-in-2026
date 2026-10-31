import { describe, expect, it } from "bun:test";
import { kvSet } from "../src/db";
import { backedOff, backOff, clearBackoff } from "../src/limits";
import { resetTime } from "../src/scheduler";

describe("capacity back-off", () => {
  it("pauses once for workers that fail together, doubles on each new refusal, and resets after a success", () => {
    const first = backOff();
    expect(first).not.toBeNull();
    expect(Math.round(((first ?? 0) - Date.now()) / 60_000)).toBe(2);
    expect(backedOff()).toBe(true);
    expect(backOff()).toBeNull();
    kvSet("backoff.until", "0");
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(4);
    kvSet("backoff.until", "0");
    clearBackoff();
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(2);
  });

  it("ends the pause just after the provider's reset time when that comes first", () => {
    kvSet("backoff.until", "0");
    kvSet("backoff.level", "5"); // the next pause would be an hour
    const resetsAt = Date.now() + 10 * 60_000;
    expect(backOff(resetsAt)).toBe(resetsAt + 30_000);
    kvSet("backoff.until", "0");
    clearBackoff();
    // A reset further away than the pause, or already past, leaves the pause as it was.
    expect(Math.round(((backOff(Date.now() + 3 * 3_600_000) ?? 0) - Date.now()) / 60_000)).toBe(2);
    kvSet("backoff.until", "0");
    clearBackoff();
    expect(Math.round(((backOff(Date.now() - 60_000) ?? 0) - Date.now()) / 60_000)).toBe(2);
  });
});

describe("resetTime", () => {
  it("reads the reset moment from a usage-limit error", () => {
    const error = "Claude usage limit reached (five_hour, resets 2026-10-31T05:00:00.000Z): You've hit your session limit";
    expect(resetTime(error)).toBe(Date.parse("2026-10-31T05:00:00.000Z"));
    expect(resetTime("The model provider is overloaded")).toBeUndefined();
  });

  it("reads Codex's local reset time, today or tomorrow, and a dated one", () => {
    const codex = (at: string) =>
      `You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at ${at}. (Codex thread 01a1)`;
    const evening = new Date(2026, 9, 30, 20, 55);
    expect(resetTime(codex("11:58 PM"), evening)).toBe(new Date(2026, 9, 30, 23, 58).getTime());
    const night = new Date(2026, 9, 31, 0, 30);
    expect(resetTime(codex("11:58 PM"), night)).toBe(new Date(2026, 9, 31, 23, 58).getTime());
    expect(resetTime(codex("12:05 AM"), night)).toBe(new Date(2026, 10, 1, 0, 5).getTime());
    expect(resetTime(codex("Nov 3rd, 2026 11:58 PM"), night)).toBe(new Date(2026, 10, 3, 23, 58).getTime());
    expect(resetTime(null)).toBeUndefined();
  });
});
