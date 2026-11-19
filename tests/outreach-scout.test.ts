import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { config } from "../src/config";
import { outreachStore } from "../src/leads";
import { kvSet } from "../src/db";
import { backOff, clearBackoff } from "../src/limits";
import { closeQuiet, followUpTools, scoutPrompt, scoutTools, shouldFollowUp, shouldScout } from "../src/outreach-scout";
import { migrate } from "../src/schema";

const open: Database[] = [];
const store = () => {
  const db = new Database(":memory:");
  migrate(db);
  open.push(db);
  return outreachStore(db);
};
const saved = config.outreach;
afterEach(() => {
  for (const db of open.splice(0)) db.close();
  if (saved) config.outreach = saved;
  else delete config.outreach;
});

const NOW = new Date("2026-11-18T18:00:00Z");
const leadArgs = (over: Record<string, unknown> = {}) => ({
  kind: "seed",
  company: "Acme Power",
  domain: "acme.com",
  source_url: "https://news.example.com/acme",
  source_title: "Acme Power raises a seed round",
  posted_at: "2026-11-17T15:00:00Z",
  what_they_do: "DC fast chargers",
  why_fit: "Power electronics coursework",
  score: 80,
  ...over,
});
const personArgs = (leadId: number, over: Record<string, unknown> = {}) => ({
  lead_id: leadId,
  name: "Sam Lee",
  role: "CEO",
  email: "sam@acme.com",
  email_source: "public",
  email_confidence: "high",
  subject: "EE intern",
  body: "Hi Sam,\nSaw the round.\nI'm an EE student.\nCould I send my resume?\nSam",
  ...over,
});
const tools = (s = store(), fetchFn?: typeof fetch) => ({ s, t: scoutTools(s, () => NOW, fetchFn) });
const call = async (t: ReturnType<typeof scoutTools>, name: string, args: Record<string, unknown>) => {
  const tool = t[name];
  if (!tool) throw new Error(`no tool ${name}`);
  try {
    return await tool.handler(args);
  } catch (err) {
    return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
  }
};

describe("scout tools", () => {
  it("add_lead saves a fresh fitting lead", async () => {
    const { s, t } = tools();
    expect(await call(t, "add_lead", leadArgs())).toMatch(/^Lead \d+ saved/);
    expect(s.leads()).toHaveLength(1);
    expect(await call(t, "add_lead", leadArgs())).toContain("already");
  });

  it("add_lead returns the refusal for a stale post", async () => {
    const { s, t } = tools();
    expect(await call(t, "add_lead", leadArgs({ kind: "post", posted_at: "2026-11-15T15:00:00Z", likes: 10 }))).toContain("older than 1 day");
    expect(s.leads()).toHaveLength(0);
  });

  it("add_person refuses six lines", async () => {
    const { s, t } = tools();
    await call(t, "add_lead", leadArgs());
    const id = s.leads()[0]?.id ?? 0;
    expect(await call(t, "add_person", personArgs(id, { body: "1\n2\n3\n4\n5\n6" }))).toContain("6 lines");
    expect(await call(t, "add_person", personArgs(id))).toMatch(/^Draft \d+ saved/);
    expect(s.lead(id)?.status).toBe("active");
  });

  it("add_person refuses a fourth person and an unknown lead", async () => {
    const { s, t } = tools();
    await call(t, "add_lead", leadArgs());
    const id = s.leads()[0]?.id ?? 0;
    for (const n of ["a", "b", "c"]) expect(await call(t, "add_person", personArgs(id, { email: `${n}@acme.com` }))).toMatch(/saved/);
    expect(await call(t, "add_person", personArgs(id, { email: "d@acme.com" }))).toContain("three people");
    expect(await call(t, "add_person", personArgs(999))).toContain("no lead 999");
  });

  it("add_lead refuses a second open lead at the same company", async () => {
    const { t } = tools();
    expect(await call(t, "add_lead", leadArgs())).toMatch(/saved/);
    expect(
      await call(t, "add_lead", leadArgs({ source_url: "https://example.com/acme-post", kind: "post", likes: 3, posted_at: "2026-11-18T15:00:00Z" })),
    ).toContain("open already");
  });

  it("add_lead stops after leadsPerRun and once today's list is full", async () => {
    config.outreach = { ...saved, leadsPerRun: 1, perDay: 20 };
    const { t } = tools();
    expect(await call(t, "add_lead", leadArgs())).toMatch(/saved/);
    expect(await call(t, "add_lead", leadArgs({ company: "Other Co", source_url: "https://example.com/other" }))).toContain("run limit");
    config.outreach = { ...saved, leadsPerRun: 8, perDay: 1 };
    const full = tools();
    expect(await call(full.t, "add_lead", leadArgs())).toMatch(/saved/);
    const id = full.s.leads()[0]?.id ?? 0;
    expect(await call(full.t, "add_person", personArgs(id))).toMatch(/saved/);
    expect(await call(full.t, "add_lead", leadArgs({ company: "Other Co", source_url: "https://example.com/other" }))).toContain("today's list is full");
  });

  it("add_person refuses an address already on another lead", async () => {
    const { s, t } = tools();
    await call(t, "add_lead", leadArgs());
    await call(t, "add_lead", leadArgs({ company: "Other Co", source_url: "https://example.com/other" }));
    const [a, b] = s.leads().map(l => l.id);
    expect(await call(t, "add_person", personArgs(a ?? 0))).toMatch(/saved/);
    expect(await call(t, "add_person", personArgs(b ?? 0))).toContain("already");
  });

  it("find_email without a key returns the three guesses as low", async () => {
    config.outreach = { ...saved, hunterKey: null };
    const { t } = tools();
    const reply = await call(t, "find_email", { first: "Jane", last: "Founder", domain: "acme.com" });
    expect(reply).toContain("jane@acme.com, jane.founder@acme.com, jfounder@acme.com");
    expect(reply).toContain("low");
  });

  it("find_email does not call Hunter past hunterPerDay", async () => {
    config.outreach = { ...saved, hunterKey: "test-key", hunterPerDay: 1 };
    let calls = 0;
    const fake = (() => {
      calls++;
      return Promise.resolve(new Response(JSON.stringify({ data: { email: "jane@acme.com", score: 91 } })));
    }) as unknown as typeof fetch;
    const { s, t } = tools(store(), fake);
    await call(t, "add_lead", leadArgs({ source_url: `https://news.example.com/hunter-${Date.now()}` }));
    const lead_id = s.leads()[0]?.id ?? 0;
    expect(await call(t, "find_email", { first: "Jane", last: "Founder", domain: "acme.com", lead_id })).toContain("jane@acme.com (hunter, high)");
    expect(await call(t, "find_email", { first: "Jane", last: "Founder", domain: "acme.com", lead_id })).toContain("low");
    expect(calls).toBe(1);
  });

  it("the rendered prompt contains no TODO and names the humanizer rules", () => {
    const prompt = scoutPrompt(store());
    expect(prompt).not.toContain("{{");
    expect(prompt).toContain("Humanizer");
    expect(prompt).toContain("never open a linkedin.com");
  });
});

