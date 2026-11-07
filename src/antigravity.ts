// Google's Antigravity CLI as a worker harness: `agy`, headless, with stream-json in and out. One
// process per unit of work, as with the others. agy signs in once, interactively (`agy`), and keeps
// the sign-in in the system keyring, which headless runs reuse.
//
// Host tools reach it as the same MCP server Claude Code and Codex get ("host", src/claude.ts), and a
// browser worker the same Playwright server. agy reads MCP servers only from files, not flags: the
// workspace's `.agents/mcp_config.json`, written into the worker's working directory for the run and
// removed after. Workers that share a directory (data/work) therefore start there one at a time.
// The prompt goes in on stdin, since a fill prompt is longer than a Windows command line may be.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserServer, serveHostTools, stepOf } from "./claude";
import { config, PROMPTS } from "./config";
import { logEvent } from "./db";
import { errorMessage } from "./errors";
import type { CatalogModel } from "./models";
import { AGY_PREFIX, durationMs, type WorkerHandle, type WorkerOptions, type WorkerResult } from "./worker";

// Overridable so a test can stand in a fake, which runs under Bun. The installer puts agy in
// %LOCALAPPDATA%\agy\bin, which a service's PATH may not include.
export function agyBinary(): string[] | null {
  const local = process.env["LOCALAPPDATA"] ? join(process.env["LOCALAPPDATA"], "agy", "bin", "agy.exe") : "";
  const bin = process.env["AUTO_APPLY_AGY"] ?? Bun.which("agy") ?? (local && existsSync(local) ? local : null);
  if (!bin) return null;
  return bin.endsWith(".ts") ? [process.execPath, bin] : [bin];
}

const NOTE = `\n\nThe host tools this task names (\`report_result\`, \`ask_user\` and the rest) are the tools of the same name on the "host" MCP server; the browser tools (\`browser_snapshot\`, \`browser_click\` and the rest) are on the "browser" MCP server. Never use agy's own \`send_message\`, \`schedule\`, \`generate_image\` or subagent tools.\n\n`;
// agy 1.5.2 has its own browser (open_browser_url, browser_click_element, read_browser_page,
// browser_subagent, ...) and no setting turns it off. It is not the application's Chrome, so a
// browser worker is told not to use it, and a step that does is logged as an error.
const OWN_BROWSER_NOTE = `Never use agy's own browser or web tools (\`open_browser_url\`, \`browser_click_element\`, \`browser_input\`, \`read_browser_page\`, \`browser_subagent\`, \`search_web\`, \`read_url_content\` and the like): they open a different browser. Use only the "browser" MCP server's tools.\n\n`;
const OWN_BROWSER =
  /^(?:open_browser_url|read_browser_page|list_browser_pages|click_browser_pixel|capture_browser_\w+|execute_browser_javascript|browser_(?:click_element|input|subagent|get_dom|scroll\w*|press_key|select_option|refresh_page|resize_window|mouse_\w+|move_mouse|drag_pixel_to_pixel|\w*network_request\w*))$/;

// What agy prints with no sign-in: `agy models` (1.5.2) says "Please sign in to view available models".
const SIGNED_OUT = /authentication required|please sign in/i;

// Tools that would lose the application's tab, or fill a form all at once, which bot checks flag.
const BROWSER_DISABLED = ["browser_close", "browser_fill_form", "browser_run_code_unsafe"];

// agy's stream-json events, the part this client reads.
interface ToolInfo {
  name?: string;
  parameters?: Record<string, unknown>;
  error?: { message?: string };
}
interface Step {
  step_index?: number;
  state?: string; // ACTIVE | DONE
  step_type?: string; // user_input | agent_response | tool | checkpoint
  tool_name?: string;
  text_delta?: string;
  tool_info?: ToolInfo;
}
interface Event {
  event?: string;
  conversation_id?: string;
  step_update?: Step;
  result?: { conversation_id?: string; status?: string; response?: string; error?: string };
}

const record = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") {
    try {
      return record(JSON.parse(v));
    } catch {
      return {};
    }
  }
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
};

