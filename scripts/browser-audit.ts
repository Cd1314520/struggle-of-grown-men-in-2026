#!/usr/bin/env bun
/**
 * scripts/browser-audit.ts
 *
 * Durable, isolated real-browser measurement harness.
 * Uses repository launch logic (`ensureChrome` and `startCdpProxy` / `prepareJobBrowser`)
 * on disposable displays, ports, and profiles.
 *
 * Captures low-level fingerprint surfaces and public checker verdicts
 * (Sannysoft, BrowserScan, CreepJS, Fingerprint open-source BotD, commercial demo)
 * across Direct CDP, Scoped Proxied, and Attached Browser Target automation routes.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { connect } from "node:net";
import type { CdpProxy } from "../src/cdp-proxy";

// --- Types ---
export type AuditMode = "full" | "baseline" | "after" | "smoke";

export interface AuditOptions {
  mode: AuditMode;
  display: string;
  cdpPort: number;
  proxyPort: number;
  outPath: string;
  screenshotDir: string;
  checkers: string[];
  routes: string[];
  timeoutMs: number;
}

export interface JsonVersionInfo {
  Browser: string;
  "Protocol-Version": string;
  "User-Agent": string;
  "V8-Version": string;
  webSocketDebuggerUrl: string;
}

export interface CdpTabInfo {
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

export interface CdpEvaluateResponse {
  result?: {
    type?: string;
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: {
    text?: string;
    exception?: {
      description?: string;
    };
  };
}

export interface SannysoftRowResult {
  text?: string;
  className?: string;
  failed?: boolean;
  passed?: boolean;
  warn?: boolean;
}

export interface SannysoftResult {
  webdriverResult?: SannysoftRowResult;
  advancedWebdriverResult?: SannysoftRowResult;
  chromeResult?: SannysoftRowResult;
  passedCount: number;
  failedCount: number;
  warnCount: number;
  totalTests: number;
  rows: { name: string; text: string; passed: boolean; failed: boolean; warn: boolean }[];
}

export interface CreepJsResult {
  trustScore: string | null;
  totalLies: number | null;
  scoreText: string | null;
  webDriverIsOn: boolean | null;
  headlessRating: number | null;
  stealthRating: number | null;
  likeHeadlessRating: number | null;
  likeHeadlessFlags: Record<string, boolean>;
  likeHeadlessAllFields: Record<string, unknown>;
  likeHeadlessReasons: string[];
  stealthFlags: Record<string, boolean>;
  headlessFlags: Record<string, boolean>;
  hasSwiftShader: boolean | null;
  hasBadWebGL: boolean | null;
  isReady: boolean;
  clean?: boolean;
  verdict?: string;
  note?: string;
  raw?: Record<string, unknown>;
}

export interface BrowserScanResult {
  hasNormalResult: boolean;
  hasWebdriverMention: boolean;
  botScore?: string | null;
  webdriverStatus?: string | null;
  cdpStatus?: string | null;
  navigatorStatus?: string | null;
  items: Record<string, string>;
  rawSnippet?: string;
  clean?: boolean;
  verdict?: string;
}

export interface FingerprintDemoResult {
  accessible: boolean;
  botVerdict: string | null;
  bot?: string | null;
  developerTools?: boolean | null;
  tampering?: boolean | null;
  virtualMachine?: boolean | null;
  vpn?: boolean | null;
  proxy?: boolean | null;
  suspectScore?: number | null;
  visitorId?: string | null;
  identificationConfidence?: number | null;
  confidenceScore?: number | null;
  serverResponseSnippet?: string | null;
  rawSignals: string[];
  clean?: boolean;
  verdict?: string;
}

export interface CapturedHttpHeaders {
  userAgent: string | null;
  acceptLanguage: string | null;
  secChUa: string | null;
  secChUaMobile: string | null;
  secChUaPlatform: string | null;
  secChUaArch: string | null;
  secChUaBitness: string | null;
  secChUaModel: string | null;
  secChUaPlatformVersion: string | null;
  secChUaFullVersionList: string | null;
  rawHeaders: Record<string, string>;
}

export interface WireDomCoherence {
  coherent: boolean;
  wireHeaders: CapturedHttpHeaders | null;
  apiHeaders: CapturedHttpHeaders | null;
  userAgentMatch: boolean;
  platformMatch: boolean;
  mobileMatch: boolean;
  brandsMatch: boolean;
  languagesMatch: boolean;
  highEntropyArchMatch: boolean | null;
  highEntropyBitnessMatch: boolean | null;
  mismatches: string[];
}

export interface NavigatorOwnKeysProbe {
  ownPropertyNames: string[];
  enumerableKeys: string[];
  hasModelContext: boolean;
  hasWebMcpBridge: boolean;
  isNativeEmpty: boolean;
  unexpectedKeys: string[];
}

export interface ProbeResults {
  webdriver: Record<string, unknown>;
  userAgent: Record<string, unknown>;
  languages: Record<string, unknown>;
  navigatorKeys: NavigatorOwnKeysProbe;
  wireCoherence: WireDomCoherence;
  capturedHeaders: {
    navigation: CapturedHttpHeaders | null;
    api: CapturedHttpHeaders | null;
  };
  plugins: Record<string, unknown>;
  permissions: Record<string, unknown>;
  windowMetrics: Record<string, unknown>;
  webgl: Record<string, unknown>;
  mediaDevicesInitial: Record<string, unknown>;
  mediaDevicesGranted: Record<string, unknown> | null;
  contextConsistency: Record<string, unknown>;
  cdpArtifacts: Record<string, unknown>;
}

export interface RouteCheckers {
  botd?: { status: string; bot?: boolean | null; botKind?: string | null; durationMs?: number; clean?: boolean; verdict?: string };
  sannysoft?: { status: string; results?: SannysoftResult; durationMs?: number; clean?: boolean; verdict?: string };
  creepjs?: { status: string; results?: CreepJsResult; durationMs?: number; clean?: boolean; verdict?: string };
  browserscan?: { status: string; results?: BrowserScanResult; durationMs?: number; clean?: boolean; verdict?: string };
  fingerprint_demo?: { status: string; results?: FingerprintDemoResult; durationMs?: number; clean?: boolean; verdict?: string };
}

export interface RouteAuditResult {
  route: string;
  transport: string;
  frontendCovered: false;
  description: string;
  wireCoherence: WireDomCoherence | null;
  probes: ProbeResults | null;
  checkers: RouteCheckers;
  clean: boolean;
  issues: string[];
}

export interface AuditReport {
  timestamp: string;
  mode: AuditMode;
  frontendCoverage: "none (raw CDP only; does not exercise browser.open, WebMCP bridge, or worker tools)";
  options: Record<string, unknown>;
  system: Record<string, unknown>;
  launch: Record<string, unknown>;
  routes: Record<string, RouteAuditResult>;
}

// --- CLI Parsing ---
function parseArgs(): AuditOptions {
  const args = process.argv.slice(2);
  const opts: AuditOptions = {
    mode: "full",
    display: ":188",
    cdpPort: 19222,
    proxyPort: 19223,
    outPath: "",
    screenshotDir: resolve(process.cwd(), "artifacts/screenshots"),
    checkers: ["sannysoft", "browserscan", "creepjs", "botd", "fingerprint_demo"],
    routes: ["direct", "proxied", "attached"],
    timeoutMs: 40000,
  };
  let checkersExplicit = false;
  let routesExplicit = false;
  let timeoutExplicit = false;

  // Value of a `--flag=value` argument: the text between the first and second "=".
  const inlineValue = (flagArg: string): string => flagArg.split("=")[1] ?? "";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) continue;
    const next = args[i + 1];
    if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: bun run scripts/browser-audit.ts [options]

Options:
  --mode <mode>            Run mode: full | baseline | after | smoke (default: full)
  --display <display>      Isolated X11 display (default: :188)
  --cdp-port <port>        Isolated CDP port (default: 19222)
  --proxy-port <port>      Isolated Proxy port (default: 19223)
  --out <path>             Path to save JSON report (default: artifacts/audit-<timestamp>.json)
  --screenshot-dir <dir>   Directory to save checker screenshots (default: artifacts/screenshots)
  --checkers <list>        Comma-separated checkers: sannysoft,browserscan,creepjs,botd,fingerprint_demo
  --routes <list>          Comma-separated routes: direct,proxied,attached (default: all)
  --timeout <ms>           Timeout per checker in milliseconds (default: 40000)
`);
      process.exit(0);
    } else if (arg.startsWith("--mode=")) {
      opts.mode = inlineValue(arg) as AuditMode;
    } else if (arg === "--mode" && next) {
      opts.mode = next as AuditMode;
      i++;
    } else if (arg.startsWith("--display=")) {
      opts.display = inlineValue(arg);
    } else if (arg === "--display" && next) {
      opts.display = next;
      i++;
    } else if (arg.startsWith("--cdp-port=")) {
      opts.cdpPort = Number(inlineValue(arg));
    } else if (arg === "--cdp-port" && next) {
      opts.cdpPort = Number(next);
      i++;
    } else if (arg.startsWith("--proxy-port=")) {
      opts.proxyPort = Number(inlineValue(arg));
    } else if (arg === "--proxy-port" && next) {
      opts.proxyPort = Number(next);
      i++;
    } else if (arg.startsWith("--out=")) {
      opts.outPath = inlineValue(arg);
    } else if (arg === "--out" && next) {
      opts.outPath = next;
      i++;
    } else if (arg.startsWith("--screenshot-dir=")) {
      opts.screenshotDir = resolve(process.cwd(), inlineValue(arg));
    } else if (arg === "--screenshot-dir" && next) {
      opts.screenshotDir = resolve(process.cwd(), next);
      i++;
    } else if (arg.startsWith("--checkers=")) {
      opts.checkers = inlineValue(arg).split(",").map(s => s.trim().toLowerCase());
      checkersExplicit = true;
    } else if (arg === "--checkers" && next) {
      opts.checkers = next.split(",").map(s => s.trim().toLowerCase());
      i++;
      checkersExplicit = true;
    } else if (arg.startsWith("--routes=")) {
      opts.routes = inlineValue(arg).split(",").map(s => s.trim().toLowerCase());
      routesExplicit = true;
    } else if (arg === "--routes" && next) {
      opts.routes = next.split(",").map(s => s.trim().toLowerCase());
      i++;
      routesExplicit = true;
    } else if (arg.startsWith("--timeout=")) {
      opts.timeoutMs = Number(inlineValue(arg));
      timeoutExplicit = true;
    } else if (arg === "--timeout" && next) {
      opts.timeoutMs = Number(next);
      i++;
      timeoutExplicit = true;
    }
  }

  if (opts.mode === "smoke") {
    if (!checkersExplicit) opts.checkers = ["botd", "sannysoft"];
    if (!routesExplicit) opts.routes = ["direct"];
    if (!timeoutExplicit) opts.timeoutMs = 25000;
  }
  if (!opts.outPath) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    opts.outPath = resolve(process.cwd(), `artifacts/browser-audit-${opts.mode}-${timestamp}.json`);
  } else {
    opts.outPath = resolve(process.cwd(), opts.outPath);
  }

  return opts;
}

// --- Preflight and Lifecycle Helpers ---
function isPortInUse(port: number): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const sock = connect(port, "127.0.0.1");
  sock.once("connect", () => {
    sock.destroy();
    resolve(true);
  });
  sock.once("error", () => { resolve(false); });
  return promise;
}

function isDisplayInUse(display: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const sock = connect(`/tmp/.X11-unix/X${display.replace(":", "")}`);
  sock.once("connect", () => {
    sock.destroy();
    resolve(true);
  });
  sock.once("error", () => { resolve(false); });
  return promise;
}

async function findAuditPids(display: string, profileDir: string): Promise<number[]> {
  try {
    const dispNum = display.replace(":", "");
    // Exact word boundary matching for display and profile dir arguments
    const pattern = `Xvfb\\s+:${dispNum}(\\s|$)|--user-data-dir=${profileDir}(\\s|$)`;
    const pgrep = Bun.spawn(["pgrep", "-f", pattern], {
      stdout: "pipe",
      stderr: "ignore",
    });
    const text = await new Response(pgrep.stdout).text();
    return text
      .split("\n")
      .map(s => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(pid => pid !== process.pid);
  } catch {
    return [];
  }
}

interface AuditSandbox {
  dataDir: string;
  profileDir: string;
  display: string;
  cdpPort: number;
  proxyPort: number;
  markSocketCreated: () => void;
  cleanup: () => Promise<void>;
}

async function setupSandbox(opts: AuditOptions): Promise<AuditSandbox> {
  // Preflight check: refuse to run if display or ports are occupied
  if (await isDisplayInUse(opts.display)) {
    throw new Error(`Preflight check failed: Display ${opts.display} is already in use by an active X server. Refusing to collide.`);
  }
  if (await isPortInUse(opts.cdpPort)) {
    throw new Error(`Preflight check failed: CDP port ${opts.cdpPort} is already listening. Refusing to collide with existing browser.`);
  }
  if (await isPortInUse(opts.proxyPort)) {
    throw new Error(`Preflight check failed: Proxy port ${opts.proxyPort} is already listening. Refusing to collide.`);
  }

  const displayNum = opts.display.replace(":", "");
  const socketPath = `/tmp/.X11-unix/X${displayNum}`;
  const lockPath = `/tmp/.X${displayNum}-lock`;
  if (existsSync(socketPath)) {
    throw new Error(`Preflight check failed: Stale X socket exists at ${socketPath}. Audit refuses to unlink unowned socket.`);
  }
  if (existsSync(lockPath)) {
    throw new Error(`Preflight check failed: Stale X lock exists at ${lockPath}. Audit refuses to collide with existing or crashed X server.`);
  }
  const dataDir = mkdtempSync(join(tmpdir(), "auto-apply-audit-data-"));
  const profileDir = join(dataDir, "chrome-profile");
  mkdirSync(profileDir, { recursive: true });

  // Exception: Dynamic import required because AUTO_APPLY_DATA must be populated in process.env
  // before src/config evaluates its top-level constants (DATA = process.env.AUTO_APPLY_DATA ?? ...).
  process.env["AUTO_APPLY_DATA"] = dataDir;

  const { config, DATA } = await import("../src/config");
  if (DATA !== dataDir) {
    throw new Error(`Sandbox isolation failure: config DATA (${DATA}) does not match sandbox dataDir (${dataDir}). Refusing to run.`);
  }
  config.chrome.display = opts.display;
  config.chrome.cdpPort = opts.cdpPort;
  config.chrome.proxyPort = opts.proxyPort;
  config.chrome.vncPort = 0; // disable VNC for audit sessions

  let createdSocket = false;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    console.log(`[audit-lifecycle] Cleaning up isolated display ${opts.display} and profile ${profileDir}...`);

    // Terminate only processes matching our exact display or profile dir
    const pids = await findAuditPids(opts.display, profileDir);
    if (pids.length > 0) {
      for (const pid of pids) {
        try { process.kill(pid, "SIGTERM"); } catch { /* already exited */ }
      }
      await Bun.sleep(400);
      const remaining = await findAuditPids(opts.display, profileDir);
      for (const pid of remaining) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already exited */ }
      }
    }

    // Only unlink socket and lock if this audit process actually created it
    if (createdSocket && existsSync(socketPath)) {
      try { rmSync(socketPath, { force: true }); } catch { /* best-effort cleanup */ }
    }
    if (createdSocket && existsSync(lockPath)) {
      try { rmSync(lockPath, { force: true }); } catch { /* best-effort cleanup */ }
    }

    // Remove temporary data dir
    try {
      rmSync(dataDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup of the temporary data dir
    }
    console.log(`[audit-lifecycle] Isolated cleanup complete.`);
  };

  process.on("SIGINT", () => {
    void cleanup().then(() => {
      process.exit(130);
    });
  });
  process.on("SIGTERM", () => {
    void cleanup().then(() => {
      process.exit(143);
    });
  });

  return {
    dataDir,
    profileDir,
    display: opts.display,
    cdpPort: opts.cdpPort,
    proxyPort: opts.proxyPort,
    markSocketCreated: () => {
      if (existsSync(socketPath) || existsSync(lockPath)) createdSocket = true;
    },
    cleanup,
  };
}

