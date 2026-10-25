// Activity: is the pipeline healthy and what happened since the last look. The runs the owner can start,
// then the feed by day, the stops that kept applications from going out, and the raw log.
import { Page, PageHeader, Skeleton, Tabs, TabsList, TabsTrigger } from "../../components/ui";
import { useSummary } from "../../lib/api";
import { navigate, useRoute } from "../../lib/router";
import { Automations } from "./automations";
import { Blockers } from "./blockers";
import { Highlights } from "./highlights";
import { FullLog } from "./log";

const TABS = ["highlights", "blockers", "log"] as const;
type Tab = (typeof TABS)[number];

export function ActivityPage() {
  const { parts } = useRoute();
  const { data: s } = useSummary();
  const tab: Tab = TABS.find(t => t === parts[0]) ?? "highlights";
  return (
    <Page>
      <PageHeader title="Activity" description="What the agents did, and the runs you can start by hand." />
      {s ? <Automations s={s} /> : <Skeleton className="h-30 rounded-xl" />}
      <Tabs
        value={tab}
        onValueChange={v => {
          // Each tab keeps its own filters, so switching starts clean.
          navigate(v === "highlights" ? "activity" : `activity/${v}`, { replace: true });
        }}
        className="mt-8"
      >
        <TabsList className="mb-5">
          <TabsTrigger value="highlights">Highlights</TabsTrigger>
          <TabsTrigger value="blockers">Blockers</TabsTrigger>
          <TabsTrigger value="log">Full log</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === "highlights" ? <Highlights /> : tab === "blockers" ? <Blockers /> : <FullLog />}
    </Page>
  );
}