// What a tool step is doing, for the activity log, or null for a host tool (those log themselves).
// MCP tools come either through agy's `call_mcp_tool` or, when loaded eagerly, as `mcp_<server>_<tool>`.
export function stepOfTool(name: string, params: Record<string, unknown> = {}): string | null {
  let server: string | null = null;
  let tool = name;
  let input = params;
  if (name === "call_mcp_tool") {
    server = typeof params["ServerName"] === "string" ? params["ServerName"] : "?";
    tool = typeof params["ToolName"] === "string" ? params["ToolName"] : "?";
    input = record(params["Arguments"]);
  } else {
    const eager = /^mcp_(host|browser)_(.+)$/.exec(name);
    if (eager) [, server = null, tool = name] = eager;
  }
  if (server === "host") return null;
  if (server) return stepOf(`mcp__${server}__${tool}`, input);
  if (name === "run_command") return `shell: ${typeof params["CommandLine"] === "string" ? params["CommandLine"] : ""}`.slice(0, 300);
  return stepOf(name, params);
}

// Workers that share a working directory take turns there, since the MCP config is one file in it.
const turns = new Map<string, Promise<unknown>>();
const active = new Set<Bun.Subprocess>();
export const killAgyWorkers = () => {
  for (const p of active) p.kill();
};

export function runAntigravity(opts: WorkerOptions): WorkerHandle {
  const log = (kind: string, message: string) => {
    logEvent(kind, message, opts.jobId, opts.name);
  };
  const bin = agyBinary();
  if (!bin) {
    const error = "agy is not installed";
    log("error", `${opts.name} worker error: ${error}`);
    return { done: Promise.resolve({ status: "error", error, lastText: "" }), abort: () => undefined };
  }
  const exe = bin;
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | null = null;
  // Assigned from callbacks, which control-flow narrowing cannot see.
  let result = null as WorkerResult | null;
  let abortRequested = false as boolean;
  const stop = () => {
    proc?.kill("SIGTERM");
    setTimeout(() => {
      proc?.kill("SIGKILL");
    }, 3000);
  };

  const before = turns.get(opts.cwd) ?? Promise.resolve();
  const done = before.then(() => (result ? { ...result, lastText: "" } : run()));
  turns.set(
    opts.cwd,
    done.catch(() => undefined),
  );

  async function run(): Promise<WorkerResult & { lastText: string }> {
    const model = opts.model?.slice(AGY_PREFIX.length) ?? "";
    const host = serveHostTools(opts.tools, log);
    const servers: Record<string, unknown> = {
      host: {
        serverUrl: host.config.url,
        headers: host.config.headers,
        timeoutSeconds: 48 * 3600, // host tools may wait on a person
        tools: Object.fromEntries(Object.keys(opts.tools).map(name => [name, { eager: true }])),
      },
    };
    if (opts.browser) {
      const browser = browserServer(opts.cdpPort ?? config.chrome.proxyPort);
      servers["browser"] = { command: browser.command, args: browser.args, timeoutSeconds: 600, disabledTools: BROWSER_DISABLED };
    }
    const configDir = join(opts.cwd, ".agents");
    const configFile = join(configDir, "mcp_config.json");
    const previous = existsSync(configFile) ? readFileSync(configFile, "utf8") : null;
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify({ mcpServers: servers }, null, 2));
    const restore = () => {
      try {
        if (previous === null) rmSync(configFile, { force: true });
        else writeFileSync(configFile, previous);
      } catch (err) {
        log("error", `could not remove agy's MCP config: ${errorMessage(err)}`);
      }
    };

    // No -p: with stream-json input agy takes the prompt from stdin, and -p would take the next
    // argument as its value (agy 1.5.2 then exits 2).
    const args = [...exe, "--input-format", "stream-json", "--output-format", "stream-json", "--dangerously-skip-permissions", "--disable-slash-commands"];
    if (model && model !== "default") args.push("--model", model);

    let lastText = "";
    let conversation = "";
    const logged = new Set<number>();
    const texts = new Map<number, string>();
    try {
      proc = Bun.spawn(args, { cwd: opts.cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...opts.env } });
    } catch (err) {
      restore();
      host.close();
      return { status: "error", error: `agy did not start: ${errorMessage(err)}`, lastText };
    }
    const child = proc;
    active.add(child);
    const prompt = readFileSync(join(PROMPTS, "system.md"), "utf8") + NOTE + (opts.browser ? OWN_BROWSER_NOTE : "") + opts.prompt;
    void child.stdin.write(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
    void child.stdin.flush();
    // The session ends when stdin closes, so it stays open until the turn has its result.
    const endInput = () => {
      try {
        void child.stdin.end();
      } catch {
        // already closed
      }
    };
    const timer = opts.maxTime
      ? setTimeout(() => {
          result ??= { status: "error", error: `stopped after its time allowance of ${opts.maxTime}` };
          stop();
        }, durationMs(opts.maxTime))
      : null;

    const onStep = (s: Step) => {
      const index = s.step_index ?? -1;
      if (s.step_type === "agent_response") {
        const sofar = texts.get(index) ?? "";
        const delta = s.text_delta ?? "";
        const text = delta.startsWith(sofar) ? delta : sofar + delta;
        texts.set(index, text);
        if (s.state === "DONE" && text.trim()) {
          lastText = text.trim();
          log("agent", lastText);
        }
        return;
      }
      if (s.step_type !== "tool" || logged.has(index)) return;
      const name = s.tool_info?.name ?? s.tool_name ?? "";
      if (!name) return;
      logged.add(index);
      if (opts.browser && OWN_BROWSER.test(name)) log("error", `used agy's own browser tool ${name}, not the application's browser`);
      const step = stepOfTool(name, s.tool_info?.parameters ?? {});
      if (step !== null) log("step", step);
    };

    const onEvent = (e: Event) => {
      switch (e.event) {
        case "init":
          conversation = e.conversation_id ?? conversation;
          break;
        case "step_update":
          if (e.step_update) onStep(e.step_update);
          break;
        case "result": {
          const r = e.result ?? {};
          conversation = r.conversation_id ?? conversation;
          if (r.response?.trim()) lastText = r.response.trim();
          result ??= r.status === "SUCCESS" ? { status: "completed" } : { status: "error", error: r.error || `agy ended with status ${r.status ?? "unknown"}` };
          endInput();
          break;
        }
      }
    };

    const dec = new TextDecoder();
    let buf = "";
    const stderr = new Response(child.stderr).text();
    for await (const chunk of child.stdout) {
      buf += dec.decode(chunk, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          onEvent(JSON.parse(line) as Event);
        } catch (err) {
          log("error", `bad event from agy: ${String(err).slice(0, 200)}`);
        }
      }
    }
    const code = await child.exited;
    endInput();
    active.delete(child);
    if (timer) clearTimeout(timer);
    host.close();
    restore();
    if (!result) {
      const lines = (await stderr).trim().split("\n");
      result = SIGNED_OUT.test(lines.join("\n"))
        ? { status: "error", error: "agy is not signed in (run agy once in a terminal to sign in)" }
        : { status: "error", error: `agy exited with code ${code} before finishing. ${lines.slice(-5).join("\n")}`.trim() };
    }
    if (result.status !== "completed")
      log(
        result.status === "aborted" && abortRequested ? "system" : "error",
        `${opts.name} worker ${result.status}: ${result.error ?? ""}${conversation ? ` (agy conversation ${conversation})` : ""}`,
      );
    return { ...result, lastText };
  }

  return {
    done,
    abort: () => {
      abortRequested = true;
      result ??= { status: "aborted" };
      stop();
    },
  };
}

