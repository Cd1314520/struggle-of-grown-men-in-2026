import { afterEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportBumps, parseCsv, parseDay, readExport, csvTable, unzip } from "../src/linkedin-export";
import { buildDrafts, shortJob, type DraftContact } from "../src/referral-drafts";
import {
  emailBumps,
  linkedInMailBumps,
  nextStep,
  parseReferralProfile,
  searchLinks,
  todayList,
  type PlanJob,
  type ReferralProfile,
} from "../src/referral-plan";
import { referralStore, type Contact } from "../src/referrals";
import { migrate } from "../src/schema";

const open: Database[] = [];
const memory = () => {
  const db = new Database(":memory:");
  migrate(db);
  open.push(db);
  return db;
};
afterEach(() => {
  for (const db of open.splice(0)) db.close();
});

// A filled-in referral.yml, as an owner might write it. Every fact a draft may use is here.
const PROFILE_YML = `
me:
  short: CS senior at Example University
  shortLocal: CS senior at Example University in Austin
  opener: I'm a CS senior at Example University.
  about: Sam Lee, B.S. Computer Science, Example University (May 2027).
interest: new grad software roles
areas:
  - name: Data
    titles: data|analytics
    hook: have built a data pipeline for the campus bus tracker
    fact: I built the pipeline behind the campus bus tracker, which handles 40k pings a day.
    resume: data.pdf
  - name: Software
    hook: am leading a four-person team building a course planner
    fact: I lead a team of four building a course planner that 300 students use.
    resume: resume.pdf
linkedin:
  school: example-university
  schoolName: Example University
  notesPerMonth: 3
  noteLimit: 200
daily:
  places:
    - name: Austin
      match: austin|round rock
      perDay: 2
    - name: Texas
      match: \\bTX\\b|texas|dallas
      perDay: 1
  people: 2
  prep: 1
  minFit: 70
  preferTitles: backend|platform
watchlist:
  - name: Quiet Co
    place: Austin
    careers: https://quiet.example/careers
`;
const profile = (): ReferralProfile => {
  const { profile: p, problems } = parseReferralProfile(PROFILE_YML);
  expect(problems).toEqual([]);
  return p;
};

describe("profile/referral.yml", () => {
  it("ships as an example that names what is left to fill in, and drafts nothing until then", () => {
    const example = readFileSync(join(import.meta.dir, "..", "profile.example", "referral.yml"), "utf8");
    const { profile: p, problems } = parseReferralProfile(example);
    expect(problems).toContain("referral.yml still contains TODO-FILL");
    // The rest of it reads: the daily list works before the facts are written.
    expect(p.daily.companies).toBe(3);
    expect(p.linkedin.noteLimit).toBe(200);
    expect(example).not.toMatch(/permanent resident|green card/i);
  });

  it("reads places, areas and the daily numbers", () => {
    const p = profile();
    expect(p.areas.map(a => a.name)).toEqual(["Data", "Software"]);
    expect(p.daily.places.map(x => [x.name, x.perDay])).toEqual([
      ["Austin", 2],
      ["Texas", 1],
    ]);
    expect(p.me.alumniIntro).toBe("fellow alum here (CS senior at Example University)");
    expect(parseReferralProfile("areas: [{name: X}]").problems).toContain("areas: X needs a hook and a fact");
  });
});

