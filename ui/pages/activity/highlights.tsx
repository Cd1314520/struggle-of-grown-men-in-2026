// Highlights: what the agents and the owner did, as sentences, by day.
import {
  ArrowUpRight,
  Bot,
  Building2,
  ChevronRight,
  CircleUserRound,
  Hand,
  ListChecks,
  Mail,
  Radar,
  RefreshCw,
  Search,
  TriangleAlert,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ActivityResult } from "../../../src/api-types";
import { Button, Card, EmptyState, Linkified, Segments, SkeletonRows } from "../../components/ui";
import { cn } from "../../lib/cn";
import { host, num, plural } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { feed, isKindFilter, KIND_FILTERS, type FeedJob, type FeedRow, type KindFilter } from "./feed";
import { Clamp, Clock, DayHeader, useActivityPages } from "./parts";

const KIND_ICON: Record<string, LucideIcon> = {
  gate: Hand,
  user: CircleUserRound,
  error: TriangleAlert,
  mail: Mail,
  auto: Zap,
  recheck: ListChecks,
  migration: Wrench,
};
const KIND_TONE: Record<string, string> = {
  gate: "bg-warning-soft text-warning-text",
  error: "bg-danger-soft text-danger-text",
  mail: "bg-info-soft text-info-text",
};
// System entries by what they report, so a scan, a mail check and a recheck tell apart at a glance.
const SYSTEM_ICON: [RegExp, LucideIcon][] = [
  [/^Checked mail/, Mail],
  [/^(Looked for|Found) the employer/, Search],
  [/^(Checked|Found|Screened out) /, Radar],
  [/^Recheck/, RefreshCw],
  [/^Looked for new companies/, Building2],
];

function KindIcon({ row }: { row: FeedRow }) {
  const Icon = (row.kind === "system" ? SYSTEM_ICON.find(([re]) => re.test(row.text))?.[1] : KIND_ICON[row.kind]) ?? Bot;
  return (
    <span
      aria-hidden
      className={cn("mt-px flex size-7 shrink-0 items-center justify-center rounded-md [&_svg]:size-3.5", KIND_TONE[row.kind] ?? "bg-subtle text-fg-muted")}
    >
      <Icon />
    </span>
  );
}

function JobLink({ job, className }: { job: FeedJob; className?: string }) {
  return (
    <a href={href("job", job.id)} className={cn("group/job flex min-w-0 items-baseline gap-1.5 text-sm touch:-my-2 touch:py-2", className)}>
      <span className="shrink-0 font-medium text-fg-muted group-hover/job:text-fg">{job.company ?? `Job ${job.id}`}</span>
      {job.title && <span className="truncate text-fg-subtle group-hover/job:text-fg-muted">{job.title}</span>}
    </a>
  );
}

// "15 jobs" or "23 boards", folding open to the list.
function Fold({ label, children }: { label: string; children: ReactNode }) {
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
      {open && <div className="mt-1.5 animate-in border-l border-border pl-3">{children}</div>}
    </div>
  );
}

function Row({ row }: { row: FeedRow }) {
  return (
    <div className="flex gap-3 px-4 py-3">
      <KindIcon row={row} />
      <div className="min-w-0 flex-1 space-y-0.5 pt-0.5">
        <Clamp className="text-sm text-fg">
          <Linkified text={row.text} />
          {row.url && (
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent-text hover:underline">
              {host(row.url)}
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </Clamp>
        {row.detail && <p className="text-sm text-fg-muted">{row.detail}</p>}
        {row.jobs.length > 1 ? (
          <Fold label={plural(row.jobs.length, "job")}>
            <div className="flex flex-col gap-1 py-0.5">
              {row.jobs.map(j => (
                <JobLink key={j.id} job={j} />
              ))}
            </div>
          </Fold>
        ) : (
          row.job && <JobLink job={row.job} />
        )}
        {row.boards.length > 1 && (
          <Fold label={plural(row.boards.length, "board")}>
            <p className="py-0.5 font-mono text-xs leading-5 text-fg-muted">{row.boards.join(", ")}</p>
          </Fold>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start pt-1">
        {row.n > 1 && !row.jobs.length && !row.boards.length && (
          <span className="tabular text-xs text-fg-subtle" title={`${num(row.n)} times this day`}>
            ×{num(row.n)}
          </span>
        )}
        <Clock at={row.at} />
      </div>
    </div>
  );
}

const rowsOf = (pages: readonly ActivityResult[] | undefined) => feed(pages?.flatMap(p => p.items) ?? []);

export function Highlights() {
  const { params } = useRoute();
  const raw = params.get("kind"),
    filter: KindFilter = isKindFilter(raw) ? raw : "all";
  const q = useActivityPages("highlights", KIND_FILTERS[filter].kinds);
  const rows = useMemo(() => rowsOf(q.data?.pages), [q.data]);
  const days = useMemo(() => {
    const out: { day: string; rows: FeedRow[] }[] = [];
    for (const r of rows) {
      const last = out.at(-1);
      if (last?.day === r.day) last.rows.push(r);
      else out.push({ day: r.day, rows: [r] });
    }
    return out;
  }, [rows]);
  // A page of 200 entries can fold into a handful of rows (a bulk migration, a board outage): keep
  // reading until the screen has something to show.
  const pages = q.data?.pages.length ?? 0;
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetching && rows.length < 25 && pages < 12) void q.fetchNextPage();
  }, [q, rows.length, pages]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = async () => {
    setLoadingOlder(true);
    try {
      // Each click shows at least a screenful more, however much of it folds away.
      let res = await q.fetchNextPage();
      for (let i = 0; i < 8 && res.hasNextPage && rowsOf(res.data?.pages).length < rows.length + 15; i++) res = await res.fetchNextPage();
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <div>
      <Segments
        aria-label="Show"
        value={filter}
        onValueChange={v => {
          setParams({ kind: v === "all" ? null : v });
        }}
        segments={(Object.keys(KIND_FILTERS) as KindFilter[]).map(k => ({ value: k, label: KIND_FILTERS[k].label }))}
        className="-mx-1 px-1"
      />
      {q.isPending || (!rows.length && q.hasNextPage) ? (
        <Card className="mt-5">
          <SkeletonRows rows={8} />
        </Card>
      ) : !rows.length ? (
        <Card className="mt-5">
          <EmptyState
            icon={<Bot />}
            title={filter === "all" ? "No activity yet" : "Nothing here yet"}
            description={
              filter === "all" ? "What the agents do shows here as they work." : `No ${KIND_FILTERS[filter].label.toLowerCase()} entries in the log.`
            }
          />
        </Card>
      ) : (
        <>
          {days.map(d => (
            <section key={d.day} aria-label={d.day}>
              <DayHeader label={d.day} />
              <Card className="divide-y divide-border">
                {d.rows.map(r => (
                  <Row key={r.key} row={r} />
                ))}
              </Card>
            </section>
          ))}
          <div className="flex justify-center pt-6">
            {q.hasNextPage ? (
              <Button loading={loadingOlder || q.isFetchingNextPage} onClick={() => void loadOlder()}>
                Load older
              </Button>
            ) : (
              <p className="text-sm text-fg-subtle">That's everything in the log.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