// The models `agy models` lists: one per line, the slug, a tab (agy 1.5.2), then its name.
export function parseAgyModels(text: string): CatalogModel[] {
  const provider = AGY_PREFIX.slice(0, -1);
  return text.split(/\r?\n/).flatMap((line): CatalogModel[] => {
    const m = /^\s*([a-z0-9][\w.-]*)(?:\t+|\s{2,})(\S.*?)\s*$/i.exec(line);
    if (!m?.[1] || !m[2]) return [];
    return [{ selector: `${AGY_PREFIX}${m[1]}`, provider, name: m[2], contextWindow: null, cost: null }];
  });
}

export async function agyCatalog(): Promise<{ models: CatalogModel[]; error: string | null }> {
  const bin = agyBinary();
  if (!bin) return { models: [], error: "agy is not installed" };
  try {
    const proc = Bun.spawn([...bin, "models"], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env });
    const timer = setTimeout(() => {
      proc.kill();
    }, 30_000);
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(timer);
    if (SIGNED_OUT.test(err + out)) return { models: [], error: "agy is not signed in (run agy once in a terminal)" };
    if (code !== 0) throw new Error(err.trim().split("\n").at(-1) || `agy models exited with code ${code}`);
    return { models: parseAgyModels(out), error: null };
  } catch (err) {
    return { models: [], error: `agy: ${errorMessage(err)}` };
  }
}
