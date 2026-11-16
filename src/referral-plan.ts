// Who to contact today, and what each contact's next step is. Deterministic: the same applications,
// contacts, connections and earlier suggestions give the same list. Pure, so it is tested without a
// database; src/outreach.ts feeds it.
//
// The daily list has three parts, in the order they are worth the owner's time:
//   due       contacts whose next step falls today or earlier (send the message, the one follow-up, ...)
//   people    connections already in the owner's network who work at an employer they are applying to:
//             the warmest asks there are. One per employer a day; the next one there comes another day.
//   companies employers worth a cold message today: those the owner is interviewing with first (to talk
//             to someone on the team, not to ask for a referral), then by place, then by how recent and
//             how good the application is. An employer is not named again within resuggestDays, and not
//             while a conversation there is open.
import YAML from "yaml";
import { companyKey } from "./company-key";
import { connectionKey, DONE, personKey, profileId, type Connection, type Contact } from "./referrals";

export const PLACEHOLDER = "TODO-FILL";

// ---- profile/referral.yml

export interface Area {
  name: string;
  titles: RegExp | null; // job titles this area's facts fit; null: any
  hook: string; // fits a 200-character note; starts with "have" or "am"
  fact: string; // one or two sentences for the message after they accept
  resume: string | null; // the file the referral packet says is attached
}
export interface Place {
  name: string;
  match: RegExp;
  perDay: number;
}
export interface ReferralProfile {
  me: { short: string; shortLocal: string; alumniIntro: string; opener: string; about: string };
  interest: string; // what the owner is after where there is no opening: "Summer 2027 internships"
  areas: Area[];
  linkedin: { school: string; schoolName: string; notesPerMonth: number; noteLimit: number };
  daily: { places: Place[]; companies: number; people: number; prep: number; minFit: number; preferTitles: RegExp | null };
  watchlist: { name: string; place: string; careers: string }[];
  followUpDays: number;
  inviteStaleDays: number;
  resuggestDays: number;
  exportEveryDays: number;
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const num = (v: unknown, dflt: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : dflt);

// Reads referral.yml. `problems` says what stops drafting (a placeholder left, no area): drafts are built
// only from what the owner wrote, so none are shown until those are settled. The daily list works regardless.
export function parseReferralProfile(text: string): { profile: ReferralProfile; problems: string[] } {
  const problems: string[] = [];
  let raw: Record<string, unknown> = {};
  try {
    raw = rec(YAML.parse(text));
  } catch (err) {
    problems.push(`referral.yml is not valid YAML: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!text.trim()) problems.push("referral.yml is empty");
  if (text.includes(PLACEHOLDER)) problems.push(`referral.yml still contains ${PLACEHOLDER}`);
  const regex = (v: unknown, where: string) => {
    const s = str(v);
    if (!s) return null;
    try {
      return new RegExp(s, "i");
    } catch {
      problems.push(`${where}: not a regular expression: ${s}`);
      return null;
    }
  };
  const me = rec(raw["me"]);
  const short = str(me["short"]);
  const areas = (Array.isArray(raw["areas"]) ? raw["areas"] : []).map(rec).flatMap((a, i): Area[] => {
    const name = str(a["name"]) || `area ${i + 1}`;
    const hook = str(a["hook"]),
      fact = str(a["fact"]);
    if (!hook || !fact) {
      problems.push(`areas: ${name} needs a hook and a fact`);
      return [];
    }
    return [{ name, titles: regex(a["titles"], `areas: ${name}: titles`), hook, fact, resume: str(a["resume"]) || null }];
  });
  if (!areas.length) problems.push("referral.yml has no areas: add at least one with a hook and a fact");
  if (!short) problems.push("referral.yml: me.short is required");
  const linkedin = rec(raw["linkedin"]);
  const daily = rec(raw["daily"]);
  const places = (Array.isArray(daily["places"]) ? daily["places"] : []).map(rec).flatMap((p): Place[] => {
    const name = str(p["name"]),
      match = regex(p["match"], `daily.places: ${name}`);
    return name && match ? [{ name, match, perDay: num(p["perDay"], 1) }] : [];
  });
  return {
    problems,
    profile: {
      me: {
        short,
        shortLocal: str(me["shortLocal"]) || short,
        alumniIntro: str(me["alumniIntro"]) || `fellow alum here (${short})`,
        opener: str(me["opener"]) || `I'm a ${short}.`,
        about: str(me["about"]),
      },
      interest: str(raw["interest"]) || "openings",
      areas,
      linkedin: {
        school: str(linkedin["school"]),
        schoolName: str(linkedin["schoolName"]),
        notesPerMonth: num(linkedin["notesPerMonth"], 3),
        noteLimit: num(linkedin["noteLimit"], 200) || 200,
      },
      daily: {
        places,
        companies: num(daily["companies"], 3),
        people: num(daily["people"], 3),
        prep: num(daily["prep"], 2),
        minFit: num(daily["minFit"], 0),
        preferTitles: regex(daily["preferTitles"], "daily.preferTitles"),
      },
      watchlist: (Array.isArray(raw["watchlist"]) ? raw["watchlist"] : [])
        .map(rec)
        .map(w => ({ name: str(w["name"]), place: str(w["place"]), careers: str(w["careers"]) }))
        .filter(w => w.name),
      followUpDays: num(raw["followUpDays"], 7) || 7,
      inviteStaleDays: num(raw["inviteStaleDays"], 21) || 21,
      resuggestDays: num(raw["resuggestDays"], 7),
      exportEveryDays: num(raw["exportEveryDays"], 30) || 30,
    },
  };
}

