// Codex as a worker harness: `codex exec --json`, signed in through its own CODEX_HOME under data/
// (`bun run codex:login`). One process per unit of work, as with omp and Claude Code.
//
// Host tools reach it as the same MCP server Claude Code gets ("host", src/claude.ts), and a browser
// worker the same Playwright server. Its own home keeps the owner's Codex setup out: no AGENTS.md,
// config, skills, memories, plugins or hooks, which `--ignore-user-config` alone does not skip. Skills
// are also found outside CODEX_HOME, in ~/.agents/skills (the home directory, which CODEX_HOME does not
// move), so host skill discovery is turned off as well.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { browserServer, serveHostTools, stepOf } from "./claude";
import { config, DATA, PROMPTS } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";
import type { CatalogModel } from "./models";
import { CODEX_PREFIX, durationMs, modelEffort, type WorkerHandle, type WorkerOptions, type WorkerResult } from "./worker";

export const codexHome = () => process.env["AUTO_APPLY_CODEX_HOME"] ?? join(DATA, "codex");

// The Codex desktop app's CLI, when no `codex` is on the PATH. Bun cannot list WindowsApps, but it can
// start a program there by its full path, so PowerShell finds the path once.
let appCli: string | null | undefined;
function desktopCli(): string | null {
  if (appCli !== undefined) return appCli;
  appCli = null;
  if (process.platform !== "win32") return appCli;
  try {
    const proc = Bun.spawnSync(["powershell", "-NoProfile", "-Command", "(Get-AppxPackage OpenAI.Codex).InstallLocation"], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const dir = proc.stdout.toString().trim();
    const exe = dir && join(dir, "app", "resources", "codex.exe");
    if (exe && existsSync(exe)) appCli = exe;
  } catch {
    // no PowerShell, no app
  }
  return appCli;
}

// Overridable so a test can stand in a fake, which runs under Bun.
export function codexBinary(): string[] | null {
  const bin = process.env["AUTO_APPLY_CODEX"] ?? Bun.which("codex") ?? desktopCli();
  if (!bin) return null;
  return bin.endsWith(".ts") ? [process.execPath, bin] : [bin];
}

const NOTE = `\n\nThe host tools this task names (\`report_result\`, \`ask_user\` and the rest) are your MCP tools of the same name on the "host" MCP server.\n\n`;

// A value for `-c key=value`, which Codex parses as TOML: JSON strings and arrays of them are TOML too.
const toml = (v: string | number | boolean | string[]) => JSON.stringify(v);

// Codex's JSONL events, the part this client reads.
interface Item {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  query?: string;
  message?: string;
  changes?: { path?: string }[];
}
interface Event {
  type?: string;
  thread_id?: string;
  item?: Item;
  message?: string;
  error?: { message?: string };
}

// Codex reports each command wrapped in the shell it runs it with; the log keeps the command.
export const unwrapShell = (command: string) =>
  command.replace(
    /^(?:"[^"]*(?:powershell|pwsh|bash)(?:\.exe)?"|\S*(?:powershell|pwsh|bash)(?:\.exe)?) (?:-NoProfile )?-(?:Command|lc|c) (['"]?)([\s\S]*)\1$/i,
    "$2",
  );

// What an item is doing, for the activity log, or null for what is not logged as a step.
function stepOfItem(item: Item): string | null {
  switch (item.type) {
    case "command_execution":
      return `shell: ${unwrapShell(item.command ?? "")}`.slice(0, 300);
    case "mcp_tool_call": {
      if (item.server === "host") return null;
      const input = item.arguments && typeof item.arguments === "object" ? (item.arguments as Record<string, unknown>) : {};
      return stepOf(`mcp__${item.server ?? "?"}__${item.tool ?? "?"}`, input);
    }
    case "web_search":
      return `web search: ${item.query ?? ""}`.slice(0, 300);
    case "file_change":
      return `edit: ${(item.changes ?? []).map(c => c.path ?? "?").join(", ")}`.slice(0, 300);
    default:
      return null;
  }
}

