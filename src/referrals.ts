// Referral outreach state: the people the owner contacts about their applications and where each
// conversation stands, the owner's LinkedIn connections, what the daily list suggested when, and each
// file read. Nothing else touches the referral_* tables.
//
// The store takes the database it works on rather than importing the app's connection, so the import
// script can use it on a file named on its command line without opening data/app.db.
//
// Nothing here sends anything or talks to LinkedIn: the owner sends every message by hand and moves the
// contact on (or a LinkedIn export or their mail shows it), and this records it.
import type { Database } from "bun:sqlite";
import { companyKey } from "./company-key";

//   drafted      added; nothing sent yet
//   requested    connection invite sent (with_note: it used one of the month's personalized notes)
//   connected    they accepted, or were already a connection
//   messaged     the message after connecting (or the email) went out
//   followed_up  the one follow-up went out
//   replied      they wrote back
//   referred     they referred the owner
//   declined, no_response, closed   finished
export const STAGES = ["drafted", "requested", "connected", "messaged", "followed_up", "replied", "referred", "declined", "no_response", "closed"] as const;
export type Stage = (typeof STAGES)[number];
export const DONE: readonly Stage[] = ["referred", "declined", "no_response", "closed"];
export const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);

// Who they are to the owner, which decides how the drafts read.
export const RELATIONS = ["manager", "alumni", "engineer", "recruiter", "connection"] as const;
export type Relation = (typeof RELATIONS)[number];
export const isRelation = (s: unknown): s is Relation => RELATIONS.includes(s as Relation);

// The day column each stage stamps.
const DAY_OF: Partial<Record<Stage, DayColumn>> = {
  requested: "requested_on",
  connected: "connected_on",
  messaged: "messaged_on",
  followed_up: "followed_up_on",
  replied: "replied_on",
  referred: "referred_on",
  declined: "closed_on",
  no_response: "closed_on",
  closed: "closed_on",
};
export type DayColumn = "requested_on" | "connected_on" | "messaged_on" | "followed_up_on" | "replied_on" | "referred_on" | "closed_on";

export interface Contact {
  id: number;
  name: string;
  title: string;
  company: string;
  company_key: string;
  profile_url: string | null;
  email: string | null;
  relation: Relation;
  stage: Stage;
  job_id: number | null;
  job_title: string | null;
  job_url: string | null;
  area: string | null;
  with_note: 0 | 1;
  notes: string;
  added_on: string;
  requested_on: string | null;
  connected_on: string | null;
  messaged_on: string | null;
  followed_up_on: string | null;
  replied_on: string | null;
  referred_on: string | null;
  closed_on: string | null;
  legacy_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface NewContact {
  name: string;
  title?: string | null | undefined;
  company: string;
  profile_url?: string | null | undefined;
  email?: string | null | undefined;
  relation: Relation;
  job_id?: number | null | undefined;
  job_title?: string | null | undefined;
  job_url?: string | null | undefined;
  area?: string | null | undefined;
  notes?: string | null | undefined;
  added_on: string;
  // An import brings these as they were; a new contact starts at drafted (connected for a connection).
  stage?: Stage | undefined;
  days?: Partial<Record<DayColumn, string | null>> | undefined;
  with_note?: boolean | undefined;
  legacy_id?: string | null | undefined;
}

export interface Connection {
  key: string;
  name: string;
  url: string | null;
  company: string;
  company_key: string;
  position: string;
  connected_on: string | null;
}

export interface ImportRecord {
  id: number;
  kind: "export" | "internscouter";
  file: string;
  fingerprint: string;
  exported_on: string | null;
  connections: number;
  updates: number;
  at: string;
}

// A LinkedIn profile's id from its URL (linkedin.com/in/<id>), lower case; "" when there is none.
export function profileId(url: string | null | undefined): string {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url ?? "");
  if (!m?.[1]) return "";
  try {
    return decodeURIComponent(m[1]).toLowerCase();
  } catch {
    return m[1].toLowerCase();
  }
}
export const personKey = (name: string) => name.toLowerCase().replace(/\s+/g, " ").trim();
// How a connection is keyed: by profile, else by name.
export const connectionKey = (c: { url?: string | null; name: string }) => profileId(c.url) || `name:${personKey(c.name)}`;

const blank = (s: string | null | undefined) => s?.trim() || null;

