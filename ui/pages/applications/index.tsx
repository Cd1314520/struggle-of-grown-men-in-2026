// Applications: everything sent, as a CRM. Whose move it is on each, what came back, and the
// numbers that say how the search is going.
import { Inbox } from "lucide-react";
import { Fragment, useRef } from "react";
import type { Summary } from "../../../src/api-types";
import {
  EmptyState,
  JobStatus,
  Page,
  PageHeader,
  Pagination,
  SearchInput,
  Segments,
  Select,
  SkeletonRows,
  Stat,
  Table,
  TableCell,
  TableGroup,
  TableHeader,
  TableRow,
  Time,
} from "../../components/ui";
import { CompactRow, ListDetail, NoMatch, RoleCell, useOpenRecord } from "../../components/list";
import { useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { date } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { JobDetail } from "../job/detail";
import { NextLabel, NextPhrase } from "./next-step";

const COLUMNS = "minmax(0,1.15fr) 112px minmax(0,1fr) 84px 84px";
// No reply yet and Closed have no next step to show.
const NO_STEPS = new Set(["no_reply", "closed"]);
const COLUMNS_NO_STEPS = "minmax(0,1fr) 140px 120px 120px";
const SORTS = [
  { value: "default", label: "Next step" },
  { value: "sent", label: "Recently sent" },
  { value: "updated", label: "Recently updated" },
  { value: "company", label: "Company" },
];
const EMPTY: Record<string, readonly [title: string, description: string]> = {
  all: ["No applications sent yet", "Applications show up here once they are submitted."],
  offer: ["No offers yet", "Mark an application as an offer from its Next steps."],
  your_move: ["Nothing waiting on you", "When an employer asks for something, an assessment or a time to talk, it lands here."],
  upcoming: ["Nothing booked", "Interviews and calls with a time show up here."],
  waiting: ["Not waiting on anyone", "Applications where you've done your part and the employer owes a reply."],
  no_reply: ["Every application has had a reply", "Applications with no word back yet wait here."],
  closed: ["Nothing closed", "Declined and withdrawn applications move here."],
};

// The search in five numbers. Reply rate counts any reply, a no included: it says whether
// applications are being read. A phone shows the first three; `counts` is undefined while loading.
function Kpis({ counts, hints }: { counts: Summary["counts"] | undefined; hints: boolean }) {
  const n = (s: string) => counts?.[s] ?? 0,
    show = (v: number) => (counts ? v.toLocaleString() : "–");
  const sent = n("submitted") + n("interview") + n("offer") + n("rejected_by_company") + n("withdrawn"),
    replied = n("interview") + n("offer") + n("rejected_by_company");
  const items = [
    ["Sent", show(sent), null],
    ["In process", show(n("interview")), null],
    // While loading, an empty caption keeps the strip the height it will have.
    [
      "Reply rate",
      sent ? `${Math.round((replied / sent) * 100)}%` : "–",
      sent ? `${replied.toLocaleString()} of ${sent.toLocaleString()} replied` : counts ? null : " ",
    ],
    ["Declined", show(n("rejected_by_company")), null],
    ["Offers", show(n("offer")), null],
  ] as const;
  return (
    <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs sm:grid-cols-5">
      {items.map(([label, value, hint], i) => (
        <Stat
          key={label}
          label={label}
          value={value}
          hint={hints ? hint : null}
          className={cn("bg-surface px-3 pt-3 pb-3.5 sm:px-4 sm:pt-3.5 sm:pb-4", i > 2 && "hidden sm:flex")}
        />
      ))}
    </div>
  );
}

export function ApplicationsPage() {
  const lp = useListParams();
  const { data: summary } = useSummary();
  const search = useRef<HTMLInputElement>(null);
  // Recording an outcome moves the application to Closed, often on a later page; it stays open so the
  // owner sees what they just did rather than the next application.
  const record = useOpenRecord({ base: "applications", view: "applications", lp, search, advance: false });
  const { data, rows, openId } = record;
  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const compact = openId !== null && wide,
    columns = tablet && !compact;

  const groups = data?.groups ?? [];
  const segments = [
    { value: "all", label: "All", count: groups.reduce((t, g) => t + g.count, 0) },
    ...groups
      .filter(g => g.key !== "offer" || g.count > 0)
      .map(g => ({ value: g.key, label: g.label, count: g.count, tone: g.key === "your_move" ? ("warning" as const) : undefined })),
  ];
  const segment = lp.group ?? "all";
  const setSegment = (v: string) => {
    lp.setGroup(v === "all" ? null : v);
  };
  // With every segment shown in its natural order, each group gets a heading where it starts.
  const headed = !lp.group && !lp.sort;
  const labelOf = new Map(groups.map(g => [g.key, g]));
  const empty = EMPTY[segment];
  const steps = !NO_STEPS.has(segment),
    grid = steps ? COLUMNS : COLUMNS_NO_STEPS;

  return (
    <ListDetail
      layout="split"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      <Page width={compact ? "full" : "default"} className={cn(compact && "sm:px-4 lg:pb-0")}>
        <PageHeader title="Applications" description={compact ? undefined : "Everything you've sent, and whose move it is on each."}>
          {!compact && <Kpis counts={summary?.counts} hints={tablet} />}
        </PageHeader>

        {compact ? (
          <div className="mb-3 flex items-center gap-2">
            <Select
              aria-label="Segments"
              value={segment}
              onValueChange={setSegment}
              options={segments.map(s => ({
                value: s.value,
                label: (
                  <span className="flex items-center gap-2">
                    {s.label}
                    <span className="tabular text-fg-subtle">{s.count.toLocaleString()}</span>
                  </span>
                ),
              }))}
            />
            <SearchInput
              ref={search}
              value={lp.search}
              onValueChange={lp.setSearch}
              placeholder="Search"
              aria-label="Search applications"
              className="min-w-0 flex-1"
            />
          </div>
        ) : (
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
            <Segments aria-label="Segments" value={segment} onValueChange={setSegment} segments={segments} className="-mx-4 px-4 md:mx-0 md:flex-1 md:px-0" />
            <div className="flex items-center gap-2">
              <SearchInput
                ref={search}
                value={lp.search}
                onValueChange={lp.setSearch}
                placeholder={tablet ? "Search role or company" : "Search"}
                aria-label="Search applications"
                className="min-w-0 flex-1 md:w-60 md:flex-none"
              />
              <Select
                prefix="Sort"
                value={lp.sort ?? "default"}
                onValueChange={v => {
                  lp.setSort(v === "default" ? null : v);
                }}
                options={SORTS}
                className="shrink-0"
              />
            </div>
          </div>
        )}

        <Table className={cn("transition-opacity", record.query.isPlaceholderData && "opacity-60", compact && "-mx-4 rounded-none border-x-0 shadow-none")}>
          {columns && (
            <TableHeader columns={grid}>
              <span>Role</span>
              <span>Status</span>
              {steps && <span>Next step</span>}
              <span>Applied</span>
              <span>{segment === "closed" ? "Closed" : "Updated"}</span>
            </TableHeader>
          )}
          {!data ? (
            <SkeletonRows rows={8} />
          ) : rows.length === 0 ? (
            lp.q ? (
              <NoMatch
                noun="applications"
                q={lp.q}
                filtered={false}
                onClear={() => {
                  lp.setSearch("");
                }}
              />
            ) : (
              <EmptyState icon={<Inbox />} title={empty?.[0] ?? "Nothing here"} description={empty?.[1]} />
            )
          ) : (
            rows.map((r, i) => {
              const group = headed && r.group !== rows[i - 1]?.group ? labelOf.get(r.group) : undefined;
              const sent = r.submitted_at ?? r.updated_at;
              return (
                <Fragment key={r.id}>
                  {group && <TableGroup label={group.label} count={group.count} />}
                  {columns ? (
                    <TableRow columns={grid} {...record.rowProps(r.id)}>
                      <RoleCell row={r} />
                      <TableCell>
                        <JobStatus status={r.status} />
                      </TableCell>
                      {steps && (
                        <TableCell>
                          {r.next ? (
                            <>
                              <NextLabel next={r.next} company={r.company} className="text-fg" />
                              <NextPhrase next={r.next} />
                            </>
                          ) : (
                            <span className="text-fg-subtle">–</span>
                          )}
                        </TableCell>
                      )}
                      <TableCell className="tabular text-fg-muted">{date(sent)}</TableCell>
                      <TableCell className="text-fg-muted">
                        <Time at={r.updated_at} />
                      </TableCell>
                    </TableRow>
                  ) : (
                    <CompactRow
                      row={r}
                      link={record.rowProps(r.id)}
                      top={r.next ? <NextPhrase next={r.next} /> : <Time at={sent} />}
                      bottom={<JobStatus status={r.status} />}
                    />
                  )}
                </Fragment>
              );
            })
          )}
        </Table>
        {data && (
          <Pagination
            offset={data.offset}
            limit={data.limit}
            total={data.total}
            onChange={record.setPage}
            className={cn(compact && "sticky bottom-0 -mx-4 border-t border-border bg-surface px-4")}
          />
        )}
      </Page>
    </ListDetail>
  );
}
