// Sits between omp and Chrome's DevTools port and makes input look like a person's.
//
// Agents drive pages at machine speed: the pointer teleports to the exact centre of a target and a
// paragraph arrives with 0 ms between keystrokes. Behavioural bot checks (hCaptcha, reCAPTCHA) score
// Input commands are re-timed here. Fill workers additionally use a private,
// target-scoped listener so browser.open cannot adopt another application's tab.
import type { Server, ServerWebSocket } from "bun";
import { browserSlot } from "./config";
import { logEvent } from "./db";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface Pointer {
  x: number;
  y: number;
  // The last place the client asked for, and where we actually put the pointer (slightly off-centre).
  asked?: { x: number; y: number };
  lastKeyAt: number;
  lastMouseAt: number;
  burst: number; // keys typed in the current run
}

interface Conn {
  upstream: WebSocket;
  ready: Promise<void>;
  sessions: Map<string, Pointer>;
  queues: Map<string, Promise<void>>;
  injected: Set<number>;
  nextId: number;
  nativeUserAgent?: string;
  pendingBrowserVersion: Set<string>;
  consoleObjects: Map<string, Set<string>>;
}

export interface CdpTargetScope {
  targetId: string;
  excludedTargets: ReadonlySet<string>;
}
export interface CdpProxy {
  port: number;
  ownsTarget: (targetId: string) => boolean;
  revoke: () => void;
  close: () => void;
}
interface Packet {
  id?: number;
  method?: string;
  sessionId?: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: unknown;
}
interface TargetInfo {
  targetId: string;
  type: string;
  openerId?: string;
  parentId?: string;
  browserContextId?: string;
}
interface TargetConnection {
  pageId?: string;
  sessions: Map<string, string>;
  requests: Map<string, Packet>;
  infos: Map<string, TargetInfo>;
  autoAttach: Record<string, unknown> | null;
  monitors: Map<number, string>;
  watched: Set<string>;
  autoSessions: Set<string>;
  announced: Set<string>;
  discover: boolean;
}
interface ProxyClient {
  path: string;
  conn?: Conn;
  targets?: TargetConnection;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function targetInfo(value: unknown): value is TargetInfo {
  return record(value) && typeof value.targetId === "string" && typeof value.type === "string" &&
    (value.openerId === undefined || typeof value.openerId === "string") &&
    (value.parentId === undefined || typeof value.parentId === "string") &&
    (value.browserContextId === undefined || typeof value.browserContextId === "string");
}
function packet(text: string): Packet | null {
  const value: unknown = JSON.parse(text);
  if (!record(value) || (value.id !== undefined && typeof value.id !== "number") ||
      (value.method !== undefined && typeof value.method !== "string") ||
      (value.sessionId !== undefined && typeof value.sessionId !== "string") ||
      (value.params !== undefined && !record(value.params)) || (value.result !== undefined && !record(value.result))) return null;
  return { id: value.id, method: value.method, sessionId: value.sessionId, params: value.params ?? {}, result: value.result, error: value.error };
}

const INPUT = new Set(["Input.dispatchMouseEvent", "Input.dispatchKeyEvent", "Input.insertText"]);

// These mutate the shared profile even when sent through an owned page session.
// Keep URL/domain-scoped login APIs (Network.setCookie/setCookies/deleteCookies) usable;
// this guards accidental cross-tab commands, not arbitrary code executing in a page.
const PROFILE_MUTATIONS: Record<string, true> = {
  "Network.clearBrowserCookies": true,
  "Network.clearBrowserCache": true,
  "Storage.clearCookies": true,
  "Storage.setCookies": true,
  "Storage.clearDataForOrigin": true,
  "Storage.clearDataForStorageKey": true,
  "Storage.deleteStorageBucket": true,
  "Storage.overrideQuotaForOrigin": true,
  "Storage.setSharedStorageEntry": true,
  "Storage.deleteSharedStorageEntry": true,
  "Storage.clearSharedStorageEntries": true,
  "Storage.resetSharedStorageBudget": true,
  "CacheStorage.deleteCache": true,
  "CacheStorage.deleteEntry": true,
};

const MAX_TRACKED_CONSOLE_OBJECTS = 1000;
function trackConsoleObjectId(conn: Conn, session: string, id: string) {
  let set = conn.consoleObjects.get(session);
  if (!set) {
    set = new Set();
    conn.consoleObjects.set(session, set);
  }
  if (set.size >= MAX_TRACKED_CONSOLE_OBJECTS) {
    const oldest = set.values().next().value;
    if (oldest !== undefined) set.delete(oldest);
  }
  set.add(id);
}
function pointer(conn: Conn, session: string) {
  let p = conn.sessions.get(session);
  if (!p) conn.sessions.set(session, (p = { x: rand(200, 900), y: rand(120, 500), lastKeyAt: 0, lastMouseAt: 0, burst: 0 }));
  return p;
}

// Send a command of our own and drop its response.
function inject(conn: Conn, msg: Pick<Packet, "sessionId">, method: string, params: Record<string, unknown>) {
  const id = conn.nextId++;
  conn.injected.add(id);
  conn.upstream.send(JSON.stringify({ id, method, params, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) }));
  return id;
}

