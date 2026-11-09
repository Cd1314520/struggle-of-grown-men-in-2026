import { describe, expect, it } from "bun:test";
import { config } from "../src/config";
import { isCapacityError } from "../src/errors";
import { screenOut, yearsAsked } from "../src/screen";

const OCT_2026 = new Date("2026-10-31T12:00:00Z");

describe("screening postings before triage", () => {
  it("drops applications on portals that never let this machine through", () => {
    expect(screenOut("Software Engineer", "Austin, TX", "https://www.paycomonline.net/v4/ats/web.php/portal/E1A0/jobs/3")).toMatch(/Paycom/);
    expect(screenOut("Software Engineer", "Austin, TX", "https://jobs.lever.co/acme/0b1c2d3e")).toMatch(/Lever/);
    expect(screenOut("Software Engineer", "Austin, TX", "https://job-boards.greenhouse.io/acme/jobs/1")).toBeNull();
    expect(screenOut("Software Engineer", "Austin, TX", "not a url")).toBeNull();
  });
  it("drops titles outside screen.titles when it is set, and none when it is not", () => {
    const saved = config.screen;
    try {
      config.screen = { titles: String.raw`\b(intern(ship)?s?|co-?op|apprentice(ship)?)\b` };
      for (const title of ["Electrical Engineering Intern", "Summer 2027 Internship - Firmware", "Co-op, Hardware Test (Spring 2027)"])
        expect(screenOut(title, "Houston, TX", undefined, null, OCT_2026)).toBeNull();
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
  it("drops titles naming a term that is over, and keeps the terms still ahead", () => {
    const saved = config.screen;
    config.screen = { terms: null };
    for (const title of ["Software Engineering Intern - Summer 2026", "Co-op, Spring '26", "Winter 2025 Data Intern", "Fall 2025 Intern (Remote)"])
      expect(screenOut(title, "Austin, TX", undefined, null, OCT_2026)).toMatch(/term is over/);
    for (const title of ["Software Engineering Intern - Summer 2027", "Fall 2026 Intern", "Co-op, Winter 2027", "Software Engineer Intern"])
      expect(screenOut(title, "Austin, TX", undefined, null, OCT_2026)).toBeNull();
    if (saved) config.screen = saved;
    else delete config.screen;
  });
  it("drops titles naming a term outside screen.terms when it is set", () => {
    const saved = config.screen;
    try {
      config.screen = { terms: ["Summer 2027"] };
      expect(screenOut("Software Intern, Summer '27", "Austin, TX", undefined, null, OCT_2026)).toBeNull();
      expect(screenOut("Software Intern, Fall 2027", "Austin, TX", undefined, null, OCT_2026)).toMatch(/not one of screen\.terms/);
      // A title that names no term is left to triage.
      expect(screenOut("Software Intern", "Austin, TX", undefined, null, OCT_2026)).toBeNull();
    } finally {
      if (saved) config.screen = saved;
      else delete config.screen;
    }
  });
  it("drops descriptions that ask for 5 or more years", () => {
    for (const description of [
      "Requirements:\n- 5+ years of experience building backend services\n- Python",
      "You have at least 7 years' professional software engineering experience.",
      "Minimum qualifications\n- BS in CS and 6 or more years of industry experience",
      "We are hiring.\n- 5-8 years of experience with distributed systems",
    ])
      expect(screenOut("Software Engineer", "Austin, TX", undefined, description)).toMatch(/asks for \d+\+ years/);
  });
  it("keeps descriptions that ask for fewer years, prefer more, or speak of the employer's own", () => {
    for (const description of [
      "- 0-5 years of experience",
      "- 2+ years of experience in Python",
      "- 3 to 5 years of experience",
      "- BS and 5+ years of experience, or MS and 3+ years of experience",
      "- 5+ years of experience preferred",
      "- 5+ years of experience is a plus",
      "Preferred qualifications\n- 6+ years of experience with Kubernetes\nBenefits\n- 401k",
      "Nice to have:\n- 8 years of experience",
      "With over 30 years of experience serving clients, Acme leads the market.",
      "Our team brings 10+ years of experience in fintech.",
      "Join a company founded 12 years ago. Health insurance after 1 year.",
      "- 5 years of Python",
      null,
    ])
      expect(screenOut("Software Engineer", "Austin, TX", undefined, description)).toBeNull();
    // Required years come back after a preferred section ends.
    expect(yearsAsked("Nice to have\n- 8 years of experience\nRequirements\n- 5+ years of experience")).toBe(5);
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
