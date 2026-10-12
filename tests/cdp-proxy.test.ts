import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import type { ServerWebSocket } from "bun";
import { config } from "../src/config";
import { startCdpProxy, type CdpProxy } from "../src/cdp-proxy";

interface Wire {
  id?: number | undefined;
  method?: string | undefined;
  sessionId?: string | undefined;
  params: Record<string, unknown>;
  result?: Record<string, unknown> | undefined;
  error?: unknown;
}

interface RemoteObject {
  type?: string;
  value?: unknown;
  objectId?: string;
  className?: string;
  description?: string;
}

interface UpstreamConnection {
  path: string;
}

function parsePacket(text: string): Wire {
  const val: unknown = JSON.parse(text);
  if (typeof val !== "object" || val === null) {
    throw new Error("Invalid packet");
  }
  const obj = val as Record<string, unknown>;
  const params = typeof obj["params"] === "object" && obj["params"] !== null && !Array.isArray(obj["params"])
    ? (obj["params"] as Record<string, unknown>)
    : {};
  const result = typeof obj["result"] === "object" && obj["result"] !== null && !Array.isArray(obj["result"])
    ? (obj["result"] as Record<string, unknown>)
    : undefined;
  return {
    id: typeof obj["id"] === "number" ? obj["id"] : undefined,
    method: typeof obj["method"] === "string" ? obj["method"] : undefined,
    sessionId: typeof obj["sessionId"] === "string" ? obj["sessionId"] : undefined,
    params,
    result,
    error: obj["error"],
  };
}

interface TestHarnessOptions {
  nativeUa?: string | null;
  scopeTargetId?: string;
}

