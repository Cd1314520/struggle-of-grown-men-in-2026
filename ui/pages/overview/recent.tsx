import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { EmptyState, ListBody, ListRow, Time } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { plain, plural } from "../../lib/format";
import { href } from "../../lib/router";
import { feed, type FeedRow } from "../activity/feed";
import { KindIcon } from "../activity/kind-icon";
import { RAIL_TITLE, RailHead } from "./rail";

const SHOWN = 4;
const ROUTINE = /^(Checked mail: No mail arrived|Folded \d+ duplicate postings?)/;

function Item({ r }: { r: FeedRow }) {
  const many = r.jobs.length > 1;
  const link = r.job && !many ? { href: href("job", r.job.id) } : {};
  return (
    <ListRow
      {...link}
      lead={<KindIcon row={r} />}
      title={plain(r.text)}
      titleClassName={cn(RAIL_TITLE, "font-normal")}
      secondary={many ? plural(r.jobs.length, "job") : (r.job?.company ?? undefined)}
      fact={<Time at={r.at} short />}
    />
  );
}

export function Recent() {
  const { data } = useQuery({ queryKey: ["activity", "overview"], queryFn: () => api.activity({ feed: "highlights", limit: 60 }) });
  const rows = data
    ? feed(data.items)
        .filter(r => !ROUTINE.test(r.text))
        .slice(0, SHOWN)
    : undefined;
  return (
    <ListBody label="Recent activity" loading={!rows} className="border-b border-border">
      <RailHead label="Recent activity" link={{ href: "#activity", label: "View all" }} />
      {rows &&
        (rows.length ? (
          rows.map(r => <Item key={r.key} r={r} />)
        ) : (
          <EmptyState size="sm" icon={<History />} title="Nothing yet" description="Scans, approvals and replies show up here." />
        ))}
    </ListBody>
  );
}
