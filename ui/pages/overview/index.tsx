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
import { NeedsYou, waitingCounts } from "./needs-you";
import { Recent } from "./recent";
import { Trend } from "./trend";
import { Quiet } from "./quiet";
import { Upcoming, YourMove, useYourMove } from "./upcoming";

function headline(blocking: number, review: number) {
  if (!blocking && !review) return "All clear";
  const parts = [];
  if (blocking) parts.push(`${num(blocking)} waiting on you`);
  if (review) parts.push(`${num(review)} to review`);
  return parts.join(", ");
}

export function OverviewPage() {
  const { data: s } = useSummary();
  const [starting, setStarting] = useState(false);
  const yourMove = useYourMove().data?.total ?? 0;
  const waiting = s ? waitingCounts(s, yourMove) : null;
  const scanning = !!s?.running.scan || starting;
  const fresh = !!s && s.setupRemaining > 0 && !Object.values(s.counts).some(Boolean);
  const meta = waiting ? headline(waiting.blocking, waiting.review) : undefined;
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: "Overview",
        meta,
        controls: (
          <div data-lead className="min-w-0 lg:hidden">
            {meta && <p className="text-sm leading-tight font-medium text-fg">{meta}</p>}
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
            <div className="max-lg:hidden">
              <Upcoming />
              <Quiet />
            </div>
            <Recent />
            <Health summary={s} />
          </div>
        }
      >
        <div className="flex flex-col">
          <NeedsYou summary={s} />
          <YourMove />
          <div className="@container/ws lg:hidden">
            <Upcoming />
            <Quiet />
          </div>
          <Kpis summary={s} />
          <Trend />
          <Funnel />
          <Calibration />
        </div>
      </WorkspaceBody>
    </Workspace>
  );
}
