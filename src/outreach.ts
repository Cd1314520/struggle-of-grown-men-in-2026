// Referral outreach as the app runs it: the Referrals page's state, the owner's changes to contacts, a
// LinkedIn export they upload, and their mail read for replies. The rules are in referral-plan.ts and
// referral-drafts.ts, the state in referrals.ts.
//
// Two rules hold everywhere here: nothing is ever sent (the owner copies a draft and sends it), and
// nothing touches linkedin.com (the links on the page are for the owner's own browser; the export is a
// file they downloaded). Gmail is only searched, never modified.
import { createHash } from "node:crypto";
import YAML from "yaml";
import type { ReferralContact, ReferralImportResult, ReferralJob, ReferralsState } from "./api-types";
import { companyKey } from "./company-key";
import { config, readProfile } from "./config";
import { db, getJob, jobsInStatuses, kvGet, kvSet, logEvent, type Job } from "./db";
import * as gmail from "./gmail";
import { exportBumps, readExport } from "./linkedin-export";
import { buildDrafts, type Signature } from "./referral-drafts";
import {
  areaFor,
  dayIn,
  emailBumps,
  exportDue,
  linkedInMailBumps,
  nextStep,
  notesLeft,
  parseReferralProfile,
  searchLinks,
  todayList,
  type PlanJob,
} from "./referral-plan";
import { DONE, isRelation, isStage, referralStore, type Contact, type Stage } from "./referrals";
import type { Status } from "./status";

export const store = referralStore(db);
const timeZone = () => config.questionDigest?.timeZone ?? "America/Chicago";
export const today = () => dayIn(timeZone());
export const EXPORT_URL = "https://www.linkedin.com/mypreferences/d/download-my-data";

// The applications worth contacting someone about: sent ones, and those on their way.
const SENT: readonly Status[] = ["submitted", "interview", "offer", "rejected_by_company", "withdrawn"];
const QUEUED: readonly Status[] = ["awaiting_approval", "approved", "filling", "needs_input", "awaiting_submit", "needs_manual"];

const utc = (s: string) => new Date(Date.parse(s.includes("T") ? s : `${s.replace(" ", "T")}Z`));
const planJob = (j: Job): PlanJob => ({
  id: j.id,
  company: j.company,
  title: j.title,
  location: j.location,
  url: j.url,
  status: j.status,
  score: j.score,
  sentOn: j.submitted_at ? dayIn(timeZone(), utc(j.submitted_at)) : null,
});
const referralJob = (j: Job): ReferralJob => ({ id: j.id, title: j.title, company: j.company, url: j.url, status: j.status });

export const loadProfile = () => parseReferralProfile(readProfile("referral.yml"));

// The sign-off: the owner's name and LinkedIn from personal.yml, while they are filled in.
function signature(): Signature {
  let personal: Record<string, unknown> = {};
  try {
    personal = (YAML.parse(readProfile("personal.yml")) ?? {}) as Record<string, unknown>;
  } catch {
    // an unreadable personal.yml leaves the signature to the name line alone
  }
  const s = (v: unknown) => (typeof v === "string" && !v.includes("TODO-FILL") ? v.trim() : "");
  const links = (personal["links"] ?? {}) as Record<string, unknown>;
  return { name: [s(personal["first_name"]), s(personal["last_name"])].filter(Boolean).join(" "), linkedin: s(links["linkedin"]) };
}