// Curved, eased path from the current position to (x, y).
async function glide(conn: Conn, msg: any, p: Pointer, x: number, y: number) {
  const dist = Math.hypot(x - p.x, y - p.y);
  if (dist < 6) return;
  if (dist > 140) await sleep(rand(220, 850)); // looking for the next thing
  const steps = Math.round(Math.min(42, Math.max(8, dist / 14)));
  const bend = dist * rand(0.08, 0.22) * (Math.random() < 0.5 ? -1 : 1);
  const cx = (p.x + x) / 2 + (-(y - p.y) / dist) * bend;
  const cy = (p.y + y) / 2 + ((x - p.x) / dist) * bend;
  const { x: sx, y: sy } = p;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
    const px = (1 - e) ** 2 * sx + 2 * (1 - e) * e * cx + e * e * x + rand(-0.8, 0.8);
    const py = (1 - e) ** 2 * sy + 2 * (1 - e) * e * cy + e * e * y + rand(-0.8, 0.8);
    inject(conn, msg, "Input.dispatchMouseEvent", { type: "mouseMoved", x: px, y: py, button: msg.params.button ?? "none", buttons: msg.params.buttons ?? 0, modifiers: msg.params.modifiers ?? 0 });
    await sleep(rand(6, 15));
  }
}

async function mouse(conn: Conn, msg: any, p: Pointer) {
  const q = msg.params;
  if (q.type === "mouseWheel") return void (await sleep(rand(20, 70)));
  const same = p.asked && Math.abs(p.asked.x - q.x) < 1.5 && Math.abs(p.asked.y - q.y) < 1.5;
  if (!same) {
    // New target: land a few pixels off the exact centre the client computed.
    const tx = q.x + rand(-3, 3), ty = q.y + rand(-2, 2);
    await glide(conn, msg, p, tx, ty);
    p.asked = { x: q.x, y: q.y };
    p.x = tx;
    p.y = ty;
  }
  if (q.type === "mousePressed") await sleep(rand(70, 230));
  if (q.type === "mouseReleased") await sleep(rand(45, 125));
  q.x = p.x;
  q.y = p.y;
  p.lastMouseAt = Date.now();
}

function keyGap(p: Pointer, text?: string) {
  const now = Date.now();
  if (now - p.lastKeyAt > 2000) {
    p.burst = 0;
    // Starting to type: just clicked into the field, or tabbed there after a pause.
    return now - p.lastMouseAt < 1500 ? rand(180, 520) : rand(350, 1100);
  }
  p.burst++;
  // Long answers are typed faster (people paste or know what they are writing), which also keeps
  // one helper call inside the agent's per-call timeout.
  let gap = p.burst < 25 ? rand(50, 130) : p.burst < 80 ? rand(36, 90) : rand(18, 42);
  if (text === " " || text === "." || text === ",") gap *= rand(1.1, 1.7);
  if (p.burst < 80 && Math.random() < 0.035) gap += rand(240, 620);
  return gap;
}

