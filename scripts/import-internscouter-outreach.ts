#!/usr/bin/env bun
// Brings InternScouter's referral outreach (its data/outreach.json, written by referral.py) into
// auto-apply's referral tables, once:
//   contacts      each with its stage, its days, whether the invite used a note, its notes; tied to an
//                 application here when one at the same employer has the same title, else keeping the
//                 role's title and link as InternScouter had them
//   connections   the LinkedIn network from the last export InternScouter read
//   suggested     which employers and people the daily list named on which day, so they rest as before
//   last export   its file name and day, so the page knows how old the network is
//
// The same file is refused a second time (by its sha256, which the database also enforces). A contact
// already brought in from an earlier, different outreach.json is skipped rather than doubled.
//
//   bun scripts/import-internscouter-outreach.ts --db data/app.db --file /path/to/outreach.json [--dry-run]
//
// The database must be at this code's schema version (`bun run migrate --db <path>`). Stop the app first:
// the import is one transaction, but the app's daily list would not see the network until its next read.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { companyKey } from "../src/company-key";
import { connectionKey, isRelation, isStage, personKey, referralStore, type DayColumn, type Relation, type Stage } from "../src/referrals";
import { openDatabase } from "../src/schema";

// referral.py's stage names and the day keys each stamps.
const STAGE: Record<string, Stage> = {
  Drafted: "drafted",
  Requested: "requested",
  Connected: "connected",
  Messaged: "messaged",
  FollowedUp: "followed_up",
  Replied: "replied",
  Referred: "referred",
  Declined: "declined",
  NoResponse: "no_response",
  Closed: "closed",
};
const DAYS: Record<string, DayColumn> = {
  requested: "requested_on",
  connected: "connected_on",
  messaged: "messaged_on",
  followed_up: "followed_up_on",
  replied: "replied_on",
  referred: "referred_on",
  closed: "closed_on",
};

interface OldContact {
  name?: string;
  title?: string;
  company?: string;
  profile_url?: string;
  relation?: string;
  stage?: string;
  email?: string;
  job_key?: string;
  job_title?: string;
  job_link?: string;
  resume?: string;
  with_note?: boolean;
  dates?: Record<string, string>;
  notes?: string;
}
interface Outreach {
  contacts?: Record<string, OldContact>;
  suggested?: Record<string, string>;
  connections?: { name?: string; url?: string; company?: string; position?: string; connected?: string }[];
  last_export?: string;
  last_export_date?: string;
}

export interface OutreachImport {
  contacts: number;
  skipped: number; // already brought in from an earlier file
  linked: number; // tied to an application here
  connections: number;
  suggested: number;
  lastExport: string | null;
}

const day = (s: unknown) => (typeof s === "string" && /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null);

// The application here a contact was about: same employer, same title.
function jobFor(db: Database, company: string, title: string): number | null {
  const want = title.trim().toLowerCase();
  if (!want) return null;
  const rows = db.query<{ id: number; title: string }, [string]>("SELECT id, title FROM jobs WHERE company_key = ? ORDER BY id DESC").all(companyKey(company));
  return rows.find(r => r.title.trim().toLowerCase() === want)?.id ?? null;
}

