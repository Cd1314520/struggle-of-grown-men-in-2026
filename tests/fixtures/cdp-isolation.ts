// Loaded by the isolated lifecycle fixture, never by the production server.
// Real proxy/HTTP/WebSocket transport against a deterministic local CDP backend.
import assert from "node:assert/strict";
import type { ServerWebSocket } from "bun";
import { config } from "../../src/config";
import { prepareJobBrowser } from "../../src/chrome";
import type { JobBrowser } from "../../src/chrome";

interface Target {
  targetId: string;
  type: string;
  title: string;
  url: string;
  browserContextId: string;
  parentId?: string;
  openerId?: string;
  draft: string;
  paused: boolean;
}
interface Wire {
  id?: number;
  method?: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  sessionId?: string;
  error?: unknown;
}
interface Connection { pageId?: string; sessions: Map<string, string>; discover: boolean }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function decode(text: string): Wire {
  const value: unknown = JSON.parse(text);
  assert(object(value));
  assert(value.id === undefined || typeof value.id === "number");
  assert(value.method === undefined || typeof value.method === "string");
  assert(value.sessionId === undefined || typeof value.sessionId === "string");
  assert(value.params === undefined || object(value.params));
  assert(value.result === undefined || object(value.result));
  return { id: value.id, method: value.method, sessionId: value.sessionId, params: value.params ?? {}, result: value.result, error: value.error };
}
const targets = new Map<string, Target>();
const sockets = new Set<ServerWebSocket<Connection>>();
const commands: Wire[] = [];
let nextTarget = 0;
let nextSession = 0;
function addTarget(url: string, type = "page", parentId?: string): Target {
  const target: Target = { targetId: `target-${++nextTarget}`, type, title: url, url, browserContextId: "persistent-profile", draft: "", paused: false, parentId };
  targets.set(target.targetId, target);
  return target;
}
// Chrome target ordering intentionally leaves these ahead of newly created pages.
addTarget("https://fixture.invalid/unrelated-history");
const manual = addTarget("https://fixture.invalid/manual");
manual.draft = "human is editing this unsaved form";
function broadcast(method: string, params: Record<string, unknown>) {
  for (const ws of sockets) ws.send(JSON.stringify({ method, params }));
}
function destroyTarget(targetId: string) {
  if (!targets.delete(targetId)) return false;
  for (const ws of sockets) {
    for (const [sessionId, attachedTarget] of ws.data.sessions) {
      if (attachedTarget !== targetId) continue;
      ws.data.sessions.delete(sessionId);
      ws.send(JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId, targetId } }));
    }
  }
  broadcast("Target.targetDestroyed", { targetId });
  return true;
}
function attach(ws: ServerWebSocket<Connection>, target: Target, outerSession?: string, pause = false) {
  const sessionId = `session-${++nextSession}`;
  ws.data.sessions.set(sessionId, target.targetId);
  target.paused ||= pause;
  ws.send(JSON.stringify({ method: "Target.attachedToTarget", sessionId: outerSession, params: { sessionId, targetInfo: target, waitingForDebugger: pause } }));
  return sessionId;
}
const upstream = Bun.serve<Connection>({
  hostname: "127.0.0.1", port: 0,
  fetch(req, server) {
    const url = new URL(req.url);
    const page = /^\/devtools\/page\/(.+)$/.exec(url.pathname)?.[1];
    if (req.headers.get("upgrade")?.toLowerCase() === "websocket")
      return server.upgrade(req, { data: { pageId: page, sessions: new Map(), discover: false } }) ? undefined : new Response("bad upgrade", { status: 400 });
    if (url.pathname === "/json/version") return Response.json({ Browser: "Fixture", webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/browser/fixture` });
    if (url.pathname === "/json/new") {
      assert.equal(req.method, "PUT");
      const target = addTarget(decodeURIComponent(url.search.slice(1)));
      broadcast("Target.targetCreated", { targetInfo: target });
      return Response.json({ ...target, id: target.targetId, webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/page/${target.targetId}` });
    }
    if (url.pathname === "/json/list" || url.pathname === "/json") return Response.json([...targets.values()].filter(t => t.type === "page").map(t => ({ ...t, id: t.targetId, webSocketDebuggerUrl: `ws://127.0.0.1:${server.port}/devtools/page/${t.targetId}` })));
    const close = /^\/json\/close\/(.+)$/.exec(url.pathname);
    if (close) { destroyTarget(close[1]!); return new Response("closed"); }
    if (url.pathname.startsWith("/json/activate/")) return new Response("activated");
    return new Response("unknown", { status: 404 });
  },
  websocket: {
    open(ws) { sockets.add(ws); },
    close(ws) { sockets.delete(ws); },
    message(ws, raw) {
      const msg = decode(String(raw));
      commands.push(msg);
      let result: Record<string, unknown> = {};
      const targetId = msg.sessionId ? ws.data.sessions.get(msg.sessionId) : ws.data.pageId;
      const target = targetId ? targets.get(targetId) : undefined;
      switch (msg.method) {
        case "Browser.getVersion": result = { product: "Fixture", protocolVersion: "1.3" }; break;
        case "Target.getTargets": result = { targetInfos: [...targets.values()] }; break;
        case "Target.getTargetInfo": result = { targetInfo: targets.get(String(msg.params.targetId)) }; break;
        case "Target.getBrowserContexts": result = { defaultBrowserContextId: "persistent-profile", browserContextIds: ["unrelated-incognito"] }; break;
        case "Target.setDiscoverTargets":
          ws.data.discover = msg.params.discover === true;
          if (ws.data.discover) for (const info of targets.values()) ws.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: info } }));
          break;
        case "Target.attachToTarget": {
          const info = targets.get(String(msg.params.targetId));
          assert(info, "proxy forwarded an invalid attachment");
          result = { sessionId: attach(ws, info) };
          break;
        }
        case "Target.setAutoAttach": {
          if (msg.params.autoAttach === true) {
            // Browser-level attachment affects every page before filtering events.
            // Page-level attachment is limited to descendants and obeys TargetFilter.
            const filters = Array.isArray(msg.params.filter) ? msg.params.filter : [];
            for (const info of targets.values()) {
              if (target && info.parentId !== target.targetId) continue;
              const filter = filters.find((entry: unknown) => object(entry) && (entry.type === undefined || entry.type === info.type));
              if (object(filter) && filter.exclude === true) continue;
              attach(ws, info, msg.sessionId, msg.params.waitForDebuggerOnStart === true);
            }
          }
          break;
        }
        case "Target.detachFromTarget": {
          const sessionId = String(msg.params.sessionId);
          if (!ws.data.sessions.has(sessionId)) {
            ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, error: { code: -32000, message: "No session with given id" } }));
            return;
          }
          ws.data.sessions.delete(sessionId);
          ws.send(JSON.stringify({ method: "Target.detachedFromTarget", params: { sessionId } }));
          break;
        }
        case "Target.closeTarget":
          result = { success: destroyTarget(String(msg.params.targetId)) };
          break;
        case "Target.createTarget": {
          const created = addTarget(String(msg.params.url));
          // Event deliberately precedes the createTarget reply, as real CDP can.
          broadcast("Target.targetCreated", { targetInfo: created });
          result = { targetId: created.targetId };
          break;
        }
        case "Page.navigate":
          assert(target, "navigation lacked an attached page");
          target.url = String(msg.params.url);
          target.draft = ""; // navigating away destroys unsaved form contents
          result = { frameId: `frame-${target.targetId}` };
          break;
        case "Runtime.evaluate":
          assert(target, "evaluation lacked an attached page");
          if (msg.params.expression === "write-draft") target.draft = String(msg.params.value);
          result = { result: { type: "string", value: target.draft } };
          break;
      }
      ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result }));
    },
  },
});
const upstreamPort = upstream.port;
assert(typeof upstreamPort === "number");
config.chrome.cdpPort = upstreamPort;
const proxies: JobBrowser[] = [];
const clientSockets: WebSocket[] = [];

