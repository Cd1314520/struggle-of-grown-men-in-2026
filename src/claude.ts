import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { config, DATA, PROMPTS } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";
import type { CatalogModel } from "./models";
import { CLAUDE_PREFIX, durationMs, type Builtin, type HostTool, type ToolArgs, type WorkerHandle, type WorkerOptions, type WorkerResult } from "./worker";

const claude = () => process.env["AUTO_APPLY_CLAUDE"] ?? "claude";
export const PLAYWRIGHT_MCP = ["npx", "-y", "@playwright/mcp@0.0.83"];

const BUILTINS: Record<Builtin, string[]> = {
  read: ["Read", "Glob"],
  write: ["Write"],
  edit: ["Edit"],
  bash: ["Bash"],
  eval: [],
  web_search: ["WebSearch", "WebFetch"],
};

const HOST_NOTE = `\n\nThe host tools this task names (\`report_result\`, \`ask_user\` and the rest) are your MCP tools of the same name on the "host" server: \`report_result\` is \`mcp__host__report_result\`.\n`;

interface Rpc {
  id?: string | number | null;
  method?: string;
  params?: { protocolVersion?: unknown; name?: unknown; arguments?: unknown };
}

function serveHostTools(tools: Record<string, HostTool>, log: (kind: string, message: string) => void) {
  const token = randomUUID();
  const call = async (name: string, args: ToolArgs) => {
    log("tool", `${name} ${JSON.stringify(args).slice(0, 600)}`);
    try {
      const tool = tools[name];
      if (!tool) throw new Error(`unknown tool ${name}`);
      return await tool.handler(args);
    } catch (err) {
      return `ERROR: ${errorMessage(err)}`;
    }
  };
  const answer = async (rpc: Rpc) => {
    if (rpc.id === undefined || rpc.id === null) return null;
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: rpc.id, result });
    switch (rpc.method) {
      case "initialize":
        return reply({
          protocolVersion: typeof rpc.params?.protocolVersion === "string" ? rpc.params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "auto-apply", version: "1" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.parameters })) });
      case "tools/call": {
        const args = rpc.params?.arguments;
        const name = rpc.params?.name;
        const text = await call(typeof name === "string" ? name : "", args && typeof args === "object" ? (args as ToolArgs) : {});
        return reply({ content: [{ type: "text", text }] });
      }
      default:
        return { jsonrpc: "2.0", id: rpc.id, error: { code: -32601, message: `method not found: ${rpc.method ?? "?"}` } };
    }
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
      if (req.method !== "POST") return new Response(null, { status: 405 });
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, { status: 400 });
      }
      const batch = Array.isArray(body);
      const rpcs = (batch ? body : [body]) as Rpc[];
      const replies = (await Promise.all(rpcs.map(answer))).filter(r => r !== null);
      if (!replies.length) return new Response(null, { status: 202 });
      return Response.json(batch ? replies : replies[0]);
    },
  });
  return {
    config: { type: "http", url: `http://127.0.0.1:${server.port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
    close: () => void server.stop(true),
  };
}

const browserServer = (cdpPort: number) => {
  mkdirSync(join(DATA, "screenshots"), { recursive: true });
  return {
    type: "stdio",
    command: PLAYWRIGHT_MCP[0],
    args: [
      ...PLAYWRIGHT_MCP.slice(1),
      "--cdp-endpoint",
      `http://127.0.0.1:${cdpPort}`,
      "--caps",
      "vision",
      "--no-webmcp",
      "--output-dir",
      join(DATA, "screenshots"),
      "--timeout-action",
      "60000",
    ],
  };
};

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}
interface Event {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  errors?: string[];
  mcp_servers?: { name?: string; status?: string }[];
  message?: { content?: Block[] };
  rate_limit_info?: { status?: string; rateLimitType?: string; resetsAt?: number };
}

export function stepOf(name: string, input: Record<string, unknown> = {}): string {
  const s = (key: string) => (typeof input[key] === "string" ? input[key] : "");
  const what = s("description") || s("element") || s("url") || s("query") || s("file_path") || s("pattern") || s("command");
  const tool = name.replace(/^mcp__browser__browser_/, "browser ").replace(/^mcp__\w+?__/, "");
  return (what ? `${tool}: ${what}` : tool).slice(0, 300);
}

const active = new Set<Bun.Subprocess>();
export const killClaudeWorkers = () => {
  for (const p of active) p.kill();
};

