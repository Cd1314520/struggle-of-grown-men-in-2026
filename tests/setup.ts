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
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});
