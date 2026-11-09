import { ArrowUpRight, Bot, Hand, MailWarning } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ActivityResult, Summary } from "../../../src/api-types";
import { Button, Clamp, EmptyState, JobStatus, Linkified, ListGroup, ListNotice, ListRow, Segments, SkeletonRows, Workspace } from "../../components/ui";
import { cn } from "../../lib/cn";
import { host, num, plural } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { feed, isKindFilter, KIND_FILTERS, type FeedBoard, type FeedJob, type FeedRow, type FeedWeight, type KindFilter } from "./feed";
import { KindIcon } from "./kind-icon";
import { activityBar, byDay, Clock, Fold, JobLink, LoadOlder, useActivityPages, type ActivityHead } from "./parts";

const WEIGHT: Record<FeedWeight, string> = { high: "font-medium", normal: "font-normal", low: "font-normal text-fg-muted" };

function Jobs({ jobs }: { jobs: readonly FeedJob[] }) {
  const list = (
    <div className="flex flex-col gap-1 py-0.5">
      {jobs.map(j => (
        <JobLink key={j.id} job={j} />
      ))}
    </div>
  );
  return jobs.length > INLINE ? <Fold label={plural(jobs.length, "job")}>{list}</Fold> : list;
}

function Boards({ boards }: { boards: readonly FeedBoard[] }) {
  const list = (
    <ul className="flex flex-col py-0.5 font-mono text-xs leading-5 text-fg-muted">
      {boards.map(b => (
        <li key={b.name} className={cn("break-all", b.lasting && "text-fg")}>
          {`${b.name}: ${b.reason}`}
        </li>
      ))}
    </ul>
  );
  return boards.length > INLINE ? <Fold label={plural(boards.length, "board")}>{list}</Fold> : list;
}

const INLINE = 3;

function Row({ row }: { row: FeedRow }) {
  const repeats = row.n > 1 && !row.jobs.length && !row.boards.length;
  const many = row.jobs.length > 1;
  const boards = row.boards.length > 1;
  const named = !many && !!row.job?.company && !row.url && !/https?:\/\//.test(row.text) && row.text.includes(row.job.company);
  const status = row.kind === "mail" && row.outcome && <JobStatus status={row.outcome} className="ml-2 align-baseline" />;
  return (
    <ListRow
      lead={<KindIcon row={row} />}
      titleLines="none"
      titleClassName={WEIGHT[row.weight]}
      title={
        <div className="flex flex-col [&>:first-child]:contents [&>:first-child>button]:order-2 [&>:first-child>button]:self-start">
          <Clamp lines={2} touchLines={3}>
            {named && row.job ? (
              <a href={href("job", row.job.id)} className="hover:underline hover:underline-offset-2">
                {row.text}
              </a>
            ) : (
              <Linkified text={row.text} />
            )}
            {status}
            {row.url && (
              <a href={row.url} target="_blank" rel="noopener noreferrer" className="ml-1.5 inline-flex items-center gap-0.5 text-accent-text hover:underline">
                {host(row.url)}
                <ArrowUpRight className="size-3.5" />
              </a>
            )}
          </Clamp>
          {(many || boards || (!!row.job && !named) || !!row.go) && (
            <div className="order-1 mt-0.5 flex min-w-0 flex-col gap-1 font-normal touch:-my-2 touch:py-2">
              {many ? <Jobs jobs={row.jobs} /> : row.job && !named && <JobLink job={row.job} />}
              {boards && (
                <>
                  {row.detail && <p className="text-sm text-fg-muted">{row.detail}</p>}
                  <Boards boards={row.boards} />
                </>
              )}
              {row.go && (
                <a href={row.go.href} className="text-sm font-medium text-accent-text hover:underline touch:-my-2 touch:py-2">
                  {row.go.label}
                </a>
              )}
            </div>
          )}
        </div>
      }
      fact={
        <>
          <Clock at={row.at} />
          {repeats && <span title={`${num(row.n)} times this day`}>{`×${num(row.n)}`}</span>}
        </>
      }
      snippet={!boards && row.detail && <div data-detail>{row.detail}</div>}
      className="[&_div:has(>[data-detail])]:max-w-none"
    />
  );
}

function Waiting({ s }: { s: Summary | undefined }) {
  if (!s) return null;
  const a = s.attention;
  const parts: [number, string, string][] = [
    [a.questions, plural(a.questions, "question"), href("questions")],
    [a.manual, plural(a.manual, "hand-off"), `${href("pipeline")}?group=needs_you`],
    [a.confirmSubmit, plural(a.confirmSubmit, "submit", "submits").concat(" to confirm"), `${href("pipeline")}?group=needs_you`],
    [a.coverLetter, plural(a.coverLetter, "cover letter"), `${href("pipeline")}?group=needs_you`],
    [a.failed, `${num(a.failed)} failed`, `${href("pipeline")}?group=failed`],
  ];
  const shown = parts.filter(([n]) => n > 0);
  return (
    <>
      {!s.gmail.connected && (
        <ListNotice
          tone="warning"
          icon={<MailWarning />}
          action={
            <Button asChild size="sm" variant="link" className="px-0 touch:px-0">
              <a href={href("settings")}>Settings</a>
            </Button>
          }
        >
          Gmail isn't connected, so replies from employers aren't being recorded.
        </ListNotice>
      )}
      {shown.length > 0 && (
        <ListNotice icon={<Hand />}>
          <span className="text-fg-muted">Waiting on you: </span>
          {shown.map(([, label, to], i) => (
            <span key={label}>
              {i > 0 && <span className="text-fg-subtle"> · </span>}
              <a href={to} className="font-medium hover:underline touch:-my-2 touch:py-2">
                {label}
              </a>
            </span>
          ))}
        </ListNotice>
      )}
    </>
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
      notice={<Waiting s={head.summary} />}
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
            <ListGroup label={d.day} />
            {d.items.map(r => (
              <Row key={r.key} row={r} />
            ))}
          </div>
        ))
      )}
    </Workspace>
  );
}
