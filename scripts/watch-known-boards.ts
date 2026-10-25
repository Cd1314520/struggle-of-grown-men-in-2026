#!/usr/bin/env bun
// Watches the boards of postings already in the database: employers found through LinkedIn, Indeed,
// the locate agent or discovery before their kind of board could be read. Lists them by default;
// with --apply, adds to profile/companies.yml each board that answers with open postings. Reads the
// database only. Run it with the app's own code: the app must know a kind of board to scan it.
import { join } from "node:path";
import { addCompany, boardOf, fetchCompany, loadCompanies, type Company } from "../src/ats";
import { DATA } from "../src/config";
import { errorMessage } from "../src/errors";
import { openDatabase } from "../src/schema";

const key = (c: Company) => `${c.ats}/${c.slug.toLowerCase()}`;

// Boards seen in the database and not watched yet, each named after the employer it was seen for most.
export function knownBoards(dbPath: string, watched: Company[] = loadCompanies()): Company[] {
  const db = openDatabase(dbPath, "readonly");
  let rows: { url: string; company: string }[];
  try {
    rows = db
      .query<{ url: string; company: string }, []>(
        "SELECT url, company FROM jobs UNION ALL SELECT s.url, j.company FROM job_sources s JOIN jobs j ON j.id = s.job_id",
      )
      .all();
  } finally {
    db.close();
  }
  const skip = new Set(watched.map(key));
  const seen = new Map<string, { board: Company; names: Map<string, number> }>();
  for (const row of rows) {
    const board = boardOf(row.url, row.company);
    if (!board || skip.has(key(board))) continue;
    const entry = seen.get(key(board)) ?? { board, names: new Map<string, number>() };
    entry.names.set(row.company, (entry.names.get(row.company) ?? 0) + 1);
    seen.set(key(board), entry);
  }
  return [...seen.values()].map(({ board, names }) => ({ ...board, name: [...names].sort((a, b) => b[1] - a[1])[0]?.[0] ?? board.name }));
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const at = args.indexOf("--db");
  const boards = knownBoards((at >= 0 ? args[at + 1] : undefined) ?? join(DATA, "app.db"));
  const byAts = new Map<string, number>();
  for (const b of boards) byAts.set(b.ats, (byAts.get(b.ats) ?? 0) + 1);
  console.log(`${boards.length} boards not watched yet: ${[...byAts].map(([ats, n]) => `${ats} ${n}`).join(", ") || "none"}`);
  if (!apply) {
    for (const b of boards) console.log(`  ${b.ats}/${b.slug}  ${b.name}`);
    if (boards.length) console.log("Run again with --apply to add those that answer with open postings.");
  } else {
    let added = 0;
    for (const b of boards) {
      try {
        const open = (await fetchCompany(b)).length;
        if (open && addCompany(b)) {
          added++;
          console.log(`  added ${b.ats}/${b.slug}  ${b.name}: ${open} open`);
        } else console.log(`  skipped ${b.ats}/${b.slug}  ${b.name}: no open postings`);
      } catch (err) {
        console.log(`  skipped ${b.ats}/${b.slug}  ${b.name}: ${errorMessage(err)}`);
      }
    }
    console.log(`Added ${added} of ${boards.length}.`);
  }
}
