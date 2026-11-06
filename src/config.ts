import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { configProblems } from "./config-check";

export const ROOT = resolve(import.meta.dir, "..");
// Overridable so a test run can use throwaway state.
export const DATA = process.env["AUTO_APPLY_DATA"] ?? join(ROOT, "data");
export const PROFILE = process.env["AUTO_APPLY_PROFILE"] ?? join(ROOT, "profile");
export const PROMPTS = join(ROOT, "prompts");

mkdirSync(join(DATA, "jobs"), { recursive: true });

// The kinds of agent work, each run on the model `models.<stage>` names (null: omp's default).
export const MODEL_STAGES = ["triage", "discover", "locate", "screen", "prep", "fill", "track", "recheck", "import"] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface Config {
  port: number;
  publicUrl: string | null;
  vncUrl: string | null;
  mailbox: string | null;
  // Who gives the go-ahead: the app, within autoApply's bar, or the owner at both gates.
  approval: "auto" | "gated";
  // Employers saved for later: the frontier list in profile/employers.yml, plus any the assessment
  // judges to fit `describe`. While holdBack is on their jobs are held instead of applied to.
  targets: { holdBack: boolean; describe?: string | null };
  // `fallback`: per stage, the models it moves to when its provider is out, replacing the global `fallback` (src/providers.ts).
  models: Record<Exclude<ModelStage, "import">, string | null> & { import?: string | null; fallback?: Partial<Record<ModelStage, string | string[]>> };
  autoApply?: {
    minScore?: number;
    allowConcerns?: boolean;
    perDay?: number;
    perEmployer?: number;
  };
  schedule: { scanMinutes: number; discoverMinutes: number; trackMinutes: number };
  questionDigest?: { enabled: boolean; time: string; timeZone: string };
  // A form that requires a cover letter: "skip" drops the application; "draft" has the fill worker
  // draft one and park it for the owner to edit and approve, whatever `approval` says.
  coverLetters?: "skip" | "draft";
  // A case-insensitive regular expression every title must match to be read at all; the rest are dropped
  // before triage, at no cost. null or absent: every title goes to triage. `terms` ("Summer 2027"): a
  // title naming any other term is dropped too. null or absent: only terms that are over. `readPostings`:
  // models.screen reads each posting for plain dealbreakers before prep; absent or false, prep alone does.
  screen?: { titles?: string | null; terms?: string[] | null; readPostings?: boolean };
  // Postings per triage call, and the hours a smaller batch waits for more (src/scan.ts).
  triage?: { batch?: number; waitHours?: number };
  feeds?: Record<string, { minutes: number; [param: string]: unknown }>;
  boards?: import("./boards").Boards;
  concurrency: { prep: number; fill?: number };
  limits: { prepPerDay: number; applyPerDay: number; locatePerDay?: number; applySpreadHours?: number };
  fillPauseSeconds: [number, number];
  resume: { dir: string; main: string; pdfName: string };
  chrome: { cdpPort: number; proxyPort: number; display: string; window: [number, number]; vncPort: number };
  // When a stage's provider hits its usage limit, the work moves to these models in turn, and a Claude Code
  // model to these extra Claude config directories (each signed in once) in turn (src/providers.ts).
  fallback?: string[];
  claudeAccounts?: string[];
  // How long agents' step-by-step records are kept; 0 keeps them for good. Decisions, gates, errors and mail are never removed.
  retention?: { chatterDays?: number };
}

const isSection = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
// config.local.yml laid over config.yml: a section is merged key by key, anything else replaces what was there.
export function overlay(base: unknown, over: unknown): unknown {
  if (!isSection(base) || !isSection(over)) return over === undefined ? base : over;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = overlay(base[key], value);
  return merged;
}

