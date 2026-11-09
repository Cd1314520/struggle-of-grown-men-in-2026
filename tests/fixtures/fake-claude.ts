#!/usr/bin/env bun
interface Plan {
  tool?: string;
  args?: Record<string, unknown>;
  hang?: boolean;
  failServer?: string;
  limited?: boolean;
}
interface Server {
  url: string;
  headers: Record<string, string>;
}
const argv = process.argv.slice(2);
const opt = (name: string) => argv[argv.indexOf(name) + 1] ?? "";
const plan = JSON.parse(await new Response(Bun.stdin.stream()).text()) as Plan;
await Bun.write(process.env["FAKE_CLAUDE_ARGS"] ?? "/dev/null", JSON.stringify(argv));
const out = (event: unknown) => process.stdout.write(JSON.stringify(event) + "\n");
const servers = (JSON.parse(opt("--mcp-config")) as { mcpServers: Record<string, Server> }).mcpServers;
out({
  type: "system",
  subtype: "init",
  mcp_servers: Object.keys(servers).map(name => ({ name, status: plan.failServer === name ? "failed" : "connected" })),
});
if (plan.failServer || plan.hang) await Bun.sleep(60_000);
const host = servers["host"];
if (!host) throw new Error("no host server");
const rpc = (method: string, params: unknown, headers = host.headers) =>
  fetch(host.url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
const unauthorized = (await rpc("tools/list", {}, {})).status;
await rpc("initialize", { protocolVersion: "2025-06-18" });
const listed = (await (await rpc("tools/list", {})).json()) as { result: { tools: { name: string }[] } };
out({ type: "assistant", message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "/work/notes.txt" } }] } });
const called = (await (await rpc("tools/call", { name: plan.tool, arguments: plan.args })).json()) as { result: { content: { text: string }[] } };
const said = { unauthorized, tools: listed.result.tools.map(t => t.name), reply: called.result.content[0]?.text };
out({ type: "assistant", message: { content: [{ type: "text", text: JSON.stringify(said) }] } });
if (plan.limited) {
  out({ type: "rate_limit_event", rate_limit_info: { status: "rejected", rateLimitType: "five_hour", resetsAt: 1792999800 } });
  out({ type: "result", subtype: "success", is_error: true, result: "You've hit your limit" });
} else out({ type: "result", subtype: "success", is_error: false, result: "done" });

export {};
