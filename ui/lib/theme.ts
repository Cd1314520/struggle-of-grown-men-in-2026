import { useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const media = matchMedia("(prefers-color-scheme: dark)");
const read = (): ThemeChoice => {
  try {
    const v = localStorage.getItem("theme");
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
};
let choice = read();
const listeners = new Set<() => void>();
const apply = () => {
  document.documentElement.classList.toggle("dark", choice === "dark" || (choice === "system" && media.matches));
  for (const l of listeners) l();
};
media.addEventListener("change", apply);
apply();

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    localStorage.setItem("theme", next);
  } catch {}
  apply();
}
export const useTheme = () =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => choice,
  );