export function referralsState(): ReferralsState {
  const day = today();
  const { profile, problems } = loadProfile();
  const contacts = store.contacts();
  const jobs = jobsInStatuses([...SENT, ...QUEUED]);
  const list = todayList({ today: day, profile, jobs: jobs.map(planJob), contacts, connections: store.connections(), suggested: store.suggestions() });
  // Named today, so the list holds still through the day and rests these employers and people after.
  store.suggest(list.suggested, day);
  const sign = signature();
  const view = (c: Contact): ReferralContact => {
    const job = c.job_id ? getJob(c.job_id) : null;
    const jobInfo = job
      ? { title: job.title, url: job.url, applied: !!job.submitted_at, inProcess: job.status === "interview" }
      : c.job_title
        ? { title: c.job_title, url: c.job_url, applied: false, inProcess: false }
        : null;
    return {
      ...c,
      job: job ? referralJob(job) : null,
      next: nextStep(c, day, profile),
      area: areaFor(profile, jobInfo?.title ?? null, c.area)?.name ?? null,
      drafts: problems.length
        ? null
        : buildDrafts({ name: c.name, company: c.company, relation: c.relation, stage: c.stage, email: c.email, area: c.area, job: jobInfo }, profile, sign),
    };
  };
  const last = store.lastExport();
  return {
    day,
    problems,
    due: list.due.map(d => ({ contactId: d.contact.id, overdue: d.overdue })),
    people: list.people.map(b => ({
      key: b.key,
      name: b.person.name,
      url: b.person.url,
      position: b.person.position,
      company: b.person.company,
      why: b.pick.why,
      jobId: b.pick.job.id,
    })),
    companies: list.companies.map(p => {
      const job = p.job.id ? getJob(p.job.id) : null;
      return {
        key: p.key,
        company: p.company,
        kind: p.kind,
        place: p.place,
        why: p.why,
        job: job ? referralJob(job) : null,
        careers: p.job.careers ?? null,
        links: searchLinks(p.company, profile, p.place),
      };
    }),
    peopleTotal: list.peopleTotal,
    contacts: contacts.map(view),
    notes: { left: notesLeft(store.notesUsed(day.slice(0, 7)), profile), perMonth: profile.linkedin.notesPerMonth, limit: profile.linkedin.noteLimit },
    linkedin: {
      lastExportOn: last?.exported_on ?? null,
      file: last?.file ?? null,
      connections: store.connectionCount(),
      due: exportDue(last?.exported_on ?? null, day, profile),
      exportUrl: EXPORT_URL,
    },
    mail: { connected: gmail.gmailStatus().connected, checkedAt: kvGet("referrals.mailAt") },
    areas: profile.areas.map(a => a.name),
  };
}

