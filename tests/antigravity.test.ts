import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agyCatalog, parseAgyModels, runAntigravity, stepOfTool } from "../src/antigravity";
import { lastEventId, workerEvents } from "../src/db";
import { isCapacityError } from "../src/errors";
import { harnessOf, S, schema, usesPlaywright, type HostTool, type WorkerOptions } from "../src/worker";

const dir = mkdtempSync(join(tmpdir(), "auto-apply-agy-"));
const argsFile = join(dir, "args.json");
process.env["AUTO_APPLY_AGY"] = join(import.meta.dir, "fixtures", "fake-agy.ts");
process.env["FAKE_AGY_ARGS"] = argsFile;
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

const tool = (handler: HostTool["handler"]): HostTool => ({ description: "Report.", parameters: schema({ note: S.str("A note") }), handler });
const run = (plan: object, opts: Partial<WorkerOptions> = {}) =>
  runAntigravity({
    name: "agy-test",
    model: "antigravity/gemini-3.8-flash-medium",
    cwd: dir,
    builtins: ["read"],
    prompt: `Do the task.\n${JSON.stringify(plan)}`,
    tools: {},
    ...opts,
  });
interface Given {
  argv: string[];
  cwd: string;
  event: string;
  prompt: string;
  mcp: { mcpServers: Record<string, Record<string, unknown>> } | null;
}
const given = () => JSON.parse(readFileSync(argsFile, "utf8")) as Given;
const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
const report = { report_result: tool(() => "ok") };

describe("choosing the agy harness", () => {
  it("runs antigravity models on agy, with Playwright for the browser", () => {
    expect(harnessOf("antigravity/gemini-3.8-flash-medium")).toBe("antigravity");
    expect(harnessOf("google/gemini-3.8-flash")).toBe("omp");
    expect(usesPlaywright("antigravity/gemini-4-argon-high")).toBe(true);
  });
});

