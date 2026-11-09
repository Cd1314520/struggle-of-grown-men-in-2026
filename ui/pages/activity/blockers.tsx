import { ExternalLink, ShieldCheck } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { BlockerCause, ListedBlocker } from "../../../src/blockers";
import {
  Button,
  Clamp,
  CompanyMark,
  EmptyState,
  JobStatus,
  Linkified,
  ListGroup,
  ListIcon,
  ListRow,
  Pagination,
  SearchInput,
  Segments,
  SkeletonRows,
  Tooltip,
  Workspace,
} from "../../components/ui";
import { NoMatch } from "../../components/list";
import { useBlockers } from "../../lib/api";
import { dayLabel, num } from "../../lib/format";
import { useHotkeys } from "../../lib/hotkeys";
import { CAUSE } from "../../lib/labels";
import { cn } from "../../lib/cn";
import { PARKED, type Status } from "../../../src/status";
import { href, setParams, useRoute } from "../../lib/router";
import { activityBar, Clock, Fold, JobLink, type ActivityHead } from "./parts";

const PAGE = 50;
const isCause = (c: string | null): c is BlockerCause => !!c && c in CAUSE;
const gist = (b: ListedBlocker) =>
  b.detail.replace(new RegExp(`\\b${b.job_id}\\b`, "g"), "…").replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "…");

const STUCK: readonly Status[] = [...PARKED, "failed"];
const isStuck = (b: ListedBlocker) => STUCK.includes(b.status);
const SHOW = { stuck: "Still stuck", resolved: "Resolved", all: "All" } as const;
type Show = keyof typeof SHOW;
const isShow = (v: string | null): v is Show => !!v && v in SHOW;