describe("the referral store", () => {
  it("adds contacts, stamps the day of each stage the owner sets, and counts the month's notes", () => {
    const store = referralStore(memory());
    const id = store.addContact({ name: "Ana Diaz", company: "Acme, Inc.", relation: "engineer", added_on: "2026-10-01", email: "Ana@Acme.example" });
    expect(store.contact(id)).toMatchObject({ stage: "drafted", company_key: "acme", email: "ana@acme.example", with_note: 0 });
    store.setStage(id, "requested", "2026-10-02", true);
    expect(store.contact(id)).toMatchObject({ stage: "requested", requested_on: "2026-10-02", with_note: 1 });
    expect(store.notesUsed("2026-10")).toBe(1);
    expect(store.notesUsed("2026-11")).toBe(0);
    // Already a connection: no invite, connected from the day added.
    const friend = store.addContact({ name: "Bo", company: "Acme", relation: "connection", added_on: "2026-10-03" });
    expect(store.contact(friend)).toMatchObject({ stage: "connected", connected_on: "2026-10-03" });
    expect(() => store.addContact({ name: " ", company: "Acme", relation: "engineer", added_on: "2026-10-01" })).toThrow(/name and a company/);
  });

  it("moves a contact forward only on what an export or the mail shows, never out of a finished stage", () => {
    const store = referralStore(memory());
    const id = store.addContact({ name: "Ana", company: "Acme", relation: "engineer", added_on: "2026-10-01" });
    expect(store.bump(id, "messaged", "2026-10-05")).toBe(true);
    expect(store.bump(id, "connected", "2026-10-04")).toBe(false);
    expect(store.contact(id)).toMatchObject({ stage: "messaged", messaged_on: "2026-10-05", connected_on: null });
    store.setStage(id, "declined", "2026-10-06");
    expect(store.bump(id, "replied", "2026-10-07")).toBe(false);
    expect(store.contact(id)).toMatchObject({ stage: "declined", closed_on: "2026-10-06" });
  });

  it("replaces the network with each export and keys people by profile", () => {
    const store = referralStore(memory());
    store.replaceConnections([
      { name: "Ana Diaz", url: "https://www.linkedin.com/in/Ana-Diaz/", company: "Acme", position: "Engineer", connected_on: "2026-01-01" },
      { name: "", url: null, company: "", position: "", connected_on: null },
    ]);
    expect(store.connections().map(c => c.key)).toEqual(["ana-diaz"]);
    expect(store.replaceConnections([{ name: "Bo Chen", url: null, company: "Initech", position: "", connected_on: null }])).toBe(1);
    expect(store.connections().map(c => [c.key, c.company_key])).toEqual([["name:bo chen", "initech"]]);
  });

  it("takes the same InternScouter file once", () => {
    const store = referralStore(memory());
    store.recordImport({ kind: "internscouter", file: "outreach.json", fingerprint: "abc", exported_on: null, connections: 0, updates: 0 });
    expect(store.imported("abc")).toBe(true);
    expect(() => {
      store.recordImport({ kind: "internscouter", file: "outreach.json", fingerprint: "abc", exported_on: null, connections: 0, updates: 0 });
    }).toThrow();
    // Exports may be read again.
    store.recordImport({ kind: "export", file: "a.zip", fingerprint: "x", exported_on: "2026-10-01", connections: 1, updates: 0 });
    store.recordImport({ kind: "export", file: "a.zip", fingerprint: "x", exported_on: "2026-10-20", connections: 1, updates: 0 });
    expect(store.lastExport()?.exported_on).toBe("2026-10-20");
  });
});

// ---- next steps and the daily list

const contact = (over: Partial<Contact>): Contact => ({
  id: 1,
  name: "Ana Diaz",
  title: "",
  company: "Acme",
  company_key: "acme",
  profile_url: null,
  email: null,
  relation: "engineer",
  stage: "drafted",
  job_id: null,
  job_title: null,
  job_url: null,
  area: null,
  with_note: 0,
  notes: "",
  added_on: "2026-10-01",
  requested_on: null,
  connected_on: null,
  messaged_on: null,
  followed_up_on: null,
  replied_on: null,
  referred_on: null,
  closed_on: null,
  legacy_id: null,
  created_at: "",
  updated_at: "",
  ...over,
});