describe("an agy worker", () => {
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

  it("runs headless on the stage's model, the prompt on stdin with the system prompt first", async () => {
    await run({ tool: "report_result", args: {} }, { tools: report }).done;
    const { argv, cwd, event, prompt, mcp } = given();
    expect(argv).not.toContain("-p");
    expect(flag(argv, "--input-format")).toBe("stream-json");
    expect(flag(argv, "--output-format")).toBe("stream-json");
    expect(argv).toContain("--dangerously-skip-permissions");
    expect(flag(argv, "--model")).toBe("gemini-3.8-flash-medium");
    expect(argv.join(" ")).not.toContain("Do the task");
    expect(cwd.toLowerCase()).toBe(dir.toLowerCase());
    expect(event).toBe("user");
    expect(prompt.startsWith("You are a worker")).toBe(true);
    expect(prompt).toContain('"host" MCP server');
    const host = mcp?.mcpServers["host"] ?? {};
    expect(host["timeoutSeconds"]).toBe(172800);
    expect(host["tools"]).toEqual({ report_result: { eager: true } });
    expect(mcp?.mcpServers["browser"]).toBeUndefined();
  });

  it("takes the MCP config out of the working directory afterwards, leaving one that was there", async () => {
    const own = mkdtempSync(join(dir, "own-"));
    await run({ tool: "report_result", args: {} }, { tools: report, cwd: own }).done;
    expect(existsSync(join(own, ".agents", "mcp_config.json"))).toBe(false);
    mkdirSync(join(own, ".agents"), { recursive: true });
    writeFileSync(join(own, ".agents", "mcp_config.json"), '{"mcpServers":{}}');
    await run({ tool: "report_result", args: {} }, { tools: report, cwd: own }).done;
    expect(readFileSync(join(own, ".agents", "mcp_config.json"), "utf8")).toBe('{"mcpServers":{}}');
  });

  it("starts workers that share a directory one after the other", async () => {
    const shared = mkdtempSync(join(dir, "shared-"));
    const order: string[] = [];
    const slow = run(
      { tool: "wait", args: {} },
      {
        cwd: shared,
        tools: {
          wait: tool(async () => {
            order.push("first started");
            await Bun.sleep(500);
            order.push("first done");
            return "ok";
          }),
        },
      },
    );
    const next = run({ tool: "report_result", args: {} }, { cwd: shared, tools: { report_result: tool(() => (order.push("second started"), "ok")) } });
    expect((await slow.done).status).toBe("completed");
    expect((await next.done).status).toBe("completed");
    expect(order).toEqual(["first started", "first done", "second started"]);
  });

  it("attaches Playwright to the application's proxy for a browser worker, without the tools that would lose its tab", async () => {
    await run({ tool: "report_result", args: {} }, { tools: report, browser: true, cdpPort: 45678, builtins: [] }).done;
    const browser = given().mcp?.mcpServers["browser"] ?? {};
    const args = browser["args"] as string[];
    expect(flag(args, "--cdp-endpoint")).toBe("http://127.0.0.1:45678");
    expect(args).toContain("--no-webmcp");
    expect(browser["disabledTools"]).toContain("browser_close");
    expect(browser["disabledTools"]).toContain("browser_fill_form");
    expect(given().prompt).toContain("Never use agy's own browser");
  });

  it("logs what its commands and browser tools act on, never what they type or what host tools get", async () => {
    const after = lastEventId();
    await run({ tool: "report_result", args: {} }, { tools: report }).done;
    const steps = workerEvents("agy-test", after, 20)
      .filter(e => e.kind === "step")
      .map(e => e.message);
    expect(steps.sort()).toEqual(["browser type: First name", "shell: Get-Content notes.txt"]);
    expect(steps.join(" ")).not.toContain("Ada");
  });

  it("names the steps of eager MCP tools by their server", () => {
    expect(stepOfTool("mcp_browser_browser_click", { element: "Submit" })).toBe("browser click: Submit");
    expect(stepOfTool("mcp_host_ask_user", { question: "?" })).toBeNull();
    expect(stepOfTool("call_mcp_tool", { ServerName: "browser", ToolName: "browser_navigate", Arguments: { url: "https://x.test" } })).toBe(
      "browser navigate: https://x.test",
    );
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

  it("says when agy is not signed in", async () => {
    const result = await run({ signedOut: true }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("not signed in");
    expect(isCapacityError(result.error)).toBe(true);
  });

  it("reports a quota refusal as the provider being at capacity", async () => {
    const result = await run({ tool: "report_result", args: {}, limited: true }, { tools: report }).done;
    expect(result.status).toBe("error");
    expect(result.error).toContain("Quota exceeded");
    expect(isCapacityError(result.error)).toBe(true);
  });
});

describe("agy's models", () => {
  it("lists the models agy offers", async () => {
    const { models, error } = await agyCatalog();
    expect(error).toBeNull();
    expect(models.map(m => m.selector)).toEqual(["antigravity/gemini-4-argon-high", "antigravity/gemini-3.8-flash-medium"]);
    expect(models[1]?.name).toBe("Gemini 3.8 Flash (Medium)");
    expect(models[0]?.provider).toBe("antigravity");
  });

  it("says when agy is not signed in", async () => {
    process.env["FAKE_AGY_SIGNED_OUT"] = "1";
    try {
      const { models, error } = await agyCatalog();
      expect(models).toEqual([]);
      expect(error).toContain("not signed in");
    } finally {
      delete process.env["FAKE_AGY_SIGNED_OUT"];
    }
  });

  it("reads only slug-and-name lines", () => {
    expect(parseAgyModels("Available models:\n\ngemini-x  Gemini X\ngemini-y\tGemini Y (High)\n")).toEqual([
      { selector: "antigravity/gemini-x", provider: "antigravity", name: "Gemini X", contextWindow: null, cost: null },
      { selector: "antigravity/gemini-y", provider: "antigravity", name: "Gemini Y (High)", contextWindow: null, cost: null },
    ]);
  });
});
