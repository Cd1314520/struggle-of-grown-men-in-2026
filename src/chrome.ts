import { mkdirSync } from "node:fs";
import { connect } from "node:net";
import { browserSlot, config } from "./config";
import { logEvent } from "./db";
import { startCdpProxy, type CdpProxy } from "./cdp-proxy";

interface CdpTab {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}
interface ScreenshotReply {
  id?: number;
  result?: { data?: string };
}

const cdp = (slot: number) => `http://127.0.0.1:${browserSlot(slot).cdpPort}`;

async function cdpAlive(slot: number) {
  try {
    return (await fetch(`${cdp(slot)}/json/version`, { signal: AbortSignal.timeout(1500) })).ok;
  } catch {
    return false;
  }
}

const displayAlive = (display: string) =>
  new Promise<boolean>(resolve => {
    const sock = connect(`/tmp/.X11-unix/X${display.replace(":", "")}`);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      resolve(false);
    });
  });

const detached = (cmd: string[], env: Record<string, string | undefined>) => {
  Bun.spawn(["setsid", ...cmd], { stdin: "ignore", stdout: "ignore", stderr: "ignore", env }).unref();
};

const portOpen = (port: number) =>
  new Promise<boolean>(resolve => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("error", () => {
      resolve(false);
    });
  });

async function ensureVnc(slot: number) {
  const { display, vncPort } = browserSlot(slot);
  if (!vncPort || !(await displayAlive(display))) return;
  const rfb = vncPort - 180;
  if (!(await portOpen(rfb)))
    detached(["x11vnc", "-display", display, "-localhost", "-rfbport", String(rfb), "-forever", "-shared", "-nopw", "-quiet"], process.env);
  if (!(await portOpen(vncPort))) detached(["websockify", "--web", "/usr/share/novnc", `127.0.0.1:${vncPort}`, `127.0.0.1:${rfb}`], process.env);
}

export async function ensureChrome(slot = 0) {
  if (await cdpAlive(slot)) return ensureVnc(slot);
  const { window } = config.chrome;
  const { display, cdpPort, profile } = browserSlot(slot);
  if (!(await displayAlive(display))) {
    detached(["Xvfb", display, "-screen", "0", `${window[0]}x${window[1]}x24`, "-nolisten", "tcp"], process.env);
    for (let i = 0; i < 20 && !(await displayAlive(display)); i++) await Bun.sleep(150);
    if (!(await displayAlive(display))) throw new Error(`Xvfb did not start on display ${display}`);
  }
  mkdirSync(profile, { recursive: true });
  detached(
    [
      "google-chrome",
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${cdpPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--window-size=${window[0]},${window[1]}`,
      "--window-position=0,0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--password-store=basic",
      "--lang=en-US",
      "--use-gl=angle",
      "--use-angle=vulkan",
      "--enable-features=Vulkan",
      "--ignore-gpu-blocklist",
      "about:blank",
    ],
    { ...process.env, DISPLAY: display },
  );
  for (let i = 0; i < 40; i++) {
    if (await cdpAlive(slot)) {
      logEvent("system", `Chrome started on display ${display}, CDP port ${cdpPort}`);
      return ensureVnc(slot);
    }
    await Bun.sleep(250);
  }
  throw new Error(`Chrome did not come up on CDP port ${cdpPort}`);
}

export async function tabs(slot = 0): Promise<{ id: string; title: string; url: string; ws: string }[]> {
  if (!(await cdpAlive(slot))) return [];
  const list = (await (await fetch(`${cdp(slot)}/json/list`)).json()) as CdpTab[];
  return list.filter(t => t.type === "page").map(t => ({ id: t.id, title: t.title, url: t.url, ws: t.webSocketDebuggerUrl }));
}
export async function activateApplicationTab(slot: number, tabId: string): Promise<void> {
  if (!tabId.trim()) throw new Error("Cannot activate a blank application tab ID");
  const listed = await fetch(`${cdp(slot)}/json/list`, { signal: AbortSignal.timeout(1500) });
  if (!listed.ok) throw new Error(`Could not inspect application tabs (${listed.status})`);
  const existing = (await listed.json()) as CdpTab[];
  if (!existing.some(tab => tab.id === tabId && tab.type === "page")) throw new Error("Saved application tab is missing; request application recovery instead");
  const res = await fetch(`${cdp(slot)}/json/activate/${encodeURIComponent(tabId)}`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) throw new Error(`Could not activate application tab (${res.status})`);
}

export interface JobBrowser extends CdpProxy {
  tabId: string;
  reused: boolean;
}

export async function prepareJobBrowser(slot: number, checkpointTabId: string | null, excludedTargets: ReadonlySet<string>): Promise<JobBrowser> {
  if (checkpointTabId && excludedTargets.has(checkpointTabId))
    throw new Error("Checkpoint tab is also assigned to another application; inspect the conflicting drafts before resuming");
  const existing = await tabs(slot);
  const saved = checkpointTabId ? existing.find(tab => tab.id === checkpointTabId) : undefined;
  let tabId = saved?.id;
  if (!tabId) {
    const res = await fetch(`${cdp(slot)}/json/new?about:blank`, { method: "PUT" });
    if (!res.ok) throw new Error(`Could not create isolated application tab (${res.status})`);
    const created: unknown = await res.json();
    if (
      !created ||
      typeof created !== "object" ||
      !("id" in created) ||
      typeof created.id !== "string" ||
      !created.id ||
      excludedTargets.has(created.id) ||
      existing.some(tab => tab.id === created.id)
    )
      throw new Error("CDP did not create a distinct application target");
    tabId = created.id;
  }
  return { ...startCdpProxy(slot, { targetId: tabId, excludedTargets }), tabId, reused: Boolean(saved) };
}

export async function pruneTabs(slot: number, keep: number, protectedIds: ReadonlySet<string> = new Set(), givenUp: ReadonlySet<string> = new Set()) {
  const open = await tabs(slot);
  const stray = open.filter(t => !protectedIds.has(t.id) && !givenUp.has(t.id)).slice(keep);
  for (const tab of [...open.filter(t => givenUp.has(t.id)), ...stray]) await fetch(`${cdp(slot)}/json/close/${tab.id}`).catch(() => {});
}

export async function screenshot(slot = 0, tabId?: string): Promise<Uint8Array | null> {
  const all = await tabs(slot);
  const tab = tabId !== undefined ? all.find(t => t.id === tabId) : (all.find(t => !t.url.startsWith("about:") && !t.url.startsWith("chrome")) ?? all[0]);
  if (!tab?.ws) return null;
  return new Promise(resolve => {
    const ws = new WebSocket(tab.ws);
    const timer = setTimeout(() => {
      ws.close();
      resolve(null);
    }, 8000);
    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
    };
    ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data)) as ScreenshotReply;
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      resolve(msg.result?.data ? Buffer.from(msg.result.data, "base64") : null);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      resolve(null);
    };
  });
}
