import { ArrowUpRight, Bot } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityResult } from "../../../src/api-types";
import { Clamp, EmptyState, Linkified, ListGroup, ListRow, Segments, SkeletonRows, Workspace } from "../../components/ui";
import { host, num, plural } from "../../lib/format";
import { setParams, useRoute } from "../../lib/router";
import { feed, isKindFilter, KIND_FILTERS, type FeedRow, type KindFilter } from "./feed";
import { KindIcon } from "./kind-icon";
import { activityBar, byDay, Clock, Fold, JobLink, LoadOlder, useActivityPages, type ActivityHead } from "./parts";

function Row({ row }: { row: FeedRow }) {
  const repeats = row.n > 1 && !row.jobs.length && !row.boards.length;
  return (
    <ListRow
      lead={<KindIcon row={row} />}
      titleLines="none"
      titleClassName="font-normal"
      title={
        <Clamp lines={2} touchLines={3}>
          <Linkified text={row.text} />
          {row.url && (
            <a href={row.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent-text hover:underline">
              {host(row.url)}
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
        </Clamp>
      }
      fact={
        <>
          <Clock at={row.at} />
          {repeats && <span title={`${num(row.n)} times this day`}>{`×${num(row.n)}`}</span>}
        </>
      }
      secondary={
        (row.jobs.length > 1 || row.boards.length > 1 || row.job) && (
          <div className="flex min-w-0 flex-1 flex-col gap-1 touch:-my-2 touch:py-2">
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
        )
      }
      snippet={row.detail && <div data-detail>{row.detail}</div>}
      className="[&_div:has(>[data-detail])]:max-w-none"
    />
  );
}

const rowsOf = (pages: readonly ActivityResult[] | undefined) => feed(pages?.flatMap(p => p.items) ?? []);

export function Highlights({ head }: { head: ActivityHead }) {
  const { params } = useRoute();
  const raw = params.get("kind"),
    filter: KindFilter = isKindFilter(raw) ? raw : "all";
  const q = useActivityPages("highlights", KIND_FILTERS[filter].kinds);
  const rows = useMemo(() => rowsOf(q.data?.pages), [q.data]);
  const days = useMemo(() => byDay(rows, r => r.day), [rows]);
  const pages = q.data?.pages.length ?? 0;
  useEffect(() => {
    if (q.hasNextPage && !q.isFetchingNextPage && !q.isFetching && rows.length < 25 && pages < 12) void q.fetchNextPage();
  }, [q, rows.length, pages]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadOlder = async () => {
    setLoadingOlder(true);
    try {
      let res = await q.fetchNextPage();
      for (let i = 0; i < 8 && res.hasNextPage && rowsOf(res.data?.pages).length < rows.length + 15; i++) res = await res.fetchNextPage();
    } finally {
      setLoadingOlder(false);
    }
  };

  return (
    <Workspace
      bar={activityBar(head, {
        segments: (
          <Segments
            aria-label="Show"
            value={filter}
            onValueChange={v => {
              setParams({ kind: v === "all" ? null : v });
            }}
            segments={(Object.keys(KIND_FILTERS) as KindFilter[]).map(k => ({ value: k, label: KIND_FILTERS[k].label }))}
          />
        ),
      })}
      footer={rows.length > 0 && <LoadOlder more={q.hasNextPage} loading={loadingOlder || q.isFetchingNextPage} onLoad={() => void loadOlder()} />}
      bodyRole="table"
      bodyLabel="Highlights"
    >
      {q.isPending || (!rows.length && q.hasNextPage) ? (
        <SkeletonRows rows={8} />
      ) : !rows.length ? (
        <EmptyState
          icon={<Bot />}
          title={filter === "all" ? "No activity yet" : "Nothing here yet"}
          description={filter === "all" ? "What the agents do shows here as they work." : `No ${KIND_FILTERS[filter].label.toLowerCase()} entries in the log.`}
          className="pt-24"
        />
      ) : (
        days.map(d => (
          <div key={d.day} className="contents">
            <ListGroup label={d.day} count={d.items.length} />
            {d.items.map(r => (
              <Row key={r.key} row={r} />
            ))}
          </div>
        ))
      )}
    </Workspace>
  );
}
