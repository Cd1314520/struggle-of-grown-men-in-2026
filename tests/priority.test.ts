import { describe, expect, it } from "bun:test";
import { compile, priorityOf } from "../src/priority";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const job = (fields: Partial<Parameters<typeof priorityOf>[0]> = {}) => ({
  title: "Intern",
  location: "Chicago, IL",
  company: "Acme",
  description: null,
  posted_at: null,
  found_at: "2026-09-01 00:00:00",
  ...fields,
});
const score = (rules: string, fields: Partial<Parameters<typeof priorityOf>[0]> = {}, frontier = false) =>
  priorityOf(job(fields), compile(rules), frontier, NOW);

describe("the keyword priority of a triaged job", () => {
  it("adds the first matching title tier and place", () => {
    const rules = `
tiers: [{ points: 30, title: embedded }, { points: 14, title: engineer }]
places: [{ points: 25, match: houston }, { points: 12, match: '\\bTX\\b' }]`;
    expect(score(rules, { title: "Embedded Engineer Intern", location: "Houston, TX" })).toBe(55);
    expect(score(rules, { title: "Process Engineer Intern", location: "Austin, TX" })).toBe(26);
    expect(score(rules)).toBe(0);
  });

  it("scores skill fit on the best resume, a title hit three times a body one, and a default without a description", () => {
    const rules = `
fit: { weight: 0.5, perHit: 10, unknown: 20, skills: { EE: [pcb, firmware], AI: [pytorch] } }`;
    expect(score(rules)).toBe(10);
    // EE: firmware in the title 3 + pcb in the body 1 = 4 hits, 40 fit; AI: 1 hit.
    expect(score(rules, { title: "Firmware Intern", description: "PCB bring-up. PyTorch a plus." })).toBe(20);
    // A preferred section counts half.
    expect(score(rules, { description: "You will test boards. Nice to have: PCB layout" })).toBe(2.5);
  });

  it("takes points off for skills required but not for ones asked as a plus", () => {
    const rules = `gaps: { points: -5, max: 2, skills: [verilog, '\\bjava\\b', '\\bsql\\b'] }`;
    expect(score(rules, { description: "Must know Verilog. Java and SQL required." })).toBe(-10);
    expect(score(rules, { description: "Verilog is a plus. Preferred: Java" })).toBe(0);
  });

  it("puts what rules the candidate out last, and rewards a welcome year, a frontier employer, freshness and a near deadline", () => {
    const rules = `
eligible: { points: 10, match: sophomore }
ineligible: { points: -100, match: 'citizenship is required', required: verilog }
frontier: 10
fresh: { days: 7, points: 5 }
closing: { days: 7, points: 8 }`;
    expect(score(rules, { description: "Sophomores welcome." })).toBe(10);
    expect(score(rules, { description: "Sophomores welcome. U.S. citizenship is required." })).toBe(-100);
    expect(score(rules, { description: "Experience with Verilog." })).toBe(-100);
    expect(score(rules, { description: "Verilog is a plus." })).toBe(0);
    expect(score(rules, {}, true)).toBe(10);
    expect(score(rules, { found_at: "2026-10-29 00:00:00" })).toBe(5);
    expect(score(rules, { description: "Apply by November 4th, 2026." })).toBe(8);
    expect(score(rules, { description: "Applications close 10/01/2026." })).toBe(-100);
  });

  it("adds startup points once, for a startup application system or a listed company", () => {
    const rules = `startup: { points: 15, url: 'ashbyhq\\.com|greenhouse\\.io', companies: [Rugged Robotics, 'Persona AI, Inc.'] }`;
    expect(score(rules, { url: "https://jobs.ashbyhq.com/acme/123" })).toBe(15);
    expect(score(rules, { company: "Rugged Robotics" })).toBe(15);
    expect(score(rules, { company: "Persona AI" })).toBe(15);
    expect(score(rules, { company: "Rugged Robotics", url: "https://job-boards.greenhouse.io/rugged/jobs/1" })).toBe(15);
    expect(score(rules, { url: "https://acme.wd5.myworkdayjobs.com/x" })).toBe(0);
    expect(score(rules)).toBe(0);
    expect(score("startup: { points: 15 }", { url: "https://jobs.ashbyhq.com/acme/1" })).toBe(0);
  });

  it("names the setting that is not a regular expression", () => {
    expect(() => compile("tiers: [{ points: 1, title: '(intern' }]")).toThrow(/tiers\[0\]\.title/);
    expect(() => compile("frontier: lots")).toThrow(/frontier needs a number/);
  });
});
