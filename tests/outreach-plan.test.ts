import { describe, expect, it } from "bun:test";
import type { Lead, Person } from "../src/leads";
import { bodyProblem, emailGuesses, expiredDrafts, followUpsDue, leadProblem, needsLeads, quietPeople, todayList } from "../src/outreach-plan";

const TZ = "America/Chicago";
const NOW = new Date("2026-11-18T18:00:00Z"); // noon in Chicago, 2026-11-18
const opts = (sent: Record<string, string> = {}) => ({ minScore: 60, resuggestDays: 30, sentCompanyDays: new Map(Object.entries(sent)), timeZone: TZ });
const input = (over: Partial<Parameters<typeof leadProblem>[0]> = {}) => ({
  kind: "post" as const,
  posted_at: "2026-11-18T14:00:00Z",
  likes: 40,
  score: 80,
  company_key: "acmepower",
  source_url: "https://www.linkedin.com/posts/acme-hiring",
  fetched: false,
  ...over,
});

let ids = 0;
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: ++ids,
  kind: "seed",
  company: "Acme",
  company_key: `acme${ids}`,
  domain: "acme.com",
  source_url: `https://example.com/${ids}`,
  source_title: "",
  posted_at: "2026-11-17T15:00:00Z",
  likes: null,
  what_they_do: "",
  why_fit: "",
  score: 80,
  status: "new",
  found_at: "2026-11-17 15:00:00",
  ...over,
});
const person = (l: Lead, over: Partial<Person> = {}): Person => ({
  id: ++ids,
  lead_id: l.id,
  name: "Sam Lee",
  role: "CEO",
  profile_url: null,
  email: `p${ids}@acme.com`,
  email_source: "public",
  email_confidence: "high",
  promoted: 0,
  subject: "s",
  body: "b",
  followup_body: null,
  stage: "drafted",
  drafted_on: "2026-11-18",
  sent_on: null,
  followed_up_on: null,
  replied_on: null,
  updated_at: "",
  ...over,
});

describe("leadProblem", () => {
  it("refuses a post older than a day", () => {
    expect(leadProblem(input(), NOW, opts())).toBeNull();
    expect(leadProblem(input({ posted_at: "2026-11-16T14:00:00Z" }), NOW, opts())).toContain("older than 1 day");
  });

  it("keeps a seed for a week", () => {
    expect(leadProblem(input({ kind: "seed", likes: null, posted_at: "2026-11-11T18:00:00Z" }), NOW, opts())).toBeNull();
    expect(leadProblem(input({ kind: "seed", likes: null, posted_at: "2026-11-10T18:00:00Z" }), NOW, opts())).toContain("older than 7 days");
  });

  it("refuses 100 likes or more", () => {
    expect(leadProblem(input({ likes: 99 }), NOW, opts())).toBeNull();
    expect(leadProblem(input({ likes: 100 }), NOW, opts())).toContain("100 likes");
    expect(leadProblem(input({ likes: null }), NOW, opts())).toBeNull();
  });

  it("refuses a score below minScore and a date that is not one", () => {
    expect(leadProblem(input({ score: 59 }), NOW, opts())).toContain("below 60");
    expect(leadProblem(input({ posted_at: "yesterday" }), NOW, opts())).toContain("not a date");
  });

  it("rejects a company contacted within resuggestDays", () => {
    expect(leadProblem(input(), NOW, opts({ acmepower: "2026-11-08" }))).toContain("company on 2026-11-08");
    expect(leadProblem(input(), NOW, opts({ acmepower: "2026-10-18" }))).toBeNull();
  });

  it("counts a post's day in hours, not calendar days", () => {
    // 12:30 AM in Chicago on the 17th, then 47 hours later.
    const post = input({ posted_at: "2026-11-17T06:30:00Z" });
    expect(leadProblem(post, new Date("2026-11-18T05:30:00Z"), opts())).toBeNull();
    expect(leadProblem(post, new Date("2026-11-19T05:30:00Z"), opts())).toContain("older than 1 day");
  });

  it("reads a date without a time as that day, and refuses one in the future", () => {
    expect(leadProblem(input({ kind: "seed", likes: null, posted_at: "2026-11-11" }), NOW, opts())).toBeNull();
    expect(leadProblem(input({ posted_at: "2026-11-19T18:00:00Z" }), NOW, opts())).toContain("in the future");
  });

  it("refuses a second open lead at the same company", () => {
    expect(leadProblem(input(), NOW, { ...opts(), openCompanyKeys: new Set(["acmepower"]) })).toContain("open already");
  });

  it("refuses a fetched linkedin or x URL", () => {
    expect(leadProblem(input({ fetched: true }), NOW, opts())).toContain("search results only");
    expect(leadProblem(input({ fetched: true, source_url: "https://x.com/acme/status/1" }), NOW, opts())).toContain("search results only");
    expect(leadProblem(input({ fetched: true, source_url: "https://acme.com/careers" }), NOW, opts())).toBeNull();
  });
});

