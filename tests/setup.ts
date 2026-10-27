// Loaded before every test file (bunfig.toml). Some tests import app modules in this process, and
// src/db.ts opens and migrates the database under AUTO_APPLY_DATA as soon as it is imported. Without
// this, running the tests would upgrade the live database with whatever migrations are in the
// working tree. Scenarios that need their own state still pass their own AUTO_APPLY_DATA.
// The profile is a fresh copy of profile.example, so the tests read neither the owner's profile nor
// a missing one (a fresh checkout or CI has no profile/).
import { afterAll } from "bun:test";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "auto-apply-test-run-"));
process.env["AUTO_APPLY_DATA"] = dir;
cpSync(join(import.meta.dir, "..", "profile.example"), join(dir, "profile"), { recursive: true });
process.env["AUTO_APPLY_PROFILE"] = join(dir, "profile");
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
