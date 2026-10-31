#!/usr/bin/env bun
// Stands in for `codex exec --json`: the prompt's last line is a JSON plan of what to do. It records
// its arguments and CODEX_HOME, calls the app's host-tool MCP server the way Codex would, and prints
// Codex's JSONL events. Subcommands `login status` and `debug models` answer as a signed-in Codex.
// Like Codex, it lists the skills on the host (in CODEX_HOME/skills and ~/.agents/skills) in the
// prompt unless `skills.include_instructions` is false, and records the ones it listed.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

interface Plan {
  tool?: string;
  args?: Record<string, unknown>;
  hang?: boolean; // wait instead of calling the tool
  failServer?: string; // fail at start as if this required MCP server did not initialize
  limited?: boolean; // end refused by a usage limit
}
const argv = process.argv.slice(2);
if (argv[0] === "login") process.exit(process.env["FAKE_CODEX_SIGNED_OUT"] ? 1 : 0);
if (argv[0] === "debug") {
  const model = (slug: string, visibility: string) => ({ slug, display_name: slug.toUpperCase(), visibility });
  console.log(JSON.stringify({ models: [model("gpt-6-luna", "list"), model("gpt-6-sol", "list"), model("codex-auto-review", "hide")] }));
  process.exit(0);
}
const input = await new Response(Bun.stdin.stream()).text();
const plan = JSON.parse(input.trim().split("\n").at(-1) ?? "{}") as Plan;
// Each `-c key=value`, its value parsed as JSON (the TOML subset the client sends).
const settings: Record<string, unknown> = {};
argv.forEach((a, i) => {
  if (a !== "-c") return;
  const kv = argv[i + 1] ?? "";
  const eq = kv.indexOf("=");
  settings[kv.slice(0, eq)] = JSON.parse(kv.slice(eq + 1));
});
const userHome = process.env["HOME"] ?? process.env["USERPROFILE"] ?? "";
const roots = settings["skills.include_instructions"] === false ? [] : [join(process.env["CODEX_HOME"] ?? "", "skills"), join(userHome, ".agents", "skills")];
const skills = roots.flatMap(root => (existsSync(root) ? readdirSync(root).filter(name => existsSync(join(root, name, "SKILL.md"))) : []));
await Bun.write(process.env["FAKE_CODEX_ARGS"] ?? "/dev/null", JSON.stringify({ argv, home: process.env["CODEX_HOME"], prompt: input, skills }));
const out = (event: unknown) => process.stdout.write(JSON.stringify(event) + "\n");
if (plan.failServer) {
  console.error(`Error: thread/start failed: required MCP servers failed to initialize: ${plan.failServer}: handshaking failed`);
  process.exit(1);
}
out({ type: "thread.started", thread_id: "thread-1" });
out({ type: "turn.started" });
if (plan.hang) await Bun.sleep(60_000);
const url = settings["mcp_servers.host.url"] as string;
const token = process.env[settings["mcp_servers.host.bearer_token_env_var"] as string] ?? "";
const rpc = (method: string, params: unknown, auth = true) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const unauthorized = (await rpc("tools/list", {}, false)).status;
await rpc("initialize", { protocolVersion: "2025-06-18" });
const listed = (await (await rpc("tools/list", {})).json()) as { result: { tools: { name: string }[] } };
out({ type: "item.started", item: { id: "item_0", type: "command_execution", command: "Get-Content notes.txt", status: "in_progress" } });
out({ type: "item.completed", item: { id: "item_0", type: "command_execution", command: "Get-Content notes.txt", exit_code: 0, status: "completed" } });
out({
  type: "item.completed",
  item: { id: "item_1", type: "mcp_tool_call", server: "browser", tool: "browser_type", arguments: { element: "First name", text: "Ada" } },
});
const called = (await (await rpc("tools/call", { name: plan.tool, arguments: plan.args })).json()) as { result: { content: { text: string }[] } };
const said = { unauthorized, tools: listed.result.tools.map(t => t.name), reply: called.result.content[0]?.text };
out({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: JSON.stringify(said) } });
if (plan.limited) {
  out({ type: "error", message: "You've hit your usage limit. Try again in 2 hours." });
  out({ type: "turn.failed", error: { message: "You've hit your usage limit. Try again in 2 hours." } });
} else out({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 2 } });
