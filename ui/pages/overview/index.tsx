import { ListChecks, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { shellActions } from "../../components/shell/state";
import { Button, ListNotice, Workspace, WorkspaceBody } from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { num } from "../../lib/format";
import { href } from "../../lib/router";
import { Calibration } from "./calibration";
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
  const fresh = !!s && s.setupRemaining > 0 && !Object.values(s.counts).some(Boolean);
  const hello = greeting(new Date().getHours()),
    meta = s && (waiting ? `${num(waiting)} ${waiting === 1 ? "thing needs" : "things need"} you` : "All clear, nothing is waiting on you");
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: hello,
        meta,
        controls: (
          <div data-lead className="min-w-0 lg:hidden">
            <p className="truncate text-base font-semibold text-fg">{hello}</p>
            {meta && <p className="truncate text-sm text-fg-muted">{meta}</p>}
          </div>
        ),
        actions: (
          <>
            <Button
              size="sm"
              className="max-sm:hidden"
              icon={<Plus />}
              onClick={() => {
                shellActions.setAddOpen(true);
              }}
            >
              Add a posting
            </Button>
            <Button
              size="sm"
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
                    () => undefined,
                  )
                  .finally(() => {
                    setStarting(false);
                  });
              }}
            >
              {scanning ? "Scanning…" : "Scan now"}
            </Button>
          </>
        ),
      }}
      notice={
        fresh && (
          <ListNotice
            icon={<ListChecks />}
            action={
              <Button asChild variant="link" size="sm">
                <a href={href("setup")}>Start setup</a>
              </Button>
            }
          >
            <span className="font-medium">Welcome to Auto Apply.</span> A few steps first: the programs it runs, a model provider, your resume and profile, and
            the mailbox. Setup checks each one as you go.
          </ListNotice>
        )
      }
    >
      <WorkspaceBody
        asideWidth="rail"
        className="xl:[&>aside]:w-96 2xl:[&>aside]:w-104"
        aside={
          <div className="@container/ws">
            <Health summary={s} />
            <Upcoming />
            <Recent />
          </div>
        }
      >
        <div className="flex flex-col">
          <NeedsYou summary={s} />
          <Kpis summary={s} className="sm:order-first" />
          <Trend />
          <Funnel />
          <Calibration />
        </div>
      </WorkspaceBody>
    </Workspace>
  );
}
