// Activity: is the pipeline healthy and what happened since the last look. The feed by day, the stops that
// kept applications from going out, and the raw log, each a sheet under one bar: the tabs, the tab's own
// search and filters, and the runs the owner can start by hand in a menu at the far right.
import { Tabs, TabsList, TabsTrigger } from "../../components/ui";
import { useSummary } from "../../lib/api";
import { navigate, useRoute } from "../../lib/router";
import { RunMenu } from "./automations";
import { Blockers } from "./blockers";
import { Highlights } from "./highlights";
import { FullLog } from "./log";
import type { ActivityHead } from "./parts";

const TABS = ["highlights", "blockers", "log"] as const;
type Tab = (typeof TABS)[number];

export function ActivityPage() {
  const { parts } = useRoute();
  const { data: s } = useSummary();
  const tab: Tab = TABS.find(t => t === parts[0]) ?? "highlights";
  const head: ActivityHead = {
    tabs: (
      <TabsList variant="bar">
        <TabsTrigger value="highlights">Highlights</TabsTrigger>
        <TabsTrigger value="blockers">Blockers</TabsTrigger>
        <TabsTrigger value="log">Full log</TabsTrigger>
      </TabsList>
    ),
    run: <RunMenu s={s} size="sm" />,
  };
  return (
    <Tabs
      value={tab}
      onValueChange={v => {
        // Each tab keeps its own filters, so switching starts clean.
        navigate(v === "highlights" ? "activity" : `activity/${v}`, { replace: true });
      }}
    >
      {tab === "highlights" ? <Highlights head={head} /> : tab === "blockers" ? <Blockers head={head} /> : <FullLog head={head} />}
    </Tabs>
  );
}
