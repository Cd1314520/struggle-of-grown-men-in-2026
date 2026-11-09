import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Summary } from "../../../src/api-types";
import { Skeleton } from "../../components/ui";
import { useStats } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const weeks = (series: readonly number[]) => [sum(series.slice(-7)), sum(series.slice(-14, -7))] as const;

function Delta({ now, before, good }: { now: number; before: number; good: boolean }) {
  if (!before) return <span>{now ? "New this week" : "None last week either"}</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return <span>Same as last week</span>;
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center font-medium", !good ? "text-fg-muted" : change > 0 ? "text-success-text" : "text-danger-text")}>
        <Icon className="size-3.5" />
        {Math.abs(change)}%
      </span>
      <span>vs last week</span>
    </span>
  );
}

const cell = (i: number) => cn("px-(--list-x) py-5 border-border", i < 3 && "sm:border-r", i % 2 === 0 && "max-sm:border-r", i < 2 && "max-sm:border-b");

export function Kpis({ summary, className }: { summary: Summary | undefined; className?: string }) {
  const { data: st } = useStats();
  const frame = cn("grid grid-cols-2 border-b border-border sm:grid-cols-4", className);
  if (!st || !summary)
    return (
      <div className={frame}>
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className={cn(cell(i), "space-y-2")}>
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-14" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </div>
    );
  const [sent, sentBefore] = weeks(st.applied),
    [found, foundBefore] = weeks(st.found);
  const rate = st.response.sent ? Math.round((st.response.heard / st.response.sent) * 100) : null;
  const talking = summary.counts["interview"] ?? 0,
    offers = summary.counts["offer"] ?? 0;
  const items = [
    { label: "Found this week", value: num(found), hint: <Delta now={found} before={foundBefore} good={false} /> },
    { label: "Applied this week", value: num(sent), hint: <Delta now={sent} before={sentBefore} good /> },
    {
      label: "Reply rate",
      value: rate === null ? "–" : `${rate}%`,
      hint: st.response.sent ? `${num(st.response.heard)} of ${num(st.response.sent)} replied` : "Nothing sent in 30 days",
    },
    { label: "In process", value: num(talking), hint: offers ? `${num(offers)} ${offers === 1 ? "offer" : "offers"}` : "No offers yet" },
  ];
  return (
    <dl className={frame}>
      {items.map((s, i) => (
        <div key={s.label} className={cn(cell(i), "flex min-w-0 flex-col")}>
          <dt className="text-sm text-fg-muted">{s.label}</dt>
          <dd className="tabular mt-0.5 text-2xl font-semibold text-fg">{s.value}</dd>
          <dd className="mt-0.5 text-xs text-fg-muted">{s.hint}</dd>
        </div>
      ))}
    </dl>
  );
}
