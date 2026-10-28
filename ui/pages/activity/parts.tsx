import { useInfiniteQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, ListFooter, Tooltip, type WorkspaceBarProps } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { clock, dateTime, parseAt } from "../../lib/format";
import { href } from "../../lib/router";
import type { FeedJob } from "./feed";

export interface ActivityHead {
  tabs: ReactNode;
  run: ReactNode;
}

export function activityBar(head: ActivityHead, own: Omit<WorkspaceBarProps, "title" | "tabs"> = {}): WorkspaceBarProps {
  return {
    title: "Activity",
    tabs: head.tabs,
    hint: "What the agents did, and the runs you can start by hand.",
    ...own,
    actions: (
      <>
        {own.actions}
        {head.run}
      </>
    ),
  };
}

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

export function JobLink({ job, className }: { job: FeedJob; className?: string }) {
  return (
    <a href={href("job", job.id)} className={cn("group/job flex min-w-0 items-baseline gap-1.5 text-sm touch:-my-2 touch:py-2", className)}>
      <span className="max-w-full shrink-0 truncate font-medium text-fg-muted group-hover/job:text-fg">{job.company ?? `Job ${job.id}`}</span>
      {job.title && <span className="truncate text-fg-muted group-hover/job:text-fg">{job.title}</span>}
    </a>
  );
}

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
      {open && <div className="mt-1.5 animate-in border-l border-border pl-3 whitespace-normal">{children}</div>}
    </div>
  );
}

export function useActivityPages(feed: "highlights" | "all", kinds: readonly string[]) {
  return useInfiniteQuery({
    queryKey: ["activity", feed, kinds],
    queryFn: ({ pageParam }) => api.activity({ feed, kinds, before: pageParam, limit: 200 }),
    initialPageParam: null as number | null,
    getNextPageParam: last => last.next,
  });
}

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
