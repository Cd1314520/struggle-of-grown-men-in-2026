import { Inbox } from "lucide-react";
import { Fragment, useRef } from "react";
import type { Summary } from "../../../src/api-types";
import {
  CompanyMark,
  EmptyState,
  JobStatus,
  ListGroup,
  ListRow,
  Pagination,
  SearchInput,
  Segments,
  Select,
  SkeletonRows,
  Time,
  Workspace,
  WorkspaceStrip,
} from "../../components/ui";
import { ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import { useSummary } from "../../lib/api";
import { date, place, unent } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { useMedia, WIDE } from "../../lib/media";
import { JobDetail } from "../job/detail";
import { NextLabel, NextPhrase } from "./next-step";

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

function Kpis({ counts }: { counts: Summary["counts"] | undefined }) {
  const n = (s: string) => counts?.[s] ?? 0,
    show = (v: number) => (counts ? v.toLocaleString() : "–");
  const sent = n("submitted") + n("interview") + n("offer") + n("rejected_by_company") + n("withdrawn"),
    replied = n("interview") + n("offer") + n("rejected_by_company");
  return (
    <WorkspaceStrip
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
  const record = useOpenRecord({ base: "applications", view: "applications", lp, search, advance: false });
  const { data, rows, openId } = record;
  const wide = useMedia(WIDE);
  const compact = openId !== null && wide;

  const groups = data?.groups ?? [];
  const segments = [
    { value: "all", label: "All", count: groups.reduce((t, g) => t + g.count, 0) },
    ...groups
      .filter(g => g.key !== "offer" || g.count > 0)
      .map(g => ({ value: g.key, label: g.label, count: g.count, tone: g.key === "your_move" ? ("warning" as const) : undefined })),
  ];
  const segment = lp.group ?? "all";
  const headed = !lp.group && !lp.sort;
  const labelOf = new Map(groups.map(g => [g.key, g]));
  const empty = EMPTY[segment];

  const list = (
    <Workspace
      frame={compact ? "column" : "page"}
      aria-label="Sent applications"
      bodyRole="table"
      bodyLabel="Applications"
      aria-rowcount={data?.total}
      loading={record.query.isPlaceholderData}
      bar={{
        title: "Applications",
        count: data?.all,
        hint: "Everything you've sent, and whose move it is on each.",
        search: (
          <SearchInput
            ref={search}
            value={lp.search}
            onValueChange={lp.setSearch}
            placeholder={wide && !compact ? "Search role or company" : "Search"}
            aria-label="Search applications"
          />
        ),
        controls: (
          <Select
            prefix="Sort"
            collapse
            value={lp.sort ?? "default"}
            onValueChange={v => {
              lp.setSort(v === "default" ? null : v);
            }}
            options={SORTS}
          />
        ),
        segments: (
          <Segments
            aria-label="Segments"
            value={segment}
            onValueChange={v => {
              lp.setGroup(v === "all" ? null : v);
            }}
            segments={segments}
          />
        ),
      }}
      strip={wide && !compact && <Kpis counts={summary?.counts} />}
      footer={data && <Pagination variant="footer" noun="applications" offset={data.offset} limit={data.limit} total={data.total} onChange={record.setPage} />}
    >
      {!data ? (
        <SkeletonRows rows={10} />
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
          <EmptyState icon={<Inbox />} title={empty?.[0] ?? "Nothing here"} description={empty?.[1]} className="pt-24" />
        )
      ) : (
        rows.map((r, i) => {
          const group = headed && r.group !== rows[i - 1]?.group ? labelOf.get(r.group) : undefined;
          const sent = r.submitted_at ?? r.updated_at;
          const closed = r.group === "closed";
          return (
            <Fragment key={r.id}>
              {group && <ListGroup label={group.label} count={group.count} />}
              <ListRow
                {...record.rowProps(r.id)}
                lead={<CompanyMark name={r.company} />}
                title={unent(r.title)}
                secondary={unent(r.company)}
                gist={
                  r.next ? (
                    <NextLabel next={r.next} company={r.company} />
                  ) : closed ? (
                    `Applied ${date(sent)}`
                  ) : (
                    r.location && <span title={r.location}>{place(r.location)}</span>
                  )
                }
                fact={r.next ? <NextPhrase next={r.next} short /> : closed ? <JobStatus status={r.status} /> : <Time at={sent} short prefix="Sent " />}
              />
            </Fragment>
          );
        })
      )}
    </Workspace>
  );

  return (
    <ListDetail
      layout="split"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      {list}
    </ListDetail>
  );
}
