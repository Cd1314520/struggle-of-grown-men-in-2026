// Media queries as React state, for what CSS alone cannot switch: which component renders, not how it looks.
import { useSyncExternalStore } from "react";

// Tailwind's breakpoints, for the layouts that change at them.
export const WIDE = "(min-width: 1024px)"; // lg: a list and its open record side by side
export const TABLET = "(min-width: 768px)"; // md: a list's rows get columns

export function useMedia(query: string) {
  return useSyncExternalStore(
    cb => {
      const m = matchMedia(query);
      m.addEventListener("change", cb);
      return () => {
        m.removeEventListener("change", cb);
      };
    },
    () => matchMedia(query).matches,
  );
}