function createHarness(options: TestHarnessOptions = {}) {
  const nativeUa = options.nativeUa === undefined
    ? "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    : options.nativeUa;

  const upstreamMessages: Wire[] = [];
  const upstreamSockets = new Set<ServerWebSocket<UpstreamConnection>>();

  const upstream = Bun.serve<UpstreamConnection>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        return server.upgrade(req, { data: { path: url.pathname } })
          ? undefined
          : new Response("upgrade failed", { status: 400 });
      }
      if (url.pathname === "/json/version") {
        if (nativeUa === null) {
          return new Response("internal error", { status: 500 });
        }
        return Response.json({
          "User-Agent": nativeUa,
          Browser: "Chrome/130.0.0.0",
          "Protocol-Version": "1.3",
        });
      }
      if (url.pathname === "/json/list" || url.pathname === "/json") {
        return Response.json([
          {
            id: options.scopeTargetId ?? "target-1",
            type: "page",
            title: "Test Page",
            url: "https://example.invalid",
            webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/page/${options.scopeTargetId ?? "target-1"}`,
          },
        ]);
      }
      return new Response("ok");
    },
    websocket: {
      open(ws) {
        upstreamSockets.add(ws);
      },
      close(ws) {
        upstreamSockets.delete(ws);
      },
      message(ws, raw) {
        const msg = parsePacket(String(raw));
        upstreamMessages.push(msg);
        let result: Record<string, unknown> = {};
        if (msg.method === "Browser.getVersion") {
          result = {
            userAgent: nativeUa ?? "DefaultNativeUA/1.0",
            product: "Chrome/130.0.0.0",
            protocolVersion: "1.3",
          };
        } else if (msg.method === "Runtime.callFunctionOn") {
          result = {
            result: {
              type: "object",
              className: "Object",
              description: "Object",
              preview: { type: "object", description: "Object", properties: [] },
            },
          };
        } else if (msg.method === "Runtime.enable") {
          result = {};
        }
        if (msg.id !== undefined) {
          ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result }));
        }
      },
    },
  });

  const savedCdpPort = config.chrome.cdpPort;
  const savedProxyPort = config.chrome.proxyPort;
  const upstreamPort = upstream.port;
  if (upstreamPort === undefined) throw new Error("upstream fixture requires a TCP listener");
  config.chrome.cdpPort = upstreamPort;
  config.chrome.proxyPort = 0;

  const scope = options.scopeTargetId
    ? { targetId: options.scopeTargetId, excludedTargets: new Set<string>() }
    : undefined;

  const proxy: CdpProxy = startCdpProxy(0, scope);

  function broadcastUpstreamEvent(method: string, params: Record<string, unknown>, sessionId?: string): void {
    assert.ok(upstreamSockets.size > 0, "active upstream connection required");
    const packet = JSON.stringify({ method, sessionId, params });
    for (const ws of upstreamSockets) {
      ws.send(packet);
    }
  }

  async function connectClient(path = `/devtools/page/${options.scopeTargetId ?? "target-1"}`) {
    const ws = new WebSocket(`ws://127.0.0.1:${proxy.port}${path}`);
    const ready: PromiseWithResolvers<void> = Promise.withResolvers();
    ws.onopen = () => { ready.resolve(); };
    ws.onerror = (e) => { ready.reject(new Error(`WebSocket error: ${e.type}`)); };

    const pending = new Map<number, (reply: Wire) => void>();
    const eventWaiters = new Map<string, ((event: Wire) => void)[]>();
    const events: Wire[] = [];
    let nextId = 0;

    ws.onmessage = (ev) => {
      const msg = parsePacket(String(ev.data));
      if (msg.id !== undefined) {
        const handler = pending.get(msg.id);
        if (handler) {
          pending.delete(msg.id);
          handler(msg);
        }
      } else {
        events.push(msg);
        if (msg.method) {
          const list = eventWaiters.get(msg.method);
          if (list && list.length > 0) {
            const next = list.shift();
            next?.(msg);
          }
        }
      }
    };

    await ready.promise;

    async function send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Wire> {
      const id = ++nextId;
      const { promise, resolve } = Promise.withResolvers<Wire>();
      pending.set(id, (reply) => { resolve(reply); });
      ws.send(JSON.stringify({ id, method, params, sessionId }));
      return promise;
    }

    // Transport handshake: roundtrip harmless command so that proxy conn.ready is
    // guaranteed resolved and upstream WebSocket transport is fully open before connectClient returns.
    const handshake = await send("Runtime.enable");
    assert.equal(handshake.error, undefined, "transport handshake roundtrip failed");

    function waitForEvent(method: string): Promise<Wire> {
      const existingIdx = events.findIndex((e) => e.method === method);
      if (existingIdx !== -1) {
        const [found] = events.splice(existingIdx, 1);
        if (!found) throw new Error(`Buffered ${method} event vanished`);
        return Promise.resolve(found);
      }
      const { promise, resolve } = Promise.withResolvers<Wire>();
      let list = eventWaiters.get(method);
      if (!list) {
        list = [];
        eventWaiters.set(method, list);
      }
      list.push(resolve);
      return promise;
    }

    return { ws, send, events, waitForEvent };
  }

  async function cleanup() {
    proxy.close();
    await upstream.stop(true);
    config.chrome.cdpPort = savedCdpPort;
    config.chrome.proxyPort = savedProxyPort;
  }

  return {
    proxy,
    upstream,
    upstreamMessages,
    connectClient,
    broadcastUpstreamEvent,
    cleanup,
  };
}

describe("CDP proxy native User-Agent normalization", () => {
  it("normalizes Network.setUserAgentOverride with matching native UA to empty string and returns upstream reply", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", { userAgent: nativeUa });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded, "Network.setUserAgentOverride was forwarded upstream");
      assert.equal(forwarded.params["userAgent"], "");
      assert.equal(Object.keys(forwarded.params).length, 1);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("normalizes Emulation.setUserAgentOverride with matching native UA to empty string", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Emulation.setUserAgentOverride", { userAgent: nativeUa });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Emulation.setUserAgentOverride");
      assert.ok(forwarded, "Emulation.setUserAgentOverride was forwarded upstream");
      assert.equal(forwarded.params["userAgent"], "");
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves custom userAgent unchanged when different from native UA", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const customUa = "Mozilla/5.0 (CustomBot; Linux x86_64) SpecialBrowser/2.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", { userAgent: customUa });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], customUa);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves override unchanged when userAgentMetadata is present (even if UA matches native)", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const metadata = { brands: [{ brand: "Chromium", version: "130" }], platform: "Linux" };
      const reply = await client.send("Network.setUserAgentOverride", {
        userAgent: nativeUa,
        userAgentMetadata: metadata,
      });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], nativeUa);
      assert.deepEqual(forwarded.params["userAgentMetadata"], metadata);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves override unchanged when userAgentMetadata is explicitly null", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", {
        userAgent: nativeUa,
        userAgentMetadata: null,
      });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], nativeUa);
      assert.equal(forwarded.params["userAgentMetadata"], null);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves override unchanged when acceptLanguage or extra parameters are present", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", {
        userAgent: nativeUa,
        acceptLanguage: "en-US,en;q=0.9",
        platform: "Linux",
      });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], nativeUa);
      assert.equal(forwarded.params["acceptLanguage"], "en-US,en;q=0.9");
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("preserves reset override with empty string unchanged", async () => {
    const nativeUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", { userAgent: "" });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], "");
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("fails open and forwards original userAgent unchanged when native UA acquisition fails", async () => {
    const simulatedUa = "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0.0.0";
    const harness = createHarness({ nativeUa: null });
    try {
      const client = await harness.connectClient();
      const reply = await client.send("Network.setUserAgentOverride", { userAgent: simulatedUa });

      assert.equal(reply.error, undefined);
      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], simulatedUa);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("learns native UA from client Browser.getVersion response and normalizes subsequent overrides", async () => {
    const harness = createHarness({ nativeUa: null });
    try {
      const client = await harness.connectClient();
      const versionReply = await client.send("Browser.getVersion");
      assert.equal(versionReply.error, undefined);

      const overrideReply = await client.send("Network.setUserAgentOverride", { userAgent: "DefaultNativeUA/1.0" });
      assert.equal(overrideReply.error, undefined);

      const forwarded = harness.upstreamMessages.find(m => m.method === "Network.setUserAgentOverride");
      assert.ok(forwarded);
      assert.equal(forwarded.params["userAgent"], "");
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });
});

describe("CDP proxy scoped passive console capture", () => {
  it("transforms eager getter inspection of tracked console object to returnByValue:false, generatePreview:true", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-canary-42", className: "Object", description: "Object" }],
      }, "sess-1");

      await eventPromise;

      const reply = await client.send("Runtime.callFunctionOn", {
        objectId: "obj-canary-42",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      assert.equal(reply.error, undefined);
      const res = reply.result?.["result"] as RemoteObject | undefined;
      assert.equal(res?.description, "Object");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded, "Runtime.callFunctionOn was forwarded upstream");
      assert.equal(forwarded.sessionId, "sess-1");
      assert.equal(forwarded.params["objectId"], "obj-canary-42");
      assert.equal(forwarded.params["returnByValue"], false);
      assert.equal(forwarded.params["generatePreview"], true);
      assert.equal(forwarded.params["silent"], true);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("consumes tracked object ID on single inspection so subsequent calls are not transformed", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-single-inspect", className: "Object", description: "Object" }],
      }, "sess-1");

      await eventPromise;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-single-inspect",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const firstCall = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn" && m.params["objectId"] === "obj-single-inspect");
      assert.ok(firstCall);
      assert.equal(firstCall.params["returnByValue"], false);
      assert.equal(firstCall.params["generatePreview"], true);

      harness.upstreamMessages.length = 0;
      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-single-inspect",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const secondCall = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn" && m.params["objectId"] === "obj-single-inspect");
      assert.ok(secondCall);
      assert.equal(secondCall.params["returnByValue"], true, "second inspection preserves original returnByValue");
      assert.equal(secondCall.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("enforces session isolation so tracked object in session A is unaffected when queried in session B", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-session-a", className: "Object", description: "Object" }],
      }, "session-A");

      await eventPromise;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-session-a",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "session-B");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.sessionId, "session-B");
      assert.equal(forwarded.params["returnByValue"], true, "different session leaves returnByValue:true untouched");
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("leaves objects not originating from consoleAPICalled untouched", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-eval-unlogged",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("leaves unrelated explicit function declarations and options untouched", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-custom-fn", className: "Object", description: "Object" }],
      }, "sess-1");

      await eventPromise;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-custom-fn",
        functionDeclaration: "function() { return this.someProperty; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("leaves callFunctionOn with extra parameters untouched", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-with-args", className: "Object", description: "Object" }],
      }, "sess-1");

      await eventPromise;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-with-args",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
        arguments: [{ value: 1 }],
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("clears tracked objects on execution context destruction or clear", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const logEvent = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-to-clear", className: "Object", description: "Object" }],
      }, "sess-1");

      await logEvent;

      const clearEvent = client.waitForEvent("Runtime.executionContextsCleared");
      harness.broadcastUpstreamEvent("Runtime.executionContextsCleared", {}, "sess-1");
      await clearEvent;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-to-clear",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("removes tracked object when client sends Runtime.releaseObject", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const eventPromise = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-to-release", className: "Object", description: "Object" }],
      }, "sess-1");

      await eventPromise;

      await client.send("Runtime.releaseObject", { objectId: "obj-to-release" }, "sess-1");

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-to-release",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });

  it("removes session tracking when target is detached", async () => {
    const harness = createHarness();
    try {
      const client = await harness.connectClient();
      const logEvent = client.waitForEvent("Runtime.consoleAPICalled");

      harness.broadcastUpstreamEvent("Runtime.consoleAPICalled", {
        type: "log",
        args: [{ type: "object", objectId: "obj-detached-sess", className: "Object", description: "Object" }],
      }, "sess-1");

      await logEvent;

      const detachEvent = client.waitForEvent("Target.detachedFromTarget");
      harness.broadcastUpstreamEvent("Target.detachedFromTarget", { sessionId: "sess-1" });
      await detachEvent;

      await client.send("Runtime.callFunctionOn", {
        objectId: "obj-detached-sess",
        functionDeclaration: "function() { return this; }",
        returnByValue: true,
        silent: true,
      }, "sess-1");

      const forwarded = harness.upstreamMessages.find(m => m.method === "Runtime.callFunctionOn");
      assert.ok(forwarded);
      assert.equal(forwarded.params["returnByValue"], true);
      assert.equal(forwarded.params["generatePreview"], undefined);
      client.ws.close();
    } finally {
      await harness.cleanup();
    }
  });
});
