// Pipeline: the automation at work. Every application past review and not yet sent, by stage, with
// what waits on the owner first.
import { ArrowRight, CircleCheck, MessageSquareText } from "lucide-react";
import { useRef } from "react";
import type { ListResult, ListRow } from "../../../src/api-types";
import type { Status } from "../../../src/status";
import { CompactRow, ListDetail, NoMatch, RoleCell, useOpenRecord } from "../../components/list";
import {
  Button,
  Callout,
  EmptyState,
  JobStatus,
  Page,
  PageHeader,
  Pagination,
  Score,
  SearchInput,
  Select,
  SkeletonRows,
  StatusLabel,
  Table,
  TableCell,
  TableHeader,
  TableRow,
  Time,
} from "../../components/ui";
import { useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { GATE } from "../../lib/labels";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { href, setParams } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { StageStrip, STAGES } from "./stages";

const STUCK = new Set(["needs_you", "questions", "failed"]);
// A score from before a job went back to be assessed again says nothing yet.
const UNASSESSED: readonly Status[] = ["triaged", "locating", "prepping"];
const COLUMNS = "minmax(0,1fr) 180px 112px 56px";
// Nothing in Assessing has a score yet.
const COLUMNS_UNSCORED = "minmax(0,1fr) 180px 112px";

// With no stage chosen, open on the first that holds anything: Needs you when it does.
const firstStage = (list: ListResult) => list.groups.find(g => g.count > 0)?.key ?? "needs_you";

// What the row waits on: the open gate when it waits on the owner, else its status.
const gateOf = (row: ListRow) => (row.group === "needs_you" ? row.gate : null);
function Stage({ row }: { row: ListRow }) {
  const gate = gateOf(row);
  return gate ? <StatusLabel tone="warning" label={GATE[gate]} /> : <JobStatus status={row.status} />;
}

// The time that matters in each stage: how long it has waited on the owner, when the agent last
// touched it, or when the posting appeared.
const timeOf = (group: string, row: ListRow) => (group === "assessing" ? row.opened_at : row.updated_at);
const TIME_HEADER: Record<string, string> = { applying: "Updated", assessing: "Found" };

const EMPTY: Record<string, readonly [title: string, description: string]> = {
  needs_you: ["Nothing needs you", "Applications pause here for a cover letter, a submit confirmation, or your hands in the browser."],
  questions: ["No applications waiting on answers", "When an application form asks something your profile can't answer, it waits here."],
  failed: ["Nothing has failed", "Applications that stop with an error land here, with the reason, to retry."],
  applying: ["Nothing is applying right now", "Approved jobs queue here, and the agent applies to them one at a time."],
  assessing: ["Nothing waiting to be assessed", "New postings are scored and their resume tailored here before they reach Review."],
};

const sortsFor = (group: string) => [
  ...(STUCK.has(group) ? [{ value: "default", label: "Longest waiting" }] : []),
  { value: STUCK.has(group) ? "newest" : "default", label: "Newest posting" },
  { value: "updated", label: "Recently updated" },
  { value: "score", label: "Best fit" },
];

export function PipelinePage() {
  const lp = useListParams();
  const { data: summary } = useSummary();
  const search = useRef<HTMLInputElement>(null);
  // A job opened by a link (the digest's, Questions', an old bookmark's) opens on its own stage and page, so
  // it is in the list beside it and J/K walk its neighbours.
  const record = useOpenRecord({ base: "pipeline", view: "pipeline", lp, search, defaultGroup: firstStage });
  const { data, rows, openId } = record;
  const group = record.group ?? "needs_you";
  // The list beside an open job has room for one fact under the time: the stage where the rows'
  // stages differ, else the score.
  const mixed = new Set(rows.map(r => gateOf(r) ?? r.status)).size > 1;

  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const compact = openId !== null && wide,
    columns = tablet && !compact;
  const current = data?.groups.find(g => g.key === group);
  const empty = EMPTY[group];
  const scored = group !== "assessing",
    grid = scored ? COLUMNS : COLUMNS_UNSCORED;

  return (
    <ListDetail
      layout="split"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      <Page width={compact ? "full" : "default"} className={cn(compact && "sm:px-4 lg:pb-0")}>
        <PageHeader title="Pipeline" description={compact ? undefined : "Applications the agent is working on, and the ones paused until you act."}>
          <StageStrip
            counts={data ? new Map(data.groups.map(g => [g.key, g.count])) : null}
            value={group}
            compact={compact}
            onSelect={key => {
              setParams({ group: key, page: null, sort: null });
            }}
          />
        </PageHeader>

        <div className="mb-3 flex items-center gap-2">
          <SearchInput
            ref={search}
            value={lp.search}
            onValueChange={lp.setSearch}
            placeholder={tablet ? `Search ${((compact ? STAGES[group]?.short : STAGES[group]?.label) ?? "this stage").toLowerCase()}` : "Search"}
            aria-label="Search this stage"
            className={cn("min-w-0", compact ? "flex-1" : "w-full sm:w-72")}
          />
          {!compact && (
            <Select
              prefix="Sort"
              value={lp.sort ?? "default"}
              onValueChange={v => {
                lp.setSort(v === "default" ? null : v);
              }}
              options={sortsFor(group)}
              className="ml-auto shrink-0"
            />
          )}
        </div>

        {group === "questions" && !!current?.count && !compact && (
          <Callout
            icon={<MessageSquareText />}
            className="mb-3"
            action={
              <Button asChild size="sm">
                <a href={href("questions")}>
                  Open Questions
                  <ArrowRight />
                </a>
              </Button>
            }
          >
            {tablet
              ? "Each is paused on a question from its application form. One answer in Questions resumes every application that asked it."
              : "Answer these in Questions."}
          </Callout>
        )}

        <Table className={cn("transition-opacity", record.query.isPlaceholderData && "opacity-60", compact && "-mx-4 rounded-none border-x-0 shadow-none")}>
          {columns && (
            <TableHeader columns={grid}>
              <span>Role</span>
              <span>Stage</span>
              <span>{TIME_HEADER[group] ?? "Waiting since"}</span>
              {scored && <span className="text-right">Fit</span>}
            </TableHeader>
          )}
          {!data ? (
            <SkeletonRows rows={8} />
          ) : rows.length === 0 ? (
            lp.q ? (
              <NoMatch
                noun="jobs"
                q={lp.q}
                filtered={false}
                onClear={() => {
                  lp.setSearch("");
                }}
              />
            ) : (
              <EmptyState icon={<CircleCheck />} title={empty?.[0] ?? "Nothing here"} description={empty?.[1]} />
            )
          ) : (
            rows.map(r => {
              const at = timeOf(group, r),
                score = UNASSESSED.includes(r.status) ? null : r.score;
              return columns ? (
                <TableRow key={r.id} columns={grid} {...record.rowProps(r.id)}>
                  <RoleCell row={r} />
                  <TableCell>
                    <Stage row={r} />
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    <Time at={at} />
                  </TableCell>
                  {scored && (
                    <TableCell className="text-right">
                      <Score value={score} threshold={summary?.threshold ?? null} />
                    </TableCell>
                  )}
                </TableRow>
              ) : (
                <CompactRow
                  key={r.id}
                  row={r}
                  link={record.rowProps(r.id)}
                  top={<Time at={at} />}
                  bottom={mixed ? <Stage row={r} /> : score != null && <Score value={score} threshold={summary?.threshold ?? null} />}
                />
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
