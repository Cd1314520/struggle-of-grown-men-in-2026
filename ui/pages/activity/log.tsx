// The full log: every entry as the workers wrote it, dense, by day.
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ActivityItem } from "../../../src/api-types";
import { EmptyState, Linkified, ListColumns, ListGroup, ListPanel, ListRow, ListToolbar, Select, SkeletonRows } from "../../components/ui";
import { cn } from "../../lib/cn";
import { dayLabel } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { byDay, Clock, headActions, LoadOlder, useActivityPages, type ActivityHead } from "./parts";

const KINDS = ["step", "tool", "agent", "gate", "user", "auto", "error", "system", "mail", "recheck", "migration"] as const;
const KIND_TEXT: Record<string, string> = { error: "text-danger-text", gate: "text-warning-text", user: "text-accent-text" };
// Time, worker and kind, employer; the message takes the rest, so nothing is pinned to the far right.
const COLUMNS = "64px 120px 160px";

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
        e.job_id ? (
          <a key="job" href={href("job", e.job_id)} className="hover:text-fg touch:-my-2 touch:py-2" title={e.title ?? undefined}>
            {e.company ?? `Job ${e.job_id}`}
          </a>
        ) : (
          <span key="job" />
        ),
      ]}
      title={
        <span title={e.message}>
          {/* One line on a desktop, however many lines the message has (a checkpoint's JSON); two on touch. */}
          <Linkified text={e.message} className="whitespace-nowrap touch:whitespace-normal" />
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
    <ListPanel
      tabs={head.tabs}
      // Beside the tabs where there is room; on a phone the Run menu has that place, and the kind goes under them.
      actions={headActions(head) || kind}
      toolbar={head.run && <ListToolbar controls={kind} />}
      columns={days.length > 0 && <ListColumns dense columns={COLUMNS} label="Message" cells={["Time", "Worker", "Company"]} />}
      footer={days.length > 0 && <LoadOlder more={q.hasNextPage} loading={q.isFetchingNextPage} onLoad={() => void q.fetchNextPage()} />}
      bodyLabel="Full log"
    >
      {q.isPending ? (
        <SkeletonRows dense rows={14} />
      ) : !days.length ? (
        <EmptyState
          size="sm"
          icon={<ScrollText />}
          title="The log is empty"
          description={valid ? `No ${shown} entries yet.` : "Entries appear as the workers run."}
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
    </ListPanel>
  );
}
