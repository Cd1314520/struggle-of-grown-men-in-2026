// What scrolls a page: from lg the page's panel (#main, inset beside the sidebar), below it the window.
import { WIDE } from "./media";

export function pageScroller(): HTMLElement {
  const main = document.getElementById("main");
  return main && matchMedia(WIDE).matches ? main : ((document.scrollingElement as HTMLElement | null) ?? document.documentElement);
}

// Back to the top of the page, wherever it scrolls.
export const scrollPageTop = () => {
  pageScroller().scrollTo({ top: 0 });
};

// Scroll events from the page's scroller: the window's below lg, the panel's from lg.
export function onPageScroll(run: () => void) {
  const main = document.getElementById("main");
  addEventListener("scroll", run, { passive: true });
  main?.addEventListener("scroll", run, { passive: true });
  return () => {
    removeEventListener("scroll", run);
    main?.removeEventListener("scroll", run);
  };
}
