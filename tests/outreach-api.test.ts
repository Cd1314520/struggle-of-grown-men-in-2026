import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { outreachStore, type Person } from "../src/leads";
import { changePerson, dropLead, outreachState, replyBumps, syncOutreachMail } from "../src/outreach-leads-api";
import { migrate } from "../src/schema";

const open: Database[] = [];
const store = () => {
  const db = new Database(":memory:");
  migrate(db);
  open.push(db);
  return outreachStore(db);
};
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

const NOW = new Date("2026-11-18T18:00:00Z");
const DAY = "2026-11-18";
let n = 0;
function seed(s: ReturnType<typeof store>, confidence: Person["email_confidence"] = "high") {
  const lead = s.addLead({
    kind: "seed",
    company: `Acme ${++n}`,
    domain: "acme.com",
    source_url: `https://news.example.com/${n}`,
    source_title: "",
    posted_at: "2026-11-17T15:00:00Z",
    likes: null,
    what_they_do: "Chargers",
    why_fit: "Power",
    score: 80,
  });
  if (!lead) throw new Error("no lead");
  const person = s.addPerson({
    lead_id: lead.id,
    name: "Sam Lee",
    role: "CEO",
    profile_url: null,
    email: `sam${n}@acme.com`,
    email_source: "public",
    email_confidence: confidence,
    subject: "Hi",
    body: "Hi Sam,\nshort.",
    drafted_on: DAY,
  });
  if (!person) throw new Error("no person");
  return { lead, person };
}

describe("outreach page state", () => {
  it("outreachState sorts people into today, follow-ups, waiting, check first, replied, done", () => {
    const s = store();
    const today = seed(s);
    const low = seed(s, "low");
    const waiting = seed(s);
    s.setStage(waiting.person.id, "sent", DAY);
    const due = seed(s);
    s.setStage(due.person.id, "sent", "2026-11-10");
    const replied = seed(s);
    s.setStage(replied.person.id, "replied", DAY);
    const done = seed(s);
    s.setStage(done.person.id, "closed", DAY);
    const state = outreachState(s, NOW);
    const ids = (k: keyof typeof state) => (state[k] as { person: Person }[]).map(i => i.person.id);
    expect(ids("today")).toEqual([today.person.id]);
    expect(ids("checkFirst")).toEqual([low.person.id]);
    expect(ids("waiting")).toEqual([waiting.person.id]);
    expect(ids("followUps")).toEqual([due.person.id]);
    expect(ids("replied")).toEqual([replied.person.id]);
    expect(ids("done")).toEqual([done.person.id]);
    expect(state.sentToday).toBe(1);
    expect(state.day).toBe(DAY);
    expect(state.gmail).toBe(false);
  });

  it("changePerson to sent stamps today, and refuses an unknown stage or person", () => {
    const s = store();
    const { person } = seed(s, "low");
    expect(changePerson(person.id, { promote: true }, s, NOW)).toBeNull();
    expect(s.person(person.id)?.promoted).toBe(1);
    expect(changePerson(person.id, { stage: "sent" }, s, NOW)).toBeNull();
    expect(s.person(person.id)?.sent_on).toBe(DAY);
    expect(changePerson(person.id, { stage: "ghosted" }, s, NOW)).toContain("stage must be one of");
    expect(changePerson(999, { stage: "sent" }, s, NOW)).toBe("no such person");
  });

  it("dropLead hides its drafts", () => {
    const s = store();
    const { lead } = seed(s);
    expect(dropLead(lead.id, s)).toBeNull();
    expect(outreachState(s, NOW).today).toEqual([]);
    expect(dropLead(999, s)).toBe("no such lead");
  });

  it("replyBumps picks sent people whose address wrote", () => {
    const s = store();
    const a = seed(s).person,
      b = seed(s).person,
      c = seed(s).person;
    s.setStage(a.id, "sent", DAY);
    s.setStage(b.id, "followed_up", DAY);
    expect(replyBumps(s.people(), new Set([a.email, b.email, c.email]))).toEqual([a.id, b.id]);
  });

  it("skips the mail check without Gmail", async () => {
    const s = store();
    s.setStage(seed(s).person.id, "sent", DAY);
    expect(await syncOutreachMail(s)).toEqual({ checked: 0, replied: 0 });
  });
});