describe("a contact's next step", () => {
  const p = { followUpDays: 7, inviteStaleDays: 21 };
  it("follows the stage, with the one follow-up a week after the message", () => {
    expect(nextStep(contact({}), "2026-10-29", p)).toMatchObject({ kind: "send_invite", due: "2026-10-29" });
    expect(nextStep(contact({ email: "a@acme.example" }), "2026-10-29", p).kind).toBe("send_email");
    expect(nextStep(contact({ stage: "requested", requested_on: "2026-10-01" }), "2026-10-29", p)).toMatchObject({ kind: "wait_accept", due: "2026-10-22" });
    expect(nextStep(contact({ stage: "messaged", messaged_on: "2026-10-25" }), "2026-10-29", p)).toMatchObject({ kind: "follow_up", due: "2026-11-01" });
    expect(nextStep(contact({ stage: "closed" }), "2026-10-29", p)).toMatchObject({ kind: "none", due: null });
  });
});

const job = (id: number, over: Partial<PlanJob>): PlanJob => ({
  id,
  company: `Co ${id}`,
  title: "Software Engineer",
  location: "Austin, TX",
  url: `https://ats.example/${id}`,
  status: "submitted",
  score: 80,
  sentOn: "2026-10-27",
  ...over,
});

describe("the daily list", () => {
  const today = "2026-10-29";
  const base = { today, profile: profile(), contacts: [] as Contact[], connections: [], suggested: new Map<string, string>() };

  it("names interviewing employers first, then each place's quota, and never one outside every place", () => {
    const list = todayList({
      ...base,
      jobs: [
        job(1, { company: "Interviewer", status: "interview" }),
        job(2, { company: "Austin A", sentOn: "2026-10-28" }),
        job(3, { company: "Austin B", sentOn: "2026-09-01" }),
        job(4, { company: "Austin C", status: "approved", sentOn: null }),
        job(5, { company: "Dallas D", location: "Dallas, TX" }),
        job(6, { company: "Far Away", location: "Seattle, WA" }),
        job(7, { company: "Unsure", status: "awaiting_approval", score: 50, sentOn: null }),
      ],
    });
    expect(list.companies.map(c => [c.company, c.kind, c.place])).toEqual([
      ["Interviewer", "prep", "Austin"],
      ["Austin A", "applied", "Austin"],
      ["Austin B", "applied", "Austin"],
      ["Dallas D", "applied", "Texas"],
    ]);
    expect(list.companies[0]?.why).toMatch(/no referral ask/);
    expect(list.suggested).toEqual(["interviewer", "austina", "austinb", "dallasd"]);
  });

  it("holds still through the day, rests an employer after, and leaves one with an open conversation or a rejection", () => {
    const jobs = [
      job(1, { company: "Alpha" }),
      job(2, { company: "Beta" }),
      job(3, { company: "Gamma" }),
      job(4, { company: "Delta", status: "rejected_by_company" }),
    ];
    const first = todayList({ ...base, jobs });
    // Austin's two, then the rest of the places fill the third.
    expect(first.companies.map(c => c.company)).toEqual(["Alpha", "Beta", "Gamma"]);
    const suggested = new Map(first.suggested.map(k => [k, today]));
    expect(todayList({ ...base, jobs, suggested }).companies.map(c => c.company)).toEqual(first.companies.map(c => c.company));
    // The next day the ones named yesterday rest, and the watchlist has its turn.
    const tomorrow = todayList({ ...base, today: "2026-10-30", jobs, suggested });
    expect(tomorrow.companies.map(c => [c.company, c.kind, c.job.careers])).toEqual([["Quiet Co", "watchlist", "https://quiet.example/careers"]]);
    // A conversation open there: not named.
    const busy = todayList({ ...base, jobs, contacts: [contact({ company: "Alpha", company_key: "alpha", stage: "messaged" })] });
    expect(busy.companies.map(c => c.company)).not.toContain("Alpha");
    expect(first.companies.map(c => c.company)).not.toContain("Delta");
  });

  it("lists people the owner knows at those employers first, one per employer, preferred titles first", () => {
    const connections = [
      {
        key: "x",
        name: "Sales Sam",
        url: "https://www.linkedin.com/in/sam",
        company: "Alpha Inc",
        company_key: "alpha",
        position: "Account Executive",
        connected_on: null,
      },
      {
        key: "y",
        name: "Pat Backend",
        url: "https://www.linkedin.com/in/pat",
        company: "Alpha",
        company_key: "alpha",
        position: "Backend Engineer",
        connected_on: null,
      },
      {
        key: "z",
        name: "Far Fran",
        url: "https://www.linkedin.com/in/fran",
        company: "Far Away",
        company_key: "faraway",
        position: "Engineer",
        connected_on: null,
      },
    ];
    const list = todayList({ ...base, jobs: [job(1, { company: "Alpha" }), job(2, { company: "Far Away", location: "Seattle" })], connections });
    expect(list.people.map(b => b.person.name)).toEqual(["Pat Backend"]);
    expect(list.peopleTotal).toBe(2);
    // Known there: no cold search for Alpha today.
    expect(list.companies.map(c => c.company)).not.toContain("Alpha");
    expect(list.suggested).toContain("bridge:pat");
    // Someone already a contact is not suggested again.
    const again = todayList({
      ...base,
      jobs: [job(1, { company: "Alpha" })],
      connections,
      contacts: [contact({ profile_url: "https://www.linkedin.com/in/pat" })],
    });
    expect(again.people.map(b => b.person.name)).toEqual(["Sales Sam"]);
  });

  it("lists contacts whose next step is due, the overdue first", () => {
    const list = todayList({
      ...base,
      jobs: [],
      contacts: [
        contact({ id: 1, stage: "messaged", messaged_on: "2026-10-25" }),
        contact({ id: 2, stage: "messaged", messaged_on: "2026-10-20" }),
        contact({ id: 3, stage: "connected" }),
      ],
    });
    expect(list.due.map(d => [d.contact.id, d.overdue])).toEqual([
      [2, true],
      [3, false],
    ]);
  });

  it("builds search links for the owner's own browser, and nothing it fetches", () => {
    const links = searchLinks("Acme (US)", profile(), "Austin");
    expect(links.map(l => l.label)).toEqual(["Managers", "Alumni", "Engineers", "Recruiters", "Google", "Email format"]);
    expect(links[0]?.url).toBe("https://www.linkedin.com/search/results/people/?keywords=Acme%20engineering%20manager%20Austin");
  });
});