// The facts to draft from: the area the contact names, else the first whose titles fit the job, else the first.
export function areaFor(profile: ReferralProfile, jobTitle: string | null, named: string | null): Area | null {
  return (
    profile.areas.find(a => a.name.toLowerCase() === named?.toLowerCase()) ??
    profile.areas.find(a => (jobTitle ? (a.titles?.test(jobTitle) ?? false) : false)) ??
    profile.areas.find(a => !a.titles) ??
    profile.areas[0] ??
    null
  );
}

// ---- days

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
// Today in a time zone, as YYYY-MM-DD.
export const dayIn = (timeZone: string, at = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

// ---- a contact's next step

export type StepKind = "send_invite" | "send_email" | "wait_accept" | "send_message" | "follow_up" | "close" | "reply" | "thank" | "none";
export interface ContactStep {
  kind: StepKind;
  due: string | null; // the day it falls due; null for none
  what: string;
}

export function nextStep(
  c: Pick<Contact, "stage" | "email" | DayKeys>,
  today: string,
  p: Pick<ReferralProfile, "followUpDays" | "inviteStaleDays">,
): ContactStep {
  const plus = (day: string | null, n: number) => (day ? addDays(day, n) : today);
  switch (c.stage) {
    case "drafted":
      return c.email
        ? { kind: "send_email", due: today, what: "Send the email from your mailbox; it shows as messaged once it is there" }
        : { kind: "send_invite", due: today, what: "Send the connection request: the note, or no note and the message after they accept" };
    case "requested":
      return { kind: "wait_accept", due: plus(c.requested_on, p.inviteStaleDays), what: "Not accepted yet: if it is still pending, try someone else there" };
    case "connected":
      return { kind: "send_message", due: today, what: "Send the message" };
    case "messaged":
      return { kind: "follow_up", due: plus(c.messaged_on, p.followUpDays), what: "Send the one follow-up" };
    case "followed_up":
      return { kind: "close", due: plus(c.followed_up_on, p.followUpDays), what: "No reply: mark it no response and move on" };
    case "replied":
      return { kind: "reply", due: today, what: "Reply: send the referral packet, or thank them" };
    case "referred":
      return { kind: "thank", due: null, what: "Thank them, and tell them how it turns out" };
    default:
      return { kind: "none", due: null, what: "" };
  }
}
type DayKeys = "requested_on" | "messaged_on" | "followed_up_on";

// ---- search links: the owner opens them in their own browser. Nothing here fetches anything.

export function searchLinks(company: string, profile: ReferralProfile, place: string | null): { label: string; url: string }[] {
  const co = company.replace(/\s*\(.*?\)/g, "").trim();
  const people = (kw: string) => `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(kw)}`;
  const google = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;
  const { school, schoolName } = profile.linkedin;
  const where = place && place !== ANYWHERE ? ` ${place}` : "";
  return [
    { label: "Managers", url: people(`${co} engineering manager${where}`) },
    ...(school ? [{ label: "Alumni", url: `https://www.linkedin.com/school/${encodeURIComponent(school)}/people/?keywords=${encodeURIComponent(co)}` }] : []),
    ...(schoolName ? [{ label: "Engineers", url: people(`${co} "${schoolName}" engineer`) }] : []),
    { label: "Recruiters", url: people(`${co} university recruiter`) },
    ...(schoolName ? [{ label: "Google", url: google(`site:linkedin.com/in "${schoolName}" "${co}" engineer`) }] : []),
    { label: "Email format", url: google(`"${co}" email format`) },
  ];
}

// ---- the daily list

export const ANYWHERE = "Anywhere";
const ENGINEER = /engineer|\bintern\b|co-?op|technician|developer|scientist|designer|\bR&D\b|hardware|firmware|embedded/i;

// An application, or an employer on the watchlist, as the list weighs it.
export interface PlanJob {
  id: number | null; // null: a watchlist employer
  company: string;
  title: string;
  location: string | null;
  url: string | null;
  status: string; // the job's status; "watchlist" for a watchlist employer
  score: number | null;
  sentOn: string | null; // the day it was submitted
  careers?: string | null;
  place?: string | null; // a watchlist employer's place, as written
}

export type PickKind = "prep" | "applied" | "queue" | "watchlist";
export interface CompanyPick {
  key: string; // the employer's company key
  kind: PickKind;
  company: string;
  place: string | null; // the place it counts under, null when outside every place
  job: PlanJob;
  why: string;
}
export interface Bridge {
  key: string; // the connection's key
  person: Connection;
  pick: CompanyPick; // the employer and the application it is about
}
export interface DueItem {
  contact: Contact;
  step: ContactStep;
  overdue: boolean;
}
export interface TodayList {
  day: string;
  due: DueItem[];
  people: Bridge[];
  companies: CompanyPick[];
  peopleTotal: number; // connections at employers being applied to, before the daily cut
  suggested: string[]; // keys to record as suggested today
}

const SENT = ["submitted", "interview", "offer", "rejected_by_company", "withdrawn"];
const ENDED = ["rejected_by_company", "withdrawn"];
// Same employer: the same key, or one inside the other when both are long enough to mean it.
const sameEmployer = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a)));