describe("follow-ups and when to run", () => {
  const sentPerson = (s: ReturnType<typeof store>, sentOn: string) => {
    const lead = s.addLead({
      kind: "seed",
      company: "Acme Power",
      domain: "acme.com",
      source_url: `https://news.example.com/${Math.random()}`,
      source_title: "",
      posted_at: new Date().toISOString(),
      likes: null,
      what_they_do: "",
      why_fit: "",
      score: 80,
    });
    if (!lead) throw new Error("no lead");
    const p = s.addPerson({ ...personArgs(lead.id), profile_url: null, email_source: "public", email_confidence: "high", drafted_on: sentOn } as never);
    if (!p) throw new Error("no person");
    s.setStage(p.id, "sent", sentOn);
    return p;
  };

  it("set_followup refuses four lines", async () => {
    const s = store();
    const p = sentPerson(s, "2026-11-10");
    const t = followUpTools(s);
    expect(await call(t, "set_followup", { person_id: p.id, body: "1\n2\n3\n4" })).toContain("4 lines");
    expect(await call(t, "set_followup", { person_id: p.id, body: "Hi Sam,\none more thing.\nSam" })).toBe("Saved.");
    expect(s.person(p.id)?.followup_body).toContain("one more thing");
  });

  it("shouldScout is false when minutes is 0", () => {
    config.outreach = { ...saved, minutes: 0 };
    kvSet("last.outreach", "1970-01-01T00:00:00Z");
    expect(shouldScout(store())).toBe(false);
  });

  it("shouldScout is false while perDay drafts wait", () => {
    config.outreach = { ...saved, minutes: 60, perDay: 1 };
    kvSet("last.outreach", "1970-01-01T00:00:00Z");
    const s = store();
    expect(shouldScout(s)).toBe(true);
    const lead = s.addLead({ ...leadArgs({ posted_at: new Date().toISOString() }), likes: null } as never);
    if (!lead) throw new Error("no lead");
    s.addPerson({ ...personArgs(lead.id), profile_url: null, drafted_on: "2026-11-18" } as never);
    expect(shouldScout(s)).toBe(false);
  });

  it("shouldFollowUp once per day", () => {
    config.outreach = { ...saved, minutes: 60, followUpDays: 5 };
    kvSet("last.outreachFollowUp", "");
    const s = store();
    sentPerson(s, "2026-01-01");
    expect(shouldFollowUp(s)).toBe(true);
    kvSet("last.outreachFollowUp", new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date()));
    expect(shouldFollowUp(s)).toBe(false);
  });

  it("closeQuiet marks a follow-up with no reply as no response", () => {
    config.outreach = { ...saved, followUpDays: 5 };
    const s = store();
    const p = sentPerson(s, "2026-01-01");
    s.setStage(p.id, "followed_up", "2026-01-06");
    expect(closeQuiet(s)).toBe(1);
    expect(s.person(p.id)?.stage).toBe("no_response");
  });

  it("does not start while backed off", () => {
    config.outreach = { ...saved, minutes: 60 };
    kvSet("last.outreach", "1970-01-01T00:00:00Z");
    kvSet("last.outreachFollowUp", "");
    const s = store();
    sentPerson(s, "2026-01-01");
    backOff();
    try {
      expect(shouldScout(s)).toBe(false);
      expect(shouldFollowUp(s)).toBe(false);
    } finally {
      kvSet("backoff.until", "0");
      clearBackoff();
    }
    expect(shouldScout(s)).toBe(true);
  });
});
