#!/usr/bin/env bun
// Brings the applications made with Internscouter (the owner's earlier Python tool) into the app, so
// they count as sent: the same posting is never applied to twice, and autoApply.perEmployer sees them.
// Reads <dir>/data/status.json (key -> Status, Applied On) and <dir>/data/jobs_db.json (key -> posting).
// Applied rows become submitted, Rejected ones rejected_by_company, Skip ones skipped; anything else is
// left out. A posting already in the database is left as it is, so running it again adds nothing.
// Stop the app first: it writes the app's own database (AUTO_APPLY_DATA, or data/).
//
//   bun scripts/import-internscouter-applications.ts E:\Job_Search [--apply]
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insertJob, logEvent, moveJob } from "../src/db";
import { to } from "../src/status";

interface Row {
  Company?: string;
  Title?: string;
  Location?: string;
  Link?: string;
  ATS?: string;
}
interface Status {
  Status?: string;
  "Applied On"?: string;
  Notes?: string;
}

const [dir, flag] = process.argv.slice(2);
if (!dir) throw new Error("usage: bun scripts/import-internscouter-applications.ts <Internscouter folder> [--apply]");
const apply = flag === "--apply";
const statuses = JSON.parse(readFileSync(join(dir, "data", "status.json"), "utf8")) as Record<string, Status>;
const postings = JSON.parse(readFileSync(join(dir, "data", "jobs_db.json"), "utf8")) as Record<string, { row?: Row }>;

const counts: Record<string, number> = {};
const count = (what: string) => (counts[what] = (counts[what] ?? 0) + 1);
for (const [key, st] of Object.entries(statuses)) {
  const row = postings[key]?.row;
  const kind = st.Status === "Applied" ? "submitted" : st.Status === "Rejected" ? "rejected" : st.Status === "Skip" ? "skipped" : null;
  if (!kind) {
    count(`left out (${st.Status ?? "no status"})`);
    continue;
  }
  if (!row?.Link || !row.Company || !row.Title) {
    count("no posting on record");
    console.log(`  no posting for ${key} (${st.Status})`);
    continue;
  }
  if (!apply) {
    count(kind);
    continue;
  }
  const id = insertJob({ url: row.Link, source: "internscouter", company: row.Company, title: row.Title, location: row.Location ?? null, description: null });
  if (id === null) {
    count("already here");
    continue;
  }
  const note = `Imported from Internscouter (${key}): ${st.Status}${st["Applied On"] ? ` on ${st["Applied On"]}` : ""}${st.Notes ? `; ${st.Notes}` : ""}`;
  if (kind === "skipped") moveJob(id, "found", to.skipped(note));
  else {
    // Sent on the day Internscouter recorded, not today.
    const sentAt = st["Applied On"] ? new Date(`${st["Applied On"]}T12:00:00Z`).toISOString() : new Date().toISOString();
    moveJob(id, "found", { ...to.submitted(note), submitted_at: sentAt });
    if (kind === "rejected") moveJob(id, "submitted", to.outcome("rejected_by_company", note));
  }
  logEvent("system", note, id, "import");
  count(kind);
}
console.log(apply ? "Imported:" : "Would import (dry run; pass --apply):", counts);