export function placeOf(location: string | null | undefined, profile: ReferralProfile): string | null {
  if (!profile.daily.places.length) return ANYWHERE;
  return profile.daily.places.find(p => p.match.test(location ?? ""))?.name ?? null;
}

function why(p: Omit<CompanyPick, "why">): string {
  const fit = p.job.score !== null ? `, fit ${p.job.score}` : "";
  if (p.kind === "prep") return `In process for ${p.job.title}: talk to someone on the team before the next step (no referral ask)${fit}`;
  if (p.kind === "applied") return `Applied${p.job.sentOn ? ` ${p.job.sentOn}` : ""}: ${p.job.title}${fit}`;
  if (p.kind === "watchlist") return "On your watchlist with no opening you are applying to: ask about the team and when roles open";
  return `Applying: ${p.job.title}${fit}`;
}

export function todayList(input: {
  today: string;
  profile: ReferralProfile;
  jobs: readonly PlanJob[];
  contacts: readonly Contact[];
  connections: readonly Connection[];
  suggested: ReadonlyMap<string, string>;
}): TodayList {
  const { today, profile, contacts, connections, suggested } = input;
  const recent = addDays(today, -profile.resuggestDays);
  const week = addDays(today, -7);
  const lastOf = (key: string) => suggested.get(key) ?? "";
  // Named today: listed again first, so the list holds still through the day.
  const resting = (key: string) => {
    const last = lastOf(key);
    return last !== today && last > recent;
  };

  // Employers with a conversation open are left alone until it finishes.
  const active = new Set(contacts.filter(c => !["declined", "no_response", "closed"].includes(c.stage)).map(c => c.company_key));
  const all: PlanJob[] = [
    ...input.jobs,
    ...profile.watchlist.map(w => ({
      id: null,
      company: w.name,
      title: "",
      location: w.place,
      url: null,
      status: "watchlist",
      score: null,
      sentOn: null,
      careers: w.careers || null,
      place: w.place,
    })),
  ];
  // An employer that turned the owner down, with nothing else open there, is not asked.
  const statuses = new Map<string, Set<string>>();
  for (const j of all) if (SENT.includes(j.status)) statuses.set(companyKey(j.company), (statuses.get(companyKey(j.company)) ?? new Set()).add(j.status));
  const turnedDown = new Set([...statuses].filter(([, s]) => [...s].some(x => ENDED.includes(x)) && ![...s].some(x => !ENDED.includes(x))).map(([k]) => k));

  type Ranked = Omit<CompanyPick, "why"> & { rank: (number | boolean)[]; src: number; loc: number };
  const placeRank = (place: string | null) =>
    place === null
      ? profile.daily.places.length + 1
      : Math.max(
          0,
          profile.daily.places.findIndex(p => p.name === place),
        );
  const best = new Map<string, Ranked>(); // the best reason to contact each employer, contacted or not
  const byCo = new Map<string, Ranked>();
  const prep = new Map<string, Ranked>();
  for (const j of all) {
    const key = companyKey(j.company);
    if (!key || turnedDown.has(key) || ENDED.includes(j.status)) continue;
    const kind: PickKind = j.status === "interview" ? "prep" : SENT.includes(j.status) ? "applied" : j.status === "watchlist" ? "watchlist" : "queue";
    if (j.status === "awaiting_approval" && (j.score ?? 0) < profile.daily.minFit) continue;
    const src = kind === "applied" || kind === "prep" ? ((j.sentOn ?? "") >= week ? 0 : 1) : kind === "queue" ? 2 : 4;
    const place = placeOf(j.location, profile);
    const loc = placeRank(place);
    const r: Ranked = { key, kind, company: j.company, place, job: j, src, loc, rank: [lastOf(key) !== today, src, -(j.score ?? 0)] };
    const known = best.get(key);
    if (!known || src < known.src || (src === known.src && (j.score ?? 0) > (known.job.score ?? 0)))
      best.set(key, { ...r, loc: Math.min(loc, known?.loc ?? loc) });
    else known.loc = Math.min(known.loc, loc);
    if (active.has(key) || resting(key)) continue;
    if (kind === "prep") {
      if (!prep.has(key)) prep.set(key, r);
      continue;
    }
    const held = byCo.get(key);
    if (!held || compare(r.rank, held.rank) < 0) byCo.set(key, held && !r.place ? { ...r, place: held.place } : r);
  }

  // People the owner already knows at an employer on the list. Only where the employer is in one of the
  // places (or the owner is interviewing there): the places say where outreach is worth it.
  const contacted = new Set(contacts.map(c => profileId(c.profile_url) || `name:${personKey(c.name)}`));
  const inPlace = (k: string) => (best.get(k)?.loc ?? Infinity) <= profile.daily.places.length;
  const candidates: (Bridge & { rank: (number | boolean | string)[] })[] = [];
  for (const person of connections) {
    const key = connectionKey(person);
    const pk = person.company_key;
    if (!pk || contacted.has(key) || resting(`bridge:${key}`)) continue;
    const k = [...best.keys()].find(b => sameEmployer(b, pk));
    if (!k) continue;
    const at = best.get(k);
    if (!at || !(inPlace(k) || prep.has(k))) continue;
    const pos = person.position;
    const eng = profile.daily.preferTitles?.test(pos) ? 0 : ENGINEER.test(pos) ? 1 : 2;
    const pick = prep.get(k) ?? at;
    candidates.push({
      key,
      person,
      pick: { key: k, kind: pick.kind, company: pick.company, place: pick.place, job: pick.job, why: why(pick) },
      rank: [lastOf(`bridge:${key}`) !== today, !prep.has(k), at.src >= 4, eng, at.loc, at.src, -(at.job.score ?? 0), person.name],
    });
  }
  const peopleTotal = new Set(candidates.map(c => c.key)).size;
  const seen = new Set<string>();
  const people = candidates
    .sort((a, b) => compare(a.rank, b.rank))
    .filter(b => !seen.has(b.pick.key) && !!seen.add(b.pick.key))
    .slice(0, profile.daily.people)
    .map(({ rank: _rank, ...b }) => b);
  const known = new Set(people.map(b => b.pick.key));

  const byRank = (a: Ranked, b: Ranked) => compare(a.rank, b.rank) || a.company.localeCompare(b.company);
  const cands = [...byCo.values()].filter(j => !prep.has(j.key) && !known.has(j.key)).sort(byRank);
  const picks: Ranked[] = [...prep.values()]
    .filter(j => !known.has(j.key))
    .sort(byRank)
    .slice(0, profile.daily.prep);
  const prepCount = picks.length;
  const quotas = profile.daily.places.length ? profile.daily.places.map(p => [p.name, p.perDay] as const) : [[ANYWHERE, profile.daily.companies] as const];
  for (const [name, n] of quotas) picks.push(...cands.filter(j => j.place === name).slice(0, n));
  const want = quotas.reduce((t, [, n]) => t + n, 0) + prepCount;
  // Not enough in the first place: the rest of the places fill in. Outside every place, never.
  for (const j of cands) {
    if (picks.length >= want) break;
    if (!picks.includes(j) && j.place !== null) picks.push(j);
  }

  const due = contacts
    .map(contact => ({ contact, step: nextStep(contact, today, profile) }))
    .filter(d => d.step.due !== null && d.step.due <= today && !DONE.includes(d.contact.stage))
    .map(d => ({ ...d, overdue: (d.step.due ?? today) < today }))
    .sort((a, b) => (a.step.due ?? "").localeCompare(b.step.due ?? "") || a.contact.id - b.contact.id);

  return {
    day: today,
    due,
    people,
    companies: picks.map(({ rank: _r, src: _s, loc: _l, ...p }) => ({ ...p, why: why(p) })),
    peopleTotal,
    suggested: [...picks.map(p => p.key), ...people.map(b => `bridge:${b.key}`)],
  };
}