async function key(conn: Conn, msg: any, p: Pointer) {
  const q = msg.params;
  if (q.type === "keyDown" || q.type === "rawKeyDown") await sleep(keyGap(p, q.text ?? q.key));
  else if (q.type === "keyUp") await sleep(rand(8, 26));
  p.lastKeyAt = Date.now();
}

// insertText drops a whole string in at once; feed it a character at a time instead.
async function insertText(conn: Conn, msg: any, p: Pointer) {
  const chars = [...String(msg.params.text ?? "")];
  if (chars.length < 2) return void (await sleep(keyGap(p, chars[0])));
  for (const ch of chars.slice(0, -1)) {
    await sleep(keyGap(p, ch));
    p.lastKeyAt = Date.now();
    inject(conn, msg, "Input.insertText", { text: ch });
  }
  await sleep(keyGap(p, chars[chars.length - 1]));
  p.lastKeyAt = Date.now();
  msg.params.text = chars[chars.length - 1];
}

async function humanize(conn: Conn, msg: any) {
  const p = pointer(conn, msg.sessionId ?? "");
  if (msg.method === "Input.dispatchMouseEvent") await mouse(conn, msg, p);
  else if (msg.method === "Input.dispatchKeyEvent") await key(conn, msg, p);
  else await insertText(conn, msg, p);
}