export function runClaude(opts: WorkerOptions): WorkerHandle {
  const log = (kind: string, message: string) => {
    logEvent(kind, message, opts.jobId, opts.name);
  };
  const model = opts.model?.slice(CLAUDE_PREFIX.length) ?? "";
  const sessionId = randomUUID();
  const host = serveHostTools(opts.tools, log);
  const servers: Record<string, unknown> = { host: host.config };
  if (opts.browser) servers["browser"] = browserServer(opts.cdpPort ?? config.chrome.proxyPort);
  const args = [
    claude(),
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--setting-sources",
    "",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: servers }),
    "--disable-slash-commands",
    "--no-chrome",
    "--permission-mode",
    "bypassPermissions",
    "--tools",
    [...new Set(opts.builtins.flatMap(b => BUILTINS[b]))].join(","),
    "--append-system-prompt",
    readFileSync(join(PROMPTS, "system.md"), "utf8") + HOST_NOTE,
    "--session-id",
    sessionId,
  ];
  if (model && model !== "default") args.push("--model", model);
  if (opts.browser) args.push("--disallowedTools", ["browser_close", "browser_fill_form", "browser_run_code_unsafe"].map(t => `mcp__browser__${t}`).join(","));

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...opts.env,
    MCP_TIMEOUT: "120000",
    MCP_TOOL_TIMEOUT: String(48 * 3_600_000),
  };
  delete env["CLAUDECODE"];
  const proc = Bun.spawn(args, { cwd: opts.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env });
  active.add(proc);
  void proc.stdin.write(opts.prompt);
  void proc.stdin.end();

  let lastText = "";
  let result = null as WorkerResult | null;
  let abortRequested = false as boolean;
  let limited = null as string | null;

  const stop = () => {
    proc.kill("SIGTERM");
    setTimeout(() => {
      proc.kill("SIGKILL");
    }, 3000);
  };
  const timer = opts.maxTime
    ? setTimeout(() => {
        result ??= { status: "error", error: `stopped after its time allowance of ${opts.maxTime}` };
        stop();
      }, durationMs(opts.maxTime))
    : null;

  const onEvent = (e: Event) => {
    switch (e.type) {
      case "system":
        if (e.subtype !== "init") break;
        for (const s of e.mcp_servers ?? []) {
          if (s.status !== "failed" && s.status !== "needs-auth") continue;
          result ??= { status: "error", error: `the ${s.name ?? "?"} MCP server did not start (${s.status})` };
          stop();
        }
        break;
      case "assistant":
        for (const block of e.message?.content ?? []) {
          if (block.type === "text" && block.text?.trim()) {
            lastText = block.text.trim();
            log("agent", lastText);
          } else if (block.type === "tool_use" && block.name && !block.name.startsWith("mcp__host__")) {
            log("step", stepOf(block.name, block.input));
          }
        }
        break;
      case "rate_limit_event":
        if (e.rate_limit_info?.status === "rejected") {
          const resets = e.rate_limit_info.resetsAt ? `, resets ${new Date(e.rate_limit_info.resetsAt * 1000).toISOString()}` : "";
          limited = `Claude usage limit reached (${e.rate_limit_info.rateLimitType ?? "?"}${resets})`;
        }
        break;
      case "result":
        if (e.subtype === "success" && !e.is_error) result ??= { status: "completed" };
        else {
          const said = e.result?.trim() || e.errors?.join("; ") || e.subtype || "unknown error";
          result ??= { status: "error", error: limited ? `${limited}: ${said}` : said };
        }
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
          onEvent(JSON.parse(line) as Event);
        } catch (err) {
          log("error", `bad event from claude: ${String(err).slice(0, 200)}`);
        }
      }
    }
  };

  const done = (async () => {
    const stderr = new Response(proc.stderr).text();
    await pump();
    const code = await proc.exited;
    active.delete(proc);
    if (timer) clearTimeout(timer);
    host.close();
    if (!result) {
      const tail = (await stderr).trim().split("\n").slice(-5).join("\n");
      result = { status: "error", error: `${limited ? `${limited}. ` : ""}claude exited with code ${code} before finishing. ${tail}`.trim() };
    }
    if (result.status !== "completed")
      log(
        result.status === "aborted" && abortRequested ? "system" : "error",
        `${opts.name} worker ${result.status}: ${result.error ?? ""} (Claude Code session ${sessionId})`,
      );
    return { ...result, lastText };
  })();

  return {
    done,
    abort: () => {
      abortRequested = true;
      result ??= { status: "aborted" };
      stop();
    },
  };
}

const ALIASES: { alias: string; name: string }[] = [
  { alias: "default", name: "Claude Code's default" },
  { alias: "fable", name: "Claude Fable (latest)" },
  { alias: "opus", name: "Claude Opus (latest)" },
  { alias: "sonnet", name: "Claude Sonnet (latest)" },
  { alias: "haiku", name: "Claude Haiku (latest)" },
];
export async function claudeCatalog(): Promise<{ models: CatalogModel[]; error: string | null }> {
  if (!Bun.which(claude())) return { models: [], error: "claude is not installed" };
  try {
    const proc = Bun.spawn([claude(), "auth", "status"], { stdout: "pipe", stderr: "pipe" });
    const timer = setTimeout(() => {
      proc.kill();
    }, 30_000);
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    clearTimeout(timer);
    const status = JSON.parse(out) as { loggedIn?: boolean };
    if (code !== 0 || !status.loggedIn) return { models: [], error: "claude is not signed in" };
  } catch (err) {
    return { models: [], error: `claude auth status failed: ${errorMessage(err)}` };
  }
  const provider = CLAUDE_PREFIX.slice(0, -1);
  return {
    models: ALIASES.map(({ alias, name }) => ({ selector: `${CLAUDE_PREFIX}${alias}`, provider, name, contextWindow: null, cost: null })),
    error: null,
  };
}
