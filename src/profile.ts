// Whether the profile is filled in well enough to act on.
import { existsSync } from "node:fs";
import { readProfile, STOCK_MAIN } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";
import { loadRubric } from "./rubric";

// Profile files ship as templates; refuse to act on them until they are filled in.
const PLACEHOLDER = "TODO-FILL";
export function profileProblems(files = ["targets.md", "resume", "rubric.yml", "personal.yml", "answers.md"]) {
  return files.filter(f => {
    if (f === "resume") return !existsSync(STOCK_MAIN);
    if (f === "rubric.yml") {
      try {
        return (loadRubric(), false);
      } catch (err) {
        logEvent("error", errorMessage(err));
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
