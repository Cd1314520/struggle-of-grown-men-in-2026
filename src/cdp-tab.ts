// One page of an application's browser, driven by the app itself over CDP: what the prefill script
// needs of a tab (src/prefill.ts) when the fill worker's harness has no JavaScript session of its own
// to run it in (Claude Code). It connects through the application's scoped proxy, so its clicks and
// keystrokes are paced like the agent's.
import type { Tab } from "./prefill";

interface Reply {
  id?: number;
  result?: Record<string, unknown>;
  error?: { message?: string };
}
interface Evaluated {
  result?: { value?: unknown; objectId?: string };
  exceptionDetails?: { text?: string; exception?: { description?: string } };
}

// Key name -> [code, Windows virtual key code, text it types].
const KEYS: Record<string, [string, number, string?]> = {
  Enter: ["Enter", 13, "\r"],
  Tab: ["Tab", 9],
  Escape: ["Escape", 27],
  Backspace: ["Backspace", 8],
  Delete: ["Delete", 46],
  ArrowUp: ["ArrowUp", 38],
  ArrowDown: ["ArrowDown", 40],
  ArrowLeft: ["ArrowLeft", 37],
  ArrowRight: ["ArrowRight", 39],
  Home: ["Home", 36],
  End: ["End", 35],
  Space: ["Space", 32, " "],
};
const MODIFIERS: Record<string, [code: string, vk: number, bit: number]> = {
  Alt: ["AltLeft", 18, 1],
  Control: ["ControlLeft", 17, 2],
  Meta: ["MetaLeft", 91, 4],
  Shift: ["ShiftLeft", 16, 8],
};

function keyOf(key: string): { key: string; code: string; windowsVirtualKeyCode: number; text?: string } {
  const named = KEYS[key];
  if (named) return { key: key === "Space" ? " " : key, code: named[0], windowsVirtualKeyCode: named[1], ...(named[2] ? { text: named[2] } : {}) };
  if (key.length !== 1) throw new Error(`unknown key ${key}`);
  const upper = key.toUpperCase();
  const letter = /[A-Z]/.test(upper);
  const digit = /[0-9]/.test(key);
  return {
    key,
    code: letter ? `Key${upper}` : digit ? `Digit${key}` : "",
    windowsVirtualKeyCode: letter || digit ? upper.charCodeAt(0) : 0,
    text: key,
  };
}

export async function connectTab(proxyPort: number, tabId: string): Promise<Tab & { close: () => void }> {
  const ws = new WebSocket(`ws://127.0.0.1:${proxyPort}/devtools/page/${encodeURIComponent(tabId)}`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => {
      resolve();
    };
    ws.onerror = () => {
      reject(new Error("could not connect to the application tab"));
    };
  });
  let next = 0;
  const waiting = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  ws.onmessage = ev => {
    const msg = JSON.parse(String(ev.data)) as Reply;
    const w = msg.id === undefined ? undefined : waiting.get(msg.id);
    if (!w || msg.id === undefined) return;
    waiting.delete(msg.id);
    if (msg.error) w.reject(new Error(msg.error.message ?? "CDP error"));
    else w.resolve(msg.result ?? {});
  };
  ws.onclose = () => {
    for (const w of waiting.values()) w.reject(new Error("the application tab's connection closed"));
    waiting.clear();
  };
  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = ++next;
      waiting.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const run = async (expression: string, byValue = true) => {
    const r = (await send("Runtime.evaluate", { expression, returnByValue: byValue, awaitPromise: true, userGesture: true })) as Evaluated;
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluation failed");
    return r.result;
  };
  const q = (selector: string) => `document.querySelector(${JSON.stringify(selector)})`;
  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
  let modifiers = 0;
  const keyEvent = async (type: "keyDown" | "keyUp", k: ReturnType<typeof keyOf>) => {
    const typed = type === "keyDown" && k.text && !(modifiers & 6) ? { text: k.text, unmodifiedText: k.text } : {};
    await send("Input.dispatchKeyEvent", { type, modifiers, key: k.key, code: k.code, windowsVirtualKeyCode: k.windowsVirtualKeyCode, ...typed });
  };

  const tab: Tab = {
    evaluate: async code => (await run(code))?.value,
    async click(selector) {
      const at = (
        await run(`(() => {
        const el = ${q(selector)};
        if (!el) throw new Error("no element matches " + ${JSON.stringify(selector)});
        el.scrollIntoView({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        return [r.left + r.width / 2, r.top + r.height / 2];
      })()`)
      )?.value as [number, number];
      await sleep(150);
      const [x, y] = at;
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    },
    async type(selector, text) {
      await run(`(() => { const el = ${q(selector)}; if (el && document.activeElement !== el) el.focus(); })()`);
      for (const ch of text) {
        const k = ch === "\n" ? keyOf("Enter") : keyOf(ch);
        await keyEvent("keyDown", k);
        await keyEvent("keyUp", k);
      }
    },
    async select(selector, ...values) {
      await run(`(() => {
        const el = ${q(selector)};
        if (!(el instanceof HTMLSelectElement)) throw new Error("not a select: " + ${JSON.stringify(selector)});
        const wanted = ${JSON.stringify(values)};
        for (const o of el.options) o.selected = wanted.includes(o.value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      })()`);
    },
    async uploadFile(selector, ...paths) {
      const objectId = (await run(q(selector), false))?.objectId;
      if (!objectId) throw new Error(`no element matches ${selector}`);
      await send("DOM.setFileInputFiles", { objectId, files: paths });
      await send("Runtime.releaseObject", { objectId });
    },
    async press(combo) {
      const parts = combo.split("+");
      const main = keyOf(parts.pop() ?? "");
      const held = parts.map(name => {
        const m = MODIFIERS[name];
        if (!m) throw new Error(`unknown modifier ${name}`);
        return { name, m };
      });
      for (const { name, m } of held) {
        modifiers |= m[2];
        await keyEvent("keyDown", { key: name, code: m[0], windowsVirtualKeyCode: m[1] });
      }
      await keyEvent("keyDown", main);
      await keyEvent("keyUp", main);
      for (const { name, m } of held.reverse()) {
        modifiers &= ~m[2];
        await keyEvent("keyUp", { key: name, code: m[0], windowsVirtualKeyCode: m[1] });
      }
    },
    async wheel(deltaX, deltaY) {
      const [x, y] = (await run("[innerWidth / 2, innerHeight / 2]"))?.value as [number, number];
      await send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX, deltaY });
    },
  };
  return {
    ...tab,
    close: () => {
      ws.close();
    },
  };
}
