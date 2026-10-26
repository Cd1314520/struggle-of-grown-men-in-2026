// Whether the profile is filled in well enough to act on, and the examples a new profile starts from.
import { constants, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PROFILE, readProfile, ROOT, STOCK_MAIN } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";
import { loadRubric } from "./rubric";

// Profile files ship as templates; refuse to act on them until they are filled in.
export const PLACEHOLDER = "TODO-FILL";
export const EXAMPLES = join(ROOT, "profile.example");

// profile/ is not tracked, so a fresh checkout has none. Each example missing from it is copied in at start,
// so every file the agents read exists and says what belongs in it; a file already there is never touched.
export function seedProfile(dir = PROFILE, from = EXAMPLES): string[] {
  mkdirSync(dir, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (existsSync(join(dir, name))) continue;
    copyFileSync(join(from, name), join(dir, name), constants.COPYFILE_EXCL);
    copied.push(name);
  }
  return copied;
}
// Whether a profile file is still the example it started as, unchanged.
export const isExample = (name: string) => existsSync(join(EXAMPLES, name)) && readProfile(name) === readFileSync(join(EXAMPLES, name), "utf8");
// Every state poll checks the profile: log a broken rubric once per distinct error, not once per poll.
let lastRubricError: string | null = null;
export function profileProblems(files = ["targets.md", "resume", "rubric.yml", "personal.yml", "answers.md"]) {
  return files.filter(f => {
    if (f === "resume") return !existsSync(STOCK_MAIN) || readFileSync(STOCK_MAIN, "utf8").includes(PLACEHOLDER);
    if (f === "rubric.yml") {
      try {
        loadRubric();
        lastRubricError = null;
        return false;
      } catch (err) {
        const message = errorMessage(err);
        if (message !== lastRubricError) logEvent("error", message);
        lastRubricError = message;
        return true;
      }
    }
    const text = readProfile(f);
    return !text.trim() || text.includes(PLACEHOLDER);
  });
}
export function requireProfile(files?: string[]) {
  const bad = profileProblems(files);
  if (bad.length) throw new Error(`Not ready: ${bad.join(", ")} (missing, empty, or still contains ${PLACEHOLDER})`);
}
