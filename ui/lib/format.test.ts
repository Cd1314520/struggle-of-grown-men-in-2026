import { describe, expect, it } from "bun:test";
import { agoShort, brief, DAY, firstClause, HOUR, place, plain, shortUrl, span, withoutCompany } from "./format";

describe("agent text", () => {
  it("shortens an address to its host and the start of its path", () => {
    expect(shortUrl("https://gx.gallup.com/pa2-insight.gx?B2BLOCATION=40850167&ACCESS_CODE=ec8bdad6")).toBe("gx.gallup.com/pa2-insight…");
    expect(shortUrl("https://ebqb.fa.us2.oraclecloud.com:443/hcmUI/CandidateExperience/s/Bkzwq3Vxxv")).toBe("ebqb.fa.us2.oraclecloud.com/hcmUI…");
    expect(shortUrl("https://www.t4wotc.com/?sk=USTOL42234")).toBe("t4wotc.com/…");
    expect(shortUrl("https://go.cultureindex.com/p/ncwHRdGExy")).toBe("go.cultureindex.com/p/ncwHRdGExy");
    expect(shortUrl("https://example.com")).toBe("example.com");
    expect(shortUrl("mailto:ben@scalr.pro?subject=Application")).toBe("ben@scalr.pro");
  });

  it("drops the employer's name a step opens with, and only that", () => {
    expect(withoutCompany('Pyramid: "Your application will not be complete"', "Pyramid Global Hospitality")).toBe('"Your application will not be complete"');
    expect(withoutCompany("Loenbro: reply for a short call", "Loenbro")).toBe("Reply for a short call");
    expect(withoutCompany("Rachel Madray, NCR Voyix: please reply", "NCR")).toBe("Rachel Madray, NCR Voyix: please reply");
  });

  it("cuts a summary to its first clause, never inside a quotation", () => {
    expect(firstClause('Woven asks "can you finish? Soon."; link provided. No deadline.')).toBe('Woven asks "can you finish? Soon."');
    expect(firstClause("Create an account to track it. Optional survey.")).toBe("Create an account to track it");
    expect(firstClause('"Complete the assessment"; 30 minutes')).toBe("Complete the assessment");
  });

  it("reads a step as one plain line beside its company", () => {
    const step =
      'Pyramid: "Your application will not be considered complete until the assessment is finished"; Gallup assessment takes 30–40 minutes; link: https://gx.gallup.com/pa2-insight.gx?B2B=1';
    expect(brief(step, "Pyramid Global Hospitality")).toBe("Your application will not be considered complete until the assessment is finished");
    expect(plain("See **this**: https://gx.gallup.com/pa2-insight.gx?B2B=1")).toBe("See this: gx.gallup.com/pa2-insight…");
    expect(plain("Prepared `ada_lovelace_resume.pdf` for it")).toBe("Prepared ada_lovelace_resume.pdf for it");
  });
});

describe("spans of time", () => {
  it("counts months up to two years, then years", () => {
    expect(span(700 * DAY)).toBe("22mo");
    expect(span(731 * DAY)).toBe("2y");
    expect(span(5 * 365.25 * DAY)).toBe("5y");
  });
});

describe("a row's age", () => {
  it("drops the ' ago' and says now for under a minute", () => {
    expect(agoShort(Date.now() - 3 * HOUR)).toBe("3h");
    expect(agoShort(Date.now() - 2 * DAY)).toBe("2d");
    expect(agoShort(Date.now() - 5000)).toBe("now");
    expect(agoShort(null)).toBe("");
  });
});

describe("a posting's place", () => {
  it("shows the first of several places and counts the rest", () => {
    expect(place("San Francisco, CA | New York City, NY | Seattle, WA")).toBe("San Francisco, CA +2");
    expect(place("San Francisco, CA • New York, NY")).toBe("San Francisco, CA +1");
    expect(place("Austin, TX")).toBe("Austin, TX");
  });
  it("says so when there is none", () => {
    expect(place(null)).toBe("No location given");
    expect(place(" ")).toBe("No location given");
  });
});
