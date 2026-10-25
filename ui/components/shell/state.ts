// The shell's own open/closed state: the command palette, the Add a posting dialog, the shortcuts sheet.
import { useSyncExternalStore } from "react";

interface ShellState {
  paletteOpen: boolean;
  addOpen: boolean;
  shortcutsOpen: boolean;
  menuOpen: boolean; // the navigation sheet on a phone
}
let state: ShellState = { paletteOpen: false, addOpen: false, shortcutsOpen: false, menuOpen: false };
const listeners = new Set<() => void>();
const set = (patch: Partial<ShellState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};
const actions = {
  setPaletteOpen: (paletteOpen: boolean) => {
    set({ paletteOpen });
  },
  setAddOpen: (addOpen: boolean) => {
    set({ addOpen });
  },
  setShortcutsOpen: (shortcutsOpen: boolean) => {
    set({ shortcutsOpen });
  },
  setMenuOpen: (menuOpen: boolean) => {
    set({ menuOpen });
  },
};
export const shellActions = actions;
export function useShell() {
  const s = useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
  return { ...s, ...actions };
}