async function connect(browser: JobBrowser) {
  const version: unknown = await (await fetch(`http://127.0.0.1:${browser.port}/json/version`)).json();
  assert(object(version) && typeof version.webSocketDebuggerUrl === "string");
  assert.equal(new URL(version.webSocketDebuggerUrl).port, String(browser.port));
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  clientSockets.push(socket);
  const ready = Promise.withResolvers<void>();
  socket.onopen = () => ready.resolve();
  socket.onerror = () => ready.reject(new Error("CDP fixture connection failed"));
  const pending = new Map<number, (msg: Wire) => void>();
  const events: Wire[] = [];
  let id = 0;
  socket.onmessage = ev => {
    const msg = decode(String(ev.data));
    if (msg.id === undefined) events.push(msg);
    else { pending.get(msg.id)?.(msg); pending.delete(msg.id); }
  };
  await ready.promise;
  async function call(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const requestId = ++id;
    const reply = Promise.withResolvers<Wire>();
    const timer = setTimeout(() => reply.reject(new Error(`No reply to ${method}`)), 2000);
    pending.set(requestId, msg => { clearTimeout(timer); reply.resolve(msg); });
    socket.send(JSON.stringify({ id: requestId, method, params, sessionId }));
    return reply.promise;
  }
  await call("Target.setDiscoverTargets", { discover: true });
  await call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  const get = await call("Target.getTargets");
  assert(Array.isArray(get.result?.targetInfos));
  // Model browser.open's problematic selection: adopt the first discoverable page.
  const selected: unknown = get.result.targetInfos.find((info: unknown) => object(info) && info.type === "page");
  assert(object(selected) && typeof selected.targetId === "string");
  const attached = await call("Target.attachToTarget", { targetId: selected.targetId, flatten: true });
  assert.equal(attached.error, undefined);
  assert.equal(typeof attached.result?.sessionId, "string");
  const sessionId = String(attached.result?.sessionId);
  return { call, events, sessionId, selected: selected.targetId, socket };
}
try {
  const first = await prepareJobBrowser(0, null, new Set([manual.targetId]));
  proxies.push(first);
  const a = await connect(first);
  assert.equal(a.selected, first.tabId);
  await a.call("Page.navigate", { url: "https://fixture.invalid/application/A" }, a.sessionId);
  await a.call("Runtime.evaluate", { expression: "write-draft", value: "A unsaved salary answer" }, a.sessionId);
  first.revoke(); // equivalent to durable park; listener remains bound until exit
  assert.equal((await fetch(`http://127.0.0.1:${first.port}/json/list`)).status, 410);

  const second = await prepareJobBrowser(0, null, new Set([first.tabId, manual.targetId]));
  proxies.push(second);
  assert.notEqual(second.tabId, first.tabId);
  assert.notEqual(second.port, first.port, "revoked listener must remain bound until old process exits");
  // Also exercise helpers that adopt the first HTTP-discovered page and speak
  // CDP directly to its page socket, instead of using a browser-level session.
  const visible: unknown = await (await fetch(`http://127.0.0.1:${second.port}/json/list`)).json();
  assert(Array.isArray(visible));
  const chosen: unknown = visible.find((entry: unknown) => object(entry) && entry.type === "page");
  assert(object(chosen) && typeof chosen.webSocketDebuggerUrl === "string");
  const pageSocket = new WebSocket(chosen.webSocketDebuggerUrl);
  clientSockets.push(pageSocket);
  const pageReady = Promise.withResolvers<void>();
  const pageReply = Promise.withResolvers<Wire>();
  let pageConnected = false;
  pageSocket.onopen = () => { pageConnected = true; pageReady.resolve(); };
  pageSocket.onerror = () => {
    const error = new Error("Page CDP connection rejected");
    if (pageConnected) pageReply.reject(error); else pageReady.reject(error);
  };
  pageSocket.onmessage = ev => {
    const reply = decode(String(ev.data));
    if (reply.id === 1) pageReply.resolve(reply);
  };
  await pageReady.promise;
  const pageTimer = setTimeout(() => pageReply.reject(new Error("No page navigation reply")), 2000);
  pageSocket.send(JSON.stringify({ id: 1, method: "Page.navigate", params: { url: "https://fixture.invalid/application/B" } }));
  try { assert.equal((await pageReply.promise).error, undefined); } finally { clearTimeout(pageTimer); }
  assert.equal(targets.get(second.tabId)!.url, "https://fixture.invalid/application/B");
  assert.equal(targets.get(first.tabId)!.draft, "A unsaved salary answer");
  assert.equal(targets.get(first.tabId)!.url, "https://fixture.invalid/application/A");
  // Even a manual page related to the current target must not be auto-attached.
  manual.parentId = second.tabId;
  const frame = addTarget("https://fixture.invalid/frame", "iframe", second.tabId);
  const b = await connect(second);
  assert.equal(b.selected, second.tabId);
  await b.call("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, b.sessionId);
  await b.call("Page.navigate", { url: "https://fixture.invalid/application/B" }, b.sessionId);
  await b.call("Runtime.evaluate", { expression: "write-draft", value: "B unsaved cover letter" }, b.sessionId);
  assert.equal(targets.get(first.tabId)!.url, "https://fixture.invalid/application/A");
  assert.equal(targets.get(first.tabId)!.draft, "A unsaved salary answer");
  assert.equal(targets.get(first.tabId)!.paused, false);
  assert.equal(manual.draft, "human is editing this unsaved form");
  assert.equal(manual.paused, false);
  const attachedFrame = b.events.find(event => event.method === "Target.attachedToTarget" && object(event.params.targetInfo) && event.params.targetInfo.targetId === frame.targetId);
  assert(attachedFrame && typeof attachedFrame.params.sessionId === "string", "owned iframe must remain usable");
  await b.call("Runtime.evaluate", { expression: "write-draft", value: "Answer in an owned iframe" }, attachedFrame.params.sessionId);
  const frameAnswer = await b.call("Runtime.evaluate", { expression: "read-draft" }, attachedFrame.params.sessionId);
  assert(object(frameAnswer.result?.result));
  assert.equal(frameAnswer.result.result.value, "Answer in an owned iframe");
  assert(!b.events.some(event => object(event.params.targetInfo) && [first.tabId, manual.targetId].includes(String(event.params.targetInfo.targetId))));
  assert(!commands.some(command => command.method === "Target.setAutoAttach" && !command.sessionId && command.params.autoAttach === true), "no global auto-attach may reach Chrome");

  for (const hidden of [first.tabId, manual.targetId]) {
    assert((await b.call("Target.attachToTarget", { targetId: hidden, flatten: true })).error);
    assert((await b.call("Target.closeTarget", { targetId: hidden })).error);
    assert((await b.call("Target.activateTarget", { targetId: hidden })).error);
    assert.equal((await fetch(`http://127.0.0.1:${second.port}/json/close/${hidden}`)).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${second.port}/json/activate/${hidden}`)).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${second.port}/devtools/page/${hidden}`, { headers: { Upgrade: "websocket" } })).status, 403);
  }
  assert((await b.call("Page.navigate", { url: "https://fixture.invalid/hijack" }, "guessed-hidden-session")).error);
  assert((await b.call("Target.sendMessageToTarget", { sessionId: b.sessionId, message: JSON.stringify({ id: 1, method: "Browser.close" }) })).error);
  assert((await b.call("Browser.close")).error);
  assert((await b.call("Target.disposeBrowserContext", { browserContextId: "persistent-profile" })).error);
  const incognito = await b.call("Target.getBrowserContexts");
  assert.deepEqual(incognito.result?.browserContextIds, []);

  const profileMutations: [string, Record<string, unknown>][] = [
    ["Network.clearBrowserCookies", {}],
    ["Network.clearBrowserCache", {}],
    ["Storage.clearCookies", { browserContextId: "persistent-profile" }],
    ["Storage.setCookies", { cookies: [], browserContextId: "persistent-profile" }],
    ["Storage.clearDataForOrigin", { origin: "https://fixture.invalid", storageTypes: "all" }],
    ["Storage.clearDataForStorageKey", { storageKey: "https://fixture.invalid/", storageTypes: "all" }],
    ["Storage.deleteStorageBucket", { bucket: { storageKey: "https://fixture.invalid/", name: "drafts" } }],
    ["Storage.overrideQuotaForOrigin", { origin: "https://fixture.invalid", quotaSize: 0 }],
    ["Storage.setSharedStorageEntry", { ownerOrigin: "https://fixture.invalid", key: "login", value: "" }],
    ["Storage.deleteSharedStorageEntry", { ownerOrigin: "https://fixture.invalid", key: "login" }],
    ["Storage.clearSharedStorageEntries", { ownerOrigin: "https://fixture.invalid" }],
    ["Storage.resetSharedStorageBudget", { ownerOrigin: "https://fixture.invalid" }],
    ["CacheStorage.deleteCache", { cacheId: "shared-profile-cache" }],
    ["CacheStorage.deleteEntry", { cacheId: "shared-profile-cache", request: "https://fixture.invalid" }],
  ];
  for (const [method, params] of profileMutations) {
    for (const sessionId of [undefined, b.sessionId]) {
      const denied = await b.call(method, params, sessionId);
      assert(object(denied.error), `${method} must be rejected even through an owned session`);
      assert.equal(denied.error.code, -32000);
    }
    assert(!commands.some(command => command.method === method), `${method} must never reach Chrome`);
  }

  const created = await b.call("Target.createTarget", { url: "https://fixture.invalid/owned-popup", browserContextId: "persistent-profile" });
  assert.equal(created.error, undefined);
  assert.equal(typeof created.result?.targetId, "string");
  const popupId = String(created.result?.targetId);
  const attachedPopup = await b.call("Target.attachToTarget", { targetId: popupId, flatten: true });
  assert.equal(attachedPopup.error, undefined);
  assert.equal(typeof attachedPopup.result?.sessionId, "string");
  await b.call("Runtime.evaluate", { expression: "write-draft", value: "Owned popup form" }, String(attachedPopup.result?.sessionId));
  assert.equal(targets.get(popupId)!.draft, "Owned popup form");
  await b.call("Browser.getVersion"); // ordered barrier after target notifications
  assert(b.events.some(event => event.method === "Target.targetCreated" && object(event.params.targetInfo) && event.params.targetInfo.targetId === popupId));
  const closed = await b.call("Target.closeTarget", { targetId: popupId });
  assert.equal(closed.error, undefined);
  assert.equal(closed.result?.success, true);
  await b.call("Browser.getVersion");
  assert(!targets.has(popupId));
  assert(b.events.some(event => event.method === "Target.targetDestroyed" && event.params.targetId === popupId));
  const popupSessions = b.events
    .filter(event => event.method === "Target.attachedToTarget" && object(event.params.targetInfo) && event.params.targetInfo.targetId === popupId)
    .map(event => String(event.params.sessionId));
  assert(popupSessions.includes(String(attachedPopup.result?.sessionId)));
  assert(popupSessions.some(sessionId => sessionId !== attachedPopup.result?.sessionId), "popup must also have an automatic watch session");
  for (const sessionId of popupSessions) {
    assert(b.events.some(event => event.method === "Target.detachedFromTarget" && event.params.sessionId === sessionId));
    assert((await b.call("Runtime.evaluate", { expression: "read-draft" }, sessionId)).error, "closed popup sessions must be retired");
  }
  const disabled = await b.call("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
  assert.equal(disabled.error, undefined);
  await b.call("Browser.getVersion"); // barrier after injected detach replies
  assert(!commands.some(command => command.method === "Target.detachFromTarget" && popupSessions.includes(String(command.params.sessionId))), "cleanup must not detach closed popup sessions");
  const liveDraft = await b.call("Runtime.evaluate", { expression: "read-draft" }, b.sessionId);
  assert.equal(liveDraft.error, undefined);
  assert(object(liveDraft.result?.result));
  assert.equal(liveDraft.result.result.value, "B unsaved cover letter", "live application connection must survive auto-attach cleanup");
  assert(second.ownsTarget(popupId), "a destroyed owned tab must remain identifiable for a lost-tab manual checkpoint");
  assert.equal(targets.get(first.tabId)!.draft, "A unsaved salary answer");
  assert.equal(manual.draft, "human is editing this unsaved form");

  first.close(); // old worker exited; no Chrome page is closed
  second.revoke();
  second.close();
  const resumed = await prepareJobBrowser(0, first.tabId, new Set([second.tabId, manual.targetId]));
  proxies.push(resumed);
  assert.equal(resumed.tabId, first.tabId);
  assert.equal(resumed.reused, true);
  const resumedClient = await connect(resumed);
  assert.equal(resumedClient.selected, first.tabId);
  const draft = await resumedClient.call("Runtime.evaluate", { expression: "read-draft" }, resumedClient.sessionId);
  assert(object(draft.result?.result));
  assert.equal(draft.result.result.value, "A unsaved salary answer");
  assert.equal(targets.get(first.tabId)!.url, "https://fixture.invalid/application/A");
  assert.equal(targets.get(second.tabId)!.draft, "B unsaved cover letter");
  await assert.rejects(prepareJobBrowser(0, first.tabId, new Set([first.tabId])));
  assert.equal(targets.get(first.tabId)!.draft, "A unsaved salary answer");
  assert.equal(manual.draft, "human is editing this unsaved form");
  resumed.close();
  targets.delete(first.tabId); // Simulate a genuinely lost checkpoint target.
  const recovery = await prepareJobBrowser(0, first.tabId, new Set([second.tabId, manual.targetId]));
  proxies.push(recovery);
  assert.notEqual(recovery.tabId, first.tabId);
  assert.notEqual(recovery.tabId, second.tabId);
  const recoveryClient = await connect(recovery);
  assert.equal(targets.get(recoveryClient.selected)!.url, "about:blank");
  assert.equal(targets.get(second.tabId)!.draft, "B unsaved cover letter");
  assert.equal(manual.draft, "human is editing this unsaved form");
} finally {
  for (const ws of clientSockets) ws.close();
  for (const proxy of proxies) proxy.close();
  await upstream.stop(true);
}
