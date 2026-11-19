// Early outreach rules, without I/O: which leads are fresh and worth keeping, which drafts go out today,
// when a follow-up falls due, and the guesses for an address no page shows. Days are the owner's days
// (YYYY-MM-DD in their time zone), as on the Referrals page.
import type { Lead, LeadKind, Person } from "./leads";
import { dayIn } from "./referral-plan";

// How many days after it appeared a lead is still worth writing about.
export const FRESH_DAYS: Record<LeadKind, number> = { post: 1, listing: 3, seed: 7 };
export const MAX_LIKES = 100;
export const BODY_LINES = 5;
export const FOLLOW_UP_LINES = 3;

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

// When a lead appeared, in ms, or null when posted_at is not a time. A date without a time (funding news
// often gives only the day) is taken as the end of that day in UTC (evening across the United States), so
// the lead is not cut short by the hours the news left out.
export const postedTime = (postedAt: string): number | null => {
  const at = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(postedAt.trim()) ? `${postedAt.trim()}T23:59:00Z` : postedAt);
  return Number.isNaN(at) ? null : at;
};
const DAY_MS = 86_400_000;
// A lead is fresh for FRESH_DAYS whole days after it appeared, counted in hours: a post is a day old 24
// hours after it went up, whatever the clock said then.
export const isFresh = (lead: Pick<Lead, "kind" | "posted_at">, now: Date) => {
  const at = postedTime(lead.posted_at);
  return at !== null && now.getTime() - at <= FRESH_DAYS[lead.kind] * DAY_MS;
};
// Clocks differ: a time up to an hour ahead is taken as now.
const FUTURE_SLACK_MS = 3_600_000;

// Pages the scout may know only through search results: it never opens them.
const SEARCH_ONLY = /^https?:\/\/([^/]+\.)?(linkedin\.com|x\.com|twitter\.com)(\/|$)/i;

export interface LeadInput {
  kind: LeadKind;
  posted_at: string;
  likes: number | null;
  score: number;
  company_key: string;
  source_url: string;
  fetched?: boolean;
}
export interface LeadRules {
  minScore: number;
  resuggestDays: number;
  sentCompanyDays: ReadonlyMap<string, string>;
  timeZone: string;
  // Companies with a lead still open (new or active, and fresh): one lead per company at a time.
  openCompanyKeys?: ReadonlySet<string>;
}

// Why a lead is refused, or null when it is kept.
export function leadProblem(l: LeadInput, now: Date, rules: LeadRules): string | null {
  const today = dayIn(rules.timeZone, now);
  const at = postedTime(l.posted_at);
  if (at === null) return `posted_at "${l.posted_at}" is not a date and time`;
  if (at > now.getTime() + FUTURE_SLACK_MS) return `posted_at ${l.posted_at} is in the future`;
  const fresh = FRESH_DAYS[l.kind];
  if (!isFresh(l, now)) return `the ${l.kind} is older than ${fresh} day${fresh === 1 ? "" : "s"}`;
  if (l.likes !== null && l.likes >= MAX_LIKES) return `the post has ${l.likes} likes; only posts under ${MAX_LIKES} likes are early enough`;
  if (l.score < rules.minScore) return `fit score ${l.score} is below ${rules.minScore}`;
  const sent = rules.sentCompanyDays.get(l.company_key);
  if (sent && daysBetween(sent, today) < rules.resuggestDays)
    return `the candidate emailed this company on ${sent}; not again within ${rules.resuggestDays} days`;
  if (rules.openCompanyKeys?.has(l.company_key)) return "a lead at this company is open already; add people to that one instead";
  if (l.fetched && SEARCH_ONLY.test(l.source_url)) return "LinkedIn and X posts are judged from search results only; do not open those pages";
  return null;
}

// Why a draft is refused, or null. Blank lines do not count.
export function bodyProblem(body: string, maxLines: number): string | null {
  const lines = body.split("\n").filter(line => line.trim()).length;
  if (!lines) return "the email is empty";
  return lines > maxLines ? `the email has ${lines} lines; keep it to ${maxLines} or fewer` : null;
}

