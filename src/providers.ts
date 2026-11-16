// Which model and account a worker runs on. A stage's own model comes first, then its fallbacks:
// `models.fallback.<stage>` when set (it replaces the global list), else the global `fallback`. A
// Claude Code model is tried on each signed-in account in `claudeAccounts` in turn. When a provider
// (Codex, one Claude account, one of agy's quota groups, omp) refuses work for capacity it is marked out:
// until the reset it names, or for 5 minutes when it names none. Later work runs on the first choice in the chain that is not
// out, and the app pauses only when every one of them is.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { config, type ModelStage } from "./config";
import { kvGet, kvSet, logEvent } from "./db";
import { isCapacityError } from "./errors";
import { harnessOf, stageOf, type RunWorker, type ToolArgs, type WorkerOptions } from "./worker";

export interface Choice {
  model: string | null;
  provider: string; // "codex", "claude:default", "claude:<config dir>", "antigravity:gemini", "antigravity:claude-gpt" or "omp"
  env: Record<string, string>;
}

// A refusal that names no reset time is usually load, not quota: try that provider again soon.
const UNTIMED_LIMIT_MS = 5 * 60_000;
// Work resumes just after the reset, not on the second, when the provider may not have caught up.
const AFTER_RESET_MS = 30_000;

// agy keeps two quotas, each with its own five-hour and weekly limit: one for the Gemini models and one
// for the Claude and GPT models (antigravity.google/docs/models). Running out of one leaves the other.
const agyGroup = (model: string | null | undefined) => (/^antigravity\/gemini/i.test(model ?? "") ? "antigravity:gemini" : "antigravity:claude-gpt");

// Who serves a worker with this model and environment, as the limits are kept.
export function providerOf(model: string | null | undefined, env: Record<string, string> | undefined = {}): string {
  const harness = harnessOf(model);
  if (harness === "antigravity") return agyGroup(model);
  if (harness !== "claude-code") return harness;
  return `claude:${env["CLAUDE_CONFIG_DIR"] ?? "default"}`;
}

// Claude Code's own sign-in first, then each extra account that has been signed in
// (`CLAUDE_CONFIG_DIR=<dir> claude`, then /login, writes <dir>/.credentials.json).
const claudeAccounts = () => [null, ...(config.claudeAccounts ?? []).filter(dir => existsSync(join(dir, ".credentials.json")))];

function choicesFor(model: string | null): Choice[] {
  const harness = harnessOf(model);
  if (harness !== "claude-code") return [{ model, provider: providerOf(model), env: {} }];
  return claudeAccounts().map(dir => ({ model, provider: `claude:${dir ?? "default"}`, env: dir ? { CLAUDE_CONFIG_DIR: dir } : {} }));
}

// The models a stage falls back to, in order: its own list when it has one, which replaces the global
// one rather than adding to it.
export function fallbacksFor(stage: ModelStage): string[] {
  const own = config.models.fallback?.[stage];
  if (own !== undefined) return Array.isArray(own) ? own : [own];
  return config.fallback ?? [];
}

// A stage's models in order, each once: its own, then its fallbacks.
export const stageModels = (stage: ModelStage): (string | null)[] => [...new Set([config.models[stage] ?? null, ...fallbacksFor(stage)])];

// Every model and account a stage's work may run on, in order. A worker named after no stage runs on
// its own model alone.
export const chainFor = (stage: ModelStage | null, model: string | null | undefined): Choice[] =>
  (stage ? stageModels(stage) : [model ?? null]).flatMap(choicesFor);

// Before the two agy quotas were told apart, a Gemini refusal was kept under `limit.antigravity`.
export const limitedUntil = (provider: string) =>
  Math.max(Number(kvGet(`limit.${provider}`) ?? 0), provider === "antigravity:gemini" ? Number(kvGet("limit.antigravity") ?? 0) : 0);
const open = (c: Choice) => Date.now() >= limitedUntil(c.provider);

let lastProvider: string | null = null;
// The model and account new work of a stage starts on: the first in its chain whose provider is not
// out. When every one is out (the app is paused then), the first.
export function choose(stage: ModelStage | null, model?: string | null): Choice {
  const all = chainFor(stage, model);
  const choice = all.find(open) ?? all[0] ?? { model: model ?? null, provider: providerOf(model), env: {} };
  if (choice.provider !== all[0]?.provider && choice.provider !== lastProvider)
    logEvent("system", `Usage: ${all[0]?.provider} is at its limit, so ${stage ?? "the"} work runs on ${choice.model ?? "omp's default"} (${choice.provider})`);
  lastProvider = choice.provider;
  return choice;
}

// The next choice after `after` in the stage's chain whose provider is not out, or null.
export function nextChoice(stage: ModelStage | null, model: string | null | undefined, after: Choice): Choice | null {
  const all = chainFor(stage, model);
  const at = all.findIndex(c => c.provider === after.provider && c.model === after.model);
  return all.find((c, i) => i > at && open(c)) ?? null;
}

// Records that a provider refused work for capacity. Returns null while another model or account in
// the stage's chain can take the work, otherwise the moment the first of them comes back.
export function hitLimit(stage: ModelStage | null, model: string | null | undefined, provider: string, resetsAt?: number | null): number | null {
  const until = resetsAt && resetsAt > Date.now() ? resetsAt + AFTER_RESET_MS : Date.now() + UNTIMED_LIMIT_MS;
  kvSet(`limit.${provider}`, String(Math.max(until, limitedUntil(provider))));
  const all = chainFor(stage, model);
  if (all.some(open)) return null;
  return Math.min(...all.map(c => limitedUntil(c.provider)));
}

const withChoice = (opts: WorkerOptions, c: Choice): WorkerOptions => ({ ...opts, model: c.model, env: { ...opts.env, ...c.env } });

// Runs a worker on its stage's first open model and account. One that a provider refuses for capacity
// runs again at once on the next open choice, instead of the work waiting for a reset. A browser
// worker is left to its caller: it may have filled half a form, and the fill resumes that draft on
// the next choice with a prompt that says so (src/fill.ts picks its own). So is a worker that called
// a host tool before the refusal: it has changed something (a prep may have handed in its resume
// already), and a rerun would act on that again. Its caller handles the refusal as before.
export function withFallback(run: RunWorker): RunWorker {
  return opts => {
    const stage = stageOf(opts);
    if (opts.browser || !stage) return run(opts);
    let acted = false as boolean; // set from the tool handlers
    const tools = Object.fromEntries(
      Object.entries(opts.tools).map(([name, tool]) => [
        name,
        {
          ...tool,
          handler: (args: ToolArgs) => {
            acted = true;
            return tool.handler(args);
          },
        },
      ]),
    );
    let choice = choose(stage, opts.model);
    let current = run(withChoice({ ...opts, tools }, choice));
    let aborted = false as boolean;
    const done = (async () => {
      let result = await current.done;
      for (;;) {
        const next = aborted || acted || result.status !== "error" || !isCapacityError(result.error) ? null : nextChoice(stage, opts.model, choice);
        if (!next) return result;
        logEvent(
          "system",
          `${opts.name} worker refused for capacity on ${choice.model ?? "omp's default"} (${choice.provider}): running it again on ${next.model ?? "omp's default"} (${next.provider})`,
          opts.jobId,
          opts.name,
        );
        choice = next;
        current = run(withChoice({ ...opts, tools }, choice));
        result = await current.done;
      }
    })();
    return {
      done,
      abort: () => {
        aborted = true;
        current.abort();
      },
    };
  };
}
