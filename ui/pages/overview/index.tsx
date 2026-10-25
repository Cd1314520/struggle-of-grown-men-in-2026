// The home page: what needs the owner, whether the machine is healthy, and whether it is working.
import { Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { shellActions } from "../../components/shell/state";
import { Button, Page, PageHeader } from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { num } from "../../lib/format";
import { Funnel } from "./funnel";
import { Health } from "./health";
import { Kpis } from "./kpis";
import { attentionRows, NeedsYou } from "./needs-you";
import { Recent } from "./recent";
import { Trend } from "./trend";
import { Upcoming } from "./upcoming";

const greeting = (hour: number) => (hour < 5 ? "Good evening" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");

export function OverviewPage() {
  const { data: s } = useSummary();
  const [starting, setStarting] = useState(false);
  const waiting = s ? attentionRows(s).reduce((n, r) => n + r.count, 0) : 0;
  const scanning = !!s?.running.scan || starting;
  return (
    <Page>
      <PageHeader
        title={greeting(new Date().getHours())}
        description={
          !s ? "\u00a0" : waiting ? `${num(waiting)} ${waiting === 1 ? "thing needs" : "things need"} you.` : "All clear. Nothing is waiting on you."
        }
        actions={
          <>
            {/* A phone has Add in its top bar. */}
            <Button
              className="max-sm:hidden"
              icon={<Plus />}
              onClick={() => {
                shellActions.setAddOpen(true);
              }}
            >
              Add a posting
            </Button>
            <Button
              icon={<RefreshCw className={scanning ? "animate-spin" : undefined} />}
              disabled={scanning}
              aria-label={scanning ? "Scanning" : "Scan now"}
              onClick={() => {
                setStarting(true);
                api
                  .run("scan")
                  .then(
                    () => {
                      toast.success("Scan started");
                      return refreshAll();
                    },
                    () => undefined, // the request already showed why it was refused
                  )
                  .finally(() => {
                    setStarting(false);
                  });
              }}
            >
              <span className="max-sm:hidden">{scanning ? "Scanning…" : "Scan now"}</span>
            </Button>
          </>
        }
      />
      {/* Two columns that flow on their own; on a phone, what needs the owner comes first. */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <NeedsYou summary={s} />
          <Kpis summary={s} />
          <Trend />
          <Funnel />
        </div>
        <div className="flex min-w-0 flex-col gap-5">
          <Health summary={s} />
          <Upcoming />
          <Recent />
        </div>
      </div>
    </Page>
  );
}
