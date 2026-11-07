import { killClaudeWorkers, runClaude } from "./claude";
import { killOmpWorkers, runOmp } from "./omp";

export type ToolArgs = Record<string, unknown>;

export interface HostTool {
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: ToolArgs) => Promise<string> | string;
}

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

export type Builtin = "read" | "write" | "edit" | "bash" | "eval" | "web_search";

export interface WorkerOptions {
  name: string;
  prompt: string;
  cwd: string;
  tools: Record<string, HostTool>;
  model?: string | null;
  browser?: boolean;
  cdpPort?: number;
  builtins: Builtin[];
  jobId?: number;
  maxTime?: string;
  env?: Record<string, string>;
}

export interface WorkerHandle {
  done: Promise<WorkerResult & { lastText: string }>;
  abort: (reason?: string) => void;
}

export type HarnessId = "omp" | "claude-code";
export const CLAUDE_PREFIX = "claude-code/";
export const harnessOf = (model: string | null | undefined): HarnessId => (model?.startsWith(CLAUDE_PREFIX) ? "claude-code" : "omp");

export function runWorker(opts: WorkerOptions): WorkerHandle {
  return harnessOf(opts.model) === "claude-code" ? runClaude(opts) : runOmp(opts);
}

export const killAllWorkers = () => {
  killOmpWorkers();
  killClaudeWorkers();
};

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
