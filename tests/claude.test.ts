import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runClaude, stepOf } from "../src/claude";
import { isCapacityError } from "../src/errors";
import { durationMs, harnessOf, S, schema, type HostTool, type WorkerOptions } from "../src/worker";

const dir = mkdtempSync(join(tmpdir(), "auto-apply-claude-"));
const argsFile = join(dir, "args.json");
process.env["AUTO_APPLY_CLAUDE"] = join(import.meta.dir, "fixtures", "fake-claude.ts");
process.env["FAKE_CLAUDE_ARGS"] = argsFile;
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const tool = (handler: HostTool["handler"]): HostTool => ({ description: "Report.", parameters: schema({ note: S.str("A note") }), handler });
const run = (plan: object, opts: Partial<WorkerOptions> = {}) =>
  runClaude({ name: "test", model: "claude-code/sonnet", cwd: dir, builtins: ["read"], prompt: JSON.stringify(plan), tools: {}, ...opts });
const given = () => JSON.parse(readFileSync(argsFile, "utf8")) as string[];
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];

describe("choosing a harness", () => {
  it("runs claude-code models on Claude Code and everything else on omp", () => {
    expect(harnessOf("claude-code/opus")).toBe("claude-code");
    expect(harnessOf("anthropic/claude-opus-5-5")).toBe("omp");
    expect(harnessOf(null)).toBe("omp");
  });

  it("reads time allowances", () => {
    expect(durationMs("20m")).toBe(1_200_000);
    expect(durationMs("24h")).toBe(86_400_000);
    expect(durationMs("90s")).toBe(90_000);
    expect(() => durationMs("soon")).toThrow();
  });
});

describe("a Claude Code worker", () => {
  it("serves its host tools over MCP, behind a token, and reads the stream to the end", async () => {
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

  it("is started on the stage's model with only the tools it was given and none of the owner's setup", async () => {
    await run({ tool: "report_result", args: {} }, { tools: { report_result: tool(() => "ok") } }).done;
    const args = given();
    expect(flag(args, "--model")).toBe("sonnet");
    expect(flag(args, "--tools")).toBe("Read,Glob");
    expect(flag(args, "--setting-sources")).toBe("");
    expect(flag(args, "--permission-mode")).toBe("bypassPermissions");
    expect(args).toContain("--strict-mcp-config");
    expect(args).not.toContain("--disallowedTools");
    const servers = (JSON.parse(flag(args, "--mcp-config") ?? "{}") as { mcpServers: Record<string, { type: string; args?: string[] }> }).mcpServers;
    expect(Object.keys(servers)).toEqual(["host"]);
    expect(flag(args, "--append-system-prompt")).toContain("mcp__host__report_result");
    expect(args).not.toContain("--effort");
  });

  it("asks for the effort a model@effort selector names", async () => {
    await run({ tool: "report_result", args: {} }, { tools: { report_result: tool(() => "ok") }, model: "claude-code/claude-sonnet-5-5@low" }).done;
    const args = given();
    expect(flag(args, "--model")).toBe("claude-sonnet-5-5");
    expect(flag(args, "--effort")).toBe("low");
  });

  it("attaches Playwright to the application's proxy for a browser worker, without the tools that would lose its tab", async () => {
    await run({ tool: "report_result", args: {} }, { tools: { report_result: tool(() => "ok") }, browser: true, cdpPort: 45678, builtins: [] }).done;
    const args = given();
    expect(flag(args, "--tools")).toBe("");
    const servers = (JSON.parse(flag(args, "--mcp-config") ?? "{}") as { mcpServers: Record<string, { args: string[] }> }).mcpServers;
    const browser = servers["browser"]?.args ?? [];
    expect(flag(browser, "--cdp-endpoint")).toBe("http://127.0.0.1:45678");
    expect(browser).toContain("--no-webmcp");
    expect(flag(args, "--disallowedTools")).toContain("mcp__browser__browser_close");
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
    expect(isCapacityError(result.error)).toBe(false);
  });

  it("gives up when an MCP server it needs does not start", async () => {
    const result = await run({ failServer: "host" }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("host MCP server did not start");
  });

  it("counts an expired sign-in as the account being out, so the next account takes the work", () => {
    expect(isCapacityError("Failed to authenticate: OAuth session expired and could not be refreshed (Claude Code session 1)")).toBe(true);
    expect(isCapacityError("prep worker error: the posting could not be read")).toBe(false);
  });

  it("reports a usage limit as the provider being at capacity", async () => {
    const result = await run({ tool: "report_result", args: {}, limited: true }, { tools: { report_result: tool(() => "ok") } }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("Claude usage limit reached (five_hour");
    expect(isCapacityError(result.error)).toBe(true);
  });

  it("logs what a tool acts on, never what it types", () => {
    expect(stepOf("Bash", { command: "typst compile main.typ", description: "Compile the resume" })).toBe("Bash: Compile the resume");
    expect(stepOf("mcp__browser__browser_type", { element: "First name", text: "Ada" })).toBe("browser type: First name");
    expect(stepOf("mcp__browser__browser_snapshot")).toBe("browser snapshot");
  });
});
