// Which model and account a worker runs on. A stage's own model comes first. When its provider has hit
// a usage limit, the same work runs on the next model in `fallback`, and a Claude Code model on the
// next signed-in account in `claudeAccounts`. The app pauses only when every one of them is out.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import { kvGet, kvSet, logEvent } from "./db";
import { harnessOf } from "./worker";

export interface Choice {
  model: string | null | undefined;
  provider: string; // "codex", "claude:default", "claude:<config dir>" or "omp"
  env: Record<string, string>;
}

// A refusal that names no reset time is usually load, not quota: try that provider again soon.
const UNTIMED_LIMIT_MS = 5 * 60_000;

// Claude Code's own sign-in first, then each extra account that has been signed in
// (`CLAUDE_CONFIG_DIR=<dir> claude`, then /login, writes <dir>/.credentials.json).
const claudeAccounts = () => [null, ...(config.claudeAccounts ?? []).filter(dir => existsSync(join(dir, ".credentials.json")))];

function choicesFor(model: string | null | undefined): Choice[] {
  const harness = harnessOf(model);
  if (harness !== "claude-code") return [{ model, provider: harness, env: {} }];
  return claudeAccounts().map(dir => ({ model, provider: `claude:${dir ?? "default"}`, env: dir ? { CLAUDE_CONFIG_DIR: dir } : {} }));
}
const chain = (model: string | null | undefined) => [model, ...(config.fallback ?? []).filter(m => m !== model)].flatMap(choicesFor);

export const limitedUntil = (provider: string) => Number(kvGet(`limit.${provider}`) ?? 0);
const open = (c: Choice) => Date.now() >= limitedUntil(c.provider);

let lastProvider: string | null = null;
export function choose(model: string | null | undefined): Choice {
  const all = chain(model);
  const choice = all.find(open) ?? all[0];
  if (!choice) return { model, provider: harnessOf(model), env: {} };
  if (choice.provider !== all[0]?.provider && choice.provider !== lastProvider)
    logEvent("system", `Usage: ${all[0]?.provider} is at its limit, so work runs on ${choice.model} (${choice.provider})`);
  lastProvider = choice.provider;
  return choice;
}

// Records that a provider hit its usage limit. Returns null while another model or account in the
// chain can take the work, otherwise the moment the first of them resets.
export function hitLimit(model: string | null | undefined, provider: string, resetsAt?: number): number | null {
  kvSet(`limit.${provider}`, String(resetsAt && resetsAt > Date.now() ? resetsAt : Date.now() + UNTIMED_LIMIT_MS));
  const all = chain(model);
  if (all.some(open)) return null;
  return Math.min(...all.map(c => limitedUntil(c.provider)));
}
