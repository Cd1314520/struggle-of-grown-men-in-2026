// Applications: everything sent, as a CRM. Whose move it is on each, what came back, and the
// numbers that say how the search is going.
import { Inbox } from "lucide-react";
import { Fragment, useRef } from "react";
import type { ListRow as Row, Summary } from "../../../src/api-types";
import {
  CompanyMark,
  EmptyState,
  JobStatus,
  ListColumns,
  ListGroup,
  ListPanel,
  ListRow,
  ListToolbar,
  Narrow,
  Page,
  PageHeader,
  Pagination,
  SearchInput,
  Segments,
  Select,
  SkeletonRows,
  StatRow,
  Time,
} from "../../components/ui";
import { ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import { useSummary } from "../../lib/api";
import { date, plain, unent, withoutCompany } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { JobDetail } from "../job/detail";
import { NextLabel, NextPhrase } from "./next-step";

// No reply yet and Closed have no next step to show.
const NO_STEPS = new Set(["no_reply", "closed"]);
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

// The search in five numbers, under the title on a desktop (Overview has them for a phone). Reply rate
// counts any reply, a no included: it says whether applications are being read. `counts` is undefined
// while loading.
function Kpis({ counts }: { counts: Summary["counts"] | undefined }) {
  const n = (s: string) => counts?.[s] ?? 0,
    show = (v: number) => (counts ? v.toLocaleString() : "–");
  const sent = n("submitted") + n("interview") + n("offer") + n("rejected_by_company") + n("withdrawn"),
    replied = n("interview") + n("offer") + n("rejected_by_company");
  return (
    <StatRow
      items={[
        { label: "Sent", value: show(sent) },
        { label: "In process", value: show(n("interview")) },
        {
          label: "Reply rate",
          value: sent ? `${Math.round((replied / sent) * 100)}%` : "–",
          ...(sent ? { hint: `${replied.toLocaleString()} of ${sent.toLocaleString()} replied` } : {}),
        },
        { label: "Declined", value: show(n("rejected_by_company")) },
        { label: "Offers", value: show(n("offer")) },
      ]}
    />
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
  const compact = openId !== null && wide;

  const groups = data?.groups ?? [];
  const segments = [
    { value: "all", label: "All", count: groups.reduce((t, g) => t + g.count, 0) },
    ...groups
      .filter(g => g.key !== "offer" || g.count > 0)
      .map(g => ({ value: g.key, label: g.label, count: g.count, tone: g.key === "your_move" ? ("warning" as const) : undefined })),
  ];
  const segment = lp.group ?? "all";
  // With every segment shown in its natural order, each group gets a heading where it starts.
  const headed = !lp.group && !lp.sort;
  const labelOf = new Map(groups.map(g => [g.key, g]));
  const empty = EMPTY[segment];
  // The status is a fact of the row only where the rows' statuses differ: the same on every row, it is the
  // segment's to say. Grouped, each group decides for its own rows, so Your move and Waiting on them, in
  // process throughout, do not repeat it beside a Closed that mixes declined and withdrawn.
  const varied = (rs: readonly Row[]) => new Set(rs.map(r => r.status)).size > 1;
  const byGroup = new Map(groups.map(g => [g.key, varied(rows.filter(r => r.group === g.key))]));
  const flat = varied(rows);
  const statusOf = (r: Row) => (headed ? (byGroup.get(r.group) ?? false) : flat);
  const statuses = rows.some(statusOf);
  const steps = !NO_STEPS.has(segment);
  const columns = [steps && "minmax(0,1.4fr)", "88px", statuses && "112px"].filter(Boolean).join(" ");

  const panel = (
    <ListPanel
      frame={compact ? "column" : "page"}
      // Beside an open job the column is the page, so it takes the page's name; on its own the panel names the
      // segment. A phone's selected segment already reads the same, with its count, right under it.
      title={compact ? "Applications" : !tablet ? undefined : segment === "all" ? "All applications" : (labelOf.get(segment)?.label ?? "Applications")}
      count={compact ? data?.all : tablet ? data?.total : undefined}
      aria-label="Sent applications"
      bodyLabel="Applications"
      aria-rowcount={data?.total}
      loading={record.query.isPlaceholderData}
      toolbar={
        <ListToolbar
          search={
            <SearchInput
              ref={search}
              value={lp.search}
              onValueChange={lp.setSearch}
              placeholder={tablet && !compact ? "Search role or company" : "Search"}
              aria-label="Search applications"
            />
          }
          controls={
            <Select
              prefix="Sort"
              collapse
              value={lp.sort ?? "default"}
              onValueChange={v => {
                lp.setSort(v === "default" ? null : v);
              }}
              options={SORTS}
            />
          }
          segments={
            <Segments
              aria-label="Segments"
              value={segment}
              onValueChange={v => {
                lp.setGroup(v === "all" ? null : v);
              }}
              segments={segments}
            />
          }
        />
      }
      columns={
        rows.length > 0 && (
          <ListColumns
            columns={columns}
            lead
            label="Role"
            cells={[steps && "Next step", "Applied", statuses && "Status"].filter(Boolean)}
            trail={segment === "closed" ? "Closed" : "Updated"}
          />
        )
      }
      footer={data && <Pagination variant="footer" noun="applications" offset={data.offset} limit={data.limit} total={data.total} onChange={record.setPage} />}
    >
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
          <EmptyState size="sm" icon={<Inbox />} title={empty?.[0] ?? "Nothing here"} description={empty?.[1]} />
        )
      ) : (
        rows.map((r, i) => {
          const group = headed && r.group !== rows[i - 1]?.group ? labelOf.get(r.group) : undefined;
          const sent = r.submitted_at ?? r.updated_at;
          return (
            <Fragment key={r.id}>
              {group && <ListGroup label={group.label} count={group.count} />}
              <ListRow
                {...record.rowProps(r.id)}
                lead={<CompanyMark name={r.company} />}
                title={unent(r.title)}
                secondary={
                  <>
                    <span>{unent(r.company)}</span>
                    {statusOf(r) && (
                      <Narrow>
                        <JobStatus status={r.status} />
                      </Narrow>
                    )}
                  </>
                }
                // What to do next, in words, where a row has no column for it: whose move and when, then the step.
                snippet={
                  r.next && (
                    <Narrow>
                      <NextPhrase next={r.next} className="mr-2 font-medium" />
                      <span title={plain(r.next.label)}>{withoutCompany(plain(r.next.label), r.company)}</span>
                    </Narrow>
                  )
                }
                trail={<Time at={r.updated_at} short />}
                columns={columns}
                cells={[
                  steps &&
                    (r.next ? (
                      <>
                        <NextLabel next={r.next} company={r.company} className="text-fg" />
                        <NextPhrase next={r.next} />
                      </>
                    ) : (
                      <span className="text-fg-subtle">–</span>
                    )),
                  <span className="tabular">{date(sent)}</span>,
                  statuses && (statusOf(r) ? <JobStatus status={r.status} /> : <span className="text-fg-subtle">–</span>),
                ].filter(Boolean)}
              />
            </Fragment>
          );
        })
      )}
    </ListPanel>
  );

  return (
    <ListDetail
      layout="split"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      {compact ? (
        panel
      ) : (
        <Page>
          <PageHeader title="Applications" description="Everything you've sent, and whose move it is on each." descriptionOnPhone={false}>
            {wide && <Kpis counts={summary?.counts} />}
          </PageHeader>
          {panel}
        </Page>
      )}
    </ListDetail>
  );
}
