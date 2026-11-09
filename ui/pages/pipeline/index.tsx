import { ArrowRight, CircleCheck, MessageSquareText, Send } from "lucide-react";
import { useRef } from "react";
import type { ListResult, ListRow as Row } from "../../../src/api-types";
import { ASSESSING } from "../../../src/status";
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
import { cap, place, unent } from "../../lib/format";
import { GATE } from "../../lib/labels";
import { useListParams } from "../../lib/list-params";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { href, setParams } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { FitFact } from "../job/fit";
import { ATTENTION, stageSegments, STAGES } from "./stages";
import { thresholdOf } from "../job/model";

const STUCK = new Set(["needs_you", "questions", "failed"]);

const firstStage = (list: ListResult) => Object.keys(STAGES).find(key => list.groups.some(g => g.key === key && g.count > 0)) ?? "needs_you";

const askOf = (row: Row) => {
  if (!row.pending) return null;
  try {
    const p: unknown = JSON.parse(row.pending);
    if (!p || typeof p !== "object") return null;
    const { text, context, kind, state } = p as Record<string, unknown>;
    if (state !== undefined && state !== "open") return null;
    const ask = kind === "submission_ambiguous" && typeof context === "string" && context.trim() ? context : text;
    return typeof ask === "string" && ask.trim() ? ask.trim() : null;
  } catch {
    return null;
  }
};

const splitNote = (note: string) => {
  const at = note.indexOf(":");
  return at > 0 ? [cap(note.slice(0, at).trim()), note.slice(at + 1).trim()] : [cap(note.trim()), ""];
};

const gateOf = (row: Row) => (row.group === "needs_you" ? row.gate : null);
function Stage({ row }: { row: Row }) {
  const gate = gateOf(row);
  return gate ? <StatusLabel tone="warning" label={GATE[gate]} /> : <JobStatus status={row.status} />;
}

const timeOf = (group: string, row: Row) => (group === "assessing" ? row.opened_at : row.updated_at);

const EMPTY: Record<string, string> = {
  needs_you: "Nothing needs you",
  questions: "No applications waiting on answers",
  failed: "Nothing has failed",
  applying: "Nothing is applying right now",
  assessing: "Nothing waiting to be assessed",
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
  const record = useOpenRecord({ base: "pipeline", view: "pipeline", lp, search, defaultGroup: firstStage });
  const { data, rows, openId } = record;
  const group = record.group ?? "needs_you";
  const stage = STAGES[group];
  const mixed = new Set(rows.map(r => gateOf(r) ?? r.status)).size > 1;

  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const compact = openId !== null && wide;
  const current = data?.groups.find(g => g.key === group);
  const scored = group !== "assessing";
  const waiting = STUCK.has(group) && lp.sort !== "score";
  const attention = data?.groups.filter(g => ATTENTION.includes(g.key)).reduce((n, g) => n + g.count, 0);
  const awaiting = summary?.counts["awaiting_approval"] ?? 0;
  const idle =
    group !== "applying"
      ? null
      : awaiting > 0 && !summary?.autoApply.enabled
        ? `${awaiting.toLocaleString()} ${awaiting === 1 ? "job is" : "jobs are"} waiting for your approval in Review; auto-apply is off.`
        : summary?.targets.holdBack
          ? `Targets are held back: ${summary.targets.describe}`
          : null;

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
        count: attention,
        ...(tablet && { noun: "need you" }),
        search: (
          <SearchInput
            ref={search}
            value={lp.search}
            onValueChange={lp.setSearch}
            placeholder={tablet ? `Search ${(stage?.short ?? "this stage").toLowerCase()}` : "Search"}
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
            segments={stageSegments(data ? new Map(data.groups.map(g => [g.key, g.count])) : null, compact || !tablet)}
          />
        ),
      }}
      notice={
        group === "questions" &&
        tablet &&
        !!current?.count && (
          <ListNotice icon={<MessageSquareText />}>
            <Button asChild size="sm" variant="link" className="px-0 touch:px-0">
              <a href={href("questions")}>
                Answer these in Questions
                <ArrowRight />
              </a>
            </Button>
          </ListNotice>
        )
      }
      footer={data && <Pagination variant="footer" noun="jobs" offset={data.offset} limit={data.limit} total={data.total} onChange={record.setPage} />}
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
          <EmptyState
            icon={group === "applying" ? <Send /> : <CircleCheck />}
            title={EMPTY[group] ?? "Nothing here"}
            description={idle}
            action={
              idle && (
                <Button asChild size="sm" variant="secondary">
                  <a href={href("review")}>
                    Open Review
                    <ArrowRight />
                  </a>
                </Button>
              )
            }
            className="pt-16"
          />
        )
      ) : (
        rows.map(r => {
          const at = timeOf(group, r),
            score = ASSESSING.includes(r.status) ? null : r.score,
            ask = group === "needs_you" || group === "questions" ? askOf(r) : null,
            [cause, detail] = group === "failed" && r.note?.trim() ? splitNote(r.note) : [null, ""];
          return (
            <ListRow
              key={r.id}
              {...record.rowProps(r.id)}
              lead={<CompanyMark name={r.company} />}
              title={unent(r.title)}
              secondary={
                mixed && tablet ? (
                  <>
                    <span>{unent(r.company)}</span>
                    <Stage row={r} />
                  </>
                ) : (
                  unent(r.company)
                )
              }
              gist={
                mixed && !tablet ? (
                  <span title={ask ?? undefined}>
                    <Stage row={r} />
                    {ask && <span className="ml-2">{ask}</span>}
                  </span>
                ) : ask ? (
                  <span title={ask}>{ask}</span>
                ) : cause ? (
                  <span title={r.note ?? undefined}>
                    <StatusLabel tone="danger" label={cause} />
                    {detail && <span className="ml-2">{detail}</span>}
                  </span>
                ) : (
                  !(mixed && compact) && !!r.location?.trim() && <span title={r.location}>{place(r.location)}</span>
                )
              }
              fact={waiting || !scored ? <Time at={at} short /> : <FitFact value={score} threshold={thresholdOf(r.rubric, summary)} />}
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
