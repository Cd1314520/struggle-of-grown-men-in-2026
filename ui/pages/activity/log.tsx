import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ActivityItem } from "../../../src/api-types";
import { Clamp, EmptyState, Linkified, ListGroup, ListRow, Select, SkeletonRows, Workspace } from "../../components/ui";
import { cap, dayLabel } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { activityBar, byDay, Clock, LoadOlder, useActivityPages, type ActivityHead } from "./parts";

const KINDS = ["step", "tool", "agent", "gate", "user", "auto", "error", "system", "mail", "recheck", "migration"] as const;
const KIND_TEXT: Record<string, string> = { error: "text-danger-text", gate: "text-warning-text", user: "text-accent-text" };
const COLUMNS = "4.5rem 9rem";

function Entry({ e }: { e: ActivityItem }) {
  return (
    <ListRow
      dense
      columns={COLUMNS}
      cells={[
        <Clock key="at" at={e.at} />,
        <span key="kind" className="font-mono text-xs">
          {e.worker && e.worker !== e.kind && <span className="mr-1.5">{e.worker}</span>}
          <span className={KIND_TEXT[e.kind] ?? "text-fg-muted"}>{e.kind}</span>
        </span>,
      ]}
      className="items-baseline"
      titleClassName="whitespace-normal touch:line-clamp-none [&>div]:flex [&>div]:items-baseline [&>div]:gap-3 [&>div>button]:mt-0 [&>div>button]:shrink-0 touch:[&>div]:block touch:[&>div>button]:-mt-2"
      title={
        <Clamp lines={1} touchLines={2} className="min-w-0 flex-1">
          {e.job_id && (
            <a href={href("job", e.job_id)} className="mr-2 font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2" title={e.title ?? undefined}>
              {e.company ?? `Job ${e.job_id}`}
            </a>
          )}
          <Linkified text={e.message} className="text-fg-muted" />
        </Clamp>
      }
    />
  );
}

export function FullLog({ head }: { head: ActivityHead }) {
  const { params } = useRoute();
  const shown = params.get("kind") ?? "";
  const valid = (KINDS as readonly string[]).includes(shown);
  const q = useActivityPages("all", valid ? [shown] : []);
  const days = useMemo(() => byDay(q.data?.pages.flatMap(p => p.items) ?? [], e => dayLabel(e.at)), [q.data]);
  const kind = (
    <Select
      prefix="Kind"
      value={valid ? shown : "all"}
      onValueChange={v => {
        setParams({ kind: v === "all" ? null : v });
      }}
      options={[{ value: "all", label: "All" }, ...KINDS.map(k => ({ value: k, label: cap(k) }))]}
    />
  );

  return (
    <Workspace
      bar={activityBar(head, { controls: kind })}
      footer={days.length > 0 && <LoadOlder more={q.hasNextPage} loading={q.isFetchingNextPage} onLoad={() => void q.fetchNextPage()} />}
      bodyRole="table"
      bodyLabel="Full log"
    >
      {q.isPending ? (
        <SkeletonRows dense rows={14} />
      ) : !days.length ? (
        <EmptyState
          icon={<ScrollText />}
          title="The log is empty"
          description={valid ? `No ${shown} entries yet.` : "Entries appear as the workers run."}
          className="pt-24"
        />
      ) : (
        days.map((d, i) => (
          <div key={d.day} className="contents">
            <ListGroup label={d.day} count={i < days.length - 1 || !q.hasNextPage ? d.items.length : undefined} />
            {d.items.map(e => (
              <Entry key={e.id} e={e} />
            ))}
          </div>
        ))
      )}
    </Workspace>
  );
}
