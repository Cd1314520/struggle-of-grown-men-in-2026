import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prelude = `
import assert from "node:assert/strict";
let targets: unknown[] = [];
let activationResponse = new Response("ok");
const calls: string[] = [];
globalThis.fetch = async (input: string | URL | Request) => {
  const url = String(input);
  calls.push(url);
  if (url.endsWith("/json/list")) return Response.json(targets);
  if (url.includes("/json/activate/")) return activationResponse;
  throw new Error("unexpected CDP request: " + url);
};
// Dynamic import keeps each subprocess's mocked fetch and module initialization isolated.
const chrome = await import(${JSON.stringify(join(import.meta.dir, "../src/chrome.ts"))});
`;

function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-chrome-activation-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.equal(child.exitCode, 0, `Chrome activation scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("application tab activation", () => {
  it("activates only the exact existing page target", () => {
    scenario(`
    targets = [
      { type: "page", id: "draft/id", title: "Draft", url: "https://fixture.invalid/draft" },
      { type: "page", id: "other", title: "Other", url: "https://fixture.invalid/other" },
      { type: "background_page", id: "background", title: "Background", url: "" },
    ];
    await chrome.activateApplicationTab(0, "draft/id");
    assert.deepEqual(calls.map(url => new URL(url).pathname), ["/json/list", "/json/activate/draft%2Fid"]);
    assert.equal(calls.filter(url => url.includes("/json/new")).length, 0);
    assert.equal(calls.filter(url => url.includes("/json/navigate")).length, 0);
  `);
  });

  it("rejects missing and non-page targets without an activation request", () => {
    scenario(`
    targets = [
      { type: "background_page", id: "non-page", title: "Background", url: "" },
      { type: "iframe", id: "frame", title: "Frame", url: "https://fixture.invalid/frame" },
    ];
    await assert.rejects(() => chrome.activateApplicationTab(0, "non-page"));
    await assert.rejects(() => chrome.activateApplicationTab(0, "missing"));
    await assert.rejects(() => chrome.activateApplicationTab(0, "frame"));
    assert.ok(calls.every(url => url.endsWith("/json/list")));
  `);
  });

  it("rejects a failed activation response", () => {
    scenario(`
    targets = [{ type: "page", id: "draft", title: "Draft", url: "https://fixture.invalid/draft" }];
    activationResponse = new Response("failed", { status: 503 });
    await assert.rejects(() => chrome.activateApplicationTab(0, "draft"));
    assert.equal(calls.filter(url => url.includes("/json/activate/")).length, 1);
  `);
  });
});
