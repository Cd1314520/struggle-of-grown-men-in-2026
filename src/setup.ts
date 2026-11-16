// What a new install still needs before the app can do its work, step by step, as the Setup page shows
// it. Every check reads the machine or the files as they are now; nothing here is stored.
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadCompanies } from "./ats";
import { chromeBinary } from "./chrome";
import { config, LOCAL_CONFIG, MODEL_STAGES, PROFILE } from "./config";
import { kvGet } from "./db";
import * as gmail from "./gmail";
import type { ModelCatalog } from "./models";
import { isExample, profileProblems } from "./profile";
import { stockResume } from "./resume";
import { codexBinary } from "./codex";
import { agyBinary } from "./antigravity";
import { stageModels } from "./providers";
import { harnessOf, usesPlaywright, type HarnessId } from "./worker";

export type SetupStepId = "tools" | "models" | "machine" | "resume" | "profile" | "gmail" | "scan";
export interface SetupCheck {
  key: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string | null;
}
export interface SetupStep {
  id: SetupStepId;
  done: boolean; // every required check passes
  required: boolean;
  checks: SetupCheck[];
}
export interface SetupResult {
  steps: SetupStep[];
  remaining: number; // required steps not done
  redirectUri: string;
  localConfig: string; // where the machine's own settings are written
}

// Whether any stage's model, or a fallback of one, runs on harness `h`.
const onHarness = (h: HarnessId) => MODEL_STAGES.some(stage => stageModels(stage).some(model => harnessOf(model) === h));

const WINDOWS = process.platform === "win32";

// The programs the app starts, as the service's PATH finds them (Chrome also where Windows installs it).
// Windows has no virtual displays: Chrome is a window on the desktop, with no live view to serve.
const PROGRAMS: { name: string; purpose: string; required: () => boolean; found?: () => boolean }[] = [
  { name: "omp", purpose: "Runs the agents on omp's models", required: () => onHarness("omp") },
  { name: "claude", purpose: "Runs the agents on Claude Code's models (claude-code/…)", required: () => onHarness("claude-code") },
  {
    name: "codex",
    purpose: "Runs the agents on Codex's models (codex/…); the Codex desktop app's CLI also counts",
    required: () => onHarness("codex"),
    found: () => !!codexBinary(),
  },
  {
    name: "agy",
    purpose: "Runs the agents on Google's Antigravity CLI (antigravity/…); sign in by running agy once",
    required: () => onHarness("antigravity"),
    found: () => !!agyBinary(),
  },
  { name: "npx", purpose: "Starts Playwright's browser tools for a Claude Code, Codex or agy fill", required: () => stageModels("fill").some(usesPlaywright) },
  { name: "typst", purpose: "Compiles the stock and tailored resumes", required: () => true },
  { name: WINDOWS ? "chrome" : "google-chrome", purpose: "The browsers applications are filled in", required: () => true, found: () => !!chromeBinary() },
  { name: "Xvfb", purpose: "Virtual displays for the browsers", required: () => !WINDOWS },
  { name: "pdfinfo", purpose: "Resume page counts (poppler-utils)", required: () => true },
  { name: "pdftoppm", purpose: "Resume previews (poppler-utils)", required: () => true },
  { name: "pdftotext", purpose: "Reading uploaded PDFs and the resume journal (poppler-utils)", required: () => true },
  { name: "git", purpose: "The resume diff on a job's page", required: () => true },
  { name: "x11vnc", purpose: "The live view of a browser", required: () => !WINDOWS && config.chrome.vncPort > 0 },
  { name: "websockify", purpose: "The live view of a browser, in a web page", required: () => !WINDOWS && config.chrome.vncPort > 0 },
  { name: "tailscale", purpose: "Optional: publishing the app to your tailnet", required: () => false },
];

const check = (key: string, label: string, ok: boolean, detail: string | null = null, required = true): SetupCheck => ({ key, label, ok, required, detail });
const step = (id: SetupStepId, checks: SetupCheck[], required = true): SetupStep => ({
  id,
  required,
  checks,
  done: checks.every(c => c.ok || !c.required),
});

function tools() {
  return step(
    "tools",
    PROGRAMS.map(p => check(p.name, p.name, p.found ? p.found() : !!Bun.which(p.name), p.purpose, p.required())),
  );
}

