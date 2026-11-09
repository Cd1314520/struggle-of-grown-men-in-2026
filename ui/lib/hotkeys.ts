import { useEffect, useLayoutEffect, useRef } from "react";

export const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select, [role=combobox]:not(button), [contenteditable]"));
const dialogOpen = () => !!document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]");

export interface Binding {
  key: string;
  run: (ev: KeyboardEvent) => void;
  inFields?: boolean;
  inDialogs?: boolean;
}

export function useHotkeys(bindings: readonly (Binding | false | null | undefined)[], enabled = true) {
  const ref = useRef(bindings);
  useLayoutEffect(() => {
    ref.current = bindings;
  });
  useEffect(() => {
    if (!enabled) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented || ev.isComposing) return;
      const mod = ev.metaKey || ev.ctrlKey;
      const key = `${mod ? "mod+" : ""}${ev.altKey ? "alt+" : ""}${ev.key.length === 1 ? ev.key.toLowerCase() : ev.key}`;
      for (const b of ref.current) {
        if (!b || b.key !== key) continue;
        if (!b.inFields && typing(ev.target)) continue;
        if (!b.inDialogs && dialogOpen()) continue;
        if (ev.repeat && !/^(j|k|ArrowUp|ArrowDown)$/.test(b.key)) continue;
        ev.preventDefault();
        b.run(ev);
        return;
      }
    };
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
    };
  }, [enabled]);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";
export const combo = (key: string) => (isMac ? `⌘${key}` : `Ctrl ${key}`);