export function startCdpProxy(slot = 0, scope?: CdpTargetScope): CdpProxy {
  const { cdpPort, proxyPort } = browserSlot(slot);
  if (scope?.excludedTargets.has(scope.targetId)) throw new Error("Job target belongs to another application");
  const upstreamHttp = `http://127.0.0.1:${cdpPort}`;
  const allowed = scope ? new Set([scope.targetId]) : null;
  const clients = new Set<ServerWebSocket<ProxyClient>>();
  let revoked = false;
  let contextId: string | undefined;
  let cachedNativeUa: string | undefined;

  async function getNativeUa(): Promise<string | undefined> {
    if (cachedNativeUa) return cachedNativeUa;
    try {
      const res = await fetch(`${upstreamHttp}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (!res.ok) return undefined;
      const data: unknown = await res.json();
      if (!record(data)) return undefined;
      const ua = data["User-Agent"] ?? data["userAgent"];
      if (typeof ua === "string" && ua.length > 0) {
        cachedNativeUa = ua;
        return ua;
      }
    } catch {}
    return undefined;
  }

  const ownsTarget = (id: string) => !revoked && (allowed === null || allowed.has(id));
  const rewrite = (text: string) => text.replaceAll(`127.0.0.1:${cdpPort}`, `127.0.0.1:${server.port}`).replaceAll(`localhost:${cdpPort}`, `127.0.0.1:${server.port}`);

  function accept(info: TargetInfo, related = false) {
    if (revoked || scope?.excludedTargets.has(info.targetId)) return false;
    if (!ownsTarget(info.targetId) && !related &&
        !(info.openerId && ownsTarget(info.openerId)) && !(info.parentId && ownsTarget(info.parentId))) return false;
    allowed?.add(info.targetId);
    if (info.targetId === scope?.targetId) contextId = info.browserContextId;
    return true;
  }
  function watch(ws: ServerWebSocket<ProxyClient>, id: string) {
    const state = ws.data.targets;
    if (!state?.autoAttach || state.pageId || state.watched.has(id) || !ownsTarget(id)) return;
    state.watched.add(id);
    const requestId = inject(ws.data.conn!, {}, "Target.attachToTarget", { targetId: id, flatten: true });
    state.monitors.set(requestId, id);
  }
  function retireSession(ws: ServerWebSocket<ProxyClient>, sessionId: string) {
    const state = ws.data.targets!;
    const target = state.sessions.get(sessionId);
    state.sessions.delete(sessionId);
    state.autoSessions.delete(sessionId);
    ws.data.conn!.sessions.delete(sessionId);
    ws.data.conn!.queues.delete(sessionId);
    ws.data.conn!.consoleObjects.delete(sessionId);
    if (!target) return;
    for (const liveSession of state.autoSessions) {
      if (state.sessions.get(liveSession) === target) return;
    }
    state.watched.delete(target);
  }
  function announce(ws: ServerWebSocket<ProxyClient>, info: TargetInfo) {
    const state = ws.data.targets!;
    if (!state.discover || state.announced.has(info.targetId)) return;
    state.announced.add(info.targetId);
    ws.send(JSON.stringify({ method: "Target.targetCreated", params: { targetInfo: info } }));
  }

  const server: Server<ProxyClient> = Bun.serve<ProxyClient>({
    hostname: "127.0.0.1",
    port: scope ? 0 : proxyPort,
    idleTimeout: 0,
    async fetch(req, server) {
      const url = new URL(req.url);
      if (revoked) return new Response("worker browser scope revoked", { status: 410 });
      const pageMatch = /^\/devtools\/page\/([^/]+)$/.exec(url.pathname);
      if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
        if (scope && ((!pageMatch && !/^\/devtools\/browser\/[^/]+$/.test(url.pathname)) || (pageMatch && !ownsTarget(pageMatch[1]!))))
          return new Response("target is outside this application", { status: 403 });
        const targets: TargetConnection | undefined = scope ? {
          pageId: pageMatch?.[1], sessions: new Map(), requests: new Map(), infos: new Map(),
          autoAttach: null, monitors: new Map(), watched: new Set(), autoSessions: new Set(), announced: new Set(), discover: false,
        } : undefined;
        return server.upgrade(req, { data: { path: url.pathname + url.search, targets } }) ? undefined : new Response("upgrade failed", { status: 400 });
      }
      if (scope) {
        const action = /^\/json\/(?:activate|close)\/([^/]+)$/.exec(url.pathname);
        if (action && !ownsTarget(action[1]!)) return new Response("target is outside this application", { status: 403 });
        if (!action && !["/json", "/json/list", "/json/version", "/json/protocol", "/json/new"].includes(url.pathname))
          return new Response("unsupported scoped CDP endpoint", { status: 403 });
      }
      try {
        const res = await fetch(upstreamHttp + url.pathname + url.search, { method: req.method });
        let text = await res.text();
        if (scope && res.ok && ["/json", "/json/list", "/json/new"].includes(url.pathname)) {
          const value: unknown = JSON.parse(text);
          if (url.pathname === "/json/new") {
            if (!record(value) || typeof value.id !== "string" || scope.excludedTargets.has(value.id)) throw new Error("Invalid new target");
            allowed!.add(value.id);
            const info = { ...value, targetId: value.id, type: "page" };
            for (const ws of clients) {
              announce(ws, info);
              watch(ws, value.id);
            }
          } else {
            if (!Array.isArray(value)) throw new Error("Invalid target list");
            text = JSON.stringify(value.filter((entry: unknown) => record(entry) && typeof entry.id === "string" && ownsTarget(entry.id)));
          }
        }
        return new Response(rewrite(text), { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
      } catch {
        return new Response("browser is not running or returned invalid CDP data", { status: 502 });
      }
    },
    websocket: {
      maxPayloadLength: 256 * 1024 * 1024,
      idleTimeout: 0,
      open(ws) {
        clients.add(ws);
        const upstream = new WebSocket(`ws://127.0.0.1:${cdpPort}${ws.data.path}`);
        const { promise: openPromise, resolve: resolveOpen } = Promise.withResolvers<void>();
        upstream.onopen = () => resolveOpen();
        const conn: Conn = {
          upstream,
          ready: Promise.all([
            openPromise,
            getNativeUa().then(ua => { if (ua) conn.nativeUserAgent = ua; }),
          ]).then(() => {}),
          sessions: new Map(),
          queues: new Map(),
          injected: new Set(),
          nextId: 1_500_000_000,
          pendingBrowserVersion: new Set(),
          consoleObjects: new Map(),
          nativeUserAgent: cachedNativeUa,
        };
        ws.data.conn = conn;
        upstream.onmessage = ev => {
          if (revoked) return;
          const text = String(ev.data);
          if (
            text.includes("Runtime.consoleAPICalled") ||
            text.includes("executionContext") ||
            text.includes("detachedFromTarget") ||
            conn.pendingBrowserVersion.size > 0
          ) {
            let pre: Packet | null = null;
            try { pre = packet(text); } catch {}
            if (pre) {
              if (pre.method === "Runtime.consoleAPICalled" && Array.isArray(pre.params.args)) {
                const session = pre.sessionId ?? "";
                for (const arg of pre.params.args) {
                  if (record(arg) && typeof arg.objectId === "string" && arg.objectId.length > 0) {
                    trackConsoleObjectId(conn, session, arg.objectId);
                  }
                }
              } else if (
                pre.method === "Runtime.executionContextDestroyed" ||
                pre.method === "Runtime.executionContextsCleared"
              ) {
                conn.consoleObjects.get(pre.sessionId ?? "")?.clear();
              } else if (pre.method === "Target.detachedFromTarget") {
                if (typeof pre.params.sessionId === "string") {
                  conn.consoleObjects.delete(pre.params.sessionId);
                }
              } else if (pre.id !== undefined && conn.pendingBrowserVersion.delete(`${pre.sessionId ?? ""}:${pre.id}`)) {
                if (typeof pre.result?.userAgent === "string" && pre.result.userAgent.length > 0) {
                  conn.nativeUserAgent = pre.result.userAgent;
                  cachedNativeUa = pre.result.userAgent;
                }
              }
            }
          }
          if (!ws.data.targets && conn.injected.size === 0) { ws.send(text); return; }
          let msg: Packet | null;
          try { msg = packet(text); } catch { ws.close(); return; }
          if (!msg) { ws.close(); return; }
          const state = ws.data.targets;
          if (msg.id !== undefined && conn.injected.delete(msg.id)) {
            const target = state?.monitors.get(msg.id);
            state?.monitors.delete(msg.id);
            if (msg.error && state) {
              logEvent("error", "Scoped CDP internal command failed; browser connection closed");
              ws.close();
            } else if (state && target && typeof msg.result?.sessionId === "string") {
              state.sessions.set(msg.result.sessionId, target);
              state.autoSessions.add(msg.result.sessionId);
              if (state.autoAttach)
                inject(conn, { sessionId: msg.result.sessionId }, "Target.setAutoAttach", state.autoAttach);
            }
            return;
          }
          if (!state) { ws.send(text); return; }
          if (msg.id !== undefined) {
            const key = `${msg.sessionId ?? ""}:${msg.id}`;
            const request = state.requests.get(key);
            state.requests.delete(key);
            if (!request) return;
            if (msg.error) { ws.send(text); return; }
            if (request.method === "Browser.getVersion" && typeof msg.result?.userAgent === "string" && msg.result.userAgent.length > 0) {
              conn.nativeUserAgent = msg.result.userAgent;
              cachedNativeUa = msg.result.userAgent;
            }
            if (request.method === "Target.getTargets" && Array.isArray(msg.result?.targetInfos)) {
              msg.result.targetInfos = msg.result.targetInfos.filter((info: unknown) => targetInfo(info) && accept(info));
            } else if (request.method === "Target.getTargetInfo") {
              if (!targetInfo(msg.result?.targetInfo) || !accept(msg.result.targetInfo)) {
                ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, error: { code: -32000, message: "Target is outside this application" } }));
                return;
              }
            } else if (request.method === "Target.getBrowserContexts" && msg.result) {
              // Workers use the persistent profile, not arbitrary/incognito contexts.
              if (contextId === undefined && typeof msg.result.defaultBrowserContextId === "string") contextId = msg.result.defaultBrowserContextId;
              msg.result.browserContextIds = Array.isArray(msg.result.browserContextIds)
                ? msg.result.browserContextIds.filter(id => id === contextId) : [];
            } else if (request.method === "Target.createTarget") {
              const id = msg.result?.targetId;
              if (typeof id !== "string" || scope!.excludedTargets.has(id)) { ws.close(); return; }
              allowed!.add(id);
              const info = state.infos.get(id);
              if (info) announce(ws, info);
              watch(ws, id);
            } else if (request.method === "Target.setAutoAttach" && !request.sessionId && !state.pageId && request.params.autoAttach === true) {
              if (typeof msg.result?.sessionId !== "string") { ws.close(); return; }
              state.sessions.set(msg.result.sessionId, scope!.targetId);
              state.autoSessions.add(msg.result.sessionId);
              if (state.autoAttach) inject(conn, { sessionId: msg.result.sessionId }, "Target.setAutoAttach", state.autoAttach);
              msg.result = {};
            } else if (request.method === "Target.attachToTarget" && typeof msg.result?.sessionId === "string" && typeof request.params.targetId === "string") {
              state.sessions.set(msg.result.sessionId, request.params.targetId);
            }
            ws.send(JSON.stringify({ id: msg.id, sessionId: msg.sessionId, result: msg.result }));
            return;
          }
          const info = msg.params.targetInfo;
          if (msg.method === "Target.attachedToTarget") {
            const parent = msg.sessionId ? state.sessions.get(msg.sessionId) : state.pageId;
            const related = Boolean(parent && ownsTarget(parent));
            if (!targetInfo(info) || !accept(info, related) || typeof msg.params.sessionId !== "string") return;
            state.sessions.set(msg.params.sessionId, info.targetId);
          } else if (msg.method === "Target.targetCreated" || msg.method === "Target.targetInfoChanged") {
            if (!targetInfo(info)) return;
            state.infos.set(info.targetId, info);
            if (!accept(info)) return;
            if (msg.method === "Target.targetCreated") {
              announce(ws, info);
              watch(ws, info.targetId);
              return;
            }
          } else if (msg.method === "Target.detachedFromTarget") {
            if (typeof msg.params.sessionId === "string") conn.consoleObjects.delete(msg.params.sessionId);
            if (typeof msg.params.sessionId !== "string" || !state.sessions.has(msg.params.sessionId)) return;
            retireSession(ws, msg.params.sessionId);
          } else if (msg.method === "Target.targetDestroyed") {
            if (typeof msg.params.targetId !== "string") return;
            const target = msg.params.targetId;
            state.infos.delete(target);
            state.announced.delete(target);
            state.watched.delete(target);
            for (const [sessionId, sessionTarget] of state.sessions) {
              if (sessionTarget === target) retireSession(ws, sessionId);
            }
            for (const [requestId, watchedTarget] of state.monitors) {
              if (watchedTarget !== target) continue;
              state.monitors.delete(requestId);
              conn.injected.delete(requestId);
            }
            // Ownership outlives discovery for lost-tab checkpoints.
            if (!ownsTarget(target)) return;
          } else if (msg.method?.startsWith("Target.")) {
            if (typeof msg.params.targetId !== "string" || !ownsTarget(msg.params.targetId)) return;
            // Retain ownership provenance after destruction so host tools can
            // checkpoint a lost job tab and park safely. Discovery stays live-only.
          }
          if (msg.sessionId && !ownsTarget(state.sessions.get(msg.sessionId) ?? "")) return;
          ws.send(text);
        };
        upstream.onclose = () => { resolveOpen(); ws.close(); };
        upstream.onerror = () => { resolveOpen(); ws.close(); };
      },
      async message(ws, raw) {
        const conn = ws.data.conn!;
        await conn.ready;
        if (revoked || conn.upstream.readyState !== WebSocket.OPEN) return;
        const text = String(raw);
        if (
          !ws.data.targets &&
          !text.includes('"Input.') &&
          !text.includes("setUserAgentOverride") &&
          !text.includes("Browser.getVersion") &&
          !text.includes("Runtime.callFunctionOn") &&
          !text.includes("Runtime.releaseObject")
        ) {
          conn.upstream.send(text);
          return;
        }
        let msg: Packet | null;
        try { msg = packet(text); } catch { ws.close(); return; }
        if (!msg) { ws.close(); return; }

        let modified = false;
        if (
          (msg.method === "Network.setUserAgentOverride" || msg.method === "Emulation.setUserAgentOverride") &&
          conn.nativeUserAgent &&
          Object.keys(msg.params).length === 1 &&
          typeof msg.params.userAgent === "string" &&
          msg.params.userAgent.length > 0 &&
          msg.params.userAgent === conn.nativeUserAgent
        ) {
          msg.params = { ...msg.params, userAgent: "" };
          modified = true;
        }

        if (msg.method === "Browser.getVersion" && msg.id !== undefined) {
          conn.pendingBrowserVersion.add(`${msg.sessionId ?? ""}:${msg.id}`);
        }

        if (msg.method === "Runtime.releaseObject" && typeof msg.params.objectId === "string") {
          conn.consoleObjects.get(msg.sessionId ?? "")?.delete(msg.params.objectId);
        }

        if (msg.method === "Runtime.callFunctionOn" && typeof msg.params.objectId === "string") {
          const session = msg.sessionId ?? "";
          const tracked = conn.consoleObjects.get(session);
          if (tracked?.has(msg.params.objectId)) {
            const keys = Object.keys(msg.params);
            const fn = typeof msg.params.functionDeclaration === "string" ? msg.params.functionDeclaration.trim() : "";
            const isEagerGetterFn =
              fn === "function() { return this; }" ||
              fn === "function(){return this}" ||
              fn === "function () { return this; }" ||
              fn.replace(/\s+/g, "") === "function(){returnthis;}";
            if (
              keys.length === 4 &&
              keys.every(k => k === "objectId" || k === "functionDeclaration" || k === "returnByValue" || k === "silent") &&
              isEagerGetterFn &&
              msg.params.returnByValue === true &&
              msg.params.silent === true
            ) {
              msg.params = { ...msg.params, returnByValue: false, generatePreview: true };
              tracked.delete(msg.params.objectId);
              modified = true;
            }
          }
        }
        const state = ws.data.targets;
        if (state) {
          const incoming = msg;
          const fail = (message: string) => ws.send(JSON.stringify({ id: incoming.id, sessionId: incoming.sessionId, error: { code: -32000, message } }));
          if (msg.sessionId && !ownsTarget(state.sessions.get(msg.sessionId) ?? "")) return void fail("Session is outside this application");
          if (typeof msg.params.targetId === "string" && !ownsTarget(msg.params.targetId)) return void fail("Target is outside this application");
          if (typeof msg.params.sessionId === "string" && !ownsTarget(state.sessions.get(msg.params.sessionId) ?? "")) return void fail("Session is outside this application");
          if (typeof msg.params.browserContextId === "string" && msg.params.browserContextId !== contextId) return void fail("Browser context is outside this application");
          if (msg.method && PROFILE_MUTATIONS[msg.method] === true)
            return void fail("Profile-wide mutation is not allowed for an application");
          if (msg.method?.startsWith("Browser.") && !["Browser.getVersion", "Browser.getWindowForTarget", "Browser.getWindowBounds", "Browser.setWindowBounds", "Browser.setDownloadBehavior"].includes(msg.method))
            return void fail("Browser-wide control is not allowed for an application");
          if (msg.method?.startsWith("Target.") && ![
            "Target.getTargets", "Target.getTargetInfo", "Target.getBrowserContexts", "Target.setDiscoverTargets",
            "Target.setAutoAttach", "Target.attachToTarget", "Target.detachFromTarget",
            "Target.createTarget", "Target.activateTarget", "Target.closeTarget",
          ].includes(msg.method)) return void fail("Unsupported application-scoped target command");
          if (msg.method === "Target.attachToTarget" && msg.params.flatten !== true) return void fail("Scoped CDP requires flattened sessions");
          if (msg.method === "Target.createTarget") {
            if (msg.params.hidden === true || msg.params.forTab === true) return void fail("Application pages must be durable visible targets");
          }
          if ((msg.method === "Target.getTargetInfo" || msg.method === "Browser.getWindowForTarget") && msg.params.targetId === undefined) msg.params.targetId = scope!.targetId;
          if (msg.method === "Target.setDiscoverTargets") {
            state.discover = msg.params.discover === true;
            if (!state.discover) state.announced.clear();
          }
          // Never enable browser-wide auto-attachment: it would attach/pause
          // parked/manual pages before event filtering could protect them.
          const request: Packet = { ...msg, params: { ...msg.params } };
          if (msg.method === "Target.setAutoAttach") {
            if (msg.params.autoAttach === true) {
              if (msg.params.flatten !== true) return void fail("Scoped CDP requires flattened auto-attachment");
              msg.params.filter = [
                { type: "page", exclude: true }, { type: "tab", exclude: true }, { type: "browser", exclude: true },
                ...(Array.isArray(msg.params.filter) ? msg.params.filter : [{}]),
              ];
            }
            if (!msg.sessionId && !state.pageId) {
              if (msg.params.autoAttach === true) {
                state.autoAttach = { ...msg.params };
                state.watched.add(scope!.targetId);
                msg.method = "Target.attachToTarget";
                msg.params = { targetId: scope!.targetId, flatten: true };
              } else {
                state.autoAttach = null;
                for (const sessionId of state.autoSessions) {
                  if (state.sessions.has(sessionId)) inject(conn, {}, "Target.detachFromTarget", { sessionId });
                }
                state.autoSessions.clear();
                state.watched.clear();
              }
            }
          }
          if (msg.id !== undefined) state.requests.set(`${msg.sessionId ?? ""}:${msg.id}`, request);
        }
        if (!msg.method || !INPUT.has(msg.method)) return void conn.upstream.send((state || modified) ? JSON.stringify(msg) : text);
        const session = msg.sessionId ?? "";
        const next = (conn.queues.get(session) ?? Promise.resolve())
          .then(() => { if (!revoked) return humanize(conn, msg); })
          .catch(err => logEvent("error", `input pacing: ${err instanceof Error ? err.message : String(err)}`))
          .then(() => {
            if (!revoked && conn.upstream.readyState === WebSocket.OPEN) conn.upstream.send(JSON.stringify(msg));
          });
        conn.queues.set(session, next);
      },
      close(ws) {
        clients.delete(ws);
        ws.data.conn?.consoleObjects.clear();
        ws.data.conn?.upstream.close();
      },
    },
  });
  const revoke = () => {
    revoked = true;
    for (const ws of clients) {
      ws.data.conn?.consoleObjects.clear();
      ws.data.conn?.upstream.close();
      ws.close();
    }
  };
  const port = server.port;
  if (port === undefined) {
    void server.stop(true);
    throw new Error("CDP proxy requires a TCP listener");
  }
  return { port, ownsTarget, revoke, close: () => { revoke(); void server.stop(true); } };
}
