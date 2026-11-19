// Early outreach state: the leads the scout found (a fresh hiring post, a new listing or a seed round) and
// the people at each one the owner may email, with the draft for each and where it stands. Nothing here
// sends anything: the owner copies a draft into his own mail, sends it, and marks it.
//
// The store takes the database it works on, as referrals.ts does, so tests use one in memory.
import type { Database } from "bun:sqlite";
import { companyKey } from "./company-key";

export const LEAD_KINDS = ["post", "listing", "seed"] as const;
export type LeadKind = (typeof LEAD_KINDS)[number];
export const LEAD_STATUSES = ["new", "active", "done", "dropped"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];
//   drafted      found, draft written, nothing sent
//   sent         the owner sent the first email
//   followed_up  the one follow-up went out
//   replied      they wrote back
//   no_response, closed   finished
export const PERSON_STAGES = ["drafted", "sent", "followed_up", "replied", "no_response", "closed"] as const;
export type PersonStage = (typeof PERSON_STAGES)[number];
export type EmailSource = "public" | "hunter" | "guess";
export type Confidence = "high" | "medium" | "low";
export const isLeadKind = (s: unknown): s is LeadKind => LEAD_KINDS.includes(s as LeadKind);
export const isPersonStage = (s: unknown): s is PersonStage => PERSON_STAGES.includes(s as PersonStage);
export const MAX_PEOPLE = 3;

export interface Lead {
  id: number;
  kind: LeadKind;
  company: string;
  company_key: string;
  domain: string;
  source_url: string;
  source_title: string;
  posted_at: string;
  likes: number | null;
  what_they_do: string;
  why_fit: string;
  score: number;
  status: LeadStatus;
  found_at: string;
}
export type NewLead = Omit<Lead, "id" | "company_key" | "status" | "found_at">;

export interface Person {
  id: number;
  lead_id: number;
  name: string;
  role: string;
  profile_url: string | null;
  email: string;
  email_source: EmailSource;
  email_confidence: Confidence;
  promoted: 0 | 1;
  subject: string;
  body: string;
  followup_body: string | null;
  stage: PersonStage;
  drafted_on: string;
  sent_on: string | null;
  followed_up_on: string | null;
  replied_on: string | null;
  updated_at: string;
}
export type NewPerson = Pick<
  Person,
  "lead_id" | "name" | "role" | "profile_url" | "email" | "email_source" | "email_confidence" | "subject" | "body" | "drafted_on"
>;

const DAY_OF: Partial<Record<PersonStage, string>> = { sent: "sent_on", followed_up: "followed_up_on", replied: "replied_on" };
const SET_STAGE = `
  UPDATE outreach_people SET
    stage = ?1,
    sent_on = CASE WHEN ?2 = 'sent_on' AND sent_on IS NULL THEN ?3 ELSE sent_on END,
    followed_up_on = CASE WHEN ?2 = 'followed_up_on' THEN ?3 ELSE followed_up_on END,
    replied_on = CASE WHEN ?2 = 'replied_on' THEN ?3 ELSE replied_on END,
    updated_at = datetime('now')
  WHERE id = ?4`;

export function outreachStore(db: Database) {
  const lead = (id: number) => db.query<Lead, [number]>("SELECT * FROM outreach_leads WHERE id = ?").get(id);
  const person = (id: number) => db.query<Person, [number]>("SELECT * FROM outreach_people WHERE id = ?").get(id);
  return {
    lead,
    person,

    // null when the source is known already.
    addLead(l: NewLead): Lead | null {
      return db
        .query<Lead, (string | number | null)[]>(
          `INSERT INTO outreach_leads (kind, company, company_key, domain, source_url, source_title, posted_at, likes, what_they_do, why_fit, score)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (source_url) DO NOTHING
          RETURNING *`,
        )
        .get(
          l.kind,
          l.company.trim(),
          companyKey(l.company),
          l.domain.trim().toLowerCase(),
          l.source_url.trim(),
          l.source_title,
          l.posted_at,
          l.likes,
          l.what_they_do,
          l.why_fit,
          Math.round(l.score),
        );
    },

    // null when the lead has its three people already, or this address is on it.
    addPerson(p: NewPerson): Person | null {
      const count = db.query<{ n: number }, [number]>("SELECT count(*) AS n FROM outreach_people WHERE lead_id = ?").get(p.lead_id)?.n ?? 0;
      if (count >= MAX_PEOPLE) return null;
      return db
        .query<Person, (string | number | null)[]>(
          `INSERT INTO outreach_people (lead_id, name, role, profile_url, email, email_source, email_confidence, subject, body, drafted_on)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (lead_id, email) DO NOTHING
          RETURNING *`,
        )
        .get(
          p.lead_id,
          p.name.trim(),
          p.role,
          p.profile_url,
          p.email.trim().toLowerCase(),
          p.email_source,
          p.email_confidence,
          p.subject,
          p.body,
          p.drafted_on,
        );
    },

    leads(statuses?: readonly LeadStatus[]): Lead[] {
      if (!statuses) return db.query<Lead, []>("SELECT * FROM outreach_leads ORDER BY id").all();
      return db
        .query<Lead, [string]>("SELECT * FROM outreach_leads WHERE status IN (SELECT value FROM json_each(?)) ORDER BY id")
        .all(JSON.stringify(statuses));
    },
    people(leadId?: number): Person[] {
      if (leadId === undefined) return db.query<Person, []>("SELECT * FROM outreach_people ORDER BY id").all();
      return db.query<Person, [number]>("SELECT * FROM outreach_people WHERE lead_id = ? ORDER BY id").all(leadId);
    },

    setStage(id: number, stage: PersonStage, day: string) {
      db.query(SET_STAGE).run(stage, DAY_OF[stage] ?? "", day, id);
    },
    setFollowUp(id: number, body: string) {
      db.query("UPDATE outreach_people SET followup_body = ?, updated_at = datetime('now') WHERE id = ?").run(body, id);
    },
    promote(id: number) {
      db.query("UPDATE outreach_people SET promoted = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    },
    setLeadStatus(id: number, status: LeadStatus) {
      db.query("UPDATE outreach_leads SET status = ? WHERE id = ?").run(status, id);
    },

    // Each company's first send, by company key: a company written to recently is not a new lead.
    sentCompanyDays(): Map<string, string> {
      const rows = db
        .query<{ company_key: string; day: string }, []>(
          `SELECT l.company_key, min(p.sent_on) AS day FROM outreach_people p JOIN outreach_leads l ON l.id = p.lead_id
          WHERE p.sent_on IS NOT NULL GROUP BY l.company_key`,
        )
        .all();
      return new Map(rows.map(r => [r.company_key, r.day]));
    },

    // Drafts that were never sent and whose lead went stale.
    deleteExpiredDrafts(ids: readonly number[]) {
      if (!ids.length) return;
      db.query("DELETE FROM outreach_people WHERE stage = 'drafted' AND id IN (SELECT value FROM json_each(?))").run(JSON.stringify(ids));
    },
  };
}
export type OutreachStore = ReturnType<typeof outreachStore>;
