// Long-lived, real (headed) Chromes, each on its own virtual display with a persistent profile.
// omp attaches to one over CDP, so logins, cookies and half-filled tabs outlive any worker.
// Every function takes the browser's number (see browserSlot in config.ts); 0 is the original.
// On Windows there is no virtual display: each Chrome is an ordinary window on the desktop, taken
// over by hand where it is, so Xvfb and the noVNC view are left out.
import { existsSync, mkdirSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { browserSlot, config } from "./config";
import { logEvent } from "./db";
import { startCdpProxy, type CdpProxy } from "./cdp-proxy";

// The /json/list fields read here.
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

// A leftover socket file does not mean an X server is listening; try to connect.
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

const WINDOWS = process.platform === "win32";

const detached = (cmd: string[], env: Record<string, string | undefined>) => {
  Bun.spawn(cmd, { stdin: "ignore", stdout: "ignore", stderr: "ignore", env, detached: true }).unref();
};

// Where Chrome's installers put it on Windows, machine-wide or for the user alone.
export function chromeBinary(): string | null {
  if (!WINDOWS) return Bun.which("google-chrome");
  const roots = [process.env["PROGRAMFILES"], process.env["PROGRAMFILES(X86)"], process.env["LOCALAPPDATA"]];
  for (const root of roots) {
    const exe = root && join(root, "Google", "Chrome", "Application", "chrome.exe");
    if (exe && existsSync(exe)) return exe;
  }
  return Bun.which("chrome");
}

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

// noVNC view of the virtual display, for taking over a tab by hand. Localhost only.
async function ensureVnc(slot: number) {
  const { display, vncPort } = browserSlot(slot);
  if (WINDOWS || !vncPort || !(await displayAlive(display))) return;
  const rfb = vncPort - 180; // 6080 -> 5900
  if (!(await portOpen(rfb)))
    detached(["x11vnc", "-display", display, "-localhost", "-rfbport", String(rfb), "-forever", "-shared", "-nopw", "-quiet"], process.env);
  if (!(await portOpen(vncPort))) detached(["websockify", "--web", "/usr/share/novnc", `127.0.0.1:${vncPort}`, `127.0.0.1:${rfb}`], process.env);
}

export async function ensureChrome(slot = 0) {
  if (await cdpAlive(slot)) {
    // A worker is about to take this browser: off the desktop again, if the owner left it on screen.
    await showWindows(slot, false);
    return ensureVnc(slot);
  }
  const { window } = config.chrome;
  const { display, cdpPort, profile } = browserSlot(slot);
  if (!WINDOWS && !(await displayAlive(display))) {
    detached(["Xvfb", display, "-screen", "0", `${window[0]}x${window[1]}x24`, "-nolisten", "tcp"], process.env);
    for (let i = 0; i < 20 && !(await displayAlive(display)); i++) await Bun.sleep(150);
    if (!(await displayAlive(display))) throw new Error(`Xvfb did not start on display ${display}`);
  }
  const chrome = chromeBinary();
  if (!chrome) throw new Error("Chrome is not installed");
  mkdirSync(profile, { recursive: true });
  detached(
    [
      chrome,
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${cdpPort}`,
      "--remote-debugging-address=127.0.0.1",
      `--window-size=${window[0]},${window[1]}`,
      offscreen() ? `--window-position=${OFFSCREEN},${OFFSCREEN}` : "--window-position=0,0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--password-store=basic",
      "--lang=en-US",
      // Vulkan reaches the machine's actual GPU through its render node (/dev/dri/renderD128),
      // providing genuine hardware WebGL and WebGL2 acceleration under Xvfb without spoofing.
      // Windows Chrome already reaches the GPU through its default ANGLE backend (Direct3D). There the
      // browsers are real windows, stacked at 0,0 and under the owner's own: Chrome stops painting a
      // covered one (document hidden, no animation frames), and every click then waits to time out.
      ...(WINDOWS
        ? [
            "--disable-features=CalculateNativeWinOcclusion",
            "--disable-backgrounding-occluded-windows",
            "--disable-renderer-backgrounding",
            "--disable-background-timer-throttling",
          ]
        : ["--use-gl=angle", "--use-angle=vulkan", "--enable-features=Vulkan", "--ignore-gpu-blocklist"]),
      "about:blank",
    ],
    { ...process.env, DISPLAY: display },
  );
  for (let i = 0; i < 40; i++) {
    if (await cdpAlive(slot)) {
      logEvent("system", WINDOWS ? `Chrome started, CDP port ${cdpPort}` : `Chrome started on display ${display}, CDP port ${cdpPort}`);
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

// HTTP /json/new creates a target; activating an existing tab does not constrain
// browser.open's adoption. Expose only this job's target through a private proxy.
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

// Retain tabs referenced by durable draft checkpoints, even when their slot is reused. Tabs that
// are `givenUp` are closed outright; of the rest that nothing protects, the `keep` most recent stay.
export async function pruneTabs(slot: number, keep: number, protectedIds: ReadonlySet<string> = new Set(), givenUp: ReadonlySet<string> = new Set()) {
  const open = await tabs(slot);
  const stray = open.filter(t => !protectedIds.has(t.id) && !givenUp.has(t.id)).slice(keep);
  for (const tab of [...open.filter(t => givenUp.has(t.id)), ...stray])
    await fetch(`${cdp(slot)}/json/close/${tab.id}`).catch(() => {
      /* tab already closed or browser gone */
    });
}

// PNG of a tab (default: the most recently used real page), for the live view in the UI.
// With chrome.offscreen on Windows, each browser's windows sit off the desktop (-32000,-32000) while
// workers use them, and come back to the top left only while the owner inspects one by hand. Chrome
// keeps painting a window there (the page stays visible and animation frames run), since occlusion
// tracking is off; a minimized window would stop painting instead.
const OFFSCREEN = -32000;
export const offscreen = () => WINDOWS && config.chrome.offscreen === true;

// Every top-level window of browser `slot` moves on screen or off it. Best effort: a browser that is
// not running, or a window that will not move, is left as it is.
export async function showWindows(slot: number, visible: boolean): Promise<void> {
  if (!offscreen() || !(await cdpAlive(slot))) return;
  const at = visible ? 0 : OFFSCREEN;
  try {
    const version = (await (await fetch(`${cdp(slot)}/json/version`, { signal: AbortSignal.timeout(1500) })).json()) as { webSocketDebuggerUrl?: string };
    const pages = await tabs(slot);
    if (!version.webSocketDebuggerUrl || !pages.length) return;
    const ws = new WebSocket(version.webSocketDebuggerUrl);
    const waiting = new Map<number, (result: Record<string, unknown> | null) => void>();
    let next = 0;
    ws.onmessage = ev => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: Record<string, unknown> };
      if (msg.id !== undefined) waiting.get(msg.id)?.(msg.result ?? null);
    };
    const send = (method: string, params: Record<string, unknown>) =>
      new Promise<Record<string, unknown> | null>(resolve => {
        const id = ++next;
        const timer = setTimeout(() => {
          resolve(null);
        }, 3000);
        waiting.set(id, result => {
          clearTimeout(timer);
          resolve(result);
        });
        ws.send(JSON.stringify({ id, method, params }));
      });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => {
        resolve();
      };
      ws.onerror = () => {
        reject(new Error("CDP connection failed"));
      };
    });
    const windows = new Set<number>();
    for (const page of pages) {
      const found = await send("Browser.getWindowForTarget", { targetId: page.id });
      if (typeof found?.["windowId"] === "number") windows.add(found["windowId"]);
    }
    for (const windowId of windows) {
      await send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      await send("Browser.setWindowBounds", { windowId, bounds: { left: at, top: at } });
    }
    ws.close();
  } catch {
    // left where it is
  }
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
