import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ActivityItem } from "../../../src/api-types";
import { EmptyState, Linkified, ListGroup, ListRow, Select, SkeletonRows, Workspace } from "../../components/ui";
import { cn } from "../../lib/cn";
import { dayLabel } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { activityBar, byDay, Clock, LoadOlder, useActivityPages, type ActivityHead } from "./parts";

const KINDS = ["step", "tool", "agent", "gate", "user", "auto", "error", "system", "mail", "recheck", "migration"] as const;
const KIND_TEXT: Record<string, string> = { error: "text-danger-text", gate: "text-warning-text", user: "text-accent-text" };
const COLUMNS = "4.5rem 8rem";

function Entry({ e }: { e: ActivityItem }) {
  return (
    <ListRow
      dense
      columns={COLUMNS}
      cells={[
        <Clock key="at" at={e.at} />,
        <span key="kind" className="font-mono text-xs">
          {e.worker ?? "app"}
          <span className={cn("ml-1.5", KIND_TEXT[e.kind] ?? "text-fg-muted")}>{e.kind}</span>
        </span>,
      ]}
      title={
        <span title={e.message}>
          {e.job_id && (
            <a href={href("job", e.job_id)} className="mr-2 font-medium text-fg hover:underline touch:-my-2 touch:py-2" title={e.title ?? undefined}>
              {e.company ?? `Job ${e.job_id}`}
            </a>
          )}
          <Linkified text={e.message} className="whitespace-nowrap text-fg-muted touch:whitespace-normal" />
        </span>
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
      options={[{ value: "all", label: "All" }, ...KINDS.map(k => ({ value: k, label: k }))]}
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
        days.map(d => (
          <div key={d.day} className="contents">
            <ListGroup label={d.day} count={d.items.length} />
            {d.items.map(e => (
              <Entry key={e.id} e={e} />
            ))}
          </div>
        ))
      )}
    </Workspace>
  );
}
