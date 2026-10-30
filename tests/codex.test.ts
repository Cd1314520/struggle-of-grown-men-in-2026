import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { codexCatalog, runCodex, unwrapShell } from "../src/codex";
import { lastEventId, workerEvents } from "../src/db";
import { isCapacityError } from "../src/errors";
import { harnessOf, S, schema, usesPlaywright, type HostTool, type WorkerOptions } from "../src/worker";

const dir = mkdtempSync(join(tmpdir(), "auto-apply-codex-"));
const argsFile = join(dir, "args.json");
const home = join(dir, "codex-home");
process.env["AUTO_APPLY_CODEX"] = join(import.meta.dir, "fixtures", "fake-codex.ts");
process.env["AUTO_APPLY_CODEX_HOME"] = home;
process.env["FAKE_CODEX_ARGS"] = argsFile;
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const tool = (handler: HostTool["handler"]): HostTool => ({ description: "Report.", parameters: schema({ note: S.str("A note") }), handler });
const run = (plan: object, opts: Partial<WorkerOptions> = {}) =>
  runCodex({
    name: "codex-test",
    model: "codex/gpt-6-luna",
    cwd: dir,
    builtins: ["read"],
    prompt: `Do the task.\n${JSON.stringify(plan)}`,
    tools: {},
    ...opts,
  });
const given = () => JSON.parse(readFileSync(argsFile, "utf8")) as { argv: string[]; home: string; prompt: string };
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
// Each `-c key=value` the worker was started with, values as JSON.
const settings = (args: string[]) =>
  Object.fromEntries(
    args.flatMap((a, i) => {
      if (a !== "-c") return [];
      const kv = args[i + 1] ?? "";
      const eq = kv.indexOf("=");
      return [[kv.slice(0, eq), JSON.parse(kv.slice(eq + 1)) as unknown]];
    }),
  );
const report = { report_result: tool(() => "ok") };

describe("choosing the Codex harness", () => {
  it("runs codex models on Codex, with Playwright for the browser", () => {
    expect(harnessOf("codex/gpt-6-luna")).toBe("codex");
    expect(harnessOf("openai/gpt-6-luna")).toBe("omp");
    expect(usesPlaywright("codex/gpt-6-sol")).toBe(true);
    expect(usesPlaywright("claude-code/opus")).toBe(true);
    expect(usesPlaywright(null)).toBe(false);
  });
});

