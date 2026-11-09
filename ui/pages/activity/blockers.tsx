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
  Time,
  Tooltip,
  Workspace,
} from "../../components/ui";
import { NoMatch } from "../../components/list";
import { useBlockers } from "../../lib/api";
import { dayLabel, num, plural } from "../../lib/format";
import { useHotkeys } from "../../lib/hotkeys";
import { CAUSE } from "../../lib/labels";
import { href, setParams, useRoute } from "../../lib/router";
import { activityBar, Fold, JobLink, type ActivityHead } from "./parts";

const PAGE = 50;
const isCause = (c: string | null): c is BlockerCause => !!c && c in CAUSE;
const gist = (b: ListedBlocker) =>
  b.detail.replace(new RegExp(`\\b${b.job_id}\\b`, "g"), "…").replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "…");

function Row({ run }: { run: readonly ListedBlocker[] }) {
  const b = run[0];
  if (!b) return null;
  const many = run.length > 1;
  const status = run.every(x => x.status === b.status) && <JobStatus status={b.status} className="shrink-0" />;
  const employers = [...new Set(run.map(x => x.company))];
  return (
    <ListRow
      lead={many ? <ListIcon icon={num(run.length)} /> : <CompanyMark name={b.company} />}
      titleLines="none"
      title={
        many ? (
          <span className="line-clamp-1">{plural(run.length, "application")}</span>
        ) : (
          <a href={href("job", b.job_id)} className="block hover:underline hover:underline-offset-2 touch:-my-2 touch:py-2">
            <span className="line-clamp-2 @4xl/ws:line-clamp-1">{b.title}</span>
          </a>
        )
      }
      secondary={many ? employers.join(", ") : b.company}
      gist={
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-medium text-fg">{CAUSE[b.cause]}</span>
          {status}
        </span>
      }
      className="[&_div:has(>[data-fold])]:line-clamp-none [&_div:has(>[data-fold])]:max-w-none"
      snippet={
        <div data-fold>
          <Clamp lines={2} touchLines={3}>
            <Linkified text={many ? gist(b) : b.detail} />
          </Clamp>
          {many && (
            <Fold label={`Show the ${plural(run.length, "job")}`}>
              <div className="flex flex-col gap-1 py-0.5">
                {run.map(x => (
                  <JobLink key={x.id} job={{ id: x.job_id, company: x.company, title: x.title }} />
                ))}
              </div>
            </Fold>
          )}
        </div>
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
          <Time at={b.at} short />
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
  let day = "",
    run: ListedBlocker[] = [];
  const flush = () => {
    if (run[0]) rows.push(<Row key={run[0].id} run={run} />);
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
    if (last && (last.cause !== b.cause || gist(last) !== gist(b))) flush();
    run.push(b);
  }
  flush();

  return (
    <Workspace
      bar={activityBar(head, {
        hint: "Every time an application stopped short of being sent, and why. Kept after the job is cleared, so an outage's stops can be retried.",
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
            <Segments
              aria-label="Cause"
              value={cause ?? "all"}
              onValueChange={v => {
                setOffset(0);
                setParams({ cause: v === "all" ? null : v });
              }}
              segments={[{ value: "all", label: "All", count: all.length }, ...counts.map(([c, n]) => ({ value: c, label: CAUSE[c], count: n }))]}
            />
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
            className="pt-24"
          />
        )
      ) : (
        rows
      )}
    </Workspace>
  );
}
