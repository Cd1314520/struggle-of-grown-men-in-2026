import { describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { isCapacityError } from "../src/errors";
import { screenOut } from "../src/screen";

describe("screening postings before triage", () => {
  it("drops applications on portals that never let this machine through", () => {
    expect(screenOut("Software Engineer", "Austin, TX", "https://www.paycomonline.net/v4/ats/web.php/portal/E1A0/jobs/3")).toMatch(/Paycom/);
    expect(screenOut("Software Engineer", "Austin, TX", "https://job-boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(screenOut("Software Engineer", "Austin, TX", "not a url")).toBeNull();
  });
  it("drops titles outside screen.titles when it is set, and none when it is not", () => {
    const saved = config.screen;
    try {
      config.screen = { titles: String.raw`\b(intern(ship)?s?|co-?op|apprentice(ship)?)\b` };
      for (const title of ["Electrical Engineering Intern", "Summer 2027 Internship - Firmware", "Co-op, Hardware Test (Spring 2027)"])
        expect(screenOut(title, "Houston, TX")).toBeNull();
      for (const title of ["Embedded Software Engineer", "Internal Tools Engineer", "International Sales Engineer"])
        expect(screenOut(title, "Houston, TX")).toMatch(/screen\.titles/);
      config.screen = { titles: null };
      expect(screenOut("Embedded Software Engineer", "Houston, TX")).toBeNull();
    } finally {
      if (saved) config.screen = saved;
      else delete config.screen;
    }
  });
  it("drops senior-level titles", () => {
    for (const title of [
      "Senior Software Engineer",
      "Sr. Backend Engineer",
      "SR Data Engineer",
      "Staff Engineer, Platform",
      "Principal Frontend Software Engineer - Discovery",
      "Lead Test Data Management Engineer",
      "Engineering Manager, AI",
      "Director of Engineering",
      "Head of AI",
      "VP, Engineering",
    ])
      expect(screenOut(title, "Austin, TX")).toMatch(/senior-level/);
  });
  it("keeps titles at the candidate's level, including numbered levels", () => {
    for (const title of [
      "Software Engineer",
      "Software Engineer II",
      "Software Engineer III",
      "AI Engineer (New York)",
      "Leadership Development Engineer",
      "Mid-Level Developer",
    ])
      expect(screenOut(title, "Remote - US")).toBeNull();
  });
  it("keeps hardware, embedded and FPGA titles: the candidate is an EE student", () => {
    for (const title of [
      "Embedded Software Engineer",
      "Embedded Systems Engineer",
      "Embedded Firmware Engineer",
      "FPGA Design Engineer",
      "Internal Acceleration, Engineer (ASIC)",
      "Hardware Test Engineer I, Testbeds & EGSE",
      "Electrical Engineer, Hardware Platform, 2+ years of experience",
      "Firmware Engineer, Manufacturing Test",
    ])
      expect(screenOut(title, "Austin, TX")).toBeNull();
  });
  it("keeps software and data titles that only mention hardware", () => {
    for (const title of [
      "Data Engineer, Hardware & Consumer Devices",
      "Analytics Engineer, Hardware Test",
      "Data Scientist - Embedded Insights",
      "Embedded AI Engineer, On-Device Models",
    ])
      expect(screenOut(title, "Austin, TX")).toBeNull();
  });
  it("drops listings abroad and keeps US or unstated ones", () => {
    expect(screenOut("Software Engineer", "Bengaluru")).toMatch(/outside the United States/);
    expect(screenOut("Software Engineer", "UK-Bristol")).toMatch(/outside the United States/);
    expect(screenOut("Software Engineer", "Hub - San Francisco | Hub - Porto")).toBeNull();
    expect(screenOut("Software Engineer", "Remote")).toBeNull();
    expect(screenOut("Software Engineer", null)).toBeNull();
  });
});

describe("capacity refusals", () => {
  it("are told apart from other worker errors", () => {
    expect(isCapacityError("Codex error event: Codex is at capacity, please try again later (code=turn_rate_limit_exceeded)")).toBe(true);
    expect(isCapacityError("HTTP 429 Too Many Requests")).toBe(true);
    expect(isCapacityError("You've hit your session limit · resets 3pm")).toBe(true);
    expect(isCapacityError('API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}')).toBe(true);
    expect(isCapacityError("stopped after its time allowance of 20m")).toBe(false);
    expect(isCapacityError("omp exited with code 1 before finishing.")).toBe(false);
    expect(isCapacityError("no report")).toBe(false);
    expect(isCapacityError(undefined)).toBe(false);
  });
});
