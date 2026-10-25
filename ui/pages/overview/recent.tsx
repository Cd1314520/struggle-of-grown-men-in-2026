// The latest decisions and outcomes from the event log, with a way into the full feed.
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bot, CircleAlert, Hand, History, Mail, Radar, RotateCcw, Sparkles, UserRound, type LucideIcon } from "lucide-react";
import { Button, Card, CardHeader, EmptyState, Skeleton, Time } from "../../components/ui";
import { api } from "../../lib/api";
import { cn } from "../../lib/cn";
import { plain, plural } from "../../lib/format";
import { href } from "../../lib/router";
import { feed, type FeedRow } from "../activity/feed";

const SHOWN = 8;

const KIND: Record<string, readonly [LucideIcon, string]> = {
  mail: [Mail, "text-info-text"],
  error: [CircleAlert, "text-danger-text"],
  gate: [Hand, "text-warning-text"],
  auto: [Sparkles, "text-accent-text"],
  user: [UserRound, "text-fg-muted"],
  recheck: [RotateCcw, "text-fg-muted"],
  system: [Radar, "text-fg-muted"],
};

// A row of the Activity page's feed, so the same event reads the same on both pages.
function Item({ r }: { r: FeedRow }) {
  const [Icon, tone] = KIND[r.kind] ?? [Bot, "text-fg-muted"];
  const many = r.jobs.length > 1,
    company = many ? plural(r.jobs.length, "job") : r.job?.company;
  const body = (
    <>
      <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md bg-subtle [&_svg]:size-3.5", tone)}>
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        {company && <span className="block truncate text-sm font-medium text-fg">{company}</span>}
        <span className={cn("block truncate text-sm", company ? "text-fg-muted" : "text-fg")} title={plain(r.text)}>
          {plain(r.text)}
        </span>
      </span>
      <Time at={r.at} className="shrink-0 text-xs text-fg-subtle" />
    </>
  );
  const row = "flex min-h-12 items-center gap-3 px-5 py-2.5";
  const to = r.job && !many ? href("job", r.job.id) : null;
  return to ? (
    <a href={to} className={cn(row, "transition-colors outline-none hover:bg-subtle/70 focus-visible:bg-subtle")}>
      {body}
    </a>
  ) : (
    <div className={row}>{body}</div>
  );
}

export function Recent() {
  // Scans and repeats fold into one row each, so a few dozen entries make the handful shown.
  const { data } = useQuery({ queryKey: ["activity", "overview"], queryFn: () => api.activity({ feed: "highlights", limit: 60 }) });
  const rows = data ? feed(data.items).slice(0, SHOWN) : undefined;
  return (
    <Card>
      <CardHeader
        title="Recent activity"
        actions={
          <Button asChild variant="ghost" size="sm" className="-my-1 -mr-2">
            <a href="#activity">
              View all
              <ArrowRight />
            </a>
          </Button>
        }
      />
      {!rows ? (
        <div className="space-y-3 px-5 pb-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : rows.length ? (
        <ul className="border-t border-border">
          {rows.map(r => (
            <li key={r.key} className="border-b border-border last:border-b-0">
              <Item r={r} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState size="sm" icon={<History />} title="Nothing yet" description="Scans, approvals and replies show up here." className="pt-2" />
      )}
    </Card>
  );
}