function Row({ run, dim }: { run: readonly ListedBlocker[]; dim: boolean }) {
  const b = run[0];
  if (!b) return null;
  const many = run.some(x => x.job_id !== b.job_id);
  const again = !many && run.length > 1;
  const faded = dim && run.every(x => !isStuck(x));
  const status = run.every(x => x.status === b.status) && <JobStatus status={b.status} className="shrink-0" />;
  const employers = [...new Set(run.map(x => x.company))];
  return (
    <ListRow
      lead={many ? <ListIcon icon={num(run.length)} /> : <CompanyMark name={b.company} />}
      titleLines="none"
      titleClassName={cn(faded && "font-normal text-fg-muted")}
      title={
        many ? (
          <span className="line-clamp-1">{employers.join(", ")}</span>
        ) : (
          <a href={href("job", b.job_id)} className="block hover:underline hover:underline-offset-2 touch:-my-2 touch:py-2">
            <span className="line-clamp-2 @4xl/ws:line-clamp-1">{b.title}</span>
          </a>
        )
      }
      secondary={many ? undefined : b.company}
      gist={
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn("min-w-0 truncate font-medium", faded ? "text-fg-muted" : "text-fg")}>
            {CAUSE[b.cause]}
            {again && <span className="font-normal text-fg-muted">{` · stopped ${num(run.length)}×`}</span>}
          </span>
          {status}
        </span>
      }
      className="[&_div:has(>[data-fold])]:line-clamp-none [&_div:has(>[data-fold])]:max-w-none"
      snippet={
        !faded && (
          <div data-fold>
            <Clamp lines={2} touchLines={2}>
              <Linkified text={many ? gist(b) : b.detail} />
            </Clamp>
            {many && (
              <Fold label="Jobs">
                <div className="flex flex-col gap-1 py-0.5">
                  {run.map(x => (
                    <JobLink key={x.id} job={{ id: x.job_id, company: x.company, title: x.title }} />
                  ))}
                </div>
              </Fold>
            )}
            {again && (
              <Fold label="Earlier stops">
                <div className="flex flex-col gap-2 py-0.5 text-sm text-fg-muted">
                  {run.slice(1).map(x => (
                    <p key={x.id}>
                      <Clock at={x.at} className="mr-2 text-fg-subtle" />
                      {x.cause !== b.cause && <span className="mr-1.5 font-medium text-fg">{CAUSE[x.cause]}</span>}
                      <Linkified text={x.detail} />
                    </p>
                  ))}
                </div>
              </Fold>
            )}
          </div>
        )
      }
      fact={
        <>
          {!many && (
            <Tooltip content="Open the posting">
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="-my-1 text-fg-subtle opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 touch:-my-2 touch:opacity-100"
              >
                <a href={b.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${b.company} posting`}>
                  <ExternalLink />
                </a>
              </Button>
            </Tooltip>
          )}
          <Clock at={b.at} />
        </>
      }
    />
  );
}

export function Blockers({ head }: { head: ActivityHead }) {
  const { data, isPending } = useBlockers();
  const { params } = useRoute();
  const raw = params.get("cause"),
    cause = isCause(raw) ? raw : null;
  const rawShow = params.get("show"),
    show: Show = isShow(rawShow) ? rawShow : "stuck";
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
  const stuck = useMemo(() => all.filter(isStuck).length, [all]);
  const split = useMemo(() => (show === "all" ? all : all.filter(b => isStuck(b) === (show === "stuck"))), [all, show]);
  const counts = useMemo(() => {
    const n = new Map<BlockerCause, number>();
    for (const b of split) n.set(b.cause, (n.get(b.cause) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]);
  }, [split]);
  const shown = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean);
    return split.filter(b => (!cause || b.cause === cause) && words.every(w => `${b.company} ${b.title} ${b.detail}`.toLowerCase().includes(w)));
  }, [split, cause, search]);
  const page = shown.slice(offset, offset + PAGE);

  const rows: ReactNode[] = [];
  let day = "",
    run: ListedBlocker[] = [];
  const flush = () => {
    if (run[0]) rows.push(<Row key={run[0].id} run={run} dim={show === "all"} />);
    run = [];
  };
  for (const b of page) {
    const d = dayLabel(b.at);
    if (d !== day) {
      flush();
      rows.push(<ListGroup key={`d-${d}`} label={d} count={shown.filter(x => dayLabel(x.at) === d).length} />);
      day = d;
    }
    const last = run[0];
    if (last) {
      const sameJob = run.every(x => x.job_id === b.job_id),
        alike =
          last.cause === b.cause && gist(last) === gist(b) && !run.some(x => x.job_id === b.job_id) && (run.length === 1 || run[1]?.job_id !== last.job_id);
      if (!sameJob && !alike) flush();
    }
    run.push(b);
  }
  flush();

  return (
    <Workspace
      bar={activityBar(head, {
        hint: "Kept after the job is cleared, so you can retry an outage's stops.",
        ...(all.length > 0 && {
          search: (
            <SearchInput
              ref={box}
              value={search}
              onValueChange={v => {
                setSearch(v);
                setOffset(0);
              }}
              placeholder="Search blockers"
              aria-label="Search blockers"
            />
          ),
          segments: (
            <div className="flex min-w-0 items-center gap-2 overflow-x-auto [&>[role=tablist]]:shrink-0 [&>[role=tablist]]:overflow-visible">
              <Segments
                aria-label="Show"
                value={show}
                onValueChange={v => {
                  setOffset(0);
                  setParams({ show: v === "stuck" ? null : v, cause: null });
                }}
                segments={(Object.keys(SHOW) as Show[]).map(k => ({
                  value: k,
                  label: SHOW[k],
                  ...(k === "stuck" && { count: stuck, tone: "warning" as const }),
                }))}
              />
              <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
              <Segments
                aria-label="Cause"
                value={cause ?? "all"}
                onValueChange={v => {
                  setOffset(0);
                  setParams({ cause: v === "all" ? null : v });
                }}
                segments={[{ value: "all", label: "Any cause", count: split.length }, ...counts.map(([c, n]) => ({ value: c, label: CAUSE[c], count: n }))]}
              />
            </div>
          ),
        }),
      })}
      footer={<Pagination variant="footer" noun="blockers" offset={offset} limit={PAGE} total={shown.length} onChange={setOffset} />}
      bodyRole="table"
      bodyLabel="Blockers"
    >
      {isPending ? (
        <SkeletonRows rows={6} />
      ) : !shown.length ? (
        show === "stuck" && !search && !cause && all.length ? (
          <EmptyState icon={<ShieldCheck />} title="Nothing is stuck right now" description="Earlier stops are under Resolved." className="pt-24" />
        ) : all.length ? (
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
            className="pt-24"
          />
        )
      ) : (
        rows
      )}
    </Workspace>
  );
}