// Tuples compared in order: false before true, smaller numbers first, strings alphabetically.
function compare(a: readonly (number | boolean | string)[], b: readonly (number | boolean | string)[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i],
      y = b[i];
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === "string" && typeof y === "string") return x.localeCompare(y);
    return Number(x) < Number(y) ? -1 : 1;
  }
  return 0;
}

// The month's personalized invitation notes still free, and whether a new export is due.
export const notesLeft = (used: number, profile: ReferralProfile) => Math.max(0, profile.linkedin.notesPerMonth - used);
export const exportDue = (lastExportOn: string | null, today: string, profile: ReferralProfile) =>
  !lastExportOn || lastExportOn < addDays(today, -profile.exportEveryDays);

// ---- the owner's mail, read only

export interface MailHeader {
  from: string;
  subject: string;
  date: string; // the Date header
}
export interface MailBump {
  stage: "connected" | "messaged" | "followed_up" | "replied";
  day: string;
}
const ACCEPTED = /accepted your invitation/i;
const MESSAGED = /\bmessag(e|ed|es)\b|\bsent you\b|\binmail\b/i;
const AUTO_REPLY = /automatic reply|auto(-| )?reply|out of (the )?office|undeliverable|delivery status|returned mail/i;
const mailDay = (date: string, timeZone: string) => {
  const at = Date.parse(date);
  return Number.isNaN(at) ? "" : dayIn(timeZone, new Date(at));
};

