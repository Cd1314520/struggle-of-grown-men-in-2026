// Activity: is the pipeline healthy and what happened since the last look. The feed by day, the stops that
// kept applications from going out, and the raw log, each one panel headed by the tabs; the runs the owner
// can start by hand are a menu in the header.
import { Page, PageHeader, Tabs, TabsList, TabsTrigger } from "../../components/ui";
import { useSummary } from "../../lib/api";
import { useMedia, WIDE } from "../../lib/media";
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
  // Below lg the top bar names the page, so the menu moves up beside the tabs, a size down to sit inside their
  // row, and the feed starts at the top.
  const wide = useMedia(WIDE);
  const head: ActivityHead = {
    tabs: (
      <TabsList>
        <TabsTrigger value="highlights">Highlights</TabsTrigger>
        <TabsTrigger value="blockers">Blockers</TabsTrigger>
        <TabsTrigger value="log">Full log</TabsTrigger>
      </TabsList>
    ),
    run: !wide && <RunMenu s={s} size="sm" />,
  };
  return (
    <Page width="narrow">
      <PageHeader
        title="Activity"
        description="What the agents did, and the runs you can start by hand."
        descriptionOnPhone={false}
        actions={wide && <RunMenu s={s} />}
      />
      <Tabs
        value={tab}
        onValueChange={v => {
          // Each tab keeps its own filters, so switching starts clean.
          navigate(v === "highlights" ? "activity" : `activity/${v}`, { replace: true });
        }}
      >
        {tab === "highlights" ? <Highlights head={head} /> : tab === "blockers" ? <Blockers head={head} /> : <FullLog head={head} />}
      </Tabs>
    </Page>
  );
}
