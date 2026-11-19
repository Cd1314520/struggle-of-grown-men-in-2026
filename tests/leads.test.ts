import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { outreachStore, type NewLead, type NewPerson } from "../src/leads";
import { migrate } from "../src/schema";

const open: Database[] = [];
const must = <T>(v: T | null | undefined): T => {
  if (v === null || v === undefined) throw new Error("missing");
  return v;
};
const store = () => {
  const db = new Database(":memory:");
  migrate(db);
  open.push(db);
  return outreachStore(db);
};
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

const lead = (over: Partial<NewLead> = {}): NewLead => ({
  kind: "seed",
  company: "Acme Power",
  domain: "acme.com",
  source_url: "https://news.example.com/acme-seed",
  source_title: "Acme Power raises a seed round",
  posted_at: "2026-11-17T15:00:00Z",
  likes: null,
  what_they_do: "Builds DC fast chargers",
  why_fit: "Power electronics work",
  score: 80,
  ...over,
});
const person = (leadId: number, over: Partial<NewPerson> = {}): NewPerson => ({
  lead_id: leadId,
  name: "Sam Lee",
  role: "CEO",
  profile_url: null,
  email: "sam@acme.com",
  email_source: "public",
  email_confidence: "high",
  subject: "EE intern",
  body: "Hi Sam,\nshort note.",
  drafted_on: "2026-11-18",
  ...over,
});

describe("outreach store", () => {
  it("adds a lead once per source_url", () => {
    const s = store();
    const a = s.addLead(lead());
    expect(a?.company_key).toBe("acmepower");
    expect(a?.status).toBe("new");
    expect(s.addLead(lead({ company: "Other" }))).toBeNull();
    expect(s.leads()).toHaveLength(1);
  });

  it("caps people at three per lead", () => {
    const s = store();
    const l = must(s.addLead(lead()));
    for (const n of ["a", "b", "c"]) expect(s.addPerson(person(l.id, { email: `${n}@acme.com` }))).not.toBeNull();
    expect(s.addPerson(person(l.id, { email: "d@acme.com" }))).toBeNull();
    expect(s.people(l.id)).toHaveLength(3);
  });

  it("dedupes people by lowercased email", () => {
    const s = store();
    const l = must(s.addLead(lead()));
    expect(s.addPerson(person(l.id, { email: "Jane@Acme.com" }))?.email).toBe("jane@acme.com");
    expect(s.addPerson(person(l.id, { email: "jane@acme.com" }))).toBeNull();
  });

  it("setStage stamps the day column", () => {
    const s = store();
    const l = must(s.addLead(lead()));
    const p = must(s.addPerson(person(l.id)));
    s.setStage(p.id, "sent", "2026-11-18");
    s.setStage(p.id, "followed_up", "2026-11-23");
    s.setStage(p.id, "replied", "2026-11-24");
    const got = must(s.people(l.id)[0]);
    expect([got.stage, got.sent_on, got.followed_up_on, got.replied_on]).toEqual(["replied", "2026-11-18", "2026-11-23", "2026-11-24"]);
  });

  it("sentCompanyDays keeps the first send per company", () => {
    const s = store();
    const a = must(s.addLead(lead()));
    const b = must(s.addLead(lead({ source_url: "https://example.com/acme-post", kind: "post" })));
    const p = must(s.addPerson(person(a.id)));
    const q = must(s.addPerson(person(b.id, { email: "x@acme.com" })));
    s.setStage(q.id, "sent", "2026-11-10");
    s.setStage(p.id, "sent", "2026-11-15");
    expect(s.sentCompanyDays().get("acmepower")).toBe("2026-11-10");
  });

  it("promote, lead status and expired drafts", () => {
    const s = store();
    const l = must(s.addLead(lead()));
    const p = must(s.addPerson(person(l.id, { email_confidence: "low" })));
    s.promote(p.id);
    expect(must(s.people(l.id)[0]).promoted).toBe(1);
    s.setFollowUp(p.id, "Following up.");
    expect(must(s.people(l.id)[0]).followup_body).toBe("Following up.");
    s.setLeadStatus(l.id, "dropped");
    expect(s.leads(["dropped"])).toHaveLength(1);
    s.deleteExpiredDrafts([p.id]);
    expect(s.people(l.id)).toHaveLength(0);
  });
});