// A stage's model is known when its harness lists it under that exact name. omp also matches names
// loosely ("opus"), and Claude Code, Codex and agy take any full model name, so an unlisted name is a
// warning, not a failure.
function models(catalog: ModelCatalog | null) {
  if (!catalog) return step("models", [check("catalog", "Model provider", false, "Checking what omp, Claude Code, Codex and agy can reach…", false)]);
  const known = new Set(catalog.models.flatMap(m => [m.selector, m.selector.slice(m.provider.length + 1)]));
  const reachable = catalog.models.length > 0;
  const harness = (h: HarnessId, label: string) => {
    const error = catalog.errors[h];
    const count = catalog.models.filter(m => harnessOf(m.selector) === h).length;
    return check(`harness.${h}`, label, !error, error ?? `${count} models`, onHarness(h));
  };
  return step("models", [
    check(
      "catalog",
      "Model provider",
      reachable,
      reachable
        ? `${catalog.models.length} models from ${new Set(catalog.models.map(m => m.provider)).size} providers`
        : Object.values(catalog.errors).join("; ") || "No models listed: log in to omp, Claude Code, Codex or agy",
    ),
    harness("omp", "omp"),
    harness("claude-code", "Claude Code"),
    harness("codex", "Codex"),
    harness("antigravity", "Antigravity (agy)"),
    ...MODEL_STAGES.map(stage => {
      const model = config.models[stage] ?? null;
      const ok = model === null || !reachable || known.has(model) || harnessOf(model) !== "omp";
      return check(`stage.${stage}`, stage, ok, model === null ? "omp's default model" : ok ? model : `${model} is not in omp's list`, false);
    }),
  ]);
}

function machine() {
  const pdfName = config.resume.pdfName;
  return step("machine", [
    check("local", "config.local.yml", existsSync(LOCAL_CONFIG), existsSync(LOCAL_CONFIG) ? "Laid over config.yml" : "Not created yet"),
    check("mailbox", "Application mailbox", !!config.mailbox, config.mailbox ?? "Not set"),
    check("publicUrl", "Public address", !!config.publicUrl, config.publicUrl ?? `Not set: the app is at http://localhost:${config.port}`, false),
    check("pdfName", "Resume file name", pdfName !== "resume.pdf", pdfName, false),
  ]);
}

function resume() {
  const stock = stockResume();
  const unfinished = profileProblems(["resume"]).length > 0;
  return step("resume", [
    check(
      "main",
      "Stock resume",
      !unfinished,
      !stock.exists ? "Not there yet: import one, or start from the example" : unfinished ? "Still has placeholders: replace the example's details" : null,
    ),
    check(
      "compiles",
      "Compiles",
      stock.exists && !stock.error,
      !stock.exists ? null : stock.error ? stock.error.split("\n")[0] || "Does not compile" : `${stock.pages ?? "?"} page${stock.pages === 1 ? "" : "s"}`,
    ),
    check(
      "notes",
      "Resume notes",
      !isExample("resume-notes.md"),
      isExample("resume-notes.md") ? "Still the example: tailoring can only reorder and trim" : null,
      false,
    ),
  ]);
}

// companies.yml runs to thousands of lines and the summary asks on every change: counted once per version of the file.
let boards: { stamp: string; count: number } | null = null;
function boardCount() {
  const file = statSync(join(PROFILE, "companies.yml"), { throwIfNoEntry: false });
  const stamp = file ? `${file.mtimeMs}:${file.size}` : "";
  if (boards?.stamp !== stamp) {
    let count = 0;
    try {
      count = loadCompanies().length;
    } catch {
      // an unreadable file shows as no boards
    }
    boards = { stamp, count };
  }
  return boards.count;
}

function profile() {
  const problems = profileProblems(["targets.md", "rubric.yml", "personal.yml", "answers.md"]);
  const file = (name: string) => check(name, name, !problems.includes(name), problems.includes(name) ? "Missing, empty, or still has placeholders" : null);
  const watched = boardCount();
  return step("profile", [
    file("targets.md"),
    file("rubric.yml"),
    file("personal.yml"),
    file("answers.md"),
    check("companies.yml", "companies.yml", watched > 0, watched ? `${watched} boards watched` : "No boards yet: discovery adds some", false),
    check("employers.yml", "employers.yml", !isExample("employers.yml"), isExample("employers.yml") ? "Still the example" : null, false),
  ]);
}

function mail() {
  const status = gmail.gmailStatus();
  const client = existsSync(join(PROFILE, "gmail-client.json"));
  return step("gmail", [
    check("client", "OAuth client", client, client ? "profile/gmail-client.json" : "profile/gmail-client.json is missing"),
    check("connected", "Connected", status.connected, status.connected ? status.address : "Not connected"),
  ]);
}

function scan() {
  const last = kvGet("last.scan");
  return step("scan", [check("scan", "First scan", !!last, last ? `Last scan ${last}` : "Not run yet")], false);
}

// `catalog` null: the model list has not been read yet (the summary never waits for it).
export function setupStatus(catalog: ModelCatalog | null): SetupResult {
  const steps = [tools(), models(catalog), machine(), resume(), profile(), mail(), scan()];
  return {
    steps,
    remaining: steps.filter(s => s.required && !s.done).length,
    redirectUri: gmail.redirectUri(),
    localConfig: LOCAL_CONFIG,
  };
}
