// Review: the approval queue, worked like an inbox. On a desktop the queue and the open job sit side by
// side and J/K walks the queue; deciding a job opens the next in its place. On a phone the queue is the
// page and a job opens over it.
import { ArrowRight, Inbox, PanelRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { FilterMenu, GroupSegments, ListDetail, ListHeader, NoMatch, useOpenRecord } from "../../components/list";
import { Button, CompanyMark, EmptyState, Pagination, SearchInput, Select, SkeletonRows, TableGroup } from "../../components/ui";
import { useSummary } from "../../lib/api";
import { plural, unent } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { useMedia, WIDE } from "../../lib/media";
import { setParams } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { QueueRow } from "./queue-row";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Best fit" },
  { value: "company", label: "Company" },
] as const;

export function ReviewPage() {
  const wide = useMedia(WIDE);
  const lp = useListParams();
  const search = useRef<HTMLInputElement>(null);
  // Beside the queue a job is always open; on a phone the queue is the page until one is.
  const record = useOpenRecord({ base: "review", view: "review", lp, search, autoOpen: wide });
  const { data: list, query, openId } = record;
  const { data: summary } = useSummary();
  const threshold = summary?.threshold ?? null;

  if (list?.all === 0) return <AllClear />;

  const rows = record.rows;
  const byAge = !lp.group && (!lp.sort || lp.sort === "newest");
  const byCompany = lp.sort === "company";
  const groups = new Map(list?.groups.map(g => [g.key, g]));

  return (
    <ListDetail
      layout="column"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
      empty={
        list && (
          <EmptyState
            icon={<PanelRight />}
            title="No job open"
            description={
              list.total ? "Pick a job from the queue to see why it fits and decide on it." : "Nothing in the queue matches, so there is no job to open."
            }
            className="h-full"
          />
        )
      }
    >
      <section aria-label="Jobs to review" className="flex flex-col pb-24 lg:h-full lg:pb-0">
        <ListHeader
          title="Review"
          count={list?.all}
          noun="waiting for you"
          actions={
            <>
              <FilterMenu
                filters={list?.filters ?? []}
                active={lp.filters}
                onToggle={lp.toggleFilter}
                onClear={() => {
                  setParams({ filter: null, page: null });
                }}
              />
              <Select
                prefix="Sort"
                value={lp.sort ?? "newest"}
                onValueChange={v => {
                  lp.setSort(v === "newest" ? null : v);
                }}
                options={SORTS}
              />
            </>
          }
        >
          <SearchInput ref={search} value={lp.search} onValueChange={lp.setSearch} placeholder="Search title, company or place" aria-label="Search the queue" />
          {list && list.total > 0 && (
            <GroupSegments label="When the posting opened" groups={list.groups} value={lp.group} onChange={lp.setGroup} className="-mx-1 px-1" />
          )}
        </ListHeader>

        <div className="border-y border-border bg-surface lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:border-y-0">
          {!list ? (
            <SkeletonRows rows={10} />
          ) : rows.length === 0 ? (
            <NoMatch noun="jobs" q={lp.q} filtered={lp.filters.length > 0 || !!lp.group} onClear={lp.clear} />
          ) : (
            <div role="table" aria-label="Queue" aria-rowcount={list.total} className={query.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
              {rows.map((job, i) => {
                const prev = rows[i - 1],
                  next = rows[i + 1];
                // Sorted by company, an employer with several roles here gets a heading over them; one with a
                // single role stays an ordinary row, so the list is not half headings.
                const clustered = byCompany && (job.company === prev?.company || job.company === next?.company);
                let heading: ReactNode = null;
                if (byAge && job.group !== prev?.group) {
                  const g = groups.get(job.group);
                  heading = <TableGroup label={g?.label ?? job.group} {...(g ? { count: g.count } : {})} className="sticky top-12 z-10 bg-subtle lg:top-0" />;
                } else if (clustered && job.company !== prev?.company) heading = <CompanyHeading company={job.company} roles={job.companyCount} />;
                return (
                  <div key={job.id} className="contents">
                    {heading}
                    <QueueRow job={job} threshold={threshold} underCompany={clustered} link={record.rowProps(job.id)} />
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {list && (
          <Pagination
            offset={list.offset}
            limit={list.limit}
            total={list.total}
            onChange={record.setPage}
            className="px-4 lg:border-t lg:border-border lg:py-2.5"
          />
        )}
      </section>
    </ListDetail>
  );
}

// The heading over an employer's roles when the queue is sorted by company.
function CompanyHeading({ company, roles }: { company: string; roles: number }) {
  return (
    <div role="row" className="sticky top-12 z-10 flex h-11 lg:top-0 items-center gap-3 border-b border-border bg-subtle px-4">
      <CompanyMark name={company} />
      <span className="min-w-0 truncate text-sm font-medium text-fg">{unent(company)}</span>
      <span className="tabular shrink-0 text-xs text-fg-subtle">{roles} to review</span>
    </div>
  );
}

// Nothing to review: say so, and point at whatever else waits on the owner.
function AllClear() {
  const { data: s } = useSummary();
  const a = s?.attention;
  const pipeline = a ? a.confirmSubmit + a.manual + a.coverLetter + a.ambiguous + a.failed : 0;
  const next = [
    a?.questions ? (["#questions", `Answer ${plural(a.questions, "question")}`] as const) : null,
    pipeline ? (["#pipeline", `${plural(pipeline, "application")} in the pipeline need you`] as const) : null,
  ].filter(x => x !== null);
  return (
    <div className="flex min-h-[70dvh] items-center justify-center px-4 lg:min-h-dvh">
      <EmptyState
        icon={<Inbox />}
        title="You're all caught up"
        description="Nothing is waiting for approval. Jobs land here once they have been assessed and tailored."
        action={
          next.length > 0 && (
            <div className="flex flex-col items-center gap-2">
              {next.map(([to, label]) => (
                <Button key={to} asChild variant="secondary">
                  <a href={to}>
                    {label}
                    <ArrowRight />
                  </a>
                </Button>
              ))}
            </div>
          )
        }
      />
    </div>
  );
}
