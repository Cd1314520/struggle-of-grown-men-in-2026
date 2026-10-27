// Review: the approval queue, worked like an inbox. On a desktop the queue and the open job sit side by
// side and J/K walks the queue; deciding a job opens the next in its place. On a phone the queue is the
// page and a job opens over it.
import { ArrowRight, Inbox, PanelRight } from "lucide-react";
import { useRef, type ReactNode } from "react";
import { FilterMenu, GroupSegments, ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import { Button, CompanyMark, EmptyState, ListGroup, Pagination, SearchInput, Select, SkeletonRows, Workspace } from "../../components/ui";
import { useSummary } from "../../lib/api";
import { plural, unent } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { setParams } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { QueueRow } from "./queue-row";
import { thresholdOf } from "../job/model";

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "score", label: "Best fit" },
  { value: "company", label: "Company" },
] as const;

export function ReviewPage() {
  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const lp = useListParams();
  const search = useRef<HTMLInputElement>(null);
  // Beside the queue a job is always open; on a phone the queue is the page until one is.
  const record = useOpenRecord({ base: "review", view: "review", lp, search, autoOpen: wide });
  const { data: list, query, openId } = record;
  const { data: summary } = useSummary();

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
      {/* The queue is always the column. A phone's has no count line: the tab bar's badge and the All segment
          count it, so the queue starts right under the search. The bar's h1 stays for screen readers. */}
      <Workspace
        frame="column"
        aria-label="Jobs to review"
        bodyRole="table"
        bodyLabel="Queue"
        aria-rowcount={list?.total}
        loading={query.isPlaceholderData}
        bar={{
          title: "Review",
          count: list?.all,
          ...(tablet && { noun: "waiting for you" }),
          search: (
            <SearchInput
              ref={search}
              value={lp.search}
              onValueChange={lp.setSearch}
              // A phone's box, beside Filter and Sort, has room for the word alone.
              placeholder={tablet ? "Search title, company or place" : "Search"}
              aria-label="Search the queue"
            />
          ),
          controls: (
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
                collapse
                value={lp.sort ?? "newest"}
                onValueChange={v => {
                  lp.setSort(v === "newest" ? null : v);
                }}
                options={SORTS}
              />
            </>
          ),
          segments: list && list.total > 0 && <GroupSegments label="When the posting opened" groups={list.groups} value={lp.group} onChange={lp.setGroup} />,
        }}
        footer={list && <Pagination variant="footer" noun="jobs" offset={list.offset} limit={list.limit} total={list.total} onChange={record.setPage} />}
      >
        {!list ? (
          <SkeletonRows rows={10} />
        ) : rows.length === 0 ? (
          <NoMatch noun="jobs" q={lp.q} filtered={lp.filters.length > 0 || !!lp.group} onClear={lp.clear} />
        ) : (
          rows.map((job, i) => {
            const prev = rows[i - 1],
              next = rows[i + 1];
            // Sorted by company, an employer with several roles here gets a heading over them; one with a
            // single role stays an ordinary row, so the list is not half headings.
            const clustered = byCompany && (job.company === prev?.company || job.company === next?.company);
            let heading: ReactNode = null;
            if (byAge && job.group !== prev?.group) {
              const g = groups.get(job.group);
              heading = <ListGroup label={g?.label ?? job.group} count={g?.count} />;
            } else if (clustered && job.company !== prev?.company)
              heading = (
                <ListGroup
                  // The mark sits over the rows' lead, so the name lines up with the titles under it.
                  lead={
                    <span className="mr-1 flex w-8 shrink-0 justify-center">
                      <CompanyMark name={job.company} size="sm" />
                    </span>
                  }
                  label={unent(job.company)}
                  hint={`${job.companyCount} to review`}
                />
              );
            return (
              <div key={job.id} className="contents">
                {heading}
                <QueueRow job={job} threshold={thresholdOf(job.rubric, summary)} underCompany={clustered} link={record.rowProps(job.id)} />
              </div>
            );
          })
        )}
      </Workspace>
    </ListDetail>
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
    <div className="flex min-h-[70dvh] items-center justify-center px-4 lg:min-h-(--app-h)">
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
