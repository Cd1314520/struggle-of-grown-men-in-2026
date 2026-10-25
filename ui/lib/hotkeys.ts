// Keyboard shortcuts. A key is ignored while the user types in a field, and while a dialog is open
// unless the binding says it belongs there.
import { useEffect, useLayoutEffect, useRef } from "react";

// A Select's trigger is a button with role=combobox: it keeps focus after a pick, and J/K must still work.
export const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || el.matches("input, textarea, select, [role=combobox]:not(button), [contenteditable]"));
const dialogOpen = () => !!document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open]");

export interface Binding {
  key: string; // KeyboardEvent.key, lowercased for letters; "mod+k" for Ctrl/⌘ combos
  run: (ev: KeyboardEvent) => void;
  inFields?: boolean; // also fires while typing
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
        if (ev.repeat && !/^(j|k|ArrowUp|ArrowDown)$/.test(b.key)) continue; // a held key must not decide the next job too
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
// How a ⌘/Ctrl combination is written in a key hint, the same everywhere: "⌘↵", "Ctrl ↵", "Ctrl S".
export const combo = (key: string) => (isMac ? `⌘${key}` : `Ctrl ${key}`);