// The applications a contact can be about: sent or on their way, at the same employer.
export function jobOptions(company: string): ReferralJob[] {
  const key = companyKey(company);
  if (!key) return [];
  const same = (k: string | null) => !!k && (k === key || (Math.min(k.length, key.length) >= 5 && (k.includes(key) || key.includes(k))));
  return jobsInStatuses([...SENT, ...QUEUED])
    .filter(j => same(j.company_key ?? companyKey(j.company)))
    .sort((a, b) => Number(QUEUED.includes(a.status)) - Number(QUEUED.includes(b.status)) || b.id - a.id)
    .slice(0, 20)
    .map(referralJob);
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const jobId = (v: unknown): number | null | "bad" => {
  if (v === null || v === undefined || v === "") return null;
  const id = Number(v);
  return Number.isInteger(id) && getJob(id) ? id : "bad";
};

// Adds a person the owner found. With a job and no company, the job's employer.
export function addContact(b: Record<string, unknown>): { id: number } | string {
  const job = jobId(b["jobId"]);
  if (job === "bad") return "no such job";
  const company = text(b["company"]) || (job ? (getJob(job)?.company ?? "") : "");
  const relation = b["relation"];
  if (!text(b["name"]) || !company) return "a contact needs a name and a company";
  if (!isRelation(relation)) return "relation must be manager, alumni, engineer, recruiter or connection";
  const email = text(b["email"]);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "that email address does not look right";
  const id = store.addContact({
    name: text(b["name"]),
    title: text(b["title"]),
    company,
    profile_url: text(b["profileUrl"]),
    email,
    relation,
    job_id: job,
    area: text(b["area"]),
    notes: text(b["notes"]),
    added_on: today(),
  });
  logEvent("user", `referral contact added: ${text(b["name"])} at ${company}`, job ?? undefined);
  return { id };
}

// The owner's changes to a contact: `op` stage (where it stands now), edit, or remove.
export function changeContact(id: number, b: Record<string, unknown>): string | null {
  const c = store.contact(id);
  if (!c) return "no such contact";
  const op = text(b["op"]);
  if (op === "stage") {
    const stage = b["stage"];
    if (!isStage(stage)) return "unknown stage";
    store.setStage(id, stage, today(), b["withNote"] === true);
    logEvent("user", `referral: ${c.name} at ${c.company} is ${stage.replace("_", " ")}`, c.job_id ?? undefined);
    return null;
  }
  if (op === "edit") {
    const job = b["jobId"] === undefined ? undefined : jobId(b["jobId"]);
    if (job === "bad") return "no such job";
    if (b["relation"] !== undefined && !isRelation(b["relation"])) return "unknown relation";
    const email = b["email"] === undefined ? undefined : text(b["email"]);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "that email address does not look right";
    const str = (k: string) => (b[k] === undefined ? undefined : text(b[k]));
    store.editContact(id, {
      ...(str("name") !== undefined ? { name: str("name") ?? "" } : {}),
      ...(str("title") !== undefined ? { title: str("title") ?? "" } : {}),
      ...(str("notes") !== undefined ? { notes: str("notes") ?? "" } : {}),
      ...(email !== undefined ? { email: email || null } : {}),
      ...(str("profileUrl") !== undefined ? { profile_url: str("profileUrl") || null } : {}),
      ...(str("area") !== undefined ? { area: str("area") || null } : {}),
      ...(job !== undefined ? { job_id: job } : {}),
      ...(isRelation(b["relation"]) ? { relation: b["relation"] } : {}),
    });
    return null;
  }
  if (op === "remove") {
    store.removeContact(id);
    logEvent("user", `referral contact removed: ${c.name} at ${c.company}`, c.job_id ?? undefined);
    return null;
  }
  return "unknown change";
}

// The day an export was made: LinkedIn names the zip after it (…_10-24-2026.zip); else the file's own date.
export function exportedOn(name: string, modified: number | null): string {
  const m = /(\d{1,2})-(\d{1,2})-(\d{4})/.exec(name);
  if (m) return `${m[3]}-${(m[1] ?? "").padStart(2, "0")}-${(m[2] ?? "").padStart(2, "0")}`;
  return modified && Number.isFinite(modified) ? dayIn(timeZone(), new Date(modified)) : today();
}

// Reads an export the owner uploaded: the network it lists replaces the last one, and the contacts it
// shows moving on move on (forward only).
export function importLinkedInExport(name: string, bytes: Uint8Array, modified: number | null): ReferralImportResult {
  const ex = readExport(name, bytes);
  const result = store.atomically(() => {
    const connections = ex.connections ? store.replaceConnections(ex.connections) : null;
    let updates = 0;
    for (const b of exportBumps(ex, store.contacts())) if (store.bump(b.contactId, b.stage, b.day, b.withNote)) updates++;
    store.recordImport({
      kind: "export",
      file: name,
      fingerprint: createHash("sha256").update(bytes).digest("hex"),
      exported_on: exportedOn(name, modified),
      connections: connections ?? 0,
      updates,
    });
    return { connections, updates };
  });
  logEvent(
    "user",
    `LinkedIn export ${name} read: ${result.connections === null ? "no connections file" : `${result.connections} connections`}, ${result.updates} contact update(s)`,
  );
  return result;
}

// How far back mail is read for a contact, and how many messages per search.
const MAIL_DAYS = 30;
const PER_SEARCH = 5;
// Stages mail can still move a contact out of.
const WAITING_ON_LINKEDIN: readonly Stage[] = ["requested", "connected", "messaged", "followed_up"];

// Searches the connected mailbox (read only: nothing is marked, moved or sent) for news of each open
// contact: LinkedIn's notifications about them, and mail with those the owner has an address for.
export async function syncReferralMail(): Promise<{ checked: number; updates: number }> {
  if (!gmail.gmailStatus().connected) return { checked: 0, updates: 0 };
  const tz = timeZone();
  const header = (m: { from: string; subject: string; date: string }) => ({ from: m.from, subject: m.subject, date: m.date });
  const quoted = (s: string) => s.replace(/["\\]/g, "").trim();
  let checked = 0,
    updates = 0;
  for (const c of store.contacts()) {
    if (DONE.includes(c.stage)) continue;
    const bumps = [];
    if (WAITING_ON_LINKEDIN.includes(c.stage) && quoted(c.name)) {
      const mails = await gmail.search(`from:linkedin.com newer_than:${MAIL_DAYS}d "${quoted(c.name)}"`, PER_SEARCH);
      bumps.push(...linkedInMailBumps(c.name, mails.map(header), tz));
    }
    if (c.email && /^[^\s@"]+@[^\s@"]+$/.test(c.email)) {
      const sent = await gmail.search(`to:${c.email} -from:${c.email}`, PER_SEARCH);
      const got = await gmail.search(`from:${c.email}`, PER_SEARCH);
      bumps.push(...emailBumps(c.added_on, sent.map(header), got.map(header), tz));
    }
    checked++;
    for (const b of bumps)
      if (store.bump(c.id, b.stage, b.day)) {
        updates++;
        logEvent("mail", `referral: ${c.name} at ${c.company} is ${b.stage.replace("_", " ")} (from your mail)`, c.job_id ?? undefined);
      }
  }
  kvSet("referrals.mailAt", new Date().toISOString());
  return { checked, updates };
}