// One statement for every stage: the day column the stage names takes the day, the others stay.
const SET_STAGE = `
  UPDATE referral_contacts SET
    stage = ?1,
    requested_on = CASE WHEN ?2 = 'requested_on' THEN ?3 ELSE requested_on END,
    connected_on = CASE WHEN ?2 = 'connected_on' THEN ?3 ELSE connected_on END,
    messaged_on = CASE WHEN ?2 = 'messaged_on' THEN ?3 ELSE messaged_on END,
    followed_up_on = CASE WHEN ?2 = 'followed_up_on' THEN ?3 ELSE followed_up_on END,
    replied_on = CASE WHEN ?2 = 'replied_on' THEN ?3 ELSE replied_on END,
    referred_on = CASE WHEN ?2 = 'referred_on' THEN ?3 ELSE referred_on END,
    closed_on = CASE WHEN ?2 = 'closed_on' THEN ?3 ELSE closed_on END,
    with_note = CASE WHEN ?4 IS NULL THEN with_note ELSE ?4 END,
    updated_at = datetime('now')
  WHERE id = ?5`;

export function referralStore(db: Database) {
  const contact = (id: number) => db.query<Contact, [number]>("SELECT * FROM referral_contacts WHERE id = ?").get(id);
  const need = (id: number) => {
    const c = contact(id);
    if (!c) throw new Error("no such contact");
    return c;
  };
  const setStage = (id: number, stage: Stage, day: string, withNote: boolean | null = null) => {
    db.query(SET_STAGE).run(stage, DAY_OF[stage] ?? "", day, withNote === null ? null : withNote ? 1 : 0, id);
  };

  return {
    contacts: () => db.query<Contact, []>("SELECT * FROM referral_contacts ORDER BY id").all(),
    contact,

    addContact(c: NewContact): number {
      const name = c.name.trim(),
        company = c.company.trim();
      if (!name || !company) throw new Error("a contact needs a name and a company");
      if (!isRelation(c.relation)) throw new Error(`relation must be one of ${RELATIONS.join(", ")}`);
      const stage = c.stage ?? (c.relation === "connection" ? "connected" : "drafted");
      if (!isStage(stage)) throw new Error(`stage must be one of ${STAGES.join(", ")}`);
      const days: Partial<Record<DayColumn, string | null>> = { ...c.days };
      // Already a connection: there is no invite to send.
      if (!c.stage && stage === "connected") days.connected_on = c.added_on;
      const row = db
        .query<{ id: number }, (string | number | null)[]>(
          `INSERT INTO referral_contacts (name, title, company, company_key, profile_url, email, relation, stage, job_id, job_title, job_url, area,
            with_note, notes, added_on, requested_on, connected_on, messaged_on, followed_up_on, replied_on, referred_on, closed_on, legacy_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
        )
        .get(
          name,
          c.title?.trim() ?? "",
          company,
          companyKey(company),
          blank(c.profile_url),
          blank(c.email)?.toLowerCase() ?? null,
          c.relation,
          stage,
          c.job_id ?? null,
          blank(c.job_title),
          blank(c.job_url),
          blank(c.area),
          c.with_note ? 1 : 0,
          c.notes?.trim() ?? "",
          c.added_on,
          days.requested_on ?? null,
          days.connected_on ?? null,
          days.messaged_on ?? null,
          days.followed_up_on ?? null,
          days.replied_on ?? null,
          days.referred_on ?? null,
          days.closed_on ?? null,
          c.legacy_id ?? null,
        );
      if (!row) throw new Error("the contact was not saved");
      return row.id;
    },

    // The owner says where it stands: any stage, which stamps its day. `withNote` with requested: the
    // invite carried a personalized note.
    setStage(id: number, stage: Stage, day: string, withNote?: boolean): Contact {
      need(id);
      if (!isStage(stage)) throw new Error(`stage must be one of ${STAGES.join(", ")}`);
      setStage(id, stage, day, stage === "requested" ? !!withNote : null);
      return need(id);
    },

    // What an export or the mail showed: moves a contact forward only, never back, never out of a finished
    // stage. Returns whether it moved.
    bump(id: number, stage: Stage, day: string, withNote?: boolean): boolean {
      const c = need(id);
      if (DONE.includes(c.stage) || STAGES.indexOf(stage) <= STAGES.indexOf(c.stage)) {
        if (withNote && !c.with_note) db.query("UPDATE referral_contacts SET with_note = 1 WHERE id = ?").run(id);
        return false;
      }
      setStage(id, stage, day, withNote ? true : null);
      return true;
    },

    editContact(
      id: number,
      change: {
        name?: string;
        title?: string;
        email?: string | null;
        profile_url?: string | null;
        notes?: string;
        job_id?: number | null;
        area?: string | null;
        relation?: Relation;
      },
    ): Contact {
      const c = need(id);
      if (change.relation !== undefined && !isRelation(change.relation)) throw new Error(`relation must be one of ${RELATIONS.join(", ")}`);
      const name = change.name === undefined ? c.name : change.name.trim();
      if (!name) throw new Error("a contact needs a name");
      db.query(
        `UPDATE referral_contacts SET name = ?, title = ?, email = ?, profile_url = ?, notes = ?, job_id = ?, area = ?, relation = ?, updated_at = datetime('now')
        WHERE id = ?`,
      ).run(
        name,
        change.title === undefined ? c.title : change.title.trim(),
        change.email === undefined ? c.email : (blank(change.email)?.toLowerCase() ?? null),
        change.profile_url === undefined ? c.profile_url : blank(change.profile_url),
        change.notes === undefined ? c.notes : change.notes.trim(),
        change.job_id === undefined ? c.job_id : change.job_id,
        change.area === undefined ? c.area : blank(change.area),
        change.relation ?? c.relation,
        id,
      );
      return need(id);
    },

    removeContact(id: number) {
      need(id);
      db.query("DELETE FROM referral_contacts WHERE id = ?").run(id);
    },

    // Personalized invitation notes used in a month ("YYYY-MM").
    notesUsed: (month: string) =>
      db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM referral_contacts WHERE with_note = 1 AND substr(requested_on, 1, 7) = ?").get(month)?.n ??
      0,

    connections: () => db.query<Connection, []>("SELECT * FROM referral_connections ORDER BY name").all(),
    connectionCount: () => db.query<{ n: number }, []>("SELECT count(*) AS n FROM referral_connections").get()?.n ?? 0,
    // A new export is the whole network as it stands: it replaces what an older one said.
    replaceConnections(list: readonly Omit<Connection, "key" | "company_key">[]): number {
      const insert = db.query(
        `INSERT INTO referral_connections (key, name, url, company, company_key, position, connected_on) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (key) DO UPDATE SET name = excluded.name, url = excluded.url, company = excluded.company, company_key = excluded.company_key,
          position = excluded.position, connected_on = excluded.connected_on`,
      );
      let n = 0;
      db.transaction(() => {
        db.query("DELETE FROM referral_connections").run();
        for (const c of list) {
          const name = c.name.trim();
          if (!name && !profileId(c.url)) continue;
          insert.run(connectionKey(c), name, blank(c.url), c.company.trim(), companyKey(c.company), c.position.trim(), c.connected_on);
          n++;
        }
      }).immediate();
      return n;
    },

    suggestions: () =>
      new Map(
        db
          .query<{ key: string; day: string }, []>("SELECT key, day FROM referral_suggestions")
          .all()
          .map(r => [r.key, r.day]),
      ),
    suggest(keys: readonly string[], day: string) {
      const upsert = db.query("INSERT INTO referral_suggestions (key, day) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET day = excluded.day");
      db.transaction(() => {
        for (const k of keys) upsert.run(k, day);
      })();
    },

    lastExport: () =>
      db.query<ImportRecord, []>("SELECT * FROM referral_imports WHERE kind = 'export' ORDER BY exported_on DESC, id DESC LIMIT 1").get() ?? null,
    imported: (fingerprint: string) =>
      !!db.query<{ id: number }, [string]>("SELECT id FROM referral_imports WHERE kind = 'internscouter' AND fingerprint = ?").get(fingerprint),
    recordImport(r: Omit<ImportRecord, "id" | "at">) {
      db.query("INSERT INTO referral_imports (kind, file, fingerprint, exported_on, connections, updates) VALUES (?, ?, ?, ?, ?, ?)").run(
        r.kind,
        r.file,
        r.fingerprint,
        r.exported_on,
        r.connections,
        r.updates,
      );
    },

    // Runs `fn` in one write transaction: an import lands whole or not at all.
    atomically: <T>(fn: () => T): T => db.transaction(fn).immediate(),
  };
}
export type ReferralStore = ReturnType<typeof referralStore>;
