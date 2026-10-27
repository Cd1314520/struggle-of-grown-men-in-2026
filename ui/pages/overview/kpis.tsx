// The four numbers that say whether the machine is working, in the funnel's order, in a line over the charts.
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { Summary } from "../../../src/api-types";
import { Card, Skeleton, StatRow } from "../../components/ui";
import { useStats } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
// The last seven days, today included, and the seven before them.
const weeks = (series: readonly number[]) => [sum(series.slice(-7)), sum(series.slice(-14, -7))] as const;

// "+18% vs last week". `good` says whether up is good news; when it is not, neither direction is coloured.
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

export function Kpis({ summary }: { summary: Summary | undefined }) {
  const { data: st } = useStats();
  if (!st || !summary)
    return (
      <Card className="flex flex-wrap gap-x-10 gap-y-4 p-5">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="space-y-2">
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
  // Review's count is in Needs you above: this one is the conversations under way instead.
  const talking = summary.counts["interview"] ?? 0,
    offers = summary.counts["offer"] ?? 0;
  return (
    <Card className="p-5">
      <StatRow
        // Two by two on a phone, one line where there is room.
        className="grid grid-cols-2 gap-x-6 gap-y-5 sm:flex sm:gap-x-10"
        items={[
          { label: "Found this week", value: num(found), hint: <Delta now={found} before={foundBefore} good={false} /> },
          { label: "Applied this week", value: num(sent), hint: <Delta now={sent} before={sentBefore} good /> },
          {
            label: "Reply rate",
            value: rate === null ? "–" : `${rate}%`,
            hint: st.response.sent ? `${num(st.response.heard)} of ${num(st.response.sent)} replied` : "Nothing sent in 30 days",
          },
          { label: "In process", value: num(talking), hint: offers ? `${num(offers)} ${offers === 1 ? "offer" : "offers"}` : "No offers yet" },
        ]}
      />
    </Card>
  );
}
