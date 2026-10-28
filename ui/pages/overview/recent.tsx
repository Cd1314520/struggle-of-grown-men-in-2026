import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { EmptyState, ListBody, ListRow, Time } from "../../components/ui";
import { api } from "../../lib/api";
import { plain, plural } from "../../lib/format";
import { href } from "../../lib/router";
import { feed, type FeedRow } from "../activity/feed";
import { KindIcon } from "../activity/kind-icon";
import { RailHead } from "./rail";

const SHOWN = 6;

function Item({ r }: { r: FeedRow }) {
  const many = r.jobs.length > 1;
  const link = r.job && !many ? { href: href("job", r.job.id) } : {};
  return (
    <ListRow
      {...link}
      lead={<KindIcon row={r} />}
      title={plain(r.text)}
      titleClassName="font-normal"
      secondary={many ? plural(r.jobs.length, "job") : (r.job?.company ?? undefined)}
      fact={<Time at={r.at} short />}
    />
  );
}

export function Recent() {
  const { data } = useQuery({ queryKey: ["activity", "overview"], queryFn: () => api.activity({ feed: "highlights", limit: 60 }) });
  const rows = data ? feed(data.items).slice(0, SHOWN) : undefined;
  return (
    <ListBody label="Recent activity" loading={!rows} className="border-t border-border">
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
