// Agent workers, whichever harness runs them: one process per unit of work, given a prompt and the
// app's "host tools". The agent calls back into those tools; that is the only channel through which a
// worker changes application state. The stage's model picks the harness: `claude-code/<model>` runs
// on Claude Code (src/claude.ts), `codex/<model>` on Codex (src/codex.ts), anything else on omp (src/omp.ts).
import { killClaudeWorkers, runClaude } from "./claude";
import { killCodexWorkers, runCodex } from "./codex";
import { config, MODEL_STAGES, type ModelStage } from "./config";
import { logEvent } from "./db";
import { isUsageLimit } from "./errors";
import { isLimited } from "./limits";
import { killOmpWorkers, runOmp } from "./omp";

// Whatever the agent sent: nothing about it is trusted until read through `arg`.
export type ToolArgs = Record<string, unknown>;

export interface HostTool {
  description: string;
  parameters: Record<string, unknown>;
  // Return value is shown to the agent. May stay pending for a long time (human gates).
  handler: (args: ToolArgs) => Promise<string> | string;
}

// Typed reads of tool arguments. A wrong type throws, which the agent sees as an ERROR reply.
export const arg = {
  str(args: ToolArgs, key: string): string {
    const value = args[key];
    if (typeof value !== "string") throw new Error(`${key} must be a string`);
    return value;
  },
  optStr(args: ToolArgs, key: string): string | undefined {
    const value = args[key];
    if (value === undefined || value === null) return undefined;
    if (typeof value !== "string") throw new Error(`${key} must be a string`);
    return value;
  },
  int(args: ToolArgs, key: string): number {
    const value = args[key];
    if (typeof value !== "number" || !Number.isInteger(value)) throw new Error(`${key} must be an integer`);
    return value;
  },
  optInt(args: ToolArgs, key: string): number | undefined {
    const value = args[key];
    return value === undefined || value === null ? undefined : arg.int(args, key);
  },
  ints(args: ToolArgs, key: string): number[] {
    const value = args[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((v): v is number => typeof v === "number")) throw new Error(`${key} must be an array of integers`);
    return value;
  },
  oneOf<T extends string>(args: ToolArgs, key: string, allowed: readonly T[]): T {
    const value = args[key];
    const found = allowed.find(a => a === value);
    if (found === undefined) throw new Error(`${key} must be one of ${allowed.join(", ")}`);
    return found;
  },
};

export type WorkerStatus = "completed" | "aborted" | "error";
export interface WorkerResult {
  status: WorkerStatus;
  error?: string;
}
export const isStatus = (value: unknown): value is WorkerStatus => value === "completed" || value === "aborted" || value === "error";

// The built-in abilities a worker may be given, by omp's names; each harness maps them to its own tools.
// `eval` is omp's JavaScript session, which Claude Code has no equivalent of.
export type Builtin = "read" | "write" | "edit" | "bash" | "eval" | "web_search";

export interface WorkerOptions {
  name: string; // e.g. "prep", "fill"
  stage?: ModelStage; // whose `models.<stage>` it runs on, when that is not its name
  prompt: string;
  cwd: string;
  tools: Record<string, HostTool>;
  model?: string | null;
  browser?: boolean;
  cdpPort?: number; // which browser to attach to (its pacing proxy); default: the first
  builtins: Builtin[]; // built-in tools this worker may use (host tools are always available)
  jobId?: number;
  maxTime?: string; // how long it may run, e.g. "20m"
  env?: Record<string, string>;
}

export interface WorkerHandle {
  done: Promise<WorkerResult & { lastText: string }>;
  abort: () => void;
}

export type HarnessId = "omp" | "claude-code" | "codex";
export const CLAUDE_PREFIX = "claude-code/";
export const CODEX_PREFIX = "codex/";
// null is omp's default model.
export const harnessOf = (model: string | null | undefined): HarnessId =>
  model?.startsWith(CLAUDE_PREFIX) ? "claude-code" : model?.startsWith(CODEX_PREFIX) ? "codex" : "omp";

