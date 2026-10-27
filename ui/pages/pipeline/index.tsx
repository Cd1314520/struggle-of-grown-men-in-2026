// Pipeline: the automation at work. Every application past review and not yet sent, by stage, with
// what waits on the owner first.
import { ArrowRight, CircleCheck, MessageSquareText } from "lucide-react";
import { useRef } from "react";
import type { ListResult, ListRow as Row } from "../../../src/api-types";
import type { Status } from "../../../src/status";
import { ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import {
  Button,
  CompanyMark,
  EmptyState,
  JobStatus,
  ListNotice,
  ListRow,
  Pagination,
  SearchInput,
  Segments,
  Select,
  SkeletonRows,
  StatusLabel,
  Time,
  Workspace,
} from "../../components/ui";
import { useSummary } from "../../lib/api";
import { place, unent } from "../../lib/format";
import { GATE } from "../../lib/labels";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { href, setParams } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { FitFact } from "../job/fit";
import { stageSegments, STAGES } from "./stages";

const STUCK = new Set(["needs_you", "questions", "failed"]);
// A score from before a job went back to be assessed again says nothing yet.
const UNASSESSED: readonly Status[] = ["triaged", "locating", "prepping"];

// With no stage chosen, open on the first that holds anything: Needs you when it does.
const firstStage = (list: ListResult) => list.groups.find(g => g.count > 0)?.key ?? "needs_you";

// What the row waits on: the open gate when it waits on the owner, else its status.
const gateOf = (row: Row) => (row.group === "needs_you" ? row.gate : null);
function Stage({ row }: { row: Row }) {
  const gate = gateOf(row);
  return gate ? <StatusLabel tone="warning" label={GATE[gate]} /> : <JobStatus status={row.status} />;
}

// The time that matters in each stage: how long it has waited on the owner, when the agent last
// touched it, or when the posting appeared.
const timeOf = (group: string, row: Row) => (group === "assessing" ? row.opened_at : row.updated_at);

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
  const stage = STAGES[group];
  // The stage is a fact of the row only where the rows' stages differ (Needs you's gates); else the
  // panel's title already says it.
  const mixed = new Set(rows.map(r => gateOf(r) ?? r.status)).size > 1;

  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const compact = openId !== null && wide;
  const current = data?.groups.find(g => g.key === group);
  const empty = EMPTY[group];
  const threshold = summary?.threshold ?? null;
  // Nothing in Assessing has a score yet: its fact is how long it has been there. Sorted longest waiting,
  // a stage paused on the owner says for how long instead of the fit.
  const scored = group !== "assessing";
  const waiting = (group === "needs_you" || group === "questions") && !lp.sort;

  const panel = (
    <Workspace
      frame={compact ? "column" : "page"}
      aria-label="Applications in the pipeline"
      bodyRole="table"
      bodyLabel={stage?.label ?? "Applications"}
      aria-rowcount={data?.total}
      loading={record.query.isPlaceholderData}
      bar={{
        title: "Pipeline",
        count: data?.all,
        hint: "Applications the agent is working on, and the ones paused until you act.",
        search: (
          <SearchInput
            ref={search}
            value={lp.search}
            onValueChange={lp.setSearch}
            placeholder={tablet ? `Search ${((compact ? stage?.short : stage?.label) ?? "this stage").toLowerCase()}` : "Search"}
            aria-label="Search this stage"
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
            options={sortsFor(group)}
          />
        ),
        segments: (
          <Segments
            aria-label="Stages"
            value={group}
            onValueChange={key => {
              setParams({ group: key, page: null, sort: null });
            }}
            segments={stageSegments(data ? new Map(data.groups.map(g => [g.key, g.count])) : null)}
          />
        ),
      }}
      notice={
        group === "questions" &&
        !!current?.count && (
          // A narrow list has room for the link alone, which then says it all.
          <ListNotice
            icon={<MessageSquareText />}
            {...(tablet &&
              !compact && {
                action: (
                  <Button asChild size="sm" variant="link" className="px-0 touch:px-0">
                    <a href={href("questions")}>
                      Open Questions
                      <ArrowRight />
                    </a>
                  </Button>
                ),
              })}
          >
            {tablet && !compact ? (
              "Each is paused on a question from its application form. One answer in Questions resumes every application that asked it."
            ) : (
              <Button asChild size="sm" variant="link" className="px-0 touch:px-0">
                <a href={href("questions")}>
                  Answer these in Questions
                  <ArrowRight />
                </a>
              </Button>
            )}
          </ListNotice>
        )
      }
      footer={data && <Pagination variant="footer" noun="applications" offset={data.offset} limit={data.limit} total={data.total} onChange={record.setPage} />}
    >
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
          <EmptyState icon={<CircleCheck />} title={empty?.[0] ?? "Nothing here"} description={empty?.[1]} className="pt-24" />
        )
      ) : (
        rows.map(r => {
          const at = timeOf(group, r),
            score = UNASSESSED.includes(r.status) ? null : r.score;
          return (
            <ListRow
              key={r.id}
              {...record.rowProps(r.id)}
              lead={<CompanyMark name={r.company} />}
              title={unent(r.title)}
              secondary={unent(r.company)}
              // What it waits on where the stages differ (Needs you's gates); else where it is.
              gist={mixed ? <Stage row={r} /> : !!r.location?.trim() && <span title={r.location}>{place(r.location)}</span>}
              fact={waiting ? <Time at={at} short prefix="Waiting " /> : scored ? <FitFact value={score} threshold={threshold} /> : <Time at={at} short />}
            />
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
      {panel}
    </ListDetail>
  );
}
