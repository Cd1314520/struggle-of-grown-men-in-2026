import type { ListRow as JobRow } from "../../../src/api-types";
import { ListBody, ListRow } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { cn } from "../../lib/cn";
import { brief, plain } from "../../lib/format";
import { href } from "../../lib/router";
import { NextPhrase } from "../applications/next-step";
import { CLOSED, RAIL_TITLE, RailHead } from "./rail";

const SHOWN = 5;

export const useYourMove = () => useJobList({ view: "applications", group: "your_move", limit: SHOWN });

export function StepRow({ r, wide }: { r: JobRow; wide?: boolean }) {
  if (!r.next) return null;
  return (
    <ListRow
      href={href("applications", r.id)}
      titleClassName={wide ? "" : RAIL_TITLE}
      title={<span title={`${plain(r.next.label)}\n${r.company}, ${r.title}`}>{brief(r.next.label, r.company)}</span>}
      secondary={r.company}
      fact={<NextPhrase next={r.next} short />}
    />
  );
}

export function YourMove() {
  const { data } = useYourMove();
  const total = data?.total ?? 0;
  if (!total) return null;
  return (
    <ListBody label="Your move" className={cn("border-b border-border", CLOSED)}>
      <RailHead label="Your move" count={total} link={{ href: "#applications?group=your_move", label: "View all" }} />
      {data?.rows.map(r => (
        <StepRow key={r.id} r={r} wide />
      ))}
    </ListBody>
  );
}

export function Upcoming() {
  const { data } = useJobList({ view: "applications", group: "upcoming", limit: SHOWN });
  const total = data?.total ?? 0;
  if (!total) return null;
  return (
    <ListBody label="Coming up" className={cn("border-b border-border", CLOSED)}>
      <RailHead label="Coming up" count={total} link={{ href: "#applications?group=upcoming", label: "View all" }} />
      {data?.rows.map(r => (
        <StepRow key={r.id} r={r} />
      ))}
    </ListBody>
  );
}
