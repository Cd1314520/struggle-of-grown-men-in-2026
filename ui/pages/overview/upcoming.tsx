// What employers asked for after an application went out: the owner's moves first, soonest due, then
// what is booked, soonest first.
import { CalendarClock } from "lucide-react";
import type { ListRow } from "../../../src/api-types";
import { Button, Card, CardFooter, CardHeader, CompanyMark, EmptyState, Skeleton } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ago, clock, date, DAY, dayLabel, parseAt } from "../../lib/format";
import { href } from "../../lib/router";
import { NextLabel } from "../applications/next-step";

const SHOWN = 5;
// A deadline counts as missed once its whole day has gone by.
const overdue = (at: number) => at < Date.now() - DAY;

function When({ row }: { row: ListRow }) {
  const next = row.next;
  if (!next) return null;
  const at = parseAt(next.at);
  if (next.whose === "upcoming")
    return (
      <span className="text-right">
        <span className="block text-sm text-fg">{dayLabel(at)}</span>
        <span className="block text-sm text-fg-muted">{clock(at)}</span>
      </span>
    );
  // No deadline: when it was asked is what says how long it has waited.
  if (!next.due) return <span className="text-sm whitespace-nowrap text-fg-muted">Asked {ago(at)}</span>;
  const late = overdue(at);
  return <span className={cn("text-sm whitespace-nowrap", late ? "text-danger-text" : "text-warning-text")}>{late ? "Overdue" : `Due ${date(at)}`}</span>;
}

export function Upcoming() {
  const mine = useJobList({ view: "applications", group: "your_move", limit: SHOWN });
  const booked = useJobList({ view: "applications", group: "upcoming", limit: SHOWN });
  const loading = !mine.data || !booked.data;
  const rows = [...(mine.data?.rows ?? []), ...(booked.data?.rows ?? [])].slice(0, SHOWN);
  const total = (mine.data?.total ?? 0) + (booked.data?.total ?? 0);
  return (
    <Card>
      <CardHeader title="Coming up" description={loading ? undefined : total ? "Interviews, assessments and deadlines from employers" : undefined} />
      {loading ? (
        <div className="space-y-3 px-5 pb-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length ? (
        <ul className="border-t border-border">
          {rows.map(r => (
            <li key={r.id} className="border-b border-border last:border-b-0">
              <a
                href={href("applications", r.id)}
                className="flex min-h-14 items-center gap-3 px-5 py-2.5 transition-colors outline-none hover:bg-subtle/70 focus-visible:bg-subtle"
              >
                <CompanyMark name={r.company} />
                <span className="min-w-0 flex-1">
                  {r.next && <NextLabel next={r.next} company={r.company} className="text-sm font-medium text-fg" />}
                  <span className="block truncate text-sm text-fg-muted">
                    {r.company}, {r.title}
                  </span>
                </span>
                <When row={r} />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          size="sm"
          icon={<CalendarClock />}
          title="Nothing scheduled"
          description="Interviews, assessments and deadlines from employers show up here."
          className="pt-2"
        />
      )}
      {total > SHOWN && (
        <CardFooter>
          <Button asChild variant="ghost" size="sm" className="-ml-2.5">
            <a href="#applications?group=your_move">View all {total}</a>
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
