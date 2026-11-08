#!/usr/bin/env bun
// Stands in for `agy -p --input-format stream-json --output-format stream-json`: the prompt's last
// line is a JSON plan of what to do. It records its arguments, the workspace MCP config and the
// prompt, calls the app's host-tool MCP server the way agy would, prints agy's stream-json events,
// and exits only once its input is closed, as agy ends a session. `agy models` lists two models.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Plan {
  tool?: string;
  args?: Record<string, unknown>;
  hang?: boolean; // wait instead of calling the tool
  limited?: boolean; // end refused by a quota
  signedOut?: boolean; // exit as a headless run with no sign-in does
}
const argv = process.argv.slice(2);
if (argv[0] === "models") {
  if (process.env["FAKE_AGY_SIGNED_OUT"]) {
    // agy 1.5.2's words, exit code 1
    console.error("Fetching available models...\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.");
    process.exit(1);
  }
  // agy 1.5.2: tab-separated on stdout, the progress line on stderr
  console.error("Fetching available models...");
  console.log("gemini-4-argon-high\tGemini 4 Argon (High)\ngemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)");
  process.exit(0);
}
// agy 1.5.2: -p takes the next argument as its prompt; with stream-json input it is not wanted.
if (argv.some(a => a === "-p" || a === "--print" || a === "--prompt")) {
  console.error(`Error: -p took "${argv[argv.indexOf("-p") + 1] ?? ""}" as its prompt, so the intended prompt was left as an argument and ignored.`);
  process.exit(2);
}
// Dies at once, its prompt unread, as agy does when it cannot reach its sign-in (no network).
if (process.env["FAKE_AGY_DIES"]) {
  console.error("authentication failed or timed out");
  process.exit(1);
}
const reader = Bun.stdin.stream().getReader();
const dec = new TextDecoder();
let buf = "";
while (!buf.includes("\n")) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += dec.decode(value, { stream: true });
}
const first = JSON.parse(buf.split("\n")[0] ?? "{}") as { event?: string; message?: { content?: string } };
const prompt = first.message?.content ?? "";
const plan = JSON.parse(prompt.trim().split("\n").at(-1) ?? "{}") as Plan;
const configFile = join(process.cwd(), ".agents", "mcp_config.json");
const mcp = existsSync(configFile) ? (JSON.parse(readFileSync(configFile, "utf8")) as { mcpServers: Record<string, Record<string, unknown>> }) : null;
await Bun.write(process.env["FAKE_AGY_ARGS"] ?? "/dev/null", JSON.stringify({ argv, cwd: process.cwd(), event: first.event, prompt, mcp }));
if (plan.signedOut) {
  console.error("Error: authentication required");
  process.exit(1);
}
const out = (event: string, body: unknown) => process.stdout.write(JSON.stringify({ event, [event]: body }) + "\n");
const id = "conv-1";
process.stdout.write(
  JSON.stringify({ event: "init", conversation_id: id, init: { cwd: process.cwd(), tools: ["run_command"], permission_mode: "always-proceed" } }) + "\n",
);
if (plan.hang) await Bun.sleep(60_000);
const host = mcp?.mcpServers["host"] ?? {};
const url = String(host["serverUrl"]);
const headers = (host["headers"] ?? {}) as Record<string, string>;
const rpc = (method: string, params: unknown, auth = true) =>
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(auth ? headers : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const unauthorized = (await rpc("tools/list", {}, false)).status;
await rpc("initialize", { protocolVersion: "2025-06-18" });
const listed = (await (await rpc("tools/list", {})).json()) as { result: { tools: { name: string }[] } };
const step = (index: number, state: string, rest: Record<string, unknown>) => {
  out("step_update", { conversation_id: id, step_index: index, state, ...rest });
};
const shell = { name: "run_command", parameters: { CommandLine: "Get-Content notes.txt" } };
step(1, "ACTIVE", { step_type: "tool", tool_name: "run_command", tool_info: shell });
step(1, "DONE", { step_type: "tool", tool_name: "run_command", tool_info: { ...shell, output: "notes" } });
const typed = { ServerName: "browser", ToolName: "browser_type", Arguments: JSON.stringify({ element: "First name", text: "Ada" }) };
step(2, "DONE", { step_type: "tool", tool_name: "call_mcp_tool", tool_info: { name: "call_mcp_tool", parameters: typed } });
step(3, "DONE", { step_type: "tool", tool_name: "mcp_host_report_result", tool_info: { name: "mcp_host_report_result", parameters: { note: "secret" } } });
const called = (await (await rpc("tools/call", { name: plan.tool, arguments: plan.args })).json()) as { result: { content: { text: string }[] } };
const said = JSON.stringify({ unauthorized, tools: listed.result.tools.map(t => t.name), reply: called.result.content[0]?.text });
step(4, "ACTIVE", { step_type: "agent_response", text_delta: said.slice(0, 10) });
step(4, "DONE", { step_type: "agent_response", text_delta: said.slice(10) });
out(
  "result",
  plan.limited
    ? { conversation_id: id, status: "ERROR", response: "", error: "RESOURCE_EXHAUSTED: Quota exceeded for model gemini-3.8-flash-medium." }
    : { conversation_id: id, status: "SUCCESS", response: said, num_turns: 1 },
);
// The session ends when the input closes.
while (!(await reader.read()).done) {
  // more input is not expected
}
