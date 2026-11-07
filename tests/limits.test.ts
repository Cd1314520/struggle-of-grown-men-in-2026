import { describe, expect, it } from "bun:test";
import { kvSet } from "../src/db";
import { backedOff, backOff, clearBackoff } from "../src/limits";

describe("capacity back-off", () => {
  it("pauses once for workers that fail together, doubles on each new refusal, and resets after a success", () => {
    const first = backOff();
    expect(first).not.toBeNull();
    expect(Math.round(((first ?? 0) - Date.now()) / 60_000)).toBe(2);
    expect(backedOff()).toBe(true);
    expect(backOff()).toBeNull();
    kvSet("backoff.until", String(Date.now() - 1));
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(4);
    clearBackoff();
    expect(backedOff()).toBe(false);
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(2);
  });

  it("starts over at the shortest pause once refusals have stopped for hours", () => {
    clearBackoff();
    backOff();
    kvSet("backoff.until", String(Date.now() - 1));
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(4);
    kvSet("backoff.until", String(Date.now() - 7 * 60 * 60_000));
    expect(Math.round(((backOff() ?? 0) - Date.now()) / 60_000)).toBe(2);
  });
});
