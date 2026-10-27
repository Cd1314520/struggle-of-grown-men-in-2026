// The open job: header, the decision the app waits on, and tabs. Shown beside or over a list (layout
// "panel"), or as the whole page at #job/<id> (layout "page", inside the page's card).
import { ArrowUpRight, Building2, ChevronDown, ChevronUp, Clock, Globe, Maximize2, MapPin, SearchX, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { JobDetail as Job } from "../../../src/api-types";
import { Button, CompanyMark, EmptyState, Score, Skeleton, StatusLabel, Tabs, TabsContent, TabsList, TabsTrigger, Time, Tooltip } from "../../components/ui";
import { ApiError, useJob, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { host, place } from "../../lib/format";
import { useHotkeys } from "../../lib/hotkeys";
import { href } from "../../lib/router";
import { useJobActions } from "./actions";
import { Activity } from "./activity";
import { DecisionBar, DecisionCard, useDecision, useDecisionKeys } from "./decision";
import { Fit } from "./fit";
import { decisionOf, fitLeads, headerStatus, setAsideOf, type Phase } from "./model";
import { Overview } from "./overview";
import { Posting } from "./posting";
import { NextSteps } from "./process";
import { Resume } from "./resume";

export interface JobDetailProps {
  id: number;
  layout: "panel" | "page";
  onClose?: (() => void) | undefined; // the panel's close button, and Esc
  onActed?: ((action: string) => void) | undefined; // after a successful action; lists use it to move to the next job
  // Where the job sits in the list beside it: `index` counts from 0 and shows as "3 of 246" with up/down.
  position?: { index: number; total: number; prev?: (() => void) | undefined; next?: (() => void) | undefined } | undefined;
}

const TABS = [
  ["overview", "Overview"],
  ["fit", "Fit"],
  ["resume", "Resume"],
  ["posting", "Posting"],
  ["activity", "Activity"],
] as const;
type Tab = (typeof TABS)[number][0];
// The tab stays put while moving through a list, so comparing one tab across jobs is J, J, J.
let lastTab: Tab = "overview";
const rememberTab = (t: Tab) => {
  lastTab = t;
};

// After an action moves the list on, the next job's buttons land under the same pointer: they ignore
// clicks for a moment so a double click cannot decide two jobs.
let actedAt = 0;
const markActed = () => {
  actedAt = Date.now();
};

function Fact({ icon, children, title }: { icon: ReactNode; children: ReactNode; title?: string | undefined }) {
  return (
    <span title={title} className="inline-flex min-w-0 items-center gap-1.5 [&>svg]:size-3.5 [&>svg]:shrink-0 [&>svg]:text-fg-subtle">
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

function Header({ job, threshold, onScore }: { job: Job; threshold: number | null; onScore: () => void }) {
  const status = headerStatus(job);
  const others = job.siblings.length;
  // Why a held or rejected job was set aside, beside its status at every width.
  const aside = job.status === "held" || job.status === "rejected" ? setAsideOf(job) : null;
  const fit = threshold != null ? `Fit score, needs ${threshold}` : "Fit score";
  const label = job.score != null ? `Fit ${job.score}, open the Fit tab` : undefined;
  return (
    // One column under 36rem (a phone, a narrow panel): company, title, then one row of facts that holds
    // the status and the score. From 36rem the status and the big score stand on the right.
    <header className="@container">
      <div className="flex items-start gap-4">
        <CompanyMark name={job.company} size="lg" className="mt-0.5 hidden @xl:inline-flex" />
        <div className="min-w-0 flex-1">
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex max-w-full items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg touch:-my-1.5 touch:py-1.5"
            title="Open the original posting"
          >
            <CompanyMark name={job.company} size="sm" className="mr-1 @xl:hidden" />
            <span className="truncate">{job.company}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-fg-subtle group-hover:text-fg" />
          </a>
          <h1 className="mt-1 text-2xl font-semibold tracking-[-0.015em] text-balance break-words text-fg">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted @xl:mt-3 @xl:gap-y-1.5">
            <StatusLabel tone={status.tone} label={status.label} pulse={status.pulse} className="text-fg @xl:hidden" />
            {aside && (
              <span title={aside.detail ?? undefined} className="min-w-0 text-fg">
                {aside.label}
              </span>
            )}
            {job.score != null && (
              <button
                type="button"
                onClick={onScore}
                title={fit}
                aria-label={label}
                className="inline-flex items-baseline gap-1.5 rounded-md outline-offset-2 hover:text-fg touch:-my-1.5 touch:py-1.5 @xl:hidden"
              >
                Fit
                <Score value={job.score} threshold={threshold} className="text-base" />
              </button>
            )}
            {/* "No location given" is not worth a line on a phone. */}
            <span className={job.location ? "contents" : "hidden @xl:contents"}>
              <Fact icon={<MapPin />} title={job.location ?? undefined}>
                {place(job.location)}
              </Fact>
            </span>
            <Fact icon={<Clock />}>{job.submitted_at ? <Time at={job.submitted_at} prefix="Applied " /> : <Time at={job.found_at} prefix="Found " />}</Fact>
            <span className="hidden min-w-0 @xl:contents">
              <Fact icon={<Globe />}>{host(job.url)}</Fact>
              {others > 0 && (
                <Fact icon={<Building2 />}>
                  {others} other {others === 1 ? "role" : "roles"} at {job.company}
                </Fact>
              )}
            </span>
          </div>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-3 @xl:flex">
          <StatusLabel tone={status.tone} label={status.label} pulse={status.pulse} className="text-fg" />
          {job.score != null && (
            <Tooltip content={fit}>
              <button type="button" onClick={onScore} className="rounded-md outline-offset-4" aria-label={label}>
                <Score value={job.score} threshold={threshold} size="lg" className="items-end" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </header>
  );
}

function HeaderSkeleton() {
  return (
    <div className="flex items-start gap-4">
      <Skeleton className="size-11 shrink-0 rounded-md" />
      <div className="flex-1 space-y-3">
        <Skeleton className="h-3.5 w-32" />
        <Skeleton className="h-6 w-3/5" />
        <Skeleton className="h-3.5 w-2/5" />
      </div>
      <Skeleton className="h-8 w-12" />
    </div>
  );
}

// The panel's own bar: where the job is in the list, and the way out. The title joins it once the
// header has scrolled away.
function PanelBar({ job, position, onClose, condensed }: Pick<JobDetailProps, "position" | "onClose"> & { job: Job | undefined; condensed: boolean }) {
  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3">
      {position && (
        <>
          <Tooltip content="Previous" shortcut="K">
            <Button variant="ghost" size="icon-sm" aria-label="Previous job" disabled={!position.prev} onClick={position.prev}>
              <ChevronUp />
            </Button>
          </Tooltip>
          <Tooltip content="Next" shortcut="J">
            <Button variant="ghost" size="icon-sm" aria-label="Next job" disabled={!position.next} onClick={position.next}>
              <ChevronDown />
            </Button>
          </Tooltip>
          <span className="tabular ml-1 text-sm whitespace-nowrap text-fg-muted">
            {(position.index + 1).toLocaleString()} <span className="text-fg-subtle">of</span> {position.total.toLocaleString()}
          </span>
        </>
      )}
      <div
        className={cn("ml-3 flex min-w-0 flex-1 items-center gap-2 transition-opacity duration-150", condensed && job ? "opacity-100" : "opacity-0")}
        aria-hidden={!condensed}
      >
        {job && (
          <>
            <CompanyMark name={job.company} size="sm" />
            <span className="truncate text-sm font-medium text-fg">{job.title}</span>
          </>
        )}
      </div>
      {job && (
        <Tooltip content="Open as a page">
          <Button asChild variant="ghost" size="icon-sm">
            <a href={href("job", job.id)} aria-label="Open as a page">
              <Maximize2 />
            </a>
          </Button>
        </Tooltip>
      )}
      {onClose && (
        <Tooltip content="Close" shortcut="Esc">
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <X />
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

function Body({ job, layout, onActed }: { job: Job; layout: JobDetailProps["layout"]; onActed: JobDetailProps["onActed"] }) {
  const { data: summary } = useSummary();
  const phase: Phase = summary?.phase ?? "practice";
  const threshold = summary?.threshold ?? null;
  const [tab, setTab] = useState<Tab>(lastTab);
  const open = (t: string) => {
    const next = TABS.find(([k]) => k === t)?.[0];
    if (!next) return;
    rememberTab(next);
    setTab(next);
  };
  const actions = useJobActions(job, action => {
    markActed();
    onActed?.(action);
  });
  const kind = decisionOf(job);
  const { decision, dialogs } = useDecision(job, kind, actions);
  useDecisionKeys(decision, actions.busy);
  useHotkeys(
    TABS.map(([k], i) => ({
      key: String(i + 1),
      run: () => {
        open(k);
      },
    })),
  );

  // The job changed right after an action: hold clicks for a moment.
  const [settling, setSettling] = useState(() => Date.now() - actedAt < 1500);
  useEffect(() => {
    if (!settling) return;
    const t = setTimeout(() => {
      setSettling(false);
    }, 600);
    return () => {
      clearTimeout(t);
    };
  }, [settling]);

  const panel = layout === "panel";
  const pad = "px-4 sm:px-6";
  const card =
    decision?.placement === "card" ? (
      <DecisionCard d={decision} job={job} busy={actions.busy} />
    ) : kind === "process" ? (
      <NextSteps job={job} a={actions} />
    ) : null;
  const bar = decision?.placement === "bar" ? decision : null;
  // A gate the agent stopped at leads, above the tabs; a judgement on the fit waits in the bar below it.
  const lead = !fitLeads(kind) && card;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", settling && "pointer-events-none")}>
      <div className={cn(panel && "min-h-0 flex-1 overflow-y-auto overscroll-contain")} data-job-scroll>
        <div className={cn("pt-4 sm:pt-6", pad)}>
          <Header
            job={job}
            threshold={threshold}
            onScore={() => {
              open("fit");
            }}
          />
        </div>
        {lead && <div className={cn("mt-5 sm:mt-6", pad)}>{lead}</div>}
        <Tabs value={tab} onValueChange={open} className="mt-4 sm:mt-6">
          <div className={cn("sticky z-10 bg-[var(--job-bg)]", panel ? "top-0" : "top-12 lg:top-0", pad)}>
            <TabsList>
              {TABS.map(([k, label]) => (
                <TabsTrigger key={k} value={k}>
                  {label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {/* One measure for every tab, so prose, check lists and properties share a right edge. */}
          <div className={cn("pt-6 pb-10", pad)}>
            <div className="@container max-w-3xl">
              {TABS.map(([k]) => (
                <TabsContent key={k} value={k} className="animate-in rounded-sm outline-offset-4">
                  {k === "overview" && (
                    <div className="flex flex-col gap-8">
                      {!lead && card}
                      <Overview job={job} phase={phase} openTab={open} />
                    </div>
                  )}
                  {k === "fit" && <Fit job={job} phase={phase} threshold={threshold} />}
                  {k === "resume" && <Resume job={job} />}
                  {k === "posting" && <Posting job={job} />}
                  {k === "activity" && <Activity job={job} />}
                </TabsContent>
              ))}
            </div>
          </div>
        </Tabs>
      </div>
      {bar && <DecisionBar d={bar} busy={actions.busy} floating={!panel} />}
      {dialogs}
    </div>
  );
}

export function JobDetail({ id, layout, onClose, onActed, position }: JobDetailProps) {
  const { data: job, error } = useJob(id);
  const panel = layout === "panel";
  const [condensed, setCondensed] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useHotkeys([onClose && { key: "Escape", run: onClose }]);

  // The title joins the panel bar once the header has scrolled out of view.
  const loaded = job?.id === id;
  useEffect(() => {
    const scroller = root.current?.querySelector<HTMLElement>("[data-job-scroll]");
    if (!panel || !scroller) return;
    scroller.scrollTo({ top: 0 }); // a new job opens at its top
    const on = () => {
      setCondensed(scroller.scrollTop > 96);
    };
    on();
    scroller.addEventListener("scroll", on, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", on);
    };
  }, [panel, id, loaded]);

  const content =
    error instanceof ApiError && error.status === 404 ? (
      <EmptyState icon={<SearchX />} title="This job no longer exists" description="It may have been removed by a cleanup." />
    ) : !job || !loaded ? (
      <div className="flex flex-col gap-8 px-4 pt-6 sm:px-6">
        <HeaderSkeleton />
        <Skeleton className="h-9 w-full" />
        <div className="space-y-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      </div>
    ) : (
      <Body key={job.id} job={job} layout={layout} onActed={onActed} />
    );

  return (
    <div
      ref={root}
      style={{ "--job-bg": "var(--surface)" } as CSSProperties}
      className={cn("flex flex-col", panel && "h-full min-h-0 bg-[var(--job-bg)]")}
      data-job={id}
    >
      {panel && <PanelBar job={loaded ? job : undefined} position={position} onClose={onClose} condensed={condensed} />}
      {content}
    </div>
  );
}