// --- CDP Client ---
export interface CdpSession {
  send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>;
  evaluate: <T>(expression: string) => Promise<T>;
  navigate: (url: string, waitLoad?: boolean) => Promise<void>;
  captureScreenshot: (savePath: string) => Promise<string | null>;
  setSessionId: (sid: string) => void;
  close: () => void;
  targetId: string;
}

export async function createCdpSession(wsUrl: string, targetId: string, initialSessionId?: string): Promise<CdpSession> {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  let currentSessionId = initialSessionId;
  const pending = new Map<number, { resolve: (val: Record<string, unknown>) => void; reject: (err: Error) => void }>();
  const events = new Map<string, ((params: Record<string, unknown>) => void)[]>();

  const { promise: connectPromise, resolve: resolveConnect, reject: rejectConnect } = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => { rejectConnect(new Error(`WebSocket connection timeout to ${wsUrl}`)); }, 6000);
  ws.onopen = () => {
    clearTimeout(timer);
    resolveConnect(undefined);
  };
  ws.onerror = () => {
    clearTimeout(timer);
    rejectConnect(new Error(`WebSocket connection error to ${wsUrl}`));
    for (const [id, h] of pending) {
      h.reject(new Error(`WebSocket error while CDP request ${id} was pending`));
    }
    pending.clear();
  };
  ws.onclose = () => {
    for (const [id, h] of pending) {
      h.reject(new Error(`WebSocket closed while CDP request ${id} was pending`));
    }
    pending.clear();
  };
  await connectPromise;

  ws.onmessage = (ev) => {
    try {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: Record<string, unknown>;
        error?: { message?: string };
      };
      const handler = msg.id !== undefined ? pending.get(msg.id) : undefined;
      if (msg.id !== undefined && handler) {
        pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        } else {
          handler.resolve(msg.result ?? {});
        }
      } else if (msg.method) {
        const list = events.get(msg.method);
        if (list && msg.params) {
          for (const fn of list) fn(msg.params);
        }
      }
    } catch {
      // Ignore frames that are not valid CDP JSON
    }
  };

  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<Record<string, unknown>> => {
    const id = nextId++;
    const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
    const reqTimer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`CDP command ${method} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    pending.set(id, {
      resolve: (val) => { clearTimeout(reqTimer); resolve(val); },
      reject: (err) => { clearTimeout(reqTimer); reject(err); },
    });
    try {
      const payload: Record<string, unknown> = { id, method, params };
      if (currentSessionId) payload["sessionId"] = currentSessionId;
      ws.send(JSON.stringify(payload));
    } catch (err) {
      clearTimeout(reqTimer);
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
    return promise;
  };

  const evaluate = async <T>(expression: string): Promise<T> => {
    const raw = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    const res = raw as CdpEvaluateResponse;
    if (res.exceptionDetails) {
      const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || "Runtime evaluation failed";
      throw new Error(`Runtime.evaluate failed: ${desc}`);
    }
    return res.result?.value as T;
  };

  const navigate = async (url: string, waitLoad = true): Promise<void> => {
    await send("Page.enable");
    if (!waitLoad) {
      await send("Page.navigate", { url });
      return;
    }

    // Held in an object so the flag set by the event listener is visible to the wait loop below.
    const loadState = { fired: false };
    const onLoad = () => { loadState.fired = true; };
    let loadListeners = events.get("Page.loadEventFired");
    if (!loadListeners) {
      loadListeners = [];
      events.set("Page.loadEventFired", loadListeners);
    }
    loadListeners.push(onLoad);

    try {
      const navRes = await send("Page.navigate", { url });
      if (typeof navRes["errorText"] === "string" && navRes["errorText"].trim().length > 0) {
        throw new Error(`Page.navigate failed: ${navRes["errorText"]}`);
      }
      const start = Date.now();
      while (!loadState.fired && Date.now() - start < 20000) {
        await Bun.sleep(100);
      }
    } finally {
      const list = events.get("Page.loadEventFired");
      if (list) {
        const idx = list.indexOf(onLoad);
        if (idx !== -1) list.splice(idx, 1);
      }
    }
  };

  const captureScreenshot = async (savePath: string): Promise<string | null> => {
    try {
      const res = await send("Page.captureScreenshot", { format: "png" });
      if (typeof res["data"] === "string") {
        mkdirSync(resolve(savePath, ".."), { recursive: true });
        const buf = Buffer.from(res["data"], "base64");
        writeFileSync(savePath, buf);
        return savePath;
      }
      return null;
    } catch {
      return null;
    }
  };

  const close = () => {
    try { ws.close(); } catch { /* socket already closed */ }
  };

  return {
    send,
    evaluate,
    navigate,
    captureScreenshot,
    setSessionId: (sid: string) => { currentSessionId = sid; },
    close,
    targetId,
  };
}

async function createTargetAndSession(cdpUrl: string): Promise<CdpSession> {
  const newRes = await fetch(`${cdpUrl}/json/new?about:blank`, { method: "PUT" });
  if (!newRes.ok) throw new Error(`Failed to create target via ${cdpUrl}/json/new: ${newRes.status}`);
  const target = (await newRes.json()) as CdpTabInfo;
  return createCdpSession(target.webSocketDebuggerUrl, target.id);
}

// Attach via browser target WebSocket (mirroring OMP / Puppeteer connection)
async function createAttachedSession(browserWsUrl: string, targetId: string): Promise<CdpSession> {
  const session = await createCdpSession(browserWsUrl, targetId);
  const attachRes = await session.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const sessionId = typeof attachRes["sessionId"] === "string" ? attachRes["sessionId"] : undefined;
  if (!sessionId) {
    throw new Error(`Target.attachToTarget failed to return sessionId for ${targetId}`);
  }
  session.setSessionId(sessionId);
  return session;
}

// --- Diagnostic HTTP Server & Wire/DOM Coherence Helpers ---
function extractCapturedHeaders(req: Request): CapturedHttpHeaders {
  const h = req.headers;
  const rawHeaders: Record<string, string> = {};
  for (const [k, v] of h.entries()) {
    rawHeaders[k] = v;
  }
  return {
    userAgent: h.get("user-agent"),
    acceptLanguage: h.get("accept-language"),
    secChUa: h.get("sec-ch-ua"),
    secChUaMobile: h.get("sec-ch-ua-mobile"),
    secChUaPlatform: h.get("sec-ch-ua-platform"),
    secChUaArch: h.get("sec-ch-ua-arch"),
    secChUaBitness: h.get("sec-ch-ua-bitness"),
    secChUaModel: h.get("sec-ch-ua-model"),
    secChUaPlatformVersion: h.get("sec-ch-ua-platform-version"),
    secChUaFullVersionList: h.get("sec-ch-ua-full-version-list"),
    rawHeaders,
  };
}

function computeWireDomCoherence(
  wireNav: CapturedHttpHeaders | null,
  wireApi: CapturedHttpHeaders | null,
  domUa: Record<string, unknown>,
  domLang: Record<string, unknown>
): WireDomCoherence {
  const primaryWire = wireApi ?? wireNav;
  const mismatches: string[] = [];

  const domUserAgent = typeof domUa["userAgent"] === "string" ? domUa["userAgent"] : "";
  const domPlatform = typeof domUa["platformFromUad"] === "string" ? domUa["platformFromUad"] : (typeof domUa["platform"] === "string" ? domUa["platform"] : "");
  const domMobile = Boolean(domUa["mobile"]);
  const domBrands = Array.isArray(domUa["brands"]) ? (domUa["brands"] as { brand: string; version: string }[]) : [];
  const domLanguages = Array.isArray(domLang["languages"]) ? (domLang["languages"] as string[]) : [];
  const highEntropy = (domUa["highEntropyValues"] ?? {}) as Record<string, unknown>;

  // 1. User-Agent
  const wireUserAgent = primaryWire?.userAgent || "";
  const userAgentMatch = Boolean(wireUserAgent && domUserAgent && wireUserAgent === domUserAgent);
  if (!userAgentMatch) {
    mismatches.push(`User-Agent wire ('${wireUserAgent}') !== DOM ('${domUserAgent}')`);
  }

  // 2. Platform (Sec-CH-UA-Platform vs navigator.userAgentData.platform)
  const wirePlatformRaw = primaryWire?.secChUaPlatform || "";
  const wirePlatformClean = wirePlatformRaw.replace(/^"|"$/g, "");
  let platformMatch = true;
  if (wirePlatformClean || domPlatform) {
    platformMatch = wirePlatformClean.toLowerCase() === domPlatform.toLowerCase();
    if (!platformMatch) {
      mismatches.push(`Platform wire Sec-CH-UA-Platform ('${wirePlatformClean}') !== DOM platform ('${domPlatform}')`);
    }
  }

  // 3. Mobile (Sec-CH-UA-Mobile vs navigator.userAgentData.mobile)
  const wireMobile = primaryWire?.secChUaMobile || "";
  let mobileMatch = true;
  if (wireMobile) {
    const wireIsMobile = wireMobile === "?1";
    mobileMatch = wireIsMobile === domMobile;
    if (!mobileMatch) {
      mismatches.push(`Mobile wire Sec-CH-UA-Mobile ('${wireMobile}') !== DOM mobile (${domMobile})`);
    }
  }

  // 4. Brands (Sec-CH-UA vs navigator.userAgentData.brands)
  const wireBrands = primaryWire?.secChUa || "";
  let brandsMatch = true;
  if (domBrands.length > 0 && wireBrands) {
    for (const b of domBrands) {
      if (b.brand && !wireBrands.includes(b.brand)) {
        brandsMatch = false;
        mismatches.push(`Brand '${b.brand}' in DOM userAgentData but absent in wire Sec-CH-UA ('${wireBrands}')`);
      }
    }
  } else if (domBrands.length > 0 && !wireBrands) {
    brandsMatch = false;
    mismatches.push("Sec-CH-UA missing on wire while userAgentData.brands is present in DOM");
  }

  // 5. Languages (Accept-Language vs navigator.languages)
  const wireLang = primaryWire?.acceptLanguage || "";
  let languagesMatch = true;
  const domFirstLanguage = domLanguages[0];
  if (wireLang && domFirstLanguage !== undefined) {
    const wirePrimary = (wireLang.split(",")[0] ?? "").trim().toLowerCase();
    const domPrimary = domFirstLanguage.toLowerCase();
    languagesMatch = wirePrimary.startsWith(domPrimary) || domPrimary.startsWith(wirePrimary);
    if (!languagesMatch) {
      mismatches.push(`Accept-Language wire primary ('${wirePrimary}') does not match DOM primary language ('${domPrimary}')`);
    }
  }

  // 6. High Entropy Arch & Bitness
  let highEntropyArchMatch: boolean | null = null;
  let highEntropyBitnessMatch: boolean | null = null;
  if (primaryWire?.secChUaArch && typeof highEntropy["architecture"] === "string") {
    const wireArch = primaryWire.secChUaArch.replace(/^"|"$/g, "").toLowerCase();
    const domArch = highEntropy["architecture"].toLowerCase();
    highEntropyArchMatch = wireArch === domArch;
    if (!highEntropyArchMatch) {
      mismatches.push(`Sec-CH-UA-Arch wire ('${wireArch}') !== DOM highEntropy architecture ('${domArch}')`);
    }
  }
  if (primaryWire?.secChUaBitness && typeof highEntropy["bitness"] === "string") {
    const wireBitness = primaryWire.secChUaBitness.replace(/^"|"$/g, "");
    const domBitness = highEntropy["bitness"];
    highEntropyBitnessMatch = wireBitness === domBitness;
    if (!highEntropyBitnessMatch) {
      mismatches.push(`Sec-CH-UA-Bitness wire ('${wireBitness}') !== DOM highEntropy bitness ('${domBitness}')`);
    }
  }

  return {
    coherent: mismatches.length === 0,
    wireHeaders: wireNav,
    apiHeaders: wireApi,
    userAgentMatch,
    platformMatch,
    mobileMatch,
    brandsMatch,
    languagesMatch,
    highEntropyArchMatch,
    highEntropyBitnessMatch,
    mismatches,
  };
}

// --- Diagnostic In-Browser Probes ---
async function runProbes(session: CdpSession, directCdpPort: number): Promise<ProbeResults> {
  console.log(`[audit-probes] Executing diagnostic in-browser probes...`);
  // Held in an object so headers recorded by the server's fetch handler are visible below.
  const captured: ProbeResults["capturedHeaders"] = { navigation: null, api: null };

  // Ephemeral diagnostic server on localhost (a trusted, secure context)
  const diagServer = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      const headers = extractCapturedHeaders(req);

      if (url.pathname === "/api/headers") {
        captured.api = headers;
        return new Response(JSON.stringify(headers), {
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      captured.navigation = headers;
      return new Response(
        "<!DOCTYPE html><html><head><title>Diagnostic</title></head><body>Diagnostic Secure Context</body></html>",
        {
          headers: {
            "Content-Type": "text/html",
            "Accept-CH": "Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-Platform-Version, Sec-CH-UA-Full-Version-List",
            "Permissions-Policy": "ch-ua=*, ch-ua-mobile=*, ch-ua-platform=*, ch-ua-arch=*, ch-ua-bitness=*, ch-ua-model=*, ch-ua-platform-version=*, ch-ua-full-version-list=*",
          },
        }
      );
    },
  });
  const diagOrigin = `http://127.0.0.1:${diagServer.port}`;

  try {
    await session.navigate(`${diagOrigin}/diagnostic`, true);
    // 1. Webdriver descriptor & native getters
    const webdriverProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'webdriver');
      const hasOwn = Object.prototype.hasOwnProperty.call(navigator, 'webdriver');
      return {
        value: navigator.webdriver,
        hasOwnOnInstance: hasOwn,
        hasDescriptorOnProto: Boolean(descriptor),
        configurable: descriptor ? descriptor.configurable : null,
        enumerable: descriptor ? descriptor.enumerable : null,
        getToString: descriptor && descriptor.get ? Function.prototype.toString.call(descriptor.get) : null,
        typeOfValue: typeof navigator.webdriver,
      };
    })()`);

    // 2. User-Agent, AppVersion, UserAgentData
    const uaProbe = await session.evaluate<Record<string, unknown>>(`(async () => {
      const uad = (navigator).userAgentData;
      let highEntropy = null;
      if (uad && typeof uad.getHighEntropyValues === 'function') {
        try {
          highEntropy = await uad.getHighEntropyValues([
            'architecture', 'model', 'platform', 'platformVersion', 'fullVersionList', 'bitness'
          ]);
        } catch (e) {
          highEntropy = { error: String(e) };
        }
      }
      return {
        userAgent: navigator.userAgent,
        appVersion: navigator.appVersion,
        platform: navigator.platform,
        hasUserAgentData: Boolean(uad),
        brands: uad?.brands ?? null,
        mobile: uad?.mobile ?? null,
        platformFromUad: uad?.platform ?? null,
        highEntropyValues: highEntropy,
      };
    })()`);

    // 3. Languages
    const langProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      return {
        language: navigator.language,
        languages: Array.from(navigator.languages || []),
      };
    })()`);

    // 4. Plugins & MimeTypes
    const pluginsProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      const p = navigator.plugins;
      const m = navigator.mimeTypes;
      const names = [];
      for (let i = 0; i < p.length; i++) {
        if (p[i]?.name) names.push(p[i].name);
      }
      return {
        pluginsLength: p.length,
        mimeTypesLength: m.length,
        pluginNames: names,
        isPluginArrayProto: Object.getPrototypeOf(p) === PluginArray.prototype,
      };
    })()`);

    // 5. Permissions
    const permissionsProbe = await session.evaluate<Record<string, unknown>>(`(async () => {
      let queryResult = null;
      try {
        const status = await navigator.permissions.query({ name: 'notifications' });
        queryResult = status.state;
      } catch (e) {
        queryResult = 'error: ' + String(e);
      }
      return {
        notificationPermission: typeof Notification !== 'undefined' ? Notification.permission : null,
        permissionsQueryNotification: queryResult,
      };
    })()`);

    // 6. Window and Screen Metrics
    const windowMetricsProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      return {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        screenWidth: screen.width,
        screenHeight: screen.height,
        screenAvailWidth: screen.availWidth,
        screenAvailHeight: screen.availHeight,
        deltaWidth: window.outerWidth - window.innerWidth,
        deltaHeight: window.outerHeight - window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      };
    })()`);

    // 7. WebGL Vendor & Renderer
    const webglProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        if (!gl) return { supported: false };
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const isSoftware = /swiftshader|llvmpipe|software/i.test(renderer);
        return {
          supported: true,
          vendor,
          renderer,
          isSoftwareRenderer: isSoftware,
        };
      } catch (e) {
        return { supported: false, error: String(e) };
      }
    })()`);

    // 8. Media Devices (Initial, getUserMedia, and Post-Grant)
    const mediaDevicesInitial = await session.evaluate<Record<string, unknown>>(`(async () => {
      try {
        if (!navigator.mediaDevices?.enumerateDevices) return { supported: false };
        const devices = await navigator.mediaDevices.enumerateDevices();
        const fakeLabels = devices.filter(d => /fake/i.test(d.label)).map(d => d.label);
        return {
          supported: true,
          count: devices.length,
          devices: devices.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId ? 'present' : 'empty' })),
          hasFakeLabels: fakeLabels.length > 0,
          fakeLabels,
        };
      } catch (e) {
        return { supported: false, error: String(e) };
      }
    })()`);

    // Grant permission via direct browser session (direct port) without weakening the scoped proxy
    let mediaDevicesGranted: Record<string, unknown> | null = null;
    try {
      const verRes = await fetch(`http://127.0.0.1:${directCdpPort}/json/version`);
      const ver = (await verRes.json()) as JsonVersionInfo;
      const directBrowserSession = await createCdpSession(ver.webSocketDebuggerUrl, "browser");
      try {
        await directBrowserSession.send("Browser.grantPermissions", {
          permissions: ["videoCapture", "audioCapture"],
          origin: diagOrigin,
        });
      } finally {
        directBrowserSession.close();
      }
      // Invoke getUserMedia under diagnostic origin to populate device tracks
      mediaDevicesGranted = await session.evaluate<Record<string, unknown>>(`(async () => {
        let gumOk = false;
        let gumError = null;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
          gumOk = true;
          stream.getTracks().forEach(t => t.stop());
        } catch (e) {
          gumError = String(e);
        }

        const devices = await navigator.mediaDevices.enumerateDevices();
        const fakeLabels = devices.filter(d => /fake/i.test(d.label)).map(d => d.label);
        return {
          supported: true,
          gumOk,
          gumError,
          count: devices.length,
          devices: devices.map(d => ({ kind: d.kind, label: d.label, deviceId: d.deviceId ? 'present' : 'empty' })),
          hasFakeLabels: fakeLabels.length > 0,
          fakeLabels,
        };
      })()`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      mediaDevicesGranted = { error: `grantPermissions failed: ${msg}` };
    }

    // 9. Context Consistency (Window vs IFrame vs Worker)
    const contextConsistencyProbe = await session.evaluate<Record<string, unknown>>(`(async () => {
      const main = {
        webdriver: navigator.webdriver,
        userAgent: navigator.userAgent,
        language: navigator.language,
        languages: Array.from(navigator.languages || []),
        platform: navigator.platform,
        brands: (navigator).userAgentData?.brands || null,
      };

      let iframe = null;
      try {
        const frame = document.createElement('iframe');
        document.body.appendChild(frame);
        const fw = frame.contentWindow;
        if (fw) {
          iframe = {
            webdriver: fw.navigator.webdriver,
            userAgent: fw.navigator.userAgent,
            language: fw.navigator.language,
            languages: Array.from(fw.navigator.languages || []),
            platform: fw.navigator.platform,
            brands: (fw.navigator).userAgentData?.brands || null,
          };
        }
        document.body.removeChild(frame);
      } catch (e) {
        iframe = { error: String(e) };
      }

      let worker = null;
      try {
        const workerCode = \`
          onmessage = () => {
            let glVendor = null;
            let glRenderer = null;
            try {
              if (typeof OffscreenCanvas !== 'undefined') {
                const oc = new OffscreenCanvas(64, 64);
                const gl = oc.getContext('webgl');
                if (gl) {
                  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
                  glVendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
                  glRenderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
                }
              }
            } catch (e) {}

            postMessage({
              webdriver: typeof navigator.webdriver !== 'undefined' ? navigator.webdriver : null,
              userAgent: navigator.userAgent,
              language: navigator.language,
              languages: Array.from(navigator.languages || []),
              platform: navigator.platform,
              brands: (navigator).userAgentData?.brands || null,
              glVendor,
              glRenderer,
            });
          };
        \`;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        const w = new Worker(URL.createObjectURL(blob));
        worker = await new Promise((resolve) => {
          w.onmessage = (e) => resolve(e.data);
          w.onerror = (e) => resolve({ error: e.message });
          setTimeout(() => resolve({ error: 'timeout' }), 2500);
          w.postMessage('ping');
        });
        w.terminate();
      } catch (e) {
        worker = { error: String(e) };
      }

      const uaMatch = iframe?.userAgent === main.userAgent && worker?.userAgent === main.userAgent;
      const langMatch = iframe?.language === main.language && worker?.language === main.language;
      const platformMatch = iframe?.platform === main.platform && worker?.platform === main.platform;

      return {
        main,
        iframe,
        worker,
        consistency: {
          userAgentMatch: uaMatch,
          languageMatch: langMatch,
          platformMatch,
          overallConsistent: uaMatch && langMatch && platformMatch,
        },
      };
    })()`);

    // 10. CDP console & runtime serialization artifacts
    const cdpArtifactsProbe = await session.evaluate<Record<string, unknown>>(`(() => {
      const errorStack = new Error().stack || '';
      const hasPuppeteerArtifact = Boolean(
        (window)['__puppeteer_evaluation_script__'] ||
        errorStack.includes('__puppeteer_evaluation_script__')
      );
      return {
        hasPuppeteerArtifact,
        hasCdpRuntimeGlobals: Boolean((window)['cdc_adoQpoasnfa76pfcZLmcfl_Array']),
      };
    })()`);

    // 11. Navigator Own Keys & WebMCP Bridge Probe
    const navigatorKeysProbe = await session.evaluate<NavigatorOwnKeysProbe>(`(() => {
      const ownNames = Object.getOwnPropertyNames(navigator);
      const enumerableKeys = Object.keys(navigator);
      const hasModelContext = ownNames.includes('modelContext') || ('modelContext' in navigator);
      const hasWebMcpBridge = Boolean((window).__ompWebMcpBridge_v1);
      const unexpected = ownNames.filter(k => k === 'modelContext' || k.startsWith('__'));
      return {
        ownPropertyNames: ownNames,
        enumerableKeys: enumerableKeys,
        hasModelContext,
        hasWebMcpBridge,
        isNativeEmpty: ownNames.length === 0,
        unexpectedKeys: unexpected,
      };
    })()`);

    // 12. HTTP Client Hints verification fetch
    const apiHeadersProbe = await session.evaluate<CapturedHttpHeaders | null>(`(async () => {
      try {
        const res = await fetch('/api/headers');
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    })()`);

    const wireDomCoherence = computeWireDomCoherence(
      captured.navigation,
      captured.api ?? apiHeadersProbe,
      uaProbe,
      langProbe
    );

    return {
      webdriver: webdriverProbe,
      userAgent: uaProbe,
      languages: langProbe,
      navigatorKeys: navigatorKeysProbe,
      wireCoherence: wireDomCoherence,
      capturedHeaders: {
        navigation: captured.navigation,
        api: captured.api ?? apiHeadersProbe,
      },
      plugins: pluginsProbe,
      permissions: permissionsProbe,
      windowMetrics: windowMetricsProbe,
      webgl: webglProbe,
      mediaDevicesInitial,
      mediaDevicesGranted,
      contextConsistency: contextConsistencyProbe,
      cdpArtifacts: cdpArtifactsProbe,
    };
  } finally {
    void diagServer.stop(true);
  }
}

