import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import YAML from "yaml";

export const ROOT = resolve(import.meta.dir, "..");
// Overridable so a test run can use throwaway state.
export const DATA = process.env.AUTO_APPLY_DATA ?? join(ROOT, "data");
export const PROFILE = process.env.AUTO_APPLY_PROFILE ?? join(ROOT, "profile");
export const PROMPTS = join(ROOT, "prompts");

mkdirSync(join(DATA, "jobs"), { recursive: true });

export interface Config {
  port: number;
  publicUrl: string | null;
  vncUrl: string | null;
  mailbox: string | null;
  phase: "practice" | "real";
  models: Record<"triage" | "discover" | "locate" | "prep" | "fill" | "track", string | null>;
  confirmBeforeSubmit: boolean;
  autoApply?: { enabled?: boolean; phases?: ("practice" | "real")[]; minScore?: number; allowConcerns?: boolean; perDay?: number; submit?: boolean };
  schedule: { scanMinutes: number; discoverMinutes: number; trackMinutes: number };
  questionDigest?: { enabled: boolean; time: string; timeZone: string };
  feeds?: Record<string, { minutes: number; [param: string]: unknown }>;
  boards?: import("./boards").Boards;
  concurrency: { prep: number; fill?: number };
  limits: { prepPerDay: number; applyPerDay: number; locatePerDay?: number };
  fillPauseSeconds: [number, number];
  resume: { dir: string; main: string; pdfName: string };
  chrome: { cdpPort: number; proxyPort: number; display: string; window: [number, number]; vncPort: number };
}

export const config: Config = YAML.parse(readFileSync(join(ROOT, "config.yml"), "utf8"));
config.questionDigest = {
  enabled: true,
  time: "09:00",
  timeZone: "America/Chicago",
  ...config.questionDigest,
};
if (typeof config.questionDigest.enabled !== "boolean" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(config.questionDigest.time)
  || typeof config.questionDigest.timeZone !== "string" || !config.questionDigest.timeZone.trim())
  throw new Error("questionDigest requires enabled: boolean, time: HH:mm (24-hour local time), and an IANA timeZone");
// Intl validates the IANA zone; never silently schedule in the host's time zone.
new Intl.DateTimeFormat("en-US", { timeZone: config.questionDigest.timeZone });
if (process.env.AUTO_APPLY_PORT) {
  // test runs: local port, no public URLs
  config.port = Number(process.env.AUTO_APPLY_PORT);
  config.chrome.proxyPort = config.port + 1;
  config.publicUrl = config.vncUrl = null;
}
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

export const RESUME_DIR = process.env.AUTO_APPLY_RESUME_DIR ?? resolve(ROOT, config.resume.dir);
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