// ---- drafts

describe("drafts", () => {
  const sign = { name: "Sam Lee", linkedin: "https://linkedin.com/in/samlee" };
  const draft = (over: Partial<DraftContact>) =>
    buildDrafts(
      {
        name: "Ana Diaz",
        company: "Acme",
        relation: "engineer",
        stage: "drafted",
        email: null,
        area: null,
        job: { title: "Data Engineer Intern (Summer 2027)", url: "https://ats.example/1", applied: true, inProcess: false },
        ...over,
      },
      profile(),
      sign,
    );

  it("keeps the connection note within LinkedIn's limit, and uses the facts of the area the job fits", () => {
    const d = draft({});
    expect(d?.note.length).toBeLessThanOrEqual(200);
    expect(d?.note).toStartWith("Hi Ana, I'm a CS senior at Example University. I applied to Acme's Data Engineer internship");
    expect(d?.message).toContain("I built the pipeline behind the campus bus tracker");
    expect(d?.message).toContain("(https://ats.example/1)");
    expect(d?.packet).toContain("- Resume: attached (data.pdf)");
    expect(d?.email).toBeNull();
  });

  it("says only what referral.yml says: every sentence of a message comes from the owner's facts or fixed wording", () => {
    const d = draft({ area: "Software", job: { title: "Platform Engineer", url: null, applied: false, inProcess: false } });
    expect(d?.message).toContain("I lead a team of four building a course planner that 300 students use.");
    expect(d?.message).not.toContain("bus tracker");
    expect(d?.note).toContain("I'm applying to Acme's Platform Engineer role");
  });

  it("writes to a connection without an invite, to a manager by email, and about the employer when there is no job", () => {
    expect(draft({ relation: "connection" })?.note).toBe("");
    expect(draft({ relation: "connection" })?.message).toStartWith("Hi Ana, hope you're doing well! I saw you're at Acme now.");
    const mail = draft({ relation: "manager", email: "ana@acme.example" })?.email;
    expect(mail?.subject).toBe("CS senior at Example University interested in Acme's Data Engineer internship");
    expect(mail?.body).toEndWith("Thanks,\nSam Lee\nhttps://linkedin.com/in/samlee");
    const general = draft({ job: null });
    expect(general?.note).toContain("I'm interested in Acme's new grad software roles");
    expect(general?.message).toContain("15 minutes");
    expect(draft({ job: { title: "Data Engineer", url: null, applied: true, inProcess: true } })?.message).toContain("interview process");
  });

  it("shortens a posting's title the way a person would say it", () => {
    expect(shortJob("2027 Summer Intern - Embedded Software (Hybrid)")).toBe("Embedded Software");
    expect(shortJob("Co-op, Electrical Engineering / Power Systems and Controls Department")).toBe("Electrical Engineering Power Systems and");
  });
});

