// The full log: every entry as the workers wrote it, dense, by day.
import { ScrollText } from "lucide-react";
import { useMemo } from "react";
import type { ActivityItem } from "../../../src/api-types";
import { Button, Card, EmptyState, Linkified, Select, SkeletonRows } from "../../components/ui";
import { cn } from "../../lib/cn";
import { dayLabel } from "../../lib/format";
import { href, setParams, useRoute } from "../../lib/router";
import { Clamp, Clock, DayHeader, useActivityPages } from "./parts";

const KINDS = ["step", "tool", "agent", "gate", "user", "auto", "error", "system", "mail", "recheck", "migration"] as const;
const KIND_TEXT: Record<string, string> = { error: "text-danger-text", gate: "text-warning-text", user: "text-accent-text" };

function Entry({ e }: { e: ActivityItem }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5 md:grid md:grid-cols-[56px_88px_minmax(0,1fr)_minmax(0,180px)]">
      <Clock at={e.at} className="pt-px leading-5" />
      <span className="truncate pt-px font-mono text-xs leading-5">
        <span className="text-fg-muted">{e.worker ?? "app"}</span>
        <span className={cn("ml-1.5", KIND_TEXT[e.kind] ?? "text-fg-subtle")}>{e.kind}</span>
      </span>
      <Clamp lines={1} className="w-full text-sm text-fg md:w-auto">
        <Linkified text={e.message} />
      </Clamp>
      {e.job_id ? (
        <a
          href={href("job", e.job_id)}
          className="truncate text-sm text-fg-muted hover:text-fg touch:-my-2 touch:py-2 md:text-right"
          title={e.title ?? undefined}
        >
          {e.company ?? `Job ${e.job_id}`}
        </a>
      ) : (
        <span className="hidden md:block" />
      )}
    </div>
  );
}

export function FullLog() {
  const { params } = useRoute();
  const kind = params.get("kind") ?? "";
  const valid = (KINDS as readonly string[]).includes(kind);
  const q = useActivityPages("all", valid ? [kind] : []);
  const days = useMemo(() => {
    const out: { day: string; items: ActivityItem[] }[] = [];
    for (const e of q.data?.pages.flatMap(p => p.items) ?? []) {
      const day = dayLabel(e.at),
        last = out.at(-1);
      if (last?.day === day) last.items.push(e);
      else out.push({ day, items: [e] });
    }
    return out;
  }, [q.data]);

  return (
    <div>
      <Select
        prefix="Kind"
        value={valid ? kind : "all"}
        onValueChange={v => {
          setParams({ kind: v === "all" ? null : v });
        }}
        options={[{ value: "all", label: "All" }, ...KINDS.map(k => ({ value: k, label: k }))]}
      />
      {q.isPending ? (
        <Card className="mt-5">
          <SkeletonRows rows={10} />
        </Card>
      ) : !days.length ? (
        <Card className="mt-5">
          <EmptyState icon={<ScrollText />} title="The log is empty" description={valid ? `No ${kind} entries yet.` : "Entries appear as the workers run."} />
        </Card>
      ) : (
        <>
          {days.map(d => (
            <section key={d.day} aria-label={d.day}>
              <DayHeader label={d.day} />
              <Card className="divide-y divide-border overflow-hidden">
                {d.items.map(e => (
                  <Entry key={e.id} e={e} />
                ))}
              </Card>
            </section>
          ))}
          <div className="flex justify-center pt-6">
            {q.hasNextPage ? (
              <Button loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>
                Load older
              </Button>
            ) : (
              <p className="text-sm text-fg-subtle">That's everything in the log.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
