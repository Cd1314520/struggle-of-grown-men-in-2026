import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";
import { configProblems } from "./config-check";

export const ROOT = resolve(import.meta.dir, "..");
export const DATA = process.env["AUTO_APPLY_DATA"] ?? join(ROOT, "data");
export const PROFILE = process.env["AUTO_APPLY_PROFILE"] ?? join(ROOT, "profile");
export const PROMPTS = join(ROOT, "prompts");

mkdirSync(join(DATA, "jobs"), { recursive: true });

export const MODEL_STAGES = ["triage", "discover", "locate", "screen", "prep", "fill", "track", "recheck", "import", "interview"] as const;
export type ModelStage = (typeof MODEL_STAGES)[number];

export interface Config {
  port: number;
  publicUrl: string | null;
  vncUrl: string | null;
  mailbox: string | null;
  approval: "auto" | "gated";
  targets: { holdBack: boolean; describe?: string | null };
  models: Record<Exclude<ModelStage, "import" | "interview">, string | null> & { import?: string | null; interview?: string | null };
  autoApply?: {
    minScore?: number;
    allowConcerns?: boolean;
    perDay?: number;
    perEmployer?: number;
    cooldownDays?: number;
  };
  schedule: { scanMinutes: number; discoverMinutes: number; trackMinutes: number };
  quietDays?: number;
  questionDigest?: { enabled: boolean; time: string; timeZone: string };
  feeds?: Record<string, { minutes: number; [param: string]: unknown }>;
  boards?: import("./boards").Boards;
  concurrency: { prep: number; fill?: number };
  limits: { prepPerDay: number; applyPerDay: number; locatePerDay?: number; applySpreadHours?: number };
  fillPauseSeconds: [number, number];
  resume: { dir: string; main: string; pdfName: string };
  chrome: { cdpPort: number; proxyPort: number; display: string; window: [number, number]; vncPort: number };
  retention?: { chatterDays?: number };
}

const isSection = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function overlay(base: unknown, over: unknown): unknown {
  if (!isSection(base) || !isSection(over)) return over === undefined ? base : over;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(over)) merged[key] = overlay(base[key], value);
  return merged;
}

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

export const LOCAL_CONFIG = process.env["AUTO_APPLY_LOCAL_CONFIG"] ?? join(ROOT, "config.local.yml");
function loadConfig(): Config {
  let raw: unknown = upgrade(YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8")));
  if (process.env.NODE_ENV !== "test" && existsSync(LOCAL_CONFIG)) raw = overlay(raw, upgrade(YAML.parse(readFileSync(LOCAL_CONFIG, "utf8"))));
  const problems = configProblems(raw);
  if (problems.length)
    throw new Error(`config.yml (with config.local.yml, if there is one) cannot be used:\n${problems.map(problem => `  - ${problem}`).join("\n")}`);
  started = structuredClone(raw) as Record<string, unknown>;
  return raw as Config;
}
export let started: Record<string, unknown> = {};
export const config = loadConfig();
config.questionDigest = {
  enabled: true,
  time: "09:00",
  timeZone: "America/Chicago",
  ...config.questionDigest,
};
if (process.env["AUTO_APPLY_PORT"]) {
  config.port = Number(process.env["AUTO_APPLY_PORT"]);
  config.chrome.proxyPort = config.port + 1;
  config.publicUrl = config.vncUrl = null;
}
export const describing = () => !!config.targets.describe?.trim();

export const publicUrl = () => (config.publicUrl ?? `http://localhost:${config.port}`).replace(/\/$/, "");

export const browserCount = () => Math.max(1, Math.floor(config.concurrency.fill ?? 1));
export const browserSlot = (slot: number) => ({
  display: `:${Number(config.chrome.display.replace(":", "")) + slot}`,
  cdpPort: config.chrome.cdpPort + 2 * slot,
  proxyPort: config.chrome.proxyPort + 2 * slot,
  vncPort: config.chrome.vncPort ? config.chrome.vncPort + slot : 0,
  profile: join(DATA, slot ? `chrome-profile-${slot + 1}` : "chrome-profile"),
});
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
