// Blockers: every time an application stopped short of being sent, and why. They stay after the job is
// cleared away, so the stops a site outage caused can be found again and retried.
import { ExternalLink, ShieldCheck } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { BlockerCause, ListedBlocker } from "../../../src/blockers";
import {
  EmptyState,
  JobStatus,
  Linkified,
  Pagination,
  SearchInput,
  Segments,
  SkeletonRows,
  Table,
  TableGroup,
  TableHeader,
  TableItem,
  Time,
  Tooltip,
} from "../../components/ui";
import { NoMatch } from "../../components/list";
import { useBlockers } from "../../lib/api";
import { dayLabel } from "../../lib/format";
import { useHotkeys } from "../../lib/hotkeys";
import { CAUSE } from "../../lib/labels";
import { href, setParams, useRoute } from "../../lib/router";
import { Clamp } from "./parts";

const COLUMNS = "minmax(0,1fr) 148px 132px 72px 28px";
const PAGE = 50;
const isCause = (c: string | null): c is BlockerCause => !!c && c in CAUSE;

function Row({ b }: { b: ListedBlocker }) {
  return (
    <TableItem columns={COLUMNS} className="items-start gap-y-1.5 py-3">
      <div role="cell" className="w-full min-w-0 md:w-auto">
        <a href={href("job", b.job_id)} className="group flex min-w-0 items-baseline gap-1.5 touch:-my-2 touch:py-2">
          <span className="shrink-0 font-medium text-fg group-hover:underline group-hover:underline-offset-2">{b.company}</span>
          <span className="truncate text-fg-muted">{b.title}</span>
        </a>
        <Clamp className="mt-0.5 text-sm text-fg-muted">
          <Linkified text={b.detail} />
        </Clamp>
      </div>
      <div role="cell" className="pt-px text-fg">
        {CAUSE[b.cause]}
      </div>
      <div role="cell" className="pt-px">
        <JobStatus status={b.status} />
      </div>
      <div role="cell" className="pt-px text-fg-muted">
        <Time at={b.at} />
      </div>
      <div role="cell" className="ml-auto md:ml-0">
        <Tooltip content="Open the posting">
          <a
            href={b.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open the ${b.company} posting`}
            className="-mt-0.5 flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-subtle hover:text-fg touch:-my-1 touch:size-9"
          >
            <ExternalLink className="size-3.5" />
          </a>
        </Tooltip>
      </div>
    </TableItem>
  );
}

export function Blockers() {
  const { data, isPending } = useBlockers();
  const { params } = useRoute();
  const raw = params.get("cause"),
    cause = isCause(raw) ? raw : null;
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const box = useRef<HTMLInputElement>(null);
  useHotkeys([
    {
      key: "/",
      run: () => {
        box.current?.focus();
      },
    },
  ]);

  const all = useMemo(() => data ?? [], [data]);
  const counts = useMemo(() => {
    const n = new Map<BlockerCause, number>();
    for (const b of all) n.set(b.cause, (n.get(b.cause) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter(b => (!cause || b.cause === cause) && words.every(w => `${b.company} ${b.title} ${b.detail}`.toLowerCase().includes(w)));
  }, [all, cause, search]);
  const page = shown.slice(offset, offset + PAGE);

  const rows: ReactNode[] = [];
  let day = "";
  for (const b of page) {
    const d = dayLabel(b.at);
    if (d !== day) rows.push(<TableGroup key={`d-${d}`} label={d} count={shown.filter(x => dayLabel(x.at) === d).length} />);
    day = d;
    rows.push(<Row key={b.id} b={b} />);
  }

  return (
    <div>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-8">
        <p className="max-w-xl text-sm text-fg-muted">
          Every time an application stopped short of being sent, and why. They stay after the job is cleared away, so the stops an outage caused can be retried.
        </p>
        <SearchInput
          ref={box}
          value={search}
          onValueChange={v => {
            setSearch(v);
            setOffset(0);
          }}
          placeholder="Search blockers"
          aria-label="Search blockers"
          className="md:w-64 md:shrink-0"
        />
      </div>
      <Segments
        aria-label="Cause"
        value={cause ?? "all"}
        onValueChange={v => {
          setOffset(0);
          setParams({ cause: v === "all" ? null : v });
        }}
        segments={[{ value: "all", label: "All", count: all.length }, ...counts.map(([c, n]) => ({ value: c, label: CAUSE[c], count: n }))]}
        className="-mx-1 mt-4 px-1"
      />
      <Table className="mt-4">
        <TableHeader columns={COLUMNS}>
          <span>Application</span>
          <span>Cause</span>
          <span>Status now</span>
          <span>When</span>
          <span />
        </TableHeader>
        {isPending ? (
          <SkeletonRows rows={6} />
        ) : !shown.length ? (
          all.length ? (
            <NoMatch
              noun="blockers"
              q={search}
              filtered={!!cause}
              onClear={() => {
                setSearch("");
                setOffset(0);
                setParams({ cause: null });
              }}
            />
          ) : (
            <EmptyState
              icon={<ShieldCheck />}
              title="Nothing has been blocked yet"
              description="When an application stops short of being sent, it shows here with the reason."
            />
          )
        ) : (
          rows
        )}
      </Table>
      <Pagination offset={offset} limit={PAGE} total={shown.length} onChange={setOffset} />
    </div>
  );
}