const active = new Set<Bun.Subprocess>();
export const killCodexWorkers = () => {
  for (const p of active) p.kill();
};

export function runCodex(opts: WorkerOptions): WorkerHandle {
  const log = (kind: string, message: string) => {
    logEvent(kind, message, opts.jobId, opts.name);
  };
  const bin = codexBinary();
  if (!bin) {
    const error = "codex is not installed";
    log("error", `${opts.name} worker error: ${error}`);
    return { done: Promise.resolve({ status: "error", error, lastText: "" }), abort: () => undefined };
  }
  const { model, effort } = modelEffort(opts.model, CODEX_PREFIX);
  const host = serveHostTools(opts.tools, log);
  const tokenVar = "AUTO_APPLY_HOST_TOKEN";
  const token = host.config.headers.Authorization.replace(/^Bearer /, "");
  const writes = opts.builtins.some(b => b === "write" || b === "edit" || b === "bash");
  const set = (key: string, value: string | number | boolean | string[]) => ["-c", `${key}=${toml(value)}`];
  const args = [
    ...bin,
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--skip-git-repo-check",
    "-C",
    opts.cwd,
    "-s",
    writes ? "workspace-write" : "read-only",
    ...set("approval_policy", "never"),
    // Codex lists the skills in CODEX_HOME/skills, ~/.agents/skills and its own bundled set in the
    // prompt. A worker gets none. (`features.skip_host_skill_discovery` does not stop the
    // ~/.agents/skills search in codex-cli 0.164, and warns that it is unstable.)
    ...set("skills.include_instructions", false),
    // Codex's shell always runs in its sandbox; its writable root is the working directory alone.
    ...set("sandbox_workspace_write.exclude_tmpdir_env_var", true),
    ...set("sandbox_workspace_write.exclude_slash_tmp", true),
    ...(process.platform === "win32" ? set("windows.sandbox", "elevated") : []),
    ...set("web_search", opts.builtins.includes("web_search") ? "live" : "disabled"),
    ...set("mcp_servers.host.url", host.config.url),
    ...set("mcp_servers.host.bearer_token_env_var", tokenVar),
    ...set("mcp_servers.host.required", true),
    // MCP calls otherwise wait for an approval that `approval_policy = "never"` turns into a refusal.
    ...set("mcp_servers.host.default_tools_approval_mode", "approve"),
    ...set("mcp_servers.host.tool_timeout_sec", 48 * 3600), // host tools may wait on a person
  ];
  if (opts.browser) {
    const browser = browserServer(opts.cdpPort ?? config.chrome.proxyPort);
    args.push(
      ...set("mcp_servers.browser.command", browser.command ?? ""),
      ...set("mcp_servers.browser.args", browser.args),
      ...set("mcp_servers.browser.required", true),
      ...set("mcp_servers.browser.default_tools_approval_mode", "approve"),
      ...set("mcp_servers.browser.startup_timeout_sec", 120), // npx may fetch Playwright's server on its first run
      ...set("mcp_servers.browser.tool_timeout_sec", 600),
      // As for Claude Code: closing the page loses the tab, and a form filled at once gets flagged.
      ...set("mcp_servers.browser.disabled_tools", ["browser_close", "browser_fill_form", "browser_run_code_unsafe"]),
    );
  }
  if (model && model !== "default") args.push("-m", model);
  if (effort) args.push(...set("model_reasoning_effort", effort));
  args.push("-");

  const home = codexHome();
  mkdirSync(home, { recursive: true });
  const env: Record<string, string | undefined> = { ...process.env, ...opts.env, CODEX_HOME: home, [tokenVar]: token };
  const proc = Bun.spawn(args, { cwd: opts.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env });
  active.add(proc);
  void proc.stdin.write(readFileSync(join(PROMPTS, "system.md"), "utf8") + NOTE + opts.prompt);
  void proc.stdin.end();

  let lastText = "";
  let threadId = "";
  // Assigned from callbacks, which control-flow narrowing cannot see.
  let result = null as WorkerResult | null;
  let abortRequested = false as boolean;
  let failure = null as string | null;
  const logged = new Set<string>();

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

  const onItem = (item: Item, completed: boolean) => {
    if (item.type === "agent_message") {
      if (completed && item.text?.trim()) {
        lastText = item.text.trim();
        log("agent", lastText);
      }
      return;
    }
    if (item.type === "error") {
      if (completed && item.message) log("error", `codex: ${item.message.slice(0, 600)}`);
      return;
    }
    // A step is logged when it starts, or when it completes if Codex sent no start.
    const key = item.id ?? "";
    if (key && logged.has(key)) return;
    const step = stepOfItem(item);
    if (step === null) return;
    if (key) logged.add(key);
    log("step", step);
  };

  const onEvent = (e: Event) => {
    switch (e.type) {
      case "thread.started":
        threadId = e.thread_id ?? "";
        break;
      case "item.started":
      case "item.completed":
        if (e.item) onItem(e.item, e.type === "item.completed");
        break;
      case "turn.completed":
        result ??= { status: "completed" };
        break;
      case "turn.failed":
        result ??= { status: "error", error: e.error?.message ?? failure ?? "the turn failed" };
        break;
      case "error":
        // Reconnect notices come as errors too; the last one says why the turn failed.
        failure = e.message ?? failure;
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
          log("error", `bad event from codex: ${String(err).slice(0, 200)}`);
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
      const lines = (await stderr).trim().split("\n");
      const server = /required MCP servers failed to initialize: (\w+)/.exec(lines.join("\n"))?.[1];
      result = server
        ? { status: "error", error: `the ${server} MCP server did not start` }
        : { status: "error", error: `${failure ? `${failure}. ` : ""}codex exited with code ${code} before finishing. ${lines.slice(-5).join("\n")}`.trim() };
    }
    if (result.status !== "completed")
      log(
        result.status === "aborted" && abortRequested ? "system" : "error",
        `${opts.name} worker ${result.status}: ${result.error ?? ""}${threadId ? ` (Codex thread ${threadId})` : ""}`,
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

// Runs `codex <args>` against the app's CODEX_HOME, for at most 30 seconds.
async function codexCommand(args: string[]): Promise<{ out: string; code: number }> {
  const bin = codexBinary();
  if (!bin) throw new Error("codex is not installed");
  mkdirSync(codexHome(), { recursive: true });
  const proc = Bun.spawn([...bin, ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, CODEX_HOME: codexHome() } });
  const timer = setTimeout(() => {
    proc.kill();
  }, 30_000);
  const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  return { out, code };
}

// The models Codex lists for this sign-in, from `codex debug models`.
export function parseCodexModels(json: string): CatalogModel[] {
  const parsed = JSON.parse(json) as { models?: unknown };
  if (!Array.isArray(parsed.models)) return [];
  const provider = CODEX_PREFIX.slice(0, -1);
  return parsed.models.flatMap((m: unknown): CatalogModel[] => {
    if (!m || typeof m !== "object") return [];
    const r = m as Record<string, unknown>;
    if (typeof r["slug"] !== "string" || r["visibility"] !== "list") return [];
    const name = typeof r["display_name"] === "string" ? r["display_name"] : r["slug"];
    return [{ selector: `${CODEX_PREFIX}${r["slug"]}`, provider, name, contextWindow: null, cost: null }];
  });
}

export async function codexCatalog(): Promise<{ models: CatalogModel[]; error: string | null }> {
  if (!codexBinary()) return { models: [], error: "codex is not installed" };
  try {
    if ((await codexCommand(["login", "status"])).code !== 0) return { models: [], error: "codex is not signed in (bun run codex:login)" };
    const listed = await codexCommand(["debug", "models"]);
    if (listed.code !== 0) throw new Error(`codex debug models exited with code ${listed.code}`);
    return { models: parseCodexModels(listed.out), error: null };
  } catch (err) {
    return { models: [], error: `codex: ${errorMessage(err)}` };
  }
}