// --- Public Anti-Bot Checker Runners ---

// Sannysoft (https://bot.sannysoft.com/)
async function checkSannysoft(session: CdpSession, screenshotPath: string, timeoutMs: number) {
  console.log(`[checker:sannysoft] Navigating to https://bot.sannysoft.com/...`);
  const startTime = Date.now();
  try {
    await session.navigate("https://bot.sannysoft.com/", true);

    let done = false;
    while (Date.now() - startTime < timeoutMs) {
      const ready = await session.evaluate<boolean>(`(() => {
        const el = document.getElementById('webdriver-result');
        return Boolean(el && el.textContent && el.textContent.trim().length > 0);
      })()`);
      if (ready) {
        done = true;
        break;
      }
      await Bun.sleep(250);
    }

    if (!done) {
      const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
      return {
        status: "timeout",
        durationMs: Date.now() - startTime,
        screenshot,
      };
    }

    await Bun.sleep(1200);

    const results = await session.evaluate<SannysoftResult>(`(() => {
      const getRow = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        return {
          text: el.textContent?.trim() || '',
          className: el.className || '',
          failed: el.classList.contains('failed'),
          passed: el.classList.contains('passed'),
          warn: el.classList.contains('warn'),
        };
      };

      const tableRows = [];
      const trs = document.querySelectorAll('table tr');
      let passedCount = 0;
      let failedCount = 0;
      let warnCount = 0;

      trs.forEach(tr => {
        const tds = tr.querySelectorAll('td');
        if (tds.length >= 2) {
          const name = tds[0].textContent?.trim() || '';
          const resultTd = tds[1];
          const text = resultTd.textContent?.trim() || '';
          const passed = resultTd.classList.contains('passed');
          const failed = resultTd.classList.contains('failed');
          const warn = resultTd.classList.contains('warn');
          if (passed) passedCount++;
          if (failed) failedCount++;
          if (warn) warnCount++;
          tableRows.push({ name, text, passed, failed, warn });
        }
      });

      return {
        webdriverResult: getRow('webdriver-result'),
        advancedWebdriverResult: getRow('advanced-webdriver-result'),
        chromeResult: getRow('chrome-result'),
        permissionsResult: getRow('permissions-result'),
        pluginsLengthResult: getRow('plugins-length-result'),
        pluginsTypeResult: getRow('plugins-type-result'),
        languagesResult: getRow('languages-result'),
        webglVendor: document.getElementById('webgl-vendor')?.textContent?.trim() || null,
        webglRenderer: document.getElementById('webgl-renderer')?.textContent?.trim() || null,
        brokenImageDimensions: document.getElementById('broken-image-dimensions')?.textContent?.trim() || null,
        passedCount,
        failedCount,
        warnCount,
        totalTests: tableRows.length,
        rows: tableRows,
      };
    })()`);

    const isClean =
      results.failedCount === 0 &&
      results.webdriverResult?.passed === true &&
      results.advancedWebdriverResult?.passed === true &&
      results.chromeResult?.passed === true;
    const screenshot = await session.captureScreenshot(screenshotPath);
    return {
      status: "completed",
      clean: isClean,
      verdict: isClean ? "clean" : "failed",
      durationMs: Date.now() - startTime,
      results,
      screenshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
    return {
      status: "error",
      clean: false,
      verdict: "error",
      error: msg,
      durationMs: Date.now() - startTime,
      screenshot,
    };
  }
}

// Fingerprint Open-Source BotD (openfpcdn.io/botd/v2)
async function checkBotD(session: CdpSession, screenshotPath: string, _timeoutMs: number) {
  console.log(`[checker:botd] Testing Open-Source BotD via openfpcdn.io/botd/v2...`);
  const startTime = Date.now();
  try {
    await session.navigate("about:blank", true);

    const result = await session.evaluate<{
      status: string;
      error?: string;
      detection?: { bot: boolean; botKind?: string };
    }>(`(async () => {
      try {
        const Botd = await import('https://openfpcdn.io/botd/v2');
        const botd = await Botd.load({ monitoring: false });
        const detection = await botd.detect();
        return {
          status: 'success',
          detection,
        };
      } catch (err) {
        return {
          status: 'error',
          error: String(err),
        };
      }
    })()`);

    const isClean = Boolean(result.status === "success" && result.detection && !result.detection.bot);
    const screenshot = await session.captureScreenshot(screenshotPath);
    return {
      status: result.status === "success" ? "completed" : "error",
      clean: isClean,
      verdict: isClean ? "clean" : (result.detection?.bot ? "bot_detected" : "error"),
      error: result.error,
      bot: result.detection?.bot ?? null,
      botKind: result.detection?.botKind ?? null,
      durationMs: Date.now() - startTime,
      screenshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: "error",
      clean: false,
      verdict: "error",
      error: msg,
      durationMs: Date.now() - startTime,
      screenshot: null,
    };
  }
}

// CreepJS (https://abrahamjuliot.github.io/creepjs/)
async function checkCreepJS(session: CdpSession, screenshotPath: string, timeoutMs: number) {
  console.log(`[checker:creepjs] Navigating to https://abrahamjuliot.github.io/creepjs/...`);
  const startTime = Date.now();
  try {
    await session.navigate("https://abrahamjuliot.github.io/creepjs/", true);

    let detectorReady = false;
    let trustScoreReady = false;
    let detectorReadyTime: number | null = null;

    while (Date.now() - startTime < timeoutMs) {
      const state = await session.evaluate<{
        hasDetector: boolean;
        hasTrustScore: boolean;
        likeRating: number | null;
        totalLies: number | null;
        scoreText: string | null;
      }>(`(() => {
        const w = window;
        const fp = (w).Fingerprint || (w).Creep;
        const scoreEl = document.getElementById('fp-score') || document.querySelector('.score-desc');
        const scoreText = scoreEl ? (scoreEl.textContent || '').trim() : null;
        const hasScoreText = Boolean(scoreText && (/\\d+%/i.test(scoreText) || /trust/i.test(scoreText)));
        const hasTrustScore = Boolean(fp && fp.trustScore != null) || hasScoreText;

        const likeRating = (fp?.headless && typeof fp.headless.likeHeadlessRating === 'number')
          ? fp.headless.likeHeadlessRating
          : null;
        const headlessRating = (fp?.headless && typeof fp.headless.headlessRating === 'number')
          ? fp.headless.headlessRating
          : null;
        const stealthRating = (fp?.headless && typeof fp.headless.stealthRating === 'number')
          ? fp.headless.stealthRating
          : null;
        const totalLies = (fp?.lies && typeof fp.lies.totalLies === 'number')
          ? fp.lies.totalLies
          : null;

        const hasDetector = Boolean(likeRating !== null && headlessRating !== null && stealthRating !== null && totalLies !== null);

        return {
          hasDetector,
          hasTrustScore,
          likeRating,
          totalLies,
          scoreText,
        };
      })()`);

      if (state.hasDetector) {
        detectorReady = true;
        detectorReadyTime ??= Date.now();
      }
      if (state.hasTrustScore) {
        trustScoreReady = true;
      }

      // If both detector calculations and trust score are settled, we are ready
      if (detectorReady && trustScoreReady) {
        break;
      }
      // If detector calculations are complete, allow up to 3 seconds for trust score to populate in checker output before proceeding
      if (detectorReady && detectorReadyTime !== null && Date.now() - detectorReadyTime >= 3000) {
        break;
      }

      await Bun.sleep(500);
    }

    if (!detectorReady) {
      const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
      const partialReport = await session.evaluate<Partial<CreepJsResult>>(`(() => {
        const w = window;
        const fp = (w).Fingerprint || (w).Creep;
        const scoreEl = document.getElementById('fp-score') || document.querySelector('.score-desc');
        return {
          trustScore: fp?.trustScore != null ? String(fp.trustScore) : (scoreEl ? scoreEl.textContent?.trim() : null),
          totalLies: (fp?.lies && typeof fp.lies.totalLies === 'number') ? fp.lies.totalLies : null,
          likeHeadlessRating: (fp?.headless && typeof fp.headless.likeHeadlessRating === 'number') ? fp.headless.likeHeadlessRating : null,
          headlessRating: (fp?.headless && typeof fp.headless.headlessRating === 'number') ? fp.headless.headlessRating : null,
          stealthRating: (fp?.headless && typeof fp.headless.stealthRating === 'number') ? fp.headless.stealthRating : null,
          isReady: false,
        };
      })()`).catch((): Partial<CreepJsResult> => ({}));

      return {
        status: "timeout",
        durationMs: Date.now() - startTime,
        clean: false,
        verdict: "timeout",
        results: {
          trustScore: partialReport.trustScore ?? null,
          totalLies: partialReport.totalLies ?? null,
          scoreText: partialReport.trustScore ?? null,
          webDriverIsOn: null,
          headlessRating: partialReport.headlessRating ?? null,
          stealthRating: partialReport.stealthRating ?? null,
          likeHeadlessRating: partialReport.likeHeadlessRating ?? null,
          likeHeadlessFlags: {},
          likeHeadlessAllFields: {},
          likeHeadlessReasons: [],
          stealthFlags: {},
          headlessFlags: {},
          hasSwiftShader: null,
          hasBadWebGL: null,
          isReady: false,
          clean: false,
          verdict: "timeout",
          note: "CreepJS timed out before detector analysis completed; partial metrics recorded honestly (not clean)",
        },
        screenshot,
      };
    }

    await Bun.sleep(500);

    const report = await session.evaluate<CreepJsResult>(`(() => {
      const w = window;
      const fp = (w).Fingerprint || (w).Creep;
      const scoreEl = document.getElementById('fp-score') || document.querySelector('.score-desc');
      const scoreText = scoreEl ? scoreEl.textContent?.trim() : null;

      const totalLies = (fp?.lies && typeof fp.lies.totalLies === 'number') ? fp.lies.totalLies : null;
      const webDriverIsOn = fp?.headless?.headless?.webDriverIsOn ?? null;
      const headlessRating = (fp?.headless && typeof fp.headless.headlessRating === 'number') ? fp.headless.headlessRating : null;
      const stealthRating = (fp?.headless && typeof fp.headless.stealthRating === 'number') ? fp.headless.stealthRating : null;
      const likeHeadlessRating = (fp?.headless && typeof fp.headless.likeHeadlessRating === 'number') ? fp.headless.likeHeadlessRating : null;

      // Capture actual Fingerprint.headless.likeHeadless all fields and reasons
      const rawLikeHeadless = (fp?.headless?.likeHeadless && typeof fp.headless.likeHeadless === 'object')
        ? fp.headless.likeHeadless
        : {};
      const likeHeadlessFlags = {};
      const likeHeadlessAllFields = {};
      const likeHeadlessReasons = [];

      for (const [key, val] of Object.entries(rawLikeHeadless)) {
        likeHeadlessAllFields[key] = val;
        if (typeof val === 'boolean') {
          likeHeadlessFlags[key] = val;
          if (val) {
            likeHeadlessReasons.push(key);
          }
        } else if (typeof val === 'string' && val.length > 0) {
          likeHeadlessReasons.push(\`\${key}: \${val}\`);
        }
      }

      if (Array.isArray(rawLikeHeadless.reasons)) {
        for (const r of rawLikeHeadless.reasons) {
          if (typeof r === 'string' && !likeHeadlessReasons.includes(r)) {
            likeHeadlessReasons.push(r);
          }
        }
      }

      // Capture actual stealth flags
      const rawStealth = (fp?.headless?.stealth && typeof fp.headless.stealth === 'object')
        ? fp.headless.stealth
        : {};
      const stealthFlags = {};
      for (const [key, val] of Object.entries(rawStealth)) {
        if (typeof val === 'boolean') {
          stealthFlags[key] = val;
        }
      }

      // Capture actual headless flags
      const rawHeadless = (fp?.headless?.headless && typeof fp.headless.headless === 'object')
        ? fp.headless.headless
        : {};
      const headlessFlags = {};
      for (const [key, val] of Object.entries(rawHeadless)) {
        if (typeof val === 'boolean') {
          headlessFlags[key] = val;
        }
      }

      const hasSwiftShader = fp?.headless?.likeHeadless?.hasSwiftShader ?? null;
      const hasBadWebGL = fp?.headless?.stealth?.hasBadWebGL ?? null;
      const trustScore = fp?.trustScore != null
        ? String(fp.trustScore)
        : (scoreText && /\\d+/.test(scoreText) ? scoreText : null);

      const isReady = Boolean(likeHeadlessRating !== null && headlessRating !== null && stealthRating !== null && totalLies !== null);

      return {
        trustScore,
        totalLies,
        scoreText,
        webDriverIsOn,
        headlessRating,
        stealthRating,
        likeHeadlessRating,
        likeHeadlessFlags,
        likeHeadlessAllFields,
        likeHeadlessReasons,
        stealthFlags,
        headlessFlags,
        hasSwiftShader,
        hasBadWebGL,
        isReady,
      };
    })()`);

    // Clean requires all ratings clean AND confirmed totalLies === 0 AND non-null trustScore
    const hasTrustScore = report.trustScore !== null;
    const isClean =
      report.isReady &&
      hasTrustScore &&
      report.totalLies === 0 &&
      report.webDriverIsOn === false &&
      report.headlessRating === 0 &&
      report.stealthRating === 0 &&
      report.hasSwiftShader === false &&
      report.hasBadWebGL === false;

    report.clean = isClean;
    if (isClean) {
      report.verdict = "clean";
    } else if (report.totalLies !== 0 && report.totalLies !== null) {
      report.verdict = "lies_detected";
    } else if (!hasTrustScore) {
      report.verdict = "missing_trust_score";
      report.note = "Detector analysis completed; trust score unavailable in observed checker output";
    } else {
      report.verdict = "flagged";
    }

    const screenshot = await session.captureScreenshot(screenshotPath);
    return {
      status: "completed",
      clean: isClean,
      verdict: report.verdict,
      durationMs: Date.now() - startTime,
      results: report,
      screenshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
    return {
      status: "error",
      clean: false,
      verdict: "error",
      error: msg,
      durationMs: Date.now() - startTime,
      screenshot,
    };
  }
}

// BrowserScan (https://www.browserscan.net/bot-detection)
async function checkBrowserScan(session: CdpSession, screenshotPath: string, timeoutMs: number) {
  console.log(`[checker:browserscan] Navigating to https://www.browserscan.net/bot-detection...`);
  const startTime = Date.now();
  try {
    await session.navigate("https://www.browserscan.net/bot-detection", true);

    let done = false;
    while (Date.now() - startTime < timeoutMs) {
      const state = await session.evaluate<{ hasResults: boolean; isScanning: boolean; isBlocked: boolean }>(`(() => {
        const text = document.body ? document.body.innerText : '';
        const isBlocked = /cf-challenge|challenge-running|Attention Required|Access Denied/i.test(text);
        // Look for actual completed detection items
        const hasResults = /WebDriverNormal|WebDriverAbnormal|WebDriver AdvanceNormal|Test Results/i.test(text);
        const isScanning = /Scanning|Analyzing/i.test(text);
        return { hasResults, isScanning, isBlocked };
      })()`);

      if (state.isBlocked) {
        const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
        return {
          status: "challenge_or_blocked",
          clean: false,
          verdict: "challenge_or_blocked",
          durationMs: Date.now() - startTime,
          screenshot,
        };
      }

      if (state.hasResults && !state.isScanning) {
        done = true;
        break;
      }
      await Bun.sleep(500);
    }

    if (!done) {
      const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
      return {
        status: "timeout",
        clean: false,
        verdict: "timeout",
        durationMs: Date.now() - startTime,
        screenshot,
      };
    }

    await Bun.sleep(1000);

    const scanData = await session.evaluate<BrowserScanResult>(`(() => {
      const bodyText = document.body?.innerText || '';
      const items = {};

      document.querySelectorAll('tr, .collapse-item, ._11xj7yu').forEach(el => {
        const text = el.innerText?.trim();
        if (!text) return;
        const lines = text.split('\\n').map(s => s.trim()).filter(Boolean);
        if (lines.length >= 2) {
          items[lines[0]] = lines.slice(1).join(' ');
        } else if (lines.length === 1) {
          const m = lines[0].match(/^(.*)(Normal|Abnormal|Passed|Failed)$/i);
          if (m) items[m[1]] = m[2];
        }
      });

      let botScore = null;
      const scoreMatch = bodyText.match(/Bot Score[:\\s]+([0-9%]+)/i);
      if (scoreMatch) botScore = scoreMatch[1];

      // 1. Overall Test Result: Check specific DOM badge or strict re-anchored regex (mutually exclusive)
      let overallResult = null;
      const resultBadge = document.querySelector('._oxrqr1, ._1ikblmd');
      if (resultBadge) {
        const badgeText = resultBadge.textContent ? resultBadge.textContent.trim() : '';
        const hasSuccessSvg = Boolean(resultBadge.querySelector('use[*|href*="status_success"], svg[class*="success"]'));
        const hasErrorSvg = Boolean(resultBadge.querySelector('use[*|href*="status_error"], use[*|href*="status_failed"], svg[class*="error"], svg[class*="fail"]'));
        if (hasSuccessSvg || /Normal/i.test(badgeText)) {
          overallResult = 'Normal';
        } else if (hasErrorSvg || /Robot/i.test(badgeText)) {
          overallResult = 'Robot';
        }
      }

      if (!overallResult) {
        const m = bodyText.match(/Test Results[:\\s\\n]+(Normal|Robot)\\b/i);
        if (m) {
          overallResult = m[1].toLowerCase() === 'normal' ? 'Normal' : 'Robot';
        }
      }

      const isNormal = overallResult === 'Normal';
      const isRobot = overallResult === 'Robot';

      // 2. Native Navigator Status: inspect own ancestor wrapper svg status
      let navigatorStatus = null;
      const navHeader = document.getElementById('anchor_navigator') ||
        Array.from(document.querySelectorAll('h2, h3, div')).find(el => el.textContent && el.textContent.trim() === 'Native Navigator');

      if (navHeader) {
        const container = navHeader.closest('div._11xj7yu, .collapse-item, section, div') || navHeader.parentElement;
        if (container) {
          const hasSuccess = Boolean(container.querySelector('use[*|href*="status_success"], svg[class*="success"]'));
          const hasError = Boolean(container.querySelector('use[*|href*="status_error"], use[*|href*="status_failed"], svg[class*="error"], svg[class*="fail"]'));
          if (hasSuccess) {
            navigatorStatus = 'Normal';
          } else if (hasError) {
            navigatorStatus = 'Abnormal';
          } else {
            const headerText = container.querySelector('header, .header, .title')?.textContent || '';
            const m = headerText.match(/\\b(Normal|Abnormal|Passed|Failed)\\b/i);
            if (m) navigatorStatus = m[1];
          }
        }
      }
      if (!navigatorStatus) {
        navigatorStatus = items['Native Navigator'] || items['Navigator'] || null;
      }

      // 3. CDP / Dev Tool Status
      let cdpStatus = items['CDP'] || items['Dev Tool'] || null;
      if (!cdpStatus) {
        const cdpHeader = Array.from(document.querySelectorAll('h2, h3, strong, div')).find(el => {
          const t = el.textContent ? el.textContent.trim() : '';
          return t === 'CDP' || t === 'Dev Tool';
        });
        if (cdpHeader) {
          const container = cdpHeader.parentElement || cdpHeader.closest('div');
          if (container) {
            const hasSuccess = Boolean(container.querySelector('use[*|href*="status_success"]'));
            const hasError = Boolean(container.querySelector('use[*|href*="status_error"], use[*|href*="status_failed"]'));
            if (hasSuccess) cdpStatus = 'Normal';
            else if (hasError) cdpStatus = 'Abnormal';
            else {
              const m = container.textContent?.match(/\\b(Normal|Abnormal)\\b/i);
              if (m) cdpStatus = m[1];
            }
          }
        }
      }

      // 4. WebDriver Status
      let webdriverStatus = items['WebDriver'] || items['WebDriver Advance'] || null;
      if (!webdriverStatus) {
        const wdHeader = Array.from(document.querySelectorAll('h2, h3, strong, div')).find(el => el.textContent && el.textContent.trim() === 'WebDriver');
        if (wdHeader) {
          const container = wdHeader.parentElement || wdHeader.closest('div');
          if (container) {
            const hasSuccess = Boolean(container.querySelector('use[*|href*="status_success"]'));
            const hasError = Boolean(container.querySelector('use[*|href*="status_error"]'));
            if (hasSuccess) webdriverStatus = 'Normal';
            else if (hasError) webdriverStatus = 'Abnormal';
            else {
              const m = container.textContent?.match(/\\b(Normal|Abnormal)\\b/i);
              if (m) webdriverStatus = m[1];
            }
          }
        }
      }

      // 5. Verdict & Clean (Mutually exclusive: Normal vs Robot; invalid/unparsed = unparsed_or_incomplete)
      const hasFailedSubtest = Boolean(
        (webdriverStatus && /abnormal|fail/i.test(webdriverStatus)) ||
        (cdpStatus && /abnormal|fail/i.test(cdpStatus)) ||
        (navigatorStatus && /abnormal|fail/i.test(navigatorStatus))
      );

      let isClean = false;
      let verdict = 'unparsed_or_incomplete';

      if (isRobot) {
        isClean = false;
        verdict = 'robot';
      } else if (isNormal && !hasFailedSubtest) {
        isClean = true;
        verdict = 'clean';
      } else if (isNormal && hasFailedSubtest) {
        isClean = false;
        verdict = 'flagged';
      } else {
        isClean = false;
        verdict = 'unparsed_or_incomplete';
      }

      return {
        hasNormalResult: isNormal,
        hasWebdriverMention: Boolean(webdriverStatus || /webdriver/i.test(bodyText)),
        botScore,
        webdriverStatus,
        cdpStatus,
        navigatorStatus,
        items,
        rawSnippet: bodyText.slice(0, 400).replace(/\\s+/g, ' '),
        clean: isClean,
        verdict,
      };
    })()`);

    const screenshot = await session.captureScreenshot(screenshotPath);
    return {
      status: "completed",
      clean: scanData.clean ?? false,
      verdict: scanData.verdict ?? "unknown",
      durationMs: Date.now() - startTime,
      results: scanData,
      screenshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
    return {
      status: "error",
      clean: false,
      verdict: "error",
      error: msg,
      durationMs: Date.now() - startTime,
      screenshot,
    };
  }
}

// Commercial Fingerprint Demo (https://demo.fingerprint.com/playground)
async function checkFingerprintDemo(session: CdpSession, screenshotPath: string, timeoutMs: number) {
  console.log(`[checker:fingerprint-demo] Navigating to https://demo.fingerprint.com/playground...`);
  const startTime = Date.now();
  try {
    await session.navigate("https://demo.fingerprint.com/playground", true);

    let done = false;
    while (Date.now() - startTime < Math.min(timeoutMs, 30000)) {
      const state = await session.evaluate<{ hasSignals: boolean; isBlocked: boolean; isRunning: boolean }>(`(() => {
        const text = document.body ? document.body.innerText : '';
        const isBlocked = /Cloudflare|Challenge|Turnstile|Captcha|Attention Required/i.test(text);
        const isRunning = /Running Device Intelligence/i.test(text);
        const hasSignals = (/Server API Response/i.test(text) || /\\bbot\\s*:/i.test(text) || /Bot[\\s\\n]+(?:Not detected|Good bot|Bad bot)/i.test(text) || /Bot Detection/i.test(text)) && !isRunning;
        return { hasSignals, isBlocked, isRunning };
      })()`);

      if (state.isBlocked) {
        const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
        return {
          status: "challenge_or_blocked",
          clean: false,
          verdict: "challenge_or_blocked",
          durationMs: Date.now() - startTime,
          screenshot,
        };
      }

      if (state.hasSignals) {
        done = true;
        break;
      }
      await Bun.sleep(500);
    }

    if (!done) {
      const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
      return {
        status: "timeout",
        clean: false,
        verdict: "timeout",
        durationMs: Date.now() - startTime,
        screenshot,
      };
    }

    await Bun.sleep(1500);

    const data = await session.evaluate<FingerprintDemoResult>(`(() => {
      const text = document.body?.innerText || '';
      const cards = [];
      document.querySelectorAll('pre, code, div, section').forEach(el => {
        const t = el.innerText?.trim();
        if (t && (t.includes('bot:') || t.includes('"bot"') || t.includes('Server API Response')) && t.length < 3000) {
          cards.push(t);
        }
      });

      let serverJson = null;
      for (const card of cards) {
        try {
          const match = card.match(/\\{[\\s\\S]*\\}/);
          if (match) {
            serverJson = JSON.parse(match[0]);
            break;
          }
        } catch {}
      }

      let bot = null;
      if (serverJson?.bot?.result) {
        bot = String(serverJson.bot.result);
      } else if (serverJson?.products?.botd?.data?.bot?.result) {
        bot = String(serverJson.products.botd.data.bot.result);
      } else {
        const m = text.match(/\\bbot\\s*:\\s*["']?([a-zA-Z0-9_-]+)["']?/i);
        if (m) bot = m[1];
      }

      if (!bot) {
        if (/Bot(?:\\s+Detection)?[\\s\\n:]+Not detected/i.test(text)) bot = "not_detected";
        else if (/Bot(?:\\s+Detection)?[\\s\\n:]+Good bot/i.test(text)) bot = "good";
        else if (/Bot(?:\\s+Detection)?[\\s\\n:]+Bad bot/i.test(text)) bot = "bad";
      }

      let developerTools = null;
      if (serverJson?.developerTools?.data?.result !== undefined) {
        developerTools = Boolean(serverJson.developerTools.data.result);
      } else {
        const m = text.match(/developer_tools\\s*:\\s*(true|false)/i);
        if (m) developerTools = m[1].toLowerCase() === "true";
        else if (/Developer Tools[\\s\\n:]+Yes/i.test(text)) developerTools = true;
        else if (/Developer Tools[\\s\\n:]+No/i.test(text)) developerTools = false;
      }

      let tampering = null;
      if (serverJson?.tampering?.data?.result !== undefined) {
        tampering = Boolean(serverJson.tampering.data.result);
      } else {
        const m = text.match(/tampering\\s*:\\s*(true|false)/i);
        if (m) tampering = m[1].toLowerCase() === "true";
        else if (/Tampering[\\s\\n:]+No/i.test(text)) tampering = false;
        else if (/Tampering[\\s\\n:]+Yes/i.test(text)) tampering = true;
      }

      let virtualMachine = null;
      const vmMatch = text.match(/virtual_machine\\s*:\\s*(true|false)/i);
      if (vmMatch) virtualMachine = vmMatch[1].toLowerCase() === "true";

      let vpn = null;
      const vpnMatch = text.match(/vpn\\s*:\\s*(true|false)/i);
      if (vpnMatch) vpn = vpnMatch[1].toLowerCase() === "true";

      let proxy = null;
      const proxyMatch = text.match(/proxy\\s*:\\s*(true|false)/i);
      if (proxyMatch) proxy = proxyMatch[1].toLowerCase() === "true";

      let suspectScore = null;
      const scoreMatch = text.match(/suspect_score\\s*:\\s*([0-9.]+)/i);
      if (scoreMatch) suspectScore = Number(scoreMatch[1]);

      let visitorId = null;
      const vMatch = text.match(/Your Visitor ID is[\\s\\n]+([A-Za-z0-9_-]+)|visitor_?id\\s*:\\s*["']?([A-Za-z0-9_-]+)["']?/i);
      if (vMatch) visitorId = vMatch[1] || vMatch[2];

      let idConfidence = null;
      const cMatch = text.match(/Confidence Score[\\s\\n]+([0-9.]+)|confidence\\s*:\\s*([0-9.]+)/i);
      if (cMatch) idConfidence = Number(cMatch[1] || cMatch[2]);

      const botVerdict = bot;

      return {
        accessible: !/Cloudflare|Challenge|Turnstile|Captcha/i.test(text),
        botVerdict,
        bot,
        developerTools,
        tampering,
        virtualMachine,
        vpn,
        proxy,
        suspectScore,
        visitorId,
        identificationConfidence: idConfidence,
        confidenceScore: idConfidence,
        serverResponseSnippet: cards[0] ? cards[0].slice(0, 500) : null,
        rawSignals: cards.slice(0, 5),
      };
    })()`);

    const screenshot = await session.captureScreenshot(screenshotPath);
    const hasGenuineVerdict = Boolean(data.bot || data.botVerdict);
    const isClean =
      hasGenuineVerdict &&
      data.accessible &&
      (data.bot === "not_detected" || data.botVerdict === "not_detected") &&
      data.tampering === false;
    data.clean = isClean;
    data.verdict = isClean
      ? "clean"
      : (!hasGenuineVerdict
        ? "unresolved"
        : (data.bot === "not_detected" ? "flagged_tampering_or_signal" : "bot_detected"));

    return {
      status: hasGenuineVerdict ? "completed" : "unresolved",
      clean: isClean,
      verdict: data.verdict,
      durationMs: Date.now() - startTime,
      results: data,
      screenshot,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const screenshot = await session.captureScreenshot(screenshotPath).catch(() => null);
    return {
      status: "error",
      clean: false,
      verdict: "error",
      error: msg,
      durationMs: Date.now() - startTime,
      screenshot,
    };
  }
}

// --- Main Audit Orchestrator ---
export async function runBrowserAudit(opts?: Partial<AuditOptions>) {
  const parsed = parseArgs();
  const options: AuditOptions = { ...parsed, ...opts };

  console.log(`=======================================================`);
  console.log(`Browser Session Hiding & Anti-Bot Diagnostic Audit`);
  console.log(`Mode: ${options.mode}`);
  console.log(`Display: ${options.display} | CDP Port: ${options.cdpPort} | Proxy Port: ${options.proxyPort}`);
  console.log(`Checkers: ${options.checkers.join(", ")}`);
  console.log(`Routes: ${options.routes.join(", ")}`);
  console.log(`=======================================================`);

  const runId = `${options.mode}-${Date.now()}`;
  const runScreenshotDir = join(options.screenshotDir, runId);
  mkdirSync(runScreenshotDir, { recursive: true });
  const sandbox = await setupSandbox(options);

  // Compute code snapshot hashes

  const hasherChrome = new Bun.CryptoHasher("sha256");
  hasherChrome.update(readFileSync("src/chrome.ts"));
  const chromeSourceHash = hasherChrome.digest("hex");

  const hasherProxy = new Bun.CryptoHasher("sha256");
  hasherProxy.update(readFileSync("src/cdp-proxy.ts"));
  const proxySourceHash = hasherProxy.digest("hex");

  const auditReport: AuditReport = {
    timestamp: new Date().toISOString(),
    mode: options.mode,
    frontendCoverage: "none (raw CDP only; does not exercise browser.open, WebMCP bridge, or worker tools)",
    options: {
      display: options.display,
      cdpPort: options.cdpPort,
      proxyPort: options.proxyPort,
      checkers: options.checkers,
      routes: options.routes,
    },
    system: {
      platform: process.platform,
      arch: process.arch,
      bunVersion: Bun.version,
    },
    launch: {
      chromeSourceHash,
      proxySourceHash,
      cmdline: null,
      browser: null,
    },
    routes: {},
  };

  try {
    // 1. Launch Chrome via repository ensureChrome
    console.log(`[audit] Launching real headed Chrome via ensureChrome(0)...`);
    // Exception: Dynamic import required after AUTO_APPLY_DATA is populated
    const { ensureChrome } = await import("../src/chrome");
    await ensureChrome(0);
    sandbox.markSocketCreated();
    // Query /json/version
    const versionRes = await fetch(`http://127.0.0.1:${options.cdpPort}/json/version`);
    if (!versionRes.ok) throw new Error(`Chrome /json/version unreachable on port ${options.cdpPort}`);
    const chromeVersion = (await versionRes.json()) as JsonVersionInfo;

    // Read root Chrome PID and cmdline from /proc
    const pids = await findAuditPids(options.display, sandbox.profileDir);
    let cmdlineArgs: string[] = [];
    for (const pid of pids) {
      try {
        const raw = readFileSync(`/proc/${pid}/cmdline`, "utf-8");
        const args = raw.split("\0").filter(Boolean);
        if (args[0]?.includes("chrome") && !args.some(a => a.startsWith("--type=")) && args.some(a => a.includes(`--remote-debugging-port=${options.cdpPort}`))) {
          cmdlineArgs = args;
          break;
        }
      } catch {
        // Process exited between listing and reading its cmdline
      }
    }
    auditReport.launch = {
      ...auditReport.launch,
      browser: chromeVersion.Browser,
      userAgent: chromeVersion["User-Agent"],
      v8Version: chromeVersion["V8-Version"],
      webSocketDebuggerUrl: chromeVersion.webSocketDebuggerUrl,
      cmdline: cmdlineArgs,
    };
    console.log(`[audit] Chrome active: ${chromeVersion.Browser}`);

    // 2. Prepare Routes:
    // Route "direct": connects directly to Chrome's CDP port (/devtools/page/<id>)
    // Route "proxied": creates a scoped tab via prepareJobBrowser and connects through the proxy port (/devtools/page/<id>)
    // Route "attached": connects to scoped CDP proxy via BROWSER target socket (/devtools/browser/...) using Target.attachToTarget

    const routesMap: Record<string, RouteAuditResult> = {};

    for (const routeName of options.routes) {
      console.log(`\n-------------------------------------------------------`);
      console.log(`Testing Route: ${routeName.toUpperCase()}`);
      console.log(`-------------------------------------------------------`);

      let session: CdpSession;
      let proxyInstance: (CdpProxy & { tabId: string; reused: boolean }) | null = null;

      if (routeName === "direct") {
        session = await createTargetAndSession(`http://127.0.0.1:${options.cdpPort}`);
      } else if (routeName === "proxied") {
        const { prepareJobBrowser } = await import("../src/chrome");
        proxyInstance = await prepareJobBrowser(0, null, new Set());
        console.log(`[audit] Started scoped CDP proxy on port ${proxyInstance.port} for target ${proxyInstance.tabId}`);
        const listRes = await fetch(`http://127.0.0.1:${proxyInstance.port}/json/list`);
        const list = (await listRes.json()) as CdpTabInfo[];
        const tab = list.find((t) => t.id === proxyInstance?.tabId) ?? list[0];
        if (!tab?.webSocketDebuggerUrl) {
          throw new Error(`Failed to obtain scoped proxy tab WebSocket debugger URL`);
        }
        session = await createCdpSession(tab.webSocketDebuggerUrl, tab.id);
      } else if (routeName === "attached") {
        const { prepareJobBrowser } = await import("../src/chrome");
        proxyInstance = await prepareJobBrowser(0, null, new Set());
        console.log(`[audit] Started scoped CDP proxy on port ${proxyInstance.port} (Browser-level attached target)`);
        const verRes = await fetch(`http://127.0.0.1:${proxyInstance.port}/json/version`);
        const ver = (await verRes.json()) as JsonVersionInfo;
        session = await createAttachedSession(ver.webSocketDebuggerUrl, proxyInstance.tabId);
      } else {
        console.warn(`Unknown route ${routeName}, skipping.`);
        continue;
      }

      let transport = "raw_cdp_direct";
      let description = "Direct raw CDP connection to Chrome remote debugging port; does NOT cover browser.open, WebMCP bridge, or worker tools";
      if (routeName === "proxied") {
        transport = "raw_cdp_proxied";
        description = "Scoped CdpProxy tab connection; does NOT cover browser.open, WebMCP bridge, or worker tools";
      } else if (routeName === "attached") {
        transport = "raw_cdp_attached";
        description = "Browser-level attached target via Target.attachToTarget; does NOT cover browser.open, WebMCP bridge, or worker tools";
      }

      const routeResults: RouteAuditResult = {
        route: routeName,
        transport,
        frontendCovered: false,
        description,
        wireCoherence: null,
        probes: null,
        checkers: {},
        clean: false,
        issues: [],
      };

      try {
        // Run deep diagnostic probes
        const probes = await runProbes(session, options.cdpPort);
        routeResults.probes = probes;
        routeResults.wireCoherence = probes.wireCoherence;

        const checkersResults: RouteCheckers = {};

        // Run requested public checkers
        if (options.checkers.includes("botd")) {
          const sPath = join(runScreenshotDir, `${routeName}-botd.png`);
          checkersResults.botd = await checkBotD(session, sPath, options.timeoutMs);
        }

        if (options.checkers.includes("sannysoft")) {
          const sPath = join(runScreenshotDir, `${routeName}-sannysoft.png`);
          checkersResults.sannysoft = await checkSannysoft(session, sPath, options.timeoutMs);
        }

        if (options.checkers.includes("creepjs")) {
          const sPath = join(runScreenshotDir, `${routeName}-creepjs.png`);
          checkersResults.creepjs = await checkCreepJS(session, sPath, options.timeoutMs);
        }

        if (options.checkers.includes("browserscan")) {
          const sPath = join(runScreenshotDir, `${routeName}-browserscan.png`);
          checkersResults.browserscan = await checkBrowserScan(session, sPath, options.timeoutMs);
        }

        if (options.checkers.includes("fingerprint_demo")) {
          const sPath = join(runScreenshotDir, `${routeName}-fingerprint-demo.png`);
          checkersResults.fingerprint_demo = await checkFingerprintDemo(session, sPath, options.timeoutMs);
        }

        routeResults.checkers = checkersResults;

        const issues: string[] = [];
        if (!probes.wireCoherence.coherent) {
          issues.push(...probes.wireCoherence.mismatches);
        }

        const nk = probes.navigatorKeys;
        if (nk.hasModelContext) {
          issues.push("navigator.modelContext present in DOM");
        }
        if (nk.hasWebMcpBridge) {
          issues.push("__ompWebMcpBridge_v1 present in DOM window");
        }
        if (!nk.isNativeEmpty) {
          issues.push(`navigator own properties not empty: [${nk.ownPropertyNames.join(", ")}]`);
        }

        if (checkersResults.botd?.clean === false) {
          issues.push(`BotD: ${checkersResults.botd.verdict || "flagged"}`);
        }
        if (checkersResults.sannysoft?.clean === false) {
          issues.push(`Sannysoft: ${checkersResults.sannysoft.verdict || "failed"}`);
        }
        if (checkersResults.creepjs?.clean === false) {
          issues.push(`CreepJS: ${checkersResults.creepjs.verdict || checkersResults.creepjs.status}`);
        }
        if (checkersResults.browserscan?.clean === false) {
          issues.push(`BrowserScan: ${checkersResults.browserscan.verdict || checkersResults.browserscan.status}`);
        }
        if (checkersResults.fingerprint_demo?.clean === false) {
          issues.push(`Fingerprint Demo: ${checkersResults.fingerprint_demo.verdict || checkersResults.fingerprint_demo.status}`);
        }

        routeResults.clean = issues.length === 0;
        routeResults.issues = issues;
        routesMap[routeName] = routeResults;
      } finally {
        session.close();
        if (proxyInstance) proxyInstance.close();
      }
    }

    auditReport.routes = routesMap;

    // Write final structured report
    writeFileSync(options.outPath, JSON.stringify(auditReport, null, 2), "utf-8");
    console.log(`\n=======================================================`);
    console.log(`Audit Completed Successfully.`);
    console.log(`Report JSON: ${options.outPath}`);
    console.log(`Screenshots: ${runScreenshotDir}`);
    console.log(`=======================================================`);

    printSummary(auditReport);

    return auditReport;
  } finally {
    await sandbox.cleanup();
  }
}

function printSummary(report: AuditReport) {
  console.log(`\n--- SUMMARY VERDICTS ---`);
  console.log(`Frontend Coverage: ${report.frontendCoverage}`);
  for (const [routeName, routeData] of Object.entries(report.routes)) {
    console.log(`\nRoute: ${routeName.toUpperCase()} [${routeData.transport}] (frontendCovered: ${routeData.frontendCovered})`);
    console.log(`  Description: ${routeData.description}`);
    console.log(`  Overall Route Clean: ${routeData.clean}${routeData.issues.length > 0 ? ` (Issues: ${routeData.issues.join("; ")})` : ""}`);

    if (routeData.wireCoherence) {
      const wc = routeData.wireCoherence;
      console.log(`  [Wire/DOM Coherence] coherent=${wc.coherent}, uaMatch=${wc.userAgentMatch}, platformMatch=${wc.platformMatch}, mobileMatch=${wc.mobileMatch}, brandsMatch=${wc.brandsMatch}, langMatch=${wc.languagesMatch}`);
      if (!wc.coherent && wc.mismatches.length > 0) {
        console.log(`  [Wire/DOM Mismatches] ${wc.mismatches.join("; ")}`);
      }
    }

    const p = routeData.probes;
    if (p) {
      const nk = p.navigatorKeys;
      console.log(`  [Probe] navigator.ownKeys: [${nk.ownPropertyNames.join(", ")}] (nativeEmpty: ${nk.isNativeEmpty}, modelContext: ${nk.hasModelContext}, webMcpBridge: ${nk.hasWebMcpBridge})`);
      const wd = p.webdriver;
      const gl = p.webgl;
      const mdInit = p.mediaDevicesInitial;
      const mdGrant = p.mediaDevicesGranted;
      const cc = p.contextConsistency;
      const cons = (cc["consistency"] ?? {}) as Record<string, unknown>;
      console.log(`  [Probe] navigator.webdriver: ${String(wd["value"])} (hasOwn: ${String(wd["hasOwnOnInstance"])}, desc: ${String(wd["hasDescriptorOnProto"])})`);
      console.log(`  [Probe] WebGL Vendor/Renderer: ${String(gl["vendor"])} | ${String(gl["renderer"])} (software: ${String(gl["isSoftwareRenderer"])})`);
      console.log(`  [Probe] Media Devices Initial: fakeLabels = ${String(mdInit["hasFakeLabels"])} (${String(mdInit["count"])} devices)`);
      if (mdGrant) {
        console.log(`  [Probe] Media Devices Granted: fakeLabels = ${String(mdGrant["hasFakeLabels"])} (${String(mdGrant["count"])} devices, gUM ok: ${String(mdGrant["gumOk"])})`);
      }
      console.log(`  [Probe] Context Consistency: uaMatch=${String(cons["userAgentMatch"])}, langMatch=${String(cons["languageMatch"])}, platformMatch=${String(cons["platformMatch"])} (overall: ${String(cons["overallConsistent"])})`);
    }

    const c = routeData.checkers;
    if (c.botd) {
      console.log(`  [Checker] BotD: status=${c.botd.status}, clean=${c.botd.clean}, verdict=${c.botd.verdict}, bot=${c.botd.bot}, botKind=${c.botd.botKind}`);
    }
    if (c.sannysoft?.results) {
      const s = c.sannysoft.results;
      console.log(`  [Checker] Sannysoft: status=${c.sannysoft.status}, clean=${c.sannysoft.clean}, verdict=${c.sannysoft.verdict}, webdriver=${s.webdriverResult?.text}, passed=${s.passedCount}, failed=${s.failedCount}, warn=${s.warnCount}`);
    }
    if (c.creepjs?.results) {
      const cr = c.creepjs.results;
      console.log(`  [Checker] CreepJS: status=${c.creepjs.status}, clean=${c.creepjs.clean}, verdict=${c.creepjs.verdict}, trustScore=${cr.trustScore}, totalLies=${cr.totalLies}, likeHeadlessRating=${cr.likeHeadlessRating}%`);
      if (cr.likeHeadlessReasons.length > 0) {
        console.log(`    likeHeadlessReasons: [${cr.likeHeadlessReasons.join(", ")}]`);
      }
      if (cr.note) {
        console.log(`    note: ${cr.note}`);
      }
    }
    if (c.browserscan?.results) {
      const bs = c.browserscan.results;
      console.log(`  [Checker] BrowserScan: status=${c.browserscan.status}, clean=${c.browserscan.clean}, verdict=${c.browserscan.verdict}, normal=${bs.hasNormalResult}, webdriver=${bs.webdriverStatus}, cdp=${bs.cdpStatus}, navigator=${bs.navigatorStatus}`);
    }
    if (c.fingerprint_demo?.results) {
      const fd = c.fingerprint_demo.results;
      console.log(`  [Checker] Fingerprint Demo: status=${c.fingerprint_demo.status}, clean=${c.fingerprint_demo.clean}, verdict=${c.fingerprint_demo.verdict}, accessible=${fd.accessible}, bot=${fd.bot || fd.botVerdict}, devTools=${fd.developerTools}, tampering=${fd.tampering}`);
    }
  }
}

if (import.meta.main) {
  runBrowserAudit().catch((err: unknown) => {
    console.error("[FATAL]", err);
    process.exit(1);
  });
}