// One file's settings with the keys from before `approval` and `targets` read as those: `phase`
// practice held targets back, and auto apply that also submitted is `approval: auto`. Old keys are
// dropped; new ones set in the same file win.
export function upgrade(file: unknown): unknown {
  if (!isSection(file)) return file;
  const out: Record<string, unknown> = { ...file };
  const phase = out["phase"];
  delete out["phase"];
  if (phase === "practice" || phase === "real") {
    const targets = isSection(out["targets"]) ? out["targets"] : {};
    out["targets"] = { holdBack: phase === "practice", ...targets };
  }
  delete out["confirmBeforeSubmit"];
  if (isSection(out["autoApply"])) {
    const { enabled, submit, phases: _phases, ...rest } = out["autoApply"];
    out["autoApply"] = rest;
    if (typeof enabled === "boolean" && out["approval"] === undefined) out["approval"] = enabled && submit !== false ? "auto" : "gated";
  }
  return out;
}

// config.yml holds the settings that are the same wherever the app runs. config.local.yml, which is
// not tracked, holds what belongs to this machine and its owner. Checked once, here, against config-check.ts: past this line the file is what `Config` says it is.
export const LOCAL_CONFIG = process.env["AUTO_APPLY_LOCAL_CONFIG"] ?? join(ROOT, "config.local.yml");
function loadConfig(): Config {
  let raw: unknown = upgrade(YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8")));
  // A test run sees config.yml alone, so it behaves the same on every machine.
  if (process.env.NODE_ENV !== "test" && existsSync(LOCAL_CONFIG)) raw = overlay(raw, upgrade(YAML.parse(readFileSync(LOCAL_CONFIG, "utf8"))));
  const problems = configProblems(raw);
  if (problems.length)
    throw new Error(`config.yml (with config.local.yml, if there is one) cannot be used:\n${problems.map(problem => `  - ${problem}`).join("\n")}`);
  started = structuredClone(raw) as Record<string, unknown>;
  return raw as Config;
}
// The files as the app started with them, before anything below or since changed the loaded config.
export let started: Record<string, unknown> = {};
export const config = loadConfig();
config.questionDigest = {
  enabled: true,
  time: "09:00",
  timeZone: "America/Chicago",
  ...config.questionDigest,
};
if (process.env["AUTO_APPLY_PORT"]) {
  // test runs: local port, no public URLs
  config.port = Number(process.env["AUTO_APPLY_PORT"]);
  config.chrome.proxyPort = config.port + 1;
  config.publicUrl = config.vncUrl = null;
}
// Whether the owner describes target employers in words, beyond the frontier list.
export const describing = () => !!config.targets.describe?.trim();

export const publicUrl = () => (config.publicUrl ?? `http://localhost:${config.port}`).replace(/\/$/, "");

// One real browser per application in flight. Browser 0 is the original one (its profile holds the
// logins made so far); each further one gets its own display, ports and profile, counted up from
// the configured ones, so nothing two applications do can meet in the same window or session.
export const browserCount = () => Math.max(1, Math.floor(config.concurrency.fill ?? 1));
export const browserSlot = (slot: number) => ({
  display: `:${Number(config.chrome.display.replace(":", "")) + slot}`,
  cdpPort: config.chrome.cdpPort + 2 * slot,
  proxyPort: config.chrome.proxyPort + 2 * slot,
  vncPort: config.chrome.vncPort ? config.chrome.vncPort + slot : 0,
  profile: join(DATA, slot ? `chrome-profile-${slot + 1}` : "chrome-profile"),
});
// The live view of browser `slot`: the configured address with its port counted up the same way.
export const vncUrl = (slot = 0) => {
  const url = new URL(config.vncUrl ?? `http://localhost:${config.chrome.vncPort}`);
  if (slot) url.port = String(Number(url.port || config.chrome.vncPort) + slot);
  return `${url.href.replace(/\/$/, "")}/vnc.html?autoconnect=1&resize=scale`;
};

export const RESUME_DIR = process.env["AUTO_APPLY_RESUME_DIR"] ?? resolve(ROOT, config.resume.dir);
export const STOCK_MAIN = join(RESUME_DIR, config.resume.main);

export const jobDir = (id: number) => {
  const dir = join(DATA, "jobs", String(id));
  mkdirSync(dir, { recursive: true });
  return dir;
};

export const readProfile = (name: string) => {
  try {
    return readFileSync(join(PROFILE, name), "utf8");
  } catch {
    return "";
  }
};