// LinkedIn's notification mail about a contact: "<name> accepted your invitation" (connected), "<name>
// sent you a message" (replied). LinkedIn skips some of these; the export is the record that holds.
export function linkedInMailBumps(name: string, mails: readonly MailHeader[], timeZone: string): MailBump[] {
  const who = personKey(name);
  if (!who) return [];
  return mails.flatMap((m): MailBump[] => {
    const day = mailDay(m.date, timeZone);
    if (!day || !`${m.from} ${m.subject}`.toLowerCase().includes(who)) return [];
    if (ACCEPTED.test(m.subject)) return [{ stage: "connected", day }];
    if (MESSAGED.test(m.subject) && m.from.toLowerCase().includes(who)) return [{ stage: "replied", day }];
    return [];
  });
}

// Mail with a contact the owner has an address for, since they were added: the owner's first message
// (messaged), a second (followed_up), and theirs back (replied). Auto-replies and bounces do not count.
export function emailBumps(addedOn: string, sent: readonly MailHeader[], received: readonly MailHeader[], timeZone: string): MailBump[] {
  const days = (list: readonly MailHeader[]) =>
    list
      .filter(m => !AUTO_REPLY.test(m.subject))
      .map(m => mailDay(m.date, timeZone))
      .filter(d => d && d >= addedOn)
      .sort();
  const out = days(sent),
    back = days(received);
  return [
    ...(out[0] ? [{ stage: "messaged" as const, day: out[0] }] : []),
    ...(out[1] ? [{ stage: "followed_up" as const, day: out[1] }] : []),
    ...(back[0] ? [{ stage: "replied" as const, day: back[0] }] : []),
  ];
}
