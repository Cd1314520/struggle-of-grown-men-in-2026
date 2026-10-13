// Minimal client for `omp --mode rpc`: one process per unit of work, JSONL over stdio.
// The app exposes "host tools" that the agent calls back into; that is the only
// channel through which a worker changes application state.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { config, DATA, PROMPTS } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";

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

type WorkerStatus = "completed" | "aborted" | "error";
interface WorkerResult {
  status: WorkerStatus;
  error?: string;
}

// The subset of omp's RPC frames this client reads.
interface Frame {
  type?: string;
  id?: unknown;
  success?: boolean;
  command?: string;
  error?: unknown;
  toolName?: string;
  arguments?: ToolArgs;
  intent?: unknown;
  message?: { role?: string; content?: { type?: string; text?: string }[] };
  status?: unknown;
  sessionSettled?: boolean;
}
const isStatus = (value: unknown): value is WorkerStatus => value === "completed" || value === "aborted" || value === "error";

export interface WorkerOptions {
  name: string; // e.g. "prep", "fill"
  prompt: string;
  cwd: string;
  tools: Record<string, HostTool>;
  model?: string | null;
  browser?: boolean;
  cdpPort?: number; // which browser to attach to (its pacing proxy); default: the first
  builtins: string[]; // omp built-in tools this worker may use (host tools are always available)
  jobId?: number;
  maxTime?: string; // omp --max-time, e.g. "20m"
  env?: Record<string, string>;
}

export interface WorkerHandle {
  done: Promise<WorkerResult & { lastText: string }>;
  abort: () => void;
}

const overlayPath = (browser: boolean, cdpPort = config.chrome.proxyPort) => {
  const path = join(DATA, browser ? `omp-browser-${cdpPort}.yml` : "omp-nobrowser.yml");
  const overlay = {
    tools: { approvalMode: "yolo" },
    task: { eager: "default" },
    browser: browser
      ? {
          enabled: true,
          headless: false,
          cdpUrl: `http://127.0.0.1:${cdpPort}`,
          freezeOnTurnEnd: false,
          idleCloseSec: 0,
          screenshotDir: join(DATA, "screenshots"),
        }
      : { enabled: false },
  };
  mkdirSync(join(DATA, "screenshots"), { recursive: true });
  writeFileSync(path, YAML.stringify(overlay));
  return path;
};

const active = new Set<Bun.Subprocess>();
export const killAllWorkers = () => {
  for (const p of active) p.kill();
};

export function runWorker(opts: WorkerOptions): WorkerHandle {
  const sessionDir = join(DATA, "sessions", opts.name);
  mkdirSync(sessionDir, { recursive: true });
  const args = [
    "omp",
    "--mode",
    "rpc",
    "--no-ui",
    "--no-extensions",
    "--no-rules",
    "--no-skills",
    "--no-lsp",
    "--no-title",
    "--config",
    overlayPath(!!opts.browser, opts.cdpPort),
    "--session-dir",
    sessionDir,
    "--cwd",
    opts.cwd,
    "--append-system-prompt",
    join(PROMPTS, "system.md"),
    "--tools",
    opts.builtins.join(","),
  ];
  if (opts.model) args.push("--model", opts.model);
  if (opts.maxTime) args.push("--max-time", opts.maxTime);

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...opts.env },
  });
  active.add(proc);
  const send = (frame: unknown) => {
    try {
      void proc.stdin.write(JSON.stringify(frame) + "\n");
      void proc.stdin.flush();
    } catch {
      // process already gone; the exit path reports it
    }
  };
  const log = (kind: string, message: string) => {
    logEvent(kind, message, opts.jobId, opts.name);
  };

  let lastText = "";
  // Assigned from callbacks, which control-flow narrowing cannot see.
  let result = null as WorkerResult | null;
  let abortRequested = false as boolean;

  const closeInput = () => void proc.stdin.end();
  const onFrame = (f: Frame) => {
    switch (f.type) {
      case "ready":
        send({ id: "filter", type: "set_event_filter", events: ["tool_execution_start", "message_end"] });
        send({
          id: "tools",
          type: "set_host_tools",
          tools: Object.entries(opts.tools).map(([name, t]) => ({
            name,
            label: name,
            description: t.description,
            parameters: t.parameters,
            loadMode: "essential",
          })),
        });
        send({ id: "prompt", type: "prompt", message: opts.prompt });
        break;
      case "response":
        if (!f.success) {
          log("error", `omp rejected ${f.command ?? "?"}: ${String(f.error)}`);
          if (f.command === "prompt" || f.command === "set_host_tools") {
            result = { status: "error", error: String(f.error) };
            closeInput();
          }
        }
        break;
      case "host_tool_call": {
        const toolName = f.toolName ?? "";
        const tool = opts.tools[toolName];
        log("tool", `${toolName} ${JSON.stringify(f.arguments ?? {}).slice(0, 600)}`);
        void Promise.resolve()
          .then(() => {
            if (!tool) throw new Error(`unknown tool ${toolName}`);
            return tool.handler(f.arguments ?? {});
          })
          .catch((err: unknown) => `ERROR: ${errorMessage(err)}`)
          .then(text => {
            send({ type: "host_tool_result", id: f.id, result: { content: [{ type: "text", text }] } });
          });
        break;
      }
      case "tool_execution_start":
        if (typeof f.intent === "string" && f.intent) log("step", f.intent);
        break;
      case "message_end":
        if (f.message?.role === "assistant") {
          const text = (f.message.content ?? [])
            .filter(c => c.type === "text")
            .map(c => c.text)
            .join("\n")
            .trim();
          if (text) {
            lastText = text;
            log("agent", text);
          }
        }
        break;
      case "prompt_result":
        result = {
          status: isStatus(f.status) ? f.status : "error",
          ...(f.error instanceof Object && "message" in f.error ? { error: String(f.error.message) } : {}),
        };
        if (f.sessionSettled) closeInput();
        break;
      case "session_settled":
        closeInput();
        break;
    }
  };

  const pump = async () => {
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          onFrame(JSON.parse(line) as Frame);
        } catch (err) {
          log("error", `bad frame from omp: ${String(err).slice(0, 200)}`);
        }
      }
    }
  };

  const done = (async () => {
    const stderr = new Response(proc.stderr).text();
    await pump();
    const code = await proc.exited;
    active.delete(proc);
    if (!result) {
      const tail = (await stderr).trim().split("\n").slice(-5).join("\n");
      result = { status: "error", error: `omp exited with code ${code} before finishing. ${tail}` };
    }
    if (result.status !== "completed")
      log(result.status === "aborted" && abortRequested ? "system" : "error", `${opts.name} worker ${result.status}: ${result.error ?? ""}`);
    return { ...result, lastText };
  })();

  return {
    done,
    abort: () => {
      abortRequested = true;
      result ??= { status: "aborted" };
      send({ type: "abort" });
      setTimeout(() => {
        proc.kill();
      }, 3000);
    },
  };
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