describe("drafts", () => {
  it("bodyProblem counts lines", () => {
    expect(bodyProblem("1\n2\n\n3\n4\n5", 5)).toBeNull();
    expect(bodyProblem("1\n2\n3\n4\n5\n6", 5)).toContain("6 lines");
    expect(bodyProblem("  ", 5)).toContain("empty");
  });

  it("emailGuesses", () => {
    expect(emailGuesses("Jane", "Founder", "acme.com")).toEqual(["jane@acme.com", "jane.founder@acme.com", "jfounder@acme.com"]);
    expect(emailGuesses("Jane", "", "Acme.com")).toEqual(["jane@acme.com"]);
  });
});

describe("the daily list", () => {
  it("todayList skips low confidence unless promoted", () => {
    const l = lead();
    const low = person(l, { email_confidence: "low" });
    const kept = person(l, { email_confidence: "low", promoted: 1 });
    const mid = person(l, { email_confidence: "medium" });
    expect(todayList([low, kept, mid], [l], 20, NOW, TZ).map(p => p.id)).toEqual([kept.id, mid.id]);
  });

  it("todayList orders by score then newest and caps at perDay minus sent today", () => {
    const a = lead({ score: 70, posted_at: "2026-11-18T10:00:00Z" });
    const b = lead({ score: 90, posted_at: "2026-11-15T10:00:00Z" });
    const c = lead({ score: 90, posted_at: "2026-11-17T10:00:00Z" });
    const pa = person(a),
      pb = person(b),
      pc = person(c);
    const sent = person(a, { stage: "sent", sent_on: "2026-11-18" });
    expect(todayList([pa, pb, pc], [a, b, c], 20, NOW, TZ).map(p => p.id)).toEqual([pc.id, pb.id, pa.id]);
    expect(todayList([pa, pb, pc, sent], [a, b, c], 3, NOW, TZ).map(p => p.id)).toEqual([pc.id, pb.id]);
  });

  it("expires by posted_at in the owner's time zone", () => {
    // 11:30 PM in Chicago on the 17th.
    const late = lead({ kind: "post", posted_at: "2026-11-18T05:30:00Z" });
    const p = person(late);
    expect(todayList([p], [late], 20, NOW, TZ)).toHaveLength(1);
    expect(expiredDrafts([p], [late], new Date("2026-11-19T05:00:00Z"))).toEqual([]); // 11 PM on the 18th
    expect(expiredDrafts([p], [late], new Date("2026-11-19T07:00:00Z"))).toEqual([p.id]); // 1 AM on the 19th
    expect(todayList([p], [late], 20, new Date("2026-11-19T07:00:00Z"), TZ)).toHaveLength(0);
  });

  it("drops a company's other drafts once one is sent", () => {
    const a = lead({ company_key: "same" });
    const b = lead({ company_key: "same" });
    const sent = person(a, { stage: "sent", sent_on: "2026-11-17" });
    const other = person(b);
    expect(todayList([sent, other], [a, b], 20, NOW, TZ)).toEqual([]);
  });

  it("quietPeople closes a follow-up with no reply after followUpDays", () => {
    const l = lead();
    const quiet = person(l, { stage: "followed_up", sent_on: "2026-11-05", followed_up_on: "2026-11-12" });
    const recent = person(l, { stage: "followed_up", sent_on: "2026-11-10", followed_up_on: "2026-11-15" });
    expect(quietPeople([quiet, recent], "2026-11-18", 5)).toEqual([quiet.id]);
  });

  it("followUpsDue after followUpDays", () => {
    const l = lead();
    const p = person(l, { stage: "sent", sent_on: "2026-11-13" });
    const done = person(l, { stage: "followed_up", sent_on: "2026-11-01", followed_up_on: "2026-11-06" });
    expect(followUpsDue([p, done], "2026-11-17", 5)).toEqual([]);
    expect(followUpsDue([p, done], "2026-11-18", 5).map(x => x.id)).toEqual([p.id]);
  });

  it("needsLeads while fewer than perDay sendable drafts wait", () => {
    const l = lead();
    const two = [person(l), person(l)];
    expect(needsLeads(two, [l], 3, NOW, TZ)).toBe(true);
    expect(needsLeads(two, [l], 2, NOW, TZ)).toBe(false);
    expect(needsLeads([person(l, { stage: "sent", sent_on: "2026-11-18" }), person(l, { stage: "sent", sent_on: "2026-11-18" })], [l], 2, NOW, TZ)).toBe(false);
  });
});