describe("a Codex worker", () => {
  it("serves its host tools over MCP, behind a token, and reads the events to the end", async () => {
    let got: unknown = null;
    const result = await run(
      { tool: "report_result", args: { note: "hello" } },
      {
        tools: {
          report_result: tool(args => {
            got = args;
            return "RECORDED";
          }),
        },
      },
    ).done;
    expect(result.status).toBe("completed");
    expect(got).toEqual({ note: "hello" });
    expect(JSON.parse(result.lastText)).toEqual({ unauthorized: 401, tools: ["report_result"], reply: "RECORDED" });
  });

  it("runs in its own home on the stage's model, read-only without write tools, with the system prompt first", async () => {
    await run({ tool: "report_result", args: {} }, { tools: report }).done;
    const { argv, home: usedHome, prompt } = given();
    expect(usedHome).toBe(home);
    expect(argv[0]).toBe("exec");
    expect(flag(argv, "-m")).toBe("gpt-6-luna");
    expect(flag(argv, "-s")).toBe("read-only");
    expect(flag(argv, "-C")).toBe(dir);
    expect(argv).toContain("--ignore-user-config");
    expect(argv).toContain("--ephemeral");
    expect(argv.at(-1)).toBe("-");
    const c = settings(argv);
    expect(c["approval_policy"]).toBe("never");
    expect(c["web_search"]).toBe("disabled");
    expect(c["mcp_servers.host.required"]).toBe(true);
    expect(c["mcp_servers.host.tool_timeout_sec"]).toBe(172800);
    expect(c["mcp_servers.host.default_tools_approval_mode"]).toBe("approve");
    expect(c["mcp_servers.browser.command"]).toBeUndefined();
    expect(prompt.startsWith("You are a worker")).toBe(true);
    expect(prompt).toContain('"host" MCP server');
  });

  it("may write in its working directory, and search, only when given those tools", async () => {
    await run({ tool: "report_result", args: {} }, { tools: report, builtins: ["read", "bash", "web_search"] }).done;
    const { argv } = given();
    expect(flag(argv, "-s")).toBe("workspace-write");
    const c = settings(argv);
    expect(c["web_search"]).toBe("live");
    expect(c["sandbox_workspace_write.exclude_tmpdir_env_var"]).toBe(true);
  });

  it("attaches Playwright to the application's proxy for a browser worker, without the tools that would lose its tab", async () => {
    await run({ tool: "report_result", args: {} }, { tools: report, browser: true, cdpPort: 45678, builtins: [] }).done;
    const c = settings(given().argv);
    const browser = c["mcp_servers.browser.args"] as string[];
    expect(flag(browser, "--cdp-endpoint")).toBe("http://127.0.0.1:45678");
    expect(browser).toContain("--no-webmcp");
    expect(c["mcp_servers.browser.disabled_tools"]).toContain("browser_close");
    expect(c["mcp_servers.browser.required"]).toBe(true);
  });

  it("logs what its commands and browser tools act on, never what they type", async () => {
    const after = lastEventId();
    await run({ tool: "report_result", args: {} }, { tools: report }).done;
    const steps = workerEvents("codex-test", after, 20)
      .filter(e => e.kind === "step")
      .map(e => e.message);
    expect(steps).toContain("shell: Get-Content notes.txt");
    expect(steps).toContain("browser type: First name");
    expect(steps.filter(s => s.startsWith("shell:"))).toHaveLength(1);
    expect(steps.join(" ")).not.toContain("Ada");
  });

  it("logs a command without the shell Codex wraps it in", () => {
    expect(unwrapShell(String.raw`"C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe" -Command 'Get-Content -LiteralPath notes.txt'`)).toBe(
      "Get-Content -LiteralPath notes.txt",
    );
    expect(unwrapShell(`/bin/bash -lc "typst compile main.typ"`)).toBe("typst compile main.typ");
    expect(unwrapShell("typst compile main.typ")).toBe("typst compile main.typ");
  });

  it("stops when aborted while a host tool is still waiting", async () => {
    const handle = run({ tool: "wait", args: {} }, { tools: { wait: tool(() => new Promise<string>(resolve => setTimeout(resolve, 60_000, "late"))) } });
    await Bun.sleep(1500);
    handle.abort();
    expect((await handle.done).status).toBe("aborted");
  });

  it("stops at its time allowance", async () => {
    const result = await run({ hang: true }, { maxTime: "1s" }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("time allowance of 1s");
  });

  it("gives up when an MCP server it needs does not start", async () => {
    const result = await run({ failServer: "host" }).done;
    expect(result.status).toBe("error");
    expect(result.error).toBe("the host MCP server did not start");
  });

  it("reports a usage limit as the provider being at capacity", async () => {
    const result = await run({ tool: "report_result", args: {}, limited: true }, { tools: report }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("usage limit");
    expect(isCapacityError(result.error)).toBe(true);
  });
});

describe("Codex's models", () => {
  it("lists the models Codex shows in its picker when signed in", async () => {
    const { models, error } = await codexCatalog();
    expect(error).toBeNull();
    expect(models.map(m => m.selector)).toEqual(["codex/gpt-6-luna", "codex/gpt-6-sol"]);
    expect(models[0]?.provider).toBe("codex");
  });

  it("says when Codex is not signed in", async () => {
    process.env["FAKE_CODEX_SIGNED_OUT"] = "1";
    try {
      const { models, error } = await codexCatalog();
      expect(models).toEqual([]);
      expect(error).toContain("not signed in");
    } finally {
      delete process.env["FAKE_CODEX_SIGNED_OUT"];
    }
  });
});
