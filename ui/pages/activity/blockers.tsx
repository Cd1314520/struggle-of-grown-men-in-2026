// Blockers: every time an application stopped short of being sent, and why. They stay after the job is
// cleared away, so the stops a site outage caused can be found again and retried.
import { ExternalLink, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { BlockerCause, ListedBlocker } from "../../../src/blockers";
import {
  Button,
  Clamp,
  EmptyState,
  JobStatus,
  Linkified,
  ListColumns,
  ListGroup,
  ListPanel,
  ListRow,
  ListToolbar,
  Narrow,
  Pagination,
  SearchInput,
  Segments,
  SkeletonRows,
  Time,
  Tooltip,
} from "../../components/ui";
import { NoMatch } from "../../components/list";
import { useBlockers } from "../../lib/api";
import { dayLabel, plural } from "../../lib/format";
import { useHotkeys } from "../../lib/hotkeys";
import { TABLET, useMedia } from "../../lib/media";
import { CAUSE } from "../../lib/labels";
import { href, setParams, useRoute } from "../../lib/router";
import { Fold, headActions, JobLink, type ActivityHead } from "./parts";

// Cause, status now, when; the posting's link is the trail.
const COLUMNS = "176px 136px 72px";
const PAGE = 50;
const isCause = (c: string | null): c is BlockerCause => !!c && c in CAUSE;
// The detail with its own job's id taken out (a path to that job's files) and any UUID, so stops that say the
// same thing about different jobs compare equal: "open '…/jobs/…/resume.pdf'".
const gist = (b: ListedBlocker) =>
  b.detail.replace(new RegExp(`\\b${b.job_id}\\b`, "g"), "…").replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "…");

// One stop, or a run of them in a row with the same cause and the same words but for the job (an outage that
// stopped 57 applications): those read as one row, with the jobs folded under it.
function Row({ run }: { run: readonly ListedBlocker[] }) {
  const b = run[0];
  if (!b) return null;
  const many = run.length > 1;
  // A run whose jobs have since moved on to different places has no one status to show.
  const status = run.every(x => x.status === b.status) ? <JobStatus status={b.status} /> : null;
  return (
    <ListRow
      titleLines="none"
      titleClassName="font-normal"
      title={
        // The title, the cause and the detail share the title's cell: the detail folds open, which a snippet,
        // clamped as it is, cannot.
        <>
          {many ? (
            <span className="line-clamp-1 font-medium">{plural(run.length, "application")}</span>
          ) : (
            <a href={href("job", b.job_id)} className="group/job line-clamp-2 @4xl/list:line-clamp-1">
              <span className="font-medium text-fg group-hover/job:underline group-hover/job:underline-offset-2">{b.company}</span>{" "}
              <span className="text-fg-muted">{b.title}</span>
            </a>
          )}
          <Narrow>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-sm">
              <span className="truncate font-medium text-fg">{CAUSE[b.cause]}</span>
              {status}
            </span>
          </Narrow>
          <Clamp lines={2} touchLines={3} className="mt-1 text-sm text-fg-muted">
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
        </>
      }
      columns={COLUMNS}
      cells={[
        <span key="cause" className="block truncate text-fg">
          {CAUSE[b.cause]}
        </span>,
        <span key="status">{status}</span>,
        <Time key="at" at={b.at} />,
      ]}
      trail={
        <>
          <Narrow>
            <Time at={b.at} short />
          </Narrow>
          {many ? (
            // Holds the link's room, so the cells beside it stay under their headers.
            <span aria-hidden className="block size-7" />
          ) : (
            <Tooltip content="Open the posting">
              <Button asChild variant="ghost" size="icon-sm" className="-mr-1.5 text-fg-subtle">
                <a href={b.url} target="_blank" rel="noopener noreferrer" aria-label={`Open the ${b.company} posting`}>
                  <ExternalLink />
                </a>
              </Button>
            </Tooltip>
          )}
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
  // On a phone the search waits behind a button beside the tabs, so the first stop starts as high as the
  // other tabs' first rows do; it opens when tapped, and stays while it holds words.
  const roomy = useMedia(TABLET);
  const [searching, setSearching] = useState(false);
  const searchShown = roomy || searching || !!search;
  useEffect(() => {
    if (searching) box.current?.focus();
  }, [searching]);
  useHotkeys([
    {
      key: "/",
      run: () => {
        setSearching(true);
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

  // Days as bands; inside a day, a run of the same stop in the same words as one row.
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
    <ListPanel
      tabs={head.tabs}
      actions={headActions(
        head,
        !searchShown && all.length > 0 && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Search blockers"
            onClick={() => {
              setSearching(true);
            }}
          >
            <Search />
          </Button>
        ),
      )}
      toolbar={
        all.length > 0 && (
          <>
            {/* The panel's description, which a phone does without: the page says what Activity is. */}
            <p className="px-[var(--list-x)] pb-3 text-sm text-fg-muted max-sm:hidden">
              Every time an application stopped short of being sent, and why. Kept after the job is cleared, so an outage&apos;s stops can be retried.
            </p>
            <ListToolbar
              search={
                searchShown && (
                  <SearchInput
                    ref={box}
                    value={search}
                    onValueChange={v => {
                      setSearch(v);
                      setOffset(0);
                    }}
                    placeholder="Search blockers"
                    aria-label="Search blockers"
                    onBlur={() => {
                      setSearching(false);
                    }}
                  />
                )
              }
              segments={
                <Segments
                  aria-label="Cause"
                  value={cause ?? "all"}
                  onValueChange={v => {
                    setOffset(0);
                    setParams({ cause: v === "all" ? null : v });
                  }}
                  segments={[{ value: "all", label: "All", count: all.length }, ...counts.map(([c, n]) => ({ value: c, label: CAUSE[c], count: n }))]}
                />
              }
            />
          </>
        )
      }
      columns={rows.length > 0 && <ListColumns columns={COLUMNS} label="Application" cells={["Cause", "Status now", "When"]} trail="" />}
      footer={<Pagination variant="footer" noun="blockers" offset={offset} limit={PAGE} total={shown.length} onChange={setOffset} />}
      bodyLabel="Blockers"
    >
      {isPending ? (
        <SkeletonRows rows={6} lead={false} />
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
            size="sm"
            icon={<ShieldCheck />}
            title="Nothing has been blocked yet"
            description="When an application stops short of being sent, it shows here with the reason."
          />
        )
      ) : (
        rows
      )}
    </ListPanel>
  );
}
