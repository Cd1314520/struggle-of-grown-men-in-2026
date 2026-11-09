import { useEffect, useRef, type MouseEvent } from "react";
import { navigate } from "../../lib/router";

export function useRecordHistory({ isOpen, closable, list, rows = "a[data-row]" }: { isOpen: boolean; closable: boolean; list: () => string; rows?: string }) {
  const pushed = useRef(false);
  useEffect(() => {
    if (!isOpen) pushed.current = false;
  }, [isOpen]);

  const onListClick = (ev: MouseEvent) => {
    const row = ev.target instanceof Element ? ev.target.closest<HTMLAnchorElement>(rows) : null;
    if (!row || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey || ev.button !== 0) return;
    if (!isOpen && closable) pushed.current = true;
    else {
      ev.preventDefault();
      navigate(row.getAttribute("href") ?? "", { replace: true });
    }
  };

  const close = () => {
    const to = list();
    if (!pushed.current) {
      navigate(to, { replace: true });
      return;
    }
    pushed.current = false;
    addEventListener(
      "popstate",
      () => {
        navigate(to, { replace: true });
      },
      { once: true },
    );
    history.back();
  };

  return { onListClick, close };
}
