// What employers asked for after an application went out: the owner's moves first, soonest due, then
// what is booked, soonest first.
import { CalendarClock } from "lucide-react";
import { CompanyMark, EmptyState, ListBody, ListRow } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { brief, plain } from "../../lib/format";
import { href } from "../../lib/router";
import { NextPhrase } from "../applications/next-step";
import { RailHead } from "./rail";

const SHOWN = 5;

export function Upcoming() {
  const mine = useJobList({ view: "applications", group: "your_move", limit: SHOWN });
  const booked = useJobList({ view: "applications", group: "upcoming", limit: SHOWN });
  const loading = !mine.data || !booked.data;
  const rows = [...(mine.data?.rows ?? []), ...(booked.data?.rows ?? [])].slice(0, SHOWN);
  const total = (mine.data?.total ?? 0) + (booked.data?.total ?? 0);
  return (
    <ListBody label="Coming up" loading={loading} className="border-t border-border">
      <RailHead label="Coming up" count={total} link={total > SHOWN && { href: "#applications?group=your_move", label: "View all" }} />
      {loading ? null : rows.length ? (
        rows.map(
          r =>
            r.next && (
              <ListRow
                key={r.id}
                href={href("applications", r.id)}
                lead={<CompanyMark name={r.company} />}
                title={<span title={`${plain(r.next.label)}\n${r.company}, ${r.title}`}>{brief(r.next.label, r.company)}</span>}
                secondary={r.company}
                fact={<NextPhrase next={r.next} short />}
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
    </ListBody>
  );
}
