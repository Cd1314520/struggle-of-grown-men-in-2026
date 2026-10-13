#!/usr/bin/env bun
// Upgrades a database to this code's schema version, or reports where it stands. The app does the
// same on every start; this is for a database the app is not running against, such as a restored
// backup the journal scripts are about to read.
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { MIGRATIONS, SCHEMA_VERSION, openDatabase, schemaVersion } from "../src/schema";

export interface MigrationReport {
  path: string;
  from: number;
  to: number;
  pending: string[];
  applied: boolean;
}

const describe = (from: number) => MIGRATIONS.filter(m => m.version > from).map(m => `${m.version} (${m.name})`);

export function runMigrate(options: { dbPath: string; status?: boolean; silent?: boolean }): MigrationReport {
  const { dbPath } = options;
  if (!existsSync(dbPath)) throw new Error(`Database file not found: ${dbPath}`);
  const say = (line: string) => {
    if (!options.silent) console.log(line);
  };

  const before = new Database(dbPath, { readonly: true });
  let from: number;
  try {
    from = schemaVersion(before);
  } finally {
    before.close();
  }
  if (from > SCHEMA_VERSION)
    throw new Error(`${dbPath} is at schema version ${from}, but this code only knows up to version ${SCHEMA_VERSION}. Run the newer code.`);
  const pending = describe(from);

  if (options.status || !pending.length) {
    say(`${dbPath}: schema version ${from} of ${SCHEMA_VERSION}${pending.length ? `; pending: ${pending.join(", ")}` : "; up to date"}`);
    return { path: dbPath, from, to: from, pending, applied: false };
  }
  const db = openDatabase(dbPath, "migrate");
  let to: number;
  try {
    to = schemaVersion(db);
  } finally {
    db.close();
  }
  say(`${dbPath}: upgraded schema version ${from} -> ${to}; applied: ${pending.join(", ")}`);
  return { path: dbPath, from, to, pending, applied: true };
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  let dbPath: string | undefined;
  let status = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--status") status = true;
    else if (arg === "--db" && i + 1 < args.length) dbPath = args[++i];
    else if (arg === "-h" || arg === "--help") {
      console.log("Usage: bun scripts/migrate.ts [--status] [--db <path>]");
      console.log("  --status      Report the schema version and pending migrations without changing anything");
      console.log("  --db <path>   Path to the sqlite database (default: data/app.db)");
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg ?? ""}`);
      process.exit(1);
    }
  }
  // Read the configured data directory only when no path was given: config has side effects.
  dbPath ??= join((await import("../src/config")).DATA, "app.db");
  try {
    runMigrate({ dbPath, status });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