// ---- the LinkedIn export

// A zip built the way a zip tool writes one: local headers, deflated data, the central directory.
function zip(files: Record<string, string>): Uint8Array {
  const parts: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = deflateRawSync(Buffer.from(text)),
      nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(text.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(data.length, 20);
    dir.writeUInt32LE(text.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    parts.push(local, nameBytes, data);
    central.push(dir, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dirBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, dirBytes, end]));
}

const CONNECTIONS = `Notes:
"When exporting your connection data, you may notice that some of the email addresses are missing, as described here: https://example.invalid"

First Name,Last Name,URL,Email Address,Company,Position,Connected On
Ana,Diaz,https://www.linkedin.com/in/ana-diaz,,"Acme, Inc.",Backend Engineer,23 Oct 2026
Bo,Chen,https://www.linkedin.com/in/bo-chen,,Initech,"Engineer, ""Platform""",01 Feb 2025
`;
const INVITATIONS = `From,To,Sent At,Message,Direction,inviterProfileUrl,inviteeProfileUrl
Sam Lee,Cy Park,"10/20/26, 3:15 PM","Hi Cy, a note",OUTGOING,https://www.linkedin.com/in/samlee,https://www.linkedin.com/in/cy-park
`;
const MESSAGES = `CONVERSATION ID,CONVERSATION TITLE,FROM,SENDER PROFILE URL,TO,RECIPIENT PROFILE URLS,DATE,SUBJECT,CONTENT,FOLDER
1,,Sam Lee,https://www.linkedin.com/in/samlee,Ana Diaz,https://www.linkedin.com/in/ana-diaz,2026-10-24 15:15:00 UTC,,"Hi Ana,
thanks for connecting",INBOX
1,,Sam Lee,https://www.linkedin.com/in/samlee,Ana Diaz,https://www.linkedin.com/in/ana-diaz,2026-10-27 15:15:00 UTC,,bumping this,INBOX
1,,Ana Diaz,https://www.linkedin.com/in/ana-diaz,Sam Lee,https://www.linkedin.com/in/samlee,2026-10-28 09:00:00 UTC,,Happy to refer you,INBOX
`;

