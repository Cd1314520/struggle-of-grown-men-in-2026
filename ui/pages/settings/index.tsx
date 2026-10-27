// Settings: each subsystem's state, its one action, every value it runs with, and the policy behind it folded
// away. A value changed here is saved to config.local.yml, laid over config.yml (see field.tsx).
import { ExternalLink, Plus, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { shellActions } from "../../components/shell/state";
import { Button, ConfirmDialog, Disclosure, ListNotice, SectionNav, Skeleton, SkeletonRows, StatusLabel, Workspace, WorkspaceBody } from "../../components/ui";
import { api, refreshAll, useSettings, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num, plural } from "../../lib/format";
import { href, useRoute } from "../../lib/router";
import { onPageScroll, pageScroller } from "../../lib/scroller";
import { Mail } from "./mail";
import { Models } from "./models";
import { ConfigRow, type Confirm } from "./field";
import { SavedLocally, SettingFold, SettingRow, SettingsPanel } from "./parts";
import { BrowserRows, Schedule, Server, Sources } from "./sections";

const SECTIONS = [
  ["general", "General"],
  ["models", "Models"],
  ["auto-apply", "Auto-apply"],
  ["schedule", "Schedule & limits"],
  ["sources", "Sources"],
  ["mail", "Mail & digest"],
  ["browser", "Browser"],
  ["server", "Server"],
  ["danger", "Danger zone"],
] as const;
type Section = (typeof SECTIONS)[number][0];

// The section nav follows the scroll: the last section whose top has passed under the header, or the last one
// at the foot of the page. A click scrolls rather than following a link, since the hash is the route.
function Nav({ ready }: { ready: boolean }) {
  const [active, setActive] = useState<Section>(SECTIONS[0][0]);
  const picked = useRef(0); // when a click last chose a section: the smooth scroll it starts must not overrule it
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      if (Date.now() - picked.current < 1000) return;
      let current: Section = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 120) current = id;
      }
      const page = pageScroller();
      if (page.scrollTop + page.clientHeight >= page.scrollHeight - 2) current = "danger";
      setActive(current);
    };
    onScroll();
    return onPageScroll(onScroll);
  }, [ready]);
  return (
    <SectionNav
      label="Settings sections"
      items={SECTIONS.map(([key, label]) => ({ key, label, tone: key === "danger" ? "danger" : undefined }))}
      value={active}
      onSelect={id => {
        picked.current = Date.now();
        setActive(id);
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    />
  );
}

const APPROVALS = [
  { value: "auto", label: "Auto-apply" },
  { value: "gated", label: "Gated" },
] as const;

// Settings the app reads only at start, saved but not yet in use.
function RestartNotice() {
  const { data } = useSettings();
  if (!data?.pending.length) return null;
  return (
    <ListNotice tone="warning" icon={<RotateCw />}>
      Saved changes to {data.pending.join(", ")} are used once the app restarts: <code className="font-mono text-xs">systemctl --user restart auto-apply</code>
    </ListNotice>
  );
}

// Turning hold-back off or on changes what happens to every job at a target employer, so it is asked first.
const holdBackConfirm =
  (s: Summary) =>
  (next: unknown): Confirm | null =>
    next === false
      ? {
          title: "Stop holding back target employers?",
          description: `Jobs at target employers are applied to from now on${s.approval === "auto" ? ", and auto-apply may approve them" : ""}, scored on the real rubric. The jobs held back at them go back through triage to be assessed again; jobs you held yourself stay held.`,
          confirm: "Stop holding back",
          danger: true,
          then: () => api.run("release_targets"),
        }
      : next === true
        ? {
            title: "Hold back target employers?",
            description: "New jobs at target employers are set aside in Archive → Held instead of applied to. Applications already under way carry on.",
            confirm: "Hold them back",
          }
        : null;

function General({ s }: { s: Summary }) {
  const held = s.counts["held"] ?? 0;
  const t = s.thresholds;
  return (
    <SettingsPanel id="general" title="General" footer={<SavedLocally />}>
      <ConfigRow
        path="approval"
        label="Approval"
        description={
          s.approval === "auto"
            ? "The app approves the jobs that clear the auto-apply bar and sends every application without asking. Jobs you add by hand, and questions it can't answer, still wait for you."
            : "You approve every job in Review, and OK every filled-in application before it's sent."
        }
        field={{ kind: "choice", options: APPROVALS }}
      />
      <ConfigRow
        path="targets.holdBack"
        label="Hold back target employers"
        description={
          s.targets.holdBack
            ? "Jobs at target employers are set aside for later; everything else is applied to, as practice."
            : "Jobs at target employers are applied to as well, scored on the real rubric."
        }
        field={{ kind: "bool" }}
        confirm={holdBackConfirm(s)}
      />
      <ConfigRow
        path="targets.describe"
        label="Target employers"
        description={
          <>
            Besides the frontier list in{" "}
            <a className="text-accent-text underline-offset-2 hover:underline" href={href("profile", "employers.yml")}>
              employers.yml
            </a>
            , any employer the assessment judges to fit this description. Empty: the list alone. Changing it judges employers afresh.
          </>
        }
        field={{ kind: "words", placeholder: "The list alone" }}
      />
      {s.targets.holdBack && (
        <SettingRow label="Held for later" description="Jobs at target employers go back through triage once you stop holding them back.">
          <span className="tabular font-medium">{num(held)}</span>
          <Button asChild size="sm" variant="link" className="-my-1 px-0 touch:-my-1.5 touch:px-0">
            <a href={href("archive", "held")}>View</a>
          </Button>
        </SettingRow>
      )}
      {t && (
        <SettingRow label="Fit thresholds" description="Postings that score below them are skipped. Set in profile/rubric.yml, on the Profile page.">
          <span className="tabular">
            Practice <span className="font-medium">{t.practice}</span>, real <span className="font-medium">{t.real}</span>
          </span>
        </SettingRow>
      )}
      <SettingRow stack label="Add a posting" description="Paste a job URL to have it assessed like any posting a scan finds.">
        <Button
          size="sm"
          icon={<Plus />}
          onClick={() => {
            shellActions.setAddOpen(true);
          }}
        >
          Add a posting
        </Button>
      </SettingRow>
    </SettingsPanel>
  );
}

function AutoApply({ s }: { s: Summary }) {
  const a = s.autoApply;
  const used = Math.min(1, a.perDay ? a.approvedToday / a.perDay : 0);
  return (
    <SettingsPanel
      id="auto-apply"
      title="Auto-apply"
      description="The bar for the approvals the app gives itself while Approval is Auto-apply."
      footer={<SavedLocally />}
    >
      <SettingRow
        label="Status"
        description={
          a.enabled
            ? `Jobs scoring ${a.minScore} or more${a.allowConcerns ? "" : " with no concerns raised"} are approved and sent for you.`
            : "Approval is Gated: every application waits for you in Review."
        }
      >
        <StatusLabel tone={a.enabled ? "success" : "neutral"} label={a.enabled ? "On" : "Off"} className="text-fg" />
      </SettingRow>
      <ConfigRow
        path="autoApply.minScore"
        label="Minimum fit"
        description="Align it with the practice interview-fit threshold: a score alone never makes a job practice."
        field={{ kind: "number" }}
      />
      <ConfigRow
        path="autoApply.allowConcerns"
        label="Approve despite concerns"
        description="Hard requirements and the evidence gates still apply."
        field={{ kind: "bool" }}
      />
      <ConfigRow
        path="autoApply.perDay"
        label="Approvals a day"
        description="New applications a day (Schedule & limits) still caps what starts."
        field={{ kind: "number", unit: "a day" }}
      />
      <ConfigRow
        path="autoApply.perEmployer"
        label="Applications per employer"
        description="Ever, sent or under way. Further passing roles there wait for your review."
        field={{ kind: "number" }}
      />
      <SettingRow stack label="Approved today" description="Daily quotas reset at midnight UTC.">
        <div className="flex items-center gap-3">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className={cn("h-full rounded-full", used >= 1 ? "bg-warning" : "bg-accent")} style={{ width: `${used * 100}%` }} />
          </div>
          <span className="tabular">
            {/* The limit can be lowered after the day's approvals were made. */}
            {a.approvedToday > a.perDay ? `${num(a.approvedToday)} today, limit ${num(a.perDay)}` : `${num(a.approvedToday)} of ${num(a.perDay)} today`}
          </span>
        </div>
      </SettingRow>
      <SettingFold>
        <Disclosure id="settings-auto" summary="How auto-apply decides">
          <div className="space-y-3">
            <p>
              <span className="font-medium text-fg">Target employers. </span>
              {s.targets.holdBack
                ? "While they are held back, a job counts as practice only when its employer is not a target: on your practice list, or judged not to fit your description of a target employer and not on your frontier list. Anything else is held for later. Pay, location and a low real score are not practice proof."
                : "They are not held back, so a job at one may be approved too, on its real-rubric score. Its employer must still have been judged."}
            </p>
            <p>
              <span className="font-medium text-fg">Safeguards. </span>Missing employer evidence never qualifies; low fit or failed qualifications are skipped.
              Hand-picked postings{a.allowConcerns ? "" : " and jobs with concerns"} wait in Review.
              {a.allowConcerns ? " Concerns alone do not block a job." : ""} Auto-approvals that no longer qualify are held before they fill, and stop for your
              OK before they're sent.
            </p>
          </div>
        </Disclosure>
      </SettingFold>
    </SettingsPanel>
  );
}

function Browser({ s }: { s: Summary }) {
  const slots = s.browsers;
  return (
    <SettingsPanel id="browser" title="Browser" footer={<SavedLocally />}>
      <SettingRow
        stack
        label={slots.length > 1 ? "Browser slots" : "Browser"}
        description={
          slots.length > 1
            ? `Up to ${slots.length} browser slots run on this machine.`
            : slots.length
              ? "Chrome runs on this machine."
              : "Chrome runs on this machine. Viewing it from here needs a live view port (below)."
        }
      >
        {slots.length
          ? slots.map((u, i) => (
              <Button key={u} asChild size="sm">
                <a href={u} target="_blank" rel="noopener noreferrer">
                  {slots.length > 1 ? `Open browser ${i + 1}` : "Open browser"}
                  <ExternalLink />
                </a>
              </Button>
            ))
          : undefined}
      </SettingRow>
      <BrowserRows />
      <SettingFold>
        <Disclosure id="settings-browser" summary="Before you take over a browser">
          These are shared slot views, not application links. Ordinary parked applications release their slots; inspect their saved screenshot and checkpoint
          instead. Only explicitly reserved manual hand-offs and ambiguous submissions expose a browser link on their application page. Do not take over a
          browser without checking its current application.
        </Disclosure>
      </SettingFold>
    </SettingsPanel>
  );
}

function DangerZone({ s }: { s: Summary }) {
  const held = s.counts["held"] ?? 0;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const release = async () => {
    setBusy(true);
    try {
      await api.run("release_held");
      toast.success("Held jobs released");
      await refreshAll();
    } catch {
      // the request already showed the server's refusal
    } finally {
      setBusy(false);
    }
  };
  return (
    <SettingsPanel id="danger" title="Danger zone" tone="danger">
      <SettingRow
        stack
        label="Release held jobs"
        description={
          held
            ? `Send all ${plural(held, "held job")} back through triage, where each is assessed again against the current targets.`
            : "No jobs are held back."
        }
      >
        <Button
          variant="danger"
          disabled={!held || busy}
          loading={busy}
          onClick={() => {
            setConfirming(true);
          }}
        >
          Release held jobs
        </Button>
      </SettingRow>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Release ${plural(held, "held job")}?`}
        description={`All ${num(held)} go back through triage and are assessed again. This can't be undone.`}
        confirm="Release them"
        danger
        onConfirm={() => void release()}
      />
    </SettingsPanel>
  );
}

export function SettingsPage() {
  const { data: s } = useSummary();
  // #settings/<section> opens the page at that section (the Setup page links to them).
  const { parts } = useRoute();
  const section = parts[0];
  const ready = !!s;
  useEffect(() => {
    if (ready && section) document.getElementById(section)?.scrollIntoView({ block: "start" });
  }, [ready, section]);
  return (
    // Below lg the bar holds nothing but the h1 (the top bar names the page): its rule would double the top bar's.
    <Workspace
      className="max-lg:[&>:first-child]:border-b-0"
      bar={{ title: "Settings", hint: "How the app runs: what it may do on its own, where mail goes, and the browser it applies with." }}
    >
      <WorkspaceBody asideSide="left" asideWidth="nav" aside={<Nav ready={ready} />}>
        {s ? (
          <>
            <RestartNotice />
            <General s={s} />
            <Models />
            <AutoApply s={s} />
            <Schedule />
            <Sources />
            <Mail s={s} />
            <Browser s={s} />
            <Server />
            <DangerZone s={s} />
          </>
        ) : (
          <div className="py-6">
            <Skeleton className="mx-(--list-x) mb-4 h-5 w-28" />
            <SkeletonRows lead={false} rows={5} />
          </div>
        )}
      </WorkspaceBody>
    </Workspace>
  );
}
