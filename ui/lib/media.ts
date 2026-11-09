import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";

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

export function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}
