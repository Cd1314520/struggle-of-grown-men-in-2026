// Pieces the Activity tabs share: day headers that stay in view, text that folds to two lines, clock times.
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Overline, Tooltip } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { clock, dateTime, parseAt } from "../../lib/format";

// A day's heading, pinned under the phone's top bar while its rows scroll past.
export function DayHeader({ label, count, className }: { label: string; count?: number | undefined; className?: string }) {
  return (
    <div className={cn("sticky top-12 z-10 -mx-1 flex items-baseline gap-2 bg-canvas px-1 pt-6 pb-2 lg:top-0", className)}>
      <Overline>{label}</Overline>
      {count !== undefined && <span className="tabular text-xs text-fg-subtle">{count.toLocaleString()}</span>}
    </div>
  );
}

// "4:18 AM", with the full date on hover.
export function Clock({ at, className }: { at: string; className?: string }) {
  const ms = parseAt(at);
  return (
    <Tooltip content={dateTime(ms)}>
      <time dateTime={new Date(ms).toISOString()} className={cn("tabular text-xs whitespace-nowrap text-fg-subtle", className)}>
        {clock(ms)}
      </time>
    </Tooltip>
  );
}

// Long agent text, cut to a line or two with a toggle that only shows when something was cut.
export function Clamp({ children, lines = 2, className }: { children: ReactNode; lines?: 1 | 2; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const ro = new ResizeObserver(() => {
      setCut(el.scrollHeight > el.clientHeight + 1);
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [open, children]);
  return (
    <div className={className}>
      <div ref={ref} className={cn("break-words whitespace-pre-line", !open && (lines === 1 ? "line-clamp-1" : "line-clamp-2"))}>
        {children}
      </div>
      {(cut || open) && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="mt-0.5 text-xs font-medium text-fg-subtle hover:text-fg touch:-my-2.5 touch:py-2.5"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

// The event log, a page at a time. Every page loaded stays, and all of them refetch when something changes.
export function useActivityPages(feed: "highlights" | "all", kinds: readonly string[]) {
  return useInfiniteQuery({
    queryKey: ["activity", feed, kinds],
    queryFn: ({ pageParam }) => api.activity({ feed, kinds, before: pageParam, limit: 200 }),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.next,
  });
}
