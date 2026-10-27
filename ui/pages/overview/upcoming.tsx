// What employers asked for after an application went out: the owner's moves first, soonest due, then
// what is booked, soonest first.
import { ArrowRight, CalendarClock } from "lucide-react";
import { Button, CompanyMark, EmptyState, ListPanel, ListRow, SkeletonRows } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { brief, plain } from "../../lib/format";
import { href } from "../../lib/router";
import { NextPhrase } from "../applications/next-step";

const SHOWN = 5;

export function Upcoming() {
  const mine = useJobList({ view: "applications", group: "your_move", limit: SHOWN });
  const booked = useJobList({ view: "applications", group: "upcoming", limit: SHOWN });
  const loading = !mine.data || !booked.data;
  const rows = [...(mine.data?.rows ?? []), ...(booked.data?.rows ?? [])].slice(0, SHOWN);
  const total = (mine.data?.total ?? 0) + (booked.data?.total ?? 0);
  return (
    <ListPanel
      frame="card"
      title="Coming up"
      count={total > SHOWN ? total : undefined}
      description={!loading && total > 0 ? "Interviews, assessments and deadlines from employers" : undefined}
      actions={
        total > SHOWN && (
          <Button asChild variant="ghost" size="sm" className="-mr-2">
            <a href="#applications?group=your_move">
              View all
              <ArrowRight />
            </a>
          </Button>
        )
      }
    >
      {loading ? (
        <SkeletonRows rows={3} />
      ) : rows.length ? (
        rows.map(
          r =>
            r.next && (
              <ListRow
                key={r.id}
                href={href("applications", r.id)}
                lead={<CompanyMark name={r.company} />}
                title={<span title={`${plain(r.next.label)}\n${r.company}, ${r.title}`}>{brief(r.next.label, r.company)}</span>}
                secondary={
                  <>
                    <span>{r.company}</span>
                    <NextPhrase next={r.next} />
                  </>
                }
              />
            ),
        )
      ) : (
        <EmptyState
          size="sm"
          icon={<CalendarClock />}
          title="Nothing scheduled"
          description="Interviews, assessments and deadlines from employers show up here."
        />
      )}
    </ListPanel>
  );
}
