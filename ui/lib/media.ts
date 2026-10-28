import { useSyncExternalStore } from "react";

export const WIDE = "(min-width: 1024px)";
export const TABLET = "(min-width: 768px)";

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
