// The Early outreach page as the app serves it: its state, the owner's changes, and the read-only mail
// check that notices replies. Nothing here sends anything (docs/outreach.md). (src/outreach.ts is the
// Referrals page's module.)
import type { OutreachItem, OutreachState } from "./api-types";
import * as gmail from "./gmail";
import { isPersonStage, PERSON_STAGES, type Lead, type OutreachStore, type Person } from "./leads";
import { followUpsDue, isFresh, todayList } from "./outreach-plan";
import { leadsStore, outreachSettings, outreachTimeZone } from "./outreach-scout";
import { dayIn } from "./referral-plan";

const OPEN = new Set<Person["stage"]>(["sent", "followed_up"]);

export function outreachState(store: OutreachStore = leadsStore, now = new Date()): OutreachState {
  const s = outreachSettings();
  const tz = outreachTimeZone();
  const day = dayIn(tz, now);
  const leads = store.leads();
  const people = store.people();
  const byId = new Map(leads.map(l => [l.id, l]));
  const item = (person: Person): OutreachItem[] => {
    const lead = byId.get(person.lead_id);
    return lead ? [{ person, lead }] : [];
  };
  const today = todayList(people, leads, s.perDay, now, tz, s.resuggestDays);
  const todayIds = new Set(today.map(p => p.id));
  const due = followUpsDue(people, day, s.followUpDays);
  const dueIds = new Set(due.map(p => p.id));
  const live = (p: Person) => {
    const lead = byId.get(p.lead_id);
    return !!lead && lead.status !== "dropped" && isFresh(lead, now);
  };
  const drafted = people.filter(p => p.stage === "drafted" && !todayIds.has(p.id) && live(p));
  return {
    day,
    sentToday: people.filter(p => p.sent_on === day).length,
    perDay: s.perDay,
    sendFrom: s.sendFrom,
    gmail: gmail.gmailStatus().connected,
    today: today.flatMap(item),
    followUps: due.flatMap(item),
    checkFirst: drafted.filter(p => p.email_confidence === "low" && !p.promoted).flatMap(item),
    waiting: [...drafted.filter(p => p.email_confidence !== "low" || p.promoted), ...people.filter(p => OPEN.has(p.stage) && !dueIds.has(p.id))].flatMap(item),
    replied: people.filter(p => p.stage === "replied").flatMap(item),
    done: people.filter(p => p.stage === "no_response" || p.stage === "closed").flatMap(item),
  };
}

// The owner's change to one person: a new stage, or a low-confidence address checked by hand. The error, or null.
export function changePerson(id: number, b: Record<string, unknown>, store: OutreachStore = leadsStore, now = new Date()): string | null {
  if (!store.person(id)) return "no such person";
  if (b["promote"] === true) store.promote(id);
  if (b["stage"] !== undefined) {
    if (!isPersonStage(b["stage"])) return `stage must be one of ${PERSON_STAGES.join(", ")}`;
    store.setStage(id, b["stage"], dayIn(outreachTimeZone(), now));
  }
  return null;
}

export function dropLead(id: number, store: OutreachStore = leadsStore): string | null {
  if (!store.lead(id)) return "no such lead";
  store.setLeadStatus(id, "dropped" satisfies Lead["status"]);
  return null;
}

// The people written to whose address has written back.
export const replyBumps = (people: readonly Person[], from: ReadonlySet<string>): number[] =>
  people.filter(p => OPEN.has(p.stage) && from.has(p.email)).map(p => p.id);

// Searches the connected mailbox, read only, for mail from each person written to. Replies to another
// address (the owner's school mail) are found only when he forwards them there; otherwise he marks them.
export async function syncOutreachMail(store: OutreachStore = leadsStore): Promise<{ checked: number; replied: number }> {
  if (!gmail.gmailStatus().connected) return { checked: 0, replied: 0 };
  const open = store.people().filter(p => OPEN.has(p.stage));
  const wrote = new Set<string>();
  for (const p of open) if ((await gmail.search(`from:${p.email} newer_than:30d`, 1)).length) wrote.add(p.email);
  const ids = replyBumps(open, wrote);
  const day = dayIn(outreachTimeZone());
  for (const id of ids) store.setStage(id, "replied", day);
  return { checked: open.length, replied: ids.length };
}