// Claude Code and Codex both reach the browser through Playwright's MCP server, not omp's browser tool.
export const usesPlaywright = (model: string | null | undefined) => harnessOf(model) !== "omp";

export function runWorker(opts: WorkerOptions): WorkerHandle {
  const harness = harnessOf(opts.model);
  return harness === "claude-code" ? runClaude(opts) : harness === "codex" ? runCodex(opts) : runOmp(opts);
}

export const stageOf = (opts: Pick<WorkerOptions, "name" | "stage">): ModelStage | null => opts.stage ?? MODEL_STAGES.find(s => s === opts.name) ?? null;

// The models a stage may run on, in order: its own, then each of `models.fallback.<stage>` once.
export function modelChain(stage: ModelStage): (string | null)[] {
  const listed = config.models.fallback?.[stage];
  const fallbacks = listed === undefined ? [] : Array.isArray(listed) ? listed : [listed];
  return [...new Set([config.models[stage] ?? null, ...fallbacks])];
}

// The first model in the chain from index `from` on whose account is not at its usage limit, or
// undefined when there is none.
function firstFree(chain: (string | null)[], from: number): string | null | undefined {
  const at = chain.findIndex((m, i) => i >= from && !isLimited(m));
  return at < 0 ? undefined : chain[at];
}

// The model to move to after `model` ended on a usage limit: the next one in the chain not at its
// own limit, or null when none is left.
export function nextFallback(stage: ModelStage | null, model: string | null | undefined): string | null {
  if (!stage) return null;
  const chain = modelChain(stage);
  const at = chain.indexOf(model ?? null);
  return at < 0 ? null : (firstFree(chain, at + 1) ?? null);
}

// The model new work of a stage starts on instead of `model`: `model` itself, or, while it is at its
// usage limit, the first fallback after it that is not. When every one is limited, `model`.
export function availableModel(stage: ModelStage | null, model: string | null | undefined): string | null {
  if (!stage) return model ?? null;
  const chain = modelChain(stage);
  const at = chain.indexOf(model ?? null);
  const free = at < 0 ? undefined : firstFree(chain, at);
  return free === undefined ? (model ?? null) : free;
}

// A worker that ends on a usage limit runs again at once on its stage's next fallback model, instead
// of the work waiting hours for the limit to reset. A browser worker is left to its caller: it may
// have filled half a form, and the fill resumes that draft with a prompt that says so (src/fill.ts).
// So is a worker that called a host tool before the limit: it has changed something (a prep may have
// handed in its resume already), and a rerun would act on that again. Its caller handles the refusal
// as before, and the next worker of that stage starts on the fallback. While a model is at its limit
// (src/limits.ts), new work starts on the first fallback that is not, and goes back to the stage's own
// model once that one's limit resets.
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
    let model = availableModel(stage, opts.model);
    if (model !== (opts.model ?? null))
      logEvent(
        "system",
        `${opts.name} worker runs on ${model ?? "omp's default"}: ${opts.model ?? "omp's default"} is at its usage limit`,
        opts.jobId,
        opts.name,
      );
    let current = run({ ...opts, model, tools });
    let aborted = false as boolean;
    const done = (async () => {
      let result = await current.done;
      for (;;) {
        const next = aborted || acted || result.status !== "error" || !isUsageLimit(result.error) ? null : nextFallback(stage, model);
        if (!next) return result;
        logEvent("system", `${opts.name} worker hit a usage limit on ${model ?? "omp's default"}: running it again on ${next}`, opts.jobId, opts.name);
        model = next;
        current = run({ ...opts, model, tools });
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

export const killAllWorkers = () => {
  killOmpWorkers();
  killClaudeWorkers();
  killCodexWorkers();
};

// "20m", "24h", "90s" in milliseconds.
export function durationMs(text: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/.exec(text.trim());
  if (!m) throw new Error(`not a duration: ${text}`);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[m[2] ?? "s"] ?? 1000;
  return Number(m[1]) * unit;
}

const str = (description: string) => ({ type: "string", description });
export const schema = (properties: Record<string, unknown>, required: string[] = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
export const S = { str, int: (description: string) => ({ type: "integer", description }) };
export type RunWorker = typeof runWorker;
