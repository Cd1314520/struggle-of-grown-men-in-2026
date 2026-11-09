import { afterAll } from "bun:test";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "auto-apply-test-run-"));
process.env["AUTO_APPLY_DATA"] = dir;
cpSync(join(import.meta.dir, "..", "profile.example"), join(dir, "profile"), { recursive: true });
process.env["AUTO_APPLY_PROFILE"] = join(dir, "profile");
const resume = join(import.meta.dir, "..", "basic-resume");
mkdirSync(join(dir, "resume"));
for (const f of ["resume.typ", "main.example.typ"]) copyFileSync(join(resume, f), join(dir, "resume", f));
copyFileSync(join(resume, "main.example.typ"), join(dir, "resume", "main.typ"));
process.env["AUTO_APPLY_RESUME_DIR"] = join(dir, "resume");
// Never the owner's config.local.yml: the scenarios run in child processes, which read it (their own
// feeds and boards would reach the network), and a test that saves a setting would write to it.
process.env["AUTO_APPLY_LOCAL_CONFIG"] = join(dir, "config.local.yml");
afterAll(() => {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    // Windows will not remove the database that src/db.ts holds open until this process exits; the
    // directory is left in the temp folder.
    if (process.platform !== "win32") throw err;
  }
});
