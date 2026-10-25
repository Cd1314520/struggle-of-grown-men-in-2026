// The four numbers that say whether the machine is working, in the funnel's order: a strip of tiles over the charts.
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Summary } from "../../../src/api-types";
import { Card, Skeleton } from "../../components/ui";
import { useStats } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
// The last seven days, today included, and the seven before them.
const weeks = (series: readonly number[]) => [sum(series.slice(-7)), sum(series.slice(-14, -7))] as const;

// "+18% vs last week". `good` says whether up is good news; when it is not, neither direction is coloured.
function Delta({ now, before, good }: { now: number; before: number; good: boolean }) {
  if (!before) return <span className="text-fg-subtle">{now ? "New this week" : "None last week either"}</span>;
  const change = Math.round(((now - before) / before) * 100);
  if (!change) return <span className="text-fg-subtle">Same as last week</span>;
  const Icon = change > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-flex items-center font-medium", !good ? "text-fg-muted" : change > 0 ? "text-success-text" : "text-danger-text")}>
        <Icon className="size-3.5" />
        {Math.abs(change)}%
      </span>
      <span className="text-fg-subtle">vs last week</span>
    </span>
  );
}

function Tile({ label, value, foot }: { label: string; value: ReactNode; foot: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <span className="truncate text-sm text-fg-muted">{label}</span>
      <span className="text-2xl font-semibold tracking-[-0.01em] text-fg">{value}</span>
      <span className="truncate text-xs">{foot}</span>
    </div>
  );
}

export function Kpis({ summary }: { summary: Summary | undefined }) {
  const { data: st } = useStats();
  if (!st || !summary)
    return (
      <Card className="grid grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2.5 px-5 py-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-6 w-14" />
            <Skeleton className="h-3 w-28" />
          </div>
        ))}
      </Card>
    );
  const [sent, sentBefore] = weeks(st.applied),
    [found, foundBefore] = weeks(st.found);
  const rate = st.response.sent ? Math.round((st.response.heard / st.response.sent) * 100) : null;
  // Review's count is in Needs you above: this tile is the conversations under way instead.
  const talking = summary.counts["interview"] ?? 0,
    offers = summary.counts["offer"] ?? 0;
  return (
    <Card className="grid grid-cols-2 divide-border max-lg:[&>*:nth-child(-n+2)]:border-b lg:grid-cols-4 lg:divide-x [&>*:nth-child(odd)]:max-lg:border-r">
      <Tile label="Found this week" value={num(found)} foot={<Delta now={found} before={foundBefore} good={false} />} />
      <Tile label="Applied this week" value={num(sent)} foot={<Delta now={sent} before={sentBefore} good />} />
      <Tile
        label="Reply rate"
        value={rate === null ? "–" : `${rate}%`}
        foot={
          <span className="text-fg-subtle">
            {st.response.sent ? `${num(st.response.heard)} of ${num(st.response.sent)} replied` : "Nothing sent in 30 days"}
          </span>
        }
      />
      <Tile
        label="In process"
        value={num(talking)}
        foot={<span className="text-fg-subtle">{offers ? `${num(offers)} ${offers === 1 ? "offer" : "offers"}` : "No offers yet"}</span>}
      />
    </Card>
  );
}
