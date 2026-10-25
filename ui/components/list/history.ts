// Opening a record from its list, as history sees it. Where the record can be closed (a phone, or a list
// that is the whole page until a record opens), opening it from the list is a step in history, so Back
// and the close button both return to the list. Moving between records while one is open is not.
import { useEffect, useRef, type MouseEvent } from "react";
import { navigate } from "../../lib/router";

export function useRecordHistory({
  isOpen,
  closable,
  list,
  rows = "a[data-row]",
}: {
  isOpen: boolean;
  closable: boolean; // false beside a list that always has a record open (Review and Questions on a desktop)
  list: () => string; // the list's route as it is now, with nothing open
  rows?: string; // the selector of the list's record links
}) {
  const pushed = useRef(false);
  useEffect(() => {
    if (!isOpen) pushed.current = false;
  }, [isOpen]);

  // On the list's container: a click on a record link that should not be a history step replaces the route.
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
    // The list's entry has the params from when the record opened; keep the ones changed since.
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