export function importOutreach(db: Database, file: string, options: { dryRun?: boolean } = {}): OutreachImport {
  const bytes = readFileSync(file);
  const fingerprint = createHash("sha256").update(bytes).digest("hex");
  const store = referralStore(db);
  if (store.imported(fingerprint)) throw new Error(`${file} was already imported into this database (same contents); nothing was changed`);
  let data: Outreach;
  try {
    data = JSON.parse(bytes.toString("utf8")) as Outreach;
  } catch (err) {
    throw new Error(`${file} is not JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
  if (typeof data !== "object" || (!data.contacts && !data.connections && !data.suggested))
    throw new Error(`${file} does not look like InternScouter's outreach.json (no contacts, connections or suggested)`);

  const known = new Set(store.contacts().flatMap(c => (c.legacy_id ? [c.legacy_id] : [])));
  const result: OutreachImport = { contacts: 0, skipped: 0, linked: 0, connections: 0, suggested: 0, lastExport: null };
  const run = () => {
    for (const [cid, c] of Object.entries(data.contacts ?? {})) {
      if (known.has(cid)) {
        result.skipped++;
        continue;
      }
      const name = (c.name ?? "").trim(),
        company = (c.company ?? "").trim();
      if (!name || !company) throw new Error(`contact ${cid} has no name or company`);
      const stage = STAGE[c.stage ?? "Drafted"];
      if (!stage || !isStage(stage)) throw new Error(`contact ${cid} has an unknown stage: ${c.stage ?? ""}`);
      const relation: Relation = isRelation(c.relation) ? c.relation : "engineer";
      const days: Partial<Record<DayColumn, string | null>> = {};
      for (const [k, col] of Object.entries(DAYS)) days[col] = day(c.dates?.[k]);
      const job = jobFor(db, company, c.job_title ?? "");
      if (job) result.linked++;
      store.addContact({
        name,
        title: c.title ?? "",
        company,
        profile_url: c.profile_url ?? null,
        email: c.email ?? null,
        relation,
        stage,
        days,
        job_id: job,
        job_title: job ? null : (c.job_title ?? null),
        job_url: job ? null : (c.job_link ?? null),
        area: c.resume ?? null,
        with_note: !!c.with_note,
        notes: c.notes ?? "",
        added_on: day(c.dates?.["added"]) ?? day(c.dates?.["requested"]) ?? new Date().toISOString().slice(0, 10),
        legacy_id: cid,
      });
      result.contacts++;
    }
    if (data.connections?.length)
      result.connections = store.replaceConnections(
        data.connections.map(p => ({
          name: p.name ?? "",
          url: p.url ?? null,
          company: p.company ?? "",
          position: p.position ?? "",
          connected_on: day(p.connected),
        })),
      );
    // Employers keep the key referral.py gave them, which matches auto-apply's for most names; people are
    // keyed as the daily list keys them.
    const byDay = new Map<string, string[]>();
    for (const [key, when] of Object.entries(data.suggested ?? {})) {
      const d = day(when);
      if (!d) continue;
      const k = key.startsWith("bridge:") ? `bridge:${bridgeKey(key.slice(7))}` : key;
      byDay.set(d, [...(byDay.get(d) ?? []), k]);
      result.suggested++;
    }
    for (const [d, keys] of byDay) store.suggest(keys, d);
    const lastFile = (data.last_export ?? "").replace(/:\d+$/, "");
    const lastDay = day(data.last_export_date);
    if (lastFile && lastDay) {
      store.recordImport({
        kind: "export",
        file: lastFile,
        fingerprint: createHash("sha256")
          .update(`internscouter:${data.last_export ?? ""}`)
          .digest("hex"),
        exported_on: lastDay,
        connections: result.connections,
        updates: 0,
      });
      result.lastExport = `${lastFile} (${lastDay})`;
    }
    store.recordImport({
      kind: "internscouter",
      file: basename(file),
      fingerprint,
      exported_on: null,
      connections: result.connections,
      updates: result.contacts,
    });
    if (options.dryRun) throw new DryRun();
  };
  try {
    store.atomically(run);
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
  return result;
}
class DryRun extends Error {}

// referral.py keyed a person by profile id, or by lower-cased name when the export had no URL.
const bridgeKey = (pid: string) => (/\s/.test(pid) ? connectionKey({ name: personKey(pid) }) : pid);

if (import.meta.main) {
  const args = process.argv.slice(2);
  let dbPath: string | undefined, file: string | undefined;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--db" && i + 1 < args.length) dbPath = args[++i];
    else if (arg === "--file" && i + 1 < args.length) file = args[++i];
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: bun scripts/import-internscouter-outreach.ts --db <path> --file <outreach.json> [--dry-run]");
      console.log("  --db <path>     the auto-apply database to import into (at this code's schema version)");
      console.log("  --file <path>   InternScouter's data/outreach.json");
      console.log("  --dry-run       say what would be imported, change nothing");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg ?? ""}`);
      process.exit(1);
    }
  }
  if (!dbPath || !file) {
    console.error("Both --db <path> and --file <outreach.json> are required (--help for more)");
    process.exit(1);
  }
  if (!existsSync(file)) {
    console.error(`File not found: ${file}`);
    process.exit(1);
  }
  try {
    const db = openDatabase(dbPath, "readwrite");
    try {
      const r = importOutreach(db, file, { dryRun });
      console.log(
        `${dryRun ? "Would import" : "Imported"} ${r.contacts} contact(s) (${r.linked} tied to an application, ${r.skipped} already here), ` +
          `${r.connections} connection(s), ${r.suggested} earlier suggestion(s)${r.lastExport ? `; last export ${r.lastExport}` : ""}`,
      );
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
