import { describe, expect, it } from "bun:test";
import { config, readProfile } from "../src/config";
import type { Job } from "../src/db";
import { employersText } from "../src/employers";
import { triageBatch, triageDue } from "../src/scan";
import { render } from "../src/worker-tools";

// SQLite's datetime('now') format, `hours` ago.
const ago = (hours: number) =>
  new Date(Date.now() - hours * 3600_000)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, "");
const waiting = (n: number, foundHoursAgo = 0) =>
  Array.from(
    { length: n },
    (_, i) => ({ id: i + 1, company: `Co ${i}`, title: "Software Engineer", location: "Austin, TX", found_at: ago(foundHoursAgo) }) as Job,
  );
const noFeedback = () => false;

describe("triage batches", () => {
  it("waits for a full batch while the postings are fresh", () => {
    expect(triageDue([], noFeedback)).toBe(false);
    expect(triageDue(waiting(1), noFeedback)).toBe(false);
    expect(triageDue(waiting(triageBatch() - 1), noFeedback)).toBe(false);
    expect(triageDue(waiting(triageBatch()), noFeedback)).toBe(true);
  });

  it("sends a partial batch once its oldest posting has waited long enough, or one was picked by hand", () => {
    expect(triageDue(waiting(1, 2.1), noFeedback)).toBe(true);
    expect(triageDue(waiting(1, 1.5), noFeedback)).toBe(false);
    expect(triageDue(waiting(1), () => true)).toBe(true);
  });

  it("takes the batch size and the wait from triage in config.yml", () => {
    const saved = config.triage;
    try {
      config.triage = { batch: 10, waitHours: 0.5 };
      expect(triageDue(waiting(10), noFeedback)).toBe(true);
      expect(triageDue(waiting(1, 0.6), noFeedback)).toBe(true);
      expect(triageDue(waiting(1, 0.4), noFeedback)).toBe(false);
    } finally {
      if (saved) config.triage = saved;
      else delete config.triage;
    }
  });

  it("names only the listed employers in the batch", () => {
    const lists = { frontier: Array.from({ length: 150 }, (_, i) => `Frontier Lab ${i}`), practice: Array.from({ length: 80 }, (_, i) => `Practice Co ${i}`) };
    const batch = ["Frontier Lab 7", "Practice Co 3", "Unlisted Inc"];
    const prompt = (employers: string) => render("triage", { employers, targets: readProfile("targets.md"), postings: "" });
    const before = prompt(employersText(lists)).length;
    const after = prompt(employersText(lists, batch)).length;
    expect(employersText(lists, batch)).toBe(
      "- Frontier (agent-native, at scale; real targets): Frontier Lab 7\n- Practice (behind; fine to practise on): Practice Co 3",
    );
    expect(employersText(lists, ["Unlisted Inc"])).toContain("(none of these employers)");
    // Names match the way jobs are grouped by employer.
    expect(employersText(lists, ["frontier lab 7, inc."])).toContain("Frontier Lab 7");
    // 230 listed employers are ~4,000 characters of every call; what is left is the template and targets.
    expect(before - after).toBeGreaterThan(3500);
    expect(after).toBeLessThan(before * 0.65);
  });
});