describe("the LinkedIn export", () => {
  it("parses CSV with quoted commas, quotes and line breaks, and finds the table under LinkedIn's preamble", () => {
    expect(parseCsv('a,"b, c","d ""e""",\n"x\ny",z')).toEqual([
      ["a", "b, c", 'd "e"', ""],
      ["x\ny", "z"],
    ]);
    const rows = csvTable(CONNECTIONS, "first name");
    expect(rows.map(r => [r["first name"], r["company"], r["position"]])).toEqual([
      ["Ana", "Acme, Inc.", "Backend Engineer"],
      ["Bo", "Initech", 'Engineer, "Platform"'],
    ]);
  });

  it("reads LinkedIn's date formats", () => {
    expect(parseDay("23 Oct 2026")).toBe("2026-10-23");
    expect(parseDay("10/20/26, 3:15 PM")).toBe("2026-10-20");
    expect(parseDay("2026-10-24 15:15:00 UTC")).toBe("2026-10-24");
    expect(parseDay("soon")).toBe("");
  });

  it("reads the zip as downloaded, or Connections.csv on its own", () => {
    const bytes = zip({ "Connections.csv": CONNECTIONS, "Invitations.csv": INVITATIONS, "messages.csv": MESSAGES, "Profile.csv": "x" });
    expect([...unzip(bytes).keys()]).toEqual(["Connections.csv", "Invitations.csv", "messages.csv", "Profile.csv"]);
    const ex = readExport("Basic_LinkedInDataExport_10-24-2026.zip", bytes);
    expect(ex.connections?.map(c => [c.name, c.company, c.connected_on])).toEqual([
      ["Ana Diaz", "Acme, Inc.", "2026-10-23"],
      ["Bo Chen", "Initech", "2025-02-01"],
    ]);
    expect(ex.invitations).toEqual([{ to: "Cy Park", url: "https://www.linkedin.com/in/cy-park", sentOn: "2026-10-20", withNote: true, outgoing: true }]);
    expect(ex.messages).toHaveLength(3);
    expect(readExport("Connections.csv", new TextEncoder().encode(CONNECTIONS)).connections).toHaveLength(2);
    expect(() => readExport("notes.txt", new TextEncoder().encode("hello"))).toThrow(/neither a LinkedIn export/);
  });

  it("moves contacts on from what the export shows: invites, accepts, the owner's messages and their replies", () => {
    const ex = readExport("export.zip", zip({ "Connections.csv": CONNECTIONS, "Invitations.csv": INVITATIONS, "messages.csv": MESSAGES }));
    const bumps = exportBumps(ex, [
      { id: 1, name: "Ana Diaz", profile_url: "https://www.linkedin.com/in/ana-diaz/" },
      { id: 2, name: "cy  park", profile_url: null },
    ]);
    expect(bumps.map(b => [b.contactId, b.stage, b.day, b.withNote ?? null])).toEqual([
      [2, "requested", "2026-10-20", true],
      [1, "connected", "2026-10-23", null],
      [1, "messaged", "2026-10-24", null],
      [1, "followed_up", "2026-10-27", null],
      [1, "replied", "2026-10-28", null],
    ]);
  });
});

describe("the owner's mail, read for contacts", () => {
  const tz = "America/Chicago";
  it("reads LinkedIn's notifications about a contact", () => {
    const bumps = linkedInMailBumps(
      "Ana Diaz",
      [
        { from: "LinkedIn <invitations@linkedin.com>", subject: "Ana Diaz accepted your invitation", date: "Sat, 24 Oct 2026 14:00:00 +0000" },
        { from: "Ana Diaz via LinkedIn <messages-noreply@linkedin.com>", subject: "Ana Diaz sent you a message", date: "Wed, 28 Oct 2026 02:00:00 +0000" },
        { from: "LinkedIn <jobs@linkedin.com>", subject: "Jobs for you", date: "Wed, 28 Oct 2026 02:00:00 +0000" },
      ],
      tz,
    );
    // The second arrived on the 27th in the owner's time zone.
    expect(bumps).toEqual([
      { stage: "connected", day: "2026-10-24" },
      { stage: "replied", day: "2026-10-27" },
    ]);
  });

  it("reads mail with a contact since they were added, auto-replies aside", () => {
    const m = (date: string, subject = "Hello") => ({ from: "x", subject, date });
    expect(
      emailBumps(
        "2026-10-10",
        [m("Mon, 05 Oct 2026 15:00:00 +0000"), m("Mon, 12 Oct 2026 15:00:00 +0000"), m("Mon, 19 Oct 2026 15:00:00 +0000")],
        [m("Tue, 13 Oct 2026 15:00:00 +0000", "Automatic reply: out of office"), m("Wed, 21 Oct 2026 15:00:00 +0000", "Re: Hello")],
        tz,
      ),
    ).toEqual([
      { stage: "messaged", day: "2026-10-12" },
      { stage: "followed_up", day: "2026-10-19" },
      { stage: "replied", day: "2026-10-21" },
    ]);
  });
});
