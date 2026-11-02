import { describe, expect, it } from "bun:test";
import { kvSet } from "../src/db";
import { backedOff, backOff, clearBackoff } from "../src/limits";
import { limitResetsAt as resetTime } from "../src/errors";

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

  it("waits for the given moment, however far, when every provider is out", () => {
    kvSet("backoff.until", "0");
    kvSet("backoff.level", "5"); // the next doubling pause would be an hour
    const firstBack = Date.now() + 3 * 3_600_000;
    expect(backOff(firstBack)).toBe(firstBack);
    expect(backedOff()).toBe(true);
    expect(backOff(firstBack + 1)).toBeNull();
    kvSet("backoff.until", "0");
    clearBackoff();
  });
});

describe("limitResetsAt", () => {
  it("reads the reset moment from a usage-limit error", () => {
    const error = "Claude usage limit reached (five_hour, resets 2026-10-31T05:00:00.000Z): You've hit your session limit";
    expect(resetTime(error, new Date("2026-10-31T01:00:00.000Z"))).toBe(Date.parse("2026-10-31T05:00:00.000Z"));
    // A reset already past says nothing about the next one.
    expect(resetTime(error, new Date("2026-10-31T06:00:00.000Z"))).toBeNull();
    expect(resetTime("The model provider is overloaded")).toBeNull();
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
    expect(resetTime(null)).toBeNull();
  });
});

describe("limitResetsAt, for a wait given as a span", () => {
  it("reads hours, minutes and days from now", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    expect(resetTime("You've hit your usage limit. Try again in 2 hours.", now)).toBe(now.getTime() + 2 * 3_600_000);
    expect(resetTime("Try again in 1 hour 30 minutes.", now)).toBe(now.getTime() + 90 * 60_000);
    expect(resetTime("Try again in 3 days and 4 hours.", now)).toBe(now.getTime() + 3 * 86_400_000 + 4 * 3_600_000);
  });
});
