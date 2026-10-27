// Pieces the Activity tabs share: clock times, job links and folds, and the event log a page at a time.
import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, ListFooter, Tooltip } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { clock, dateTime, parseAt } from "../../lib/format";
import { href } from "../../lib/router";
import type { FeedJob } from "./feed";

// What every tab's panel is headed by: the tabs, and below lg the Run menu beside them.
export interface ActivityHead {
  tabs: ReactNode;
  run: ReactNode;
}

// The buttons beside the tabs below lg: a tab's own, then Run. The panel lifts its actions 6px off the
// tabs' line; these sit back down, so a button is centred on the tab labels and ends on the line they rest on.
export function headActions(head: ActivityHead, own?: ReactNode) {
  return (
    (head.run || own) && (
      <div className="-mb-1.5 flex items-center gap-1.5">
        {own}
        {head.run}
      </div>
    )
  );
}

// "4:18 AM", with the full date on hover. Its size and colour come from where it sits: a row's trail, a log cell.
export function Clock({ at, className }: { at: string; className?: string }) {
  const ms = parseAt(at);
  return (
    <Tooltip content={dateTime(ms)}>
      <time dateTime={new Date(ms).toISOString()} className={cn("tabular whitespace-nowrap", className)}>
        {clock(ms)}
      </time>
    </Tooltip>
  );
}

// A job a feed row or a folded run of blockers names: the employer, then the role.
export function JobLink({ job, className }: { job: FeedJob; className?: string }) {
  return (
    <a href={href("job", job.id)} className={cn("group/job flex min-w-0 items-baseline gap-1.5 text-sm touch:-my-2 touch:py-2", className)}>
      <span className="max-w-full shrink-0 truncate font-medium text-fg-muted group-hover/job:text-fg">{job.company ?? `Job ${job.id}`}</span>
      {job.title && <span className="truncate text-fg-muted group-hover/job:text-fg">{job.title}</span>}
    </a>
  );
}

// "15 jobs" or "23 boards", folding open to the list.
export function Fold({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
        className="inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2"
      >
        {label}
        <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
      </button>
      {/* A row's secondary line may hold it, and that line is one line: the list wraps again. */}
      {open && <div className="mt-1.5 animate-in border-l border-border pl-3 whitespace-normal">{children}</div>}
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

// The band under the feed and the log: a page more, or the end of it.
export function LoadOlder({ more, loading, onLoad }: { more: boolean; loading: boolean; onLoad: () => void }) {
  return (
    <ListFooter center>
      {more ? (
        <Button size="sm" loading={loading} onClick={onLoad}>
          Load older
        </Button>
      ) : (
        <span>That's everything in the log.</span>
      )}
    </ListFooter>
  );
}

// Entries in runs of one day each, newest day first, as the server sends them.
export function byDay<T>(items: readonly T[], dayOf: (item: T) => string) {
  const out: { day: string; items: T[] }[] = [];
  for (const item of items) {
    const day = dayOf(item),
      last = out.at(-1);
    if (last?.day === day) last.items.push(item);
    else out.push({ day, items: [item] });
  }
  return out;
}
