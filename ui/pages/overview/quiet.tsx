import { ListBody } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { cn } from "../../lib/cn";
import { CLOSED, RailHead } from "./rail";
import { StepRow } from "./upcoming";

const SHOWN = 5;

/** Applications that have waited on the employer a long while after a step. Passive: it only points at them, and is absent when none are. */
export function Quiet() {
  const quiet = useJobList({ view: "applications", group: "quiet", limit: SHOWN });
  const total = quiet.data?.total ?? 0;
  if (!total) return null;
  return (
    <ListBody label="Gone quiet" className={cn("border-b border-border", CLOSED)}>
      <RailHead label="Gone quiet" count={total} link={total > SHOWN && { href: "#applications?group=quiet", label: "View all" }} />
      {quiet.data?.rows.map(r => (
        <StepRow key={r.id} r={r} />
      ))}
    </ListBody>
  );
}
