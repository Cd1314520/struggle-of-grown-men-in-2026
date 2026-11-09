import { WIDE } from "./media";

export function pageScroller(): HTMLElement {
  const main = document.getElementById("main");
  return main && matchMedia(WIDE).matches ? main : ((document.scrollingElement as HTMLElement | null) ?? document.documentElement);
}

export const scrollPageTop = () => {
  pageScroller().scrollTo({ top: 0 });
};

export function onPageScroll(run: () => void) {
  const main = document.getElementById("main");
  addEventListener("scroll", run, { passive: true });
  main?.addEventListener("scroll", run, { passive: true });
  return () => {
    removeEventListener("scroll", run);
    main?.removeEventListener("scroll", run);
  };
}