// The common company address patterns, most likely first.
export function emailGuesses(first: string, last: string, domain: string): string[] {
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const f = clean(first),
    l = clean(last),
    d = domain.trim().toLowerCase();
  if (!f || !d) return [];
  return l ? [`${f}@${d}`, `${f}.${l}@${d}`, `${f[0]}${l}@${d}`] : [`${f}@${d}`];
}

// Companies written to within resuggestDays of the day: their other drafts wait, so nobody there hears
// twice from the candidate about two posts.
function companiesSent(people: readonly Person[], byId: ReadonlyMap<number, Lead>, day: string, resuggestDays: number): Set<string> {
  const keys = new Set<string>();
  for (const p of people) {
    const key = byId.get(p.lead_id)?.company_key;
    if (key && p.sent_on && daysBetween(p.sent_on, day) < resuggestDays) keys.add(key);
  }
  return keys;
}

const sendable = (p: Person, lead: Lead | undefined, now: Date, sentKeys: ReadonlySet<string>) =>
  p.stage === "drafted" &&
  (p.email_confidence !== "low" || p.promoted === 1) &&
  !!lead &&
  lead.status !== "dropped" &&
  !sentKeys.has(lead.company_key) &&
  isFresh(lead, now);

const sentOn = (people: readonly Person[], day: string) => people.filter(p => p.sent_on === day).length;

// The drafts that could go out now, best lead first, then the newest.
function sendableDrafts(people: readonly Person[], leads: readonly Lead[], now: Date, timeZone: string, resuggestDays: number): Person[] {
  const byId = new Map(leads.map(l => [l.id, l]));
  const sentKeys = companiesSent(people, byId, dayIn(timeZone, now), resuggestDays);
  return people
    .filter(p => sendable(p, byId.get(p.lead_id), now, sentKeys))
    .sort((a, b) => {
      const la = byId.get(a.lead_id),
        lb = byId.get(b.lead_id);
      return (lb?.score ?? 0) - (la?.score ?? 0) || (postedTime(lb?.posted_at ?? "") ?? 0) - (postedTime(la?.posted_at ?? "") ?? 0) || a.id - b.id;
    });
}

// Today's emails: sendable drafts, up to what is left of perDay.
export function todayList(people: readonly Person[], leads: readonly Lead[], perDay: number, now: Date, timeZone: string, resuggestDays = 30): Person[] {
  const left = Math.max(0, perDay - sentOn(people, dayIn(timeZone, now)));
  return sendableDrafts(people, leads, now, timeZone, resuggestDays).slice(0, left);
}

// Unsent drafts whose lead is no longer fresh.
export function expiredDrafts(people: readonly Person[], leads: readonly Lead[], now: Date): number[] {
  const byId = new Map(leads.map(l => [l.id, l]));
  return people.filter(p => p.stage === "drafted" && !isFresh(byId.get(p.lead_id) ?? { kind: "post", posted_at: "" }, now)).map(p => p.id);
}

// People sent one email, not followed up yet, whose follow-up day has come.
export const followUpsDue = (people: readonly Person[], day: string, followUpDays: number): Person[] =>
  people.filter(p => p.stage === "sent" && !p.followed_up_on && !!p.sent_on && addDays(p.sent_on, followUpDays) <= day);

// People followed up followUpDays ago or more with no reply: they become no_response.
export const quietPeople = (people: readonly Person[], day: string, followUpDays: number): number[] =>
  people.filter(p => p.stage === "followed_up" && !!p.followed_up_on && addDays(p.followed_up_on, followUpDays) <= day).map(p => p.id);

// How many more drafts today still has room for, beyond those already waiting; the scout looks for
// more while this is above 0.
export function draftsWanted(people: readonly Person[], leads: readonly Lead[], perDay: number, now: Date, timeZone: string, resuggestDays = 30): number {
  const waiting = sendableDrafts(people, leads, now, timeZone, resuggestDays).length;
  return perDay - sentOn(people, dayIn(timeZone, now)) - waiting;
}
export const needsLeads = (people: readonly Person[], leads: readonly Lead[], perDay: number, now: Date, timeZone: string, resuggestDays = 30): boolean =>
  draftsWanted(people, leads, perDay, now, timeZone, resuggestDays) > 0;
