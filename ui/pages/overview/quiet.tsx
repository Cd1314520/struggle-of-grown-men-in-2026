import { CompanyMark, ListBody, ListRow } from "../../components/ui";
import { useJobList } from "../../lib/api";
import { brief, plain } from "../../lib/format";
import { href } from "../../lib/router";
import { NextPhrase } from "../applications/next-step";
import { RailHead } from "./rail";

const SHOWN = 5;

/** Applications that have waited on the employer a long while after a step. Passive: it only points at them, and is absent when none are. */
export function Quiet() {
  const quiet = useJobList({ view: "applications", group: "quiet", limit: SHOWN });
  const total = quiet.data?.total ?? 0;
  if (!total) return null;
  return (
    <ListBody label="Gone quiet" className="border-t border-border">
      <RailHead label="Gone quiet" count={total} link={total > SHOWN && { href: "#applications?group=quiet", label: "View all" }} />
      {quiet.data?.rows.map(
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
      )}
    </ListBody>
  );
}
