// Settings: each subsystem's state, its one action, and the policy behind it folded away. Values come from
// config.yml; the page reads them and says where to change them.
import { ExternalLink, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { shellActions } from "../../components/shell/state";
import { Button, ConfirmDialog, Disclosure, Page, PageHeader, Skeleton, StatusLabel } from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { cap, num, plural } from "../../lib/format";
import type { Tone } from "../../lib/labels";
import { href, useRoute } from "../../lib/router";
import { Digest, Gmail } from "./mail";
import { Models } from "./models";
import { FromConfig, SettingRow, SettingsCard, SettingsSection } from "./parts";

const SECTIONS = [
  ["general", "General"],
  ["models", "Models"],
  ["auto-apply", "Auto apply"],
  ["mail", "Mail & digest"],
  ["browser", "Browser"],
  ["danger", "Danger zone"],
] as const;

// The section nav follows the scroll: the last section whose top has passed under the header, or the last one
// at the foot of the page. A click scrolls rather than following a link, since the hash is the route.
function SectionNav({ ready }: { ready: boolean }) {
  const [active, setActive] = useState<string>(SECTIONS[0][0]);
  const picked = useRef(0); // when a click last chose a section: the smooth scroll it starts must not overrule it
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      if (Date.now() - picked.current < 1000) return;
      let current: string = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 120) current = id;
      }
      if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) current = "danger";
      setActive(current);
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    return () => {
      removeEventListener("scroll", onScroll);
    };
  }, [ready]);
  return (
    <nav aria-label="Settings sections" className="sticky top-8 hidden flex-col gap-0.5 self-start lg:flex">
      {SECTIONS.map(([id, label]) => (
        <button
          key={id}
          type="button"
          aria-current={active === id ? "true" : undefined}
          onClick={() => {
            picked.current = Date.now();
            setActive(id);
            document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
          className={cn(
            "flex h-8 items-center rounded-md px-3 text-left text-sm font-medium transition-colors",
            // The sidebar's and Profile's selected item.
            active === id ? "bg-surface text-fg shadow-xs ring-1 ring-border" : "text-fg-muted hover:bg-subtle hover:text-fg",
            id === "danger" && active !== id && "text-danger-text/80",
          )}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function autoState(s: Summary): [Tone, string, string] {
  const a = s.autoApply;
  if (!a.enabled) return ["neutral", "Off", "Every application waits for your approval in Review."];
  if (!a.phases.includes(s.phase)) return ["neutral", `Off in the ${s.phase} phase`, `It runs in the ${a.phases.join(" and ") || "no"} phase.`];
  return [
    "success",
    "On",
    `Jobs scoring ${a.minScore} or more with verified practice evidence${a.allowConcerns ? "" : " and no concerns raised"} are approved for you.`,
  ];
}

function General({ s }: { s: Summary }) {
  const held = s.counts["held"] ?? 0;
  return (
    <SettingsSection id="general" title="General">
      <SettingsCard footer={<FromConfig />}>
        <SettingRow
          label="Phase"
          description={
            s.phase === "practice"
              ? "Applies only where your real search wouldn't, to practise. Everything else is held for the real search."
              : "Applies to the jobs you're after."
          }
        >
          <span className="font-medium">{cap(s.phase)}</span>
        </SettingRow>
        {s.phase === "practice" && (
          <SettingRow label="Held for the real search" description="They go back through triage once you switch phase.">
            <span className="tabular">{num(held)}</span>
            <Button asChild size="sm" variant="ghost">
              <a href={href("archive", "held")}>View</a>
            </Button>
          </SettingRow>
        )}
        {s.threshold != null && (
          <SettingRow label="Fit threshold" description="Postings that score below it are skipped.">
            <span className="tabular">{s.threshold}</span>
          </SettingRow>
        )}
        <SettingRow label="New applications a day" description="Blocked and failed starts count; resuming one already started doesn't. Resets at midnight UTC.">
          <span className="tabular">{num(s.applyPerDay)}</span>
        </SettingRow>
        <SettingRow
          label="Confirm before submitting"
          description={
            s.confirmBeforeSubmit ? "Applications you approve stop for your OK before they're sent." : "Applications you approve are sent without asking again."
          }
        >
          <span>{s.confirmBeforeSubmit ? "On" : "Off"}</span>
        </SettingRow>
      </SettingsCard>
      <SettingsCard>
        <SettingRow stack label="Add a posting" description="Paste a job URL to have it assessed like any posting a scan finds.">
          <Button
            icon={<Plus />}
            onClick={() => {
              shellActions.setAddOpen(true);
            }}
          >
            Add a posting
          </Button>
        </SettingRow>
      </SettingsCard>
    </SettingsSection>
  );
}

function AutoApply({ s }: { s: Summary }) {
  const a = s.autoApply;
  const [tone, label, note] = autoState(s);
  const on = tone === "success";
  const autoSubmits = on && a.submit;
  const confirmNote =
    (s.confirmBeforeSubmit ? "Manual approvals require your OK before submitting." : "Manually approved jobs submit without confirmation.") +
    (autoSubmits ? " Eligible auto-approved jobs submit directly." : " Auto-approved jobs still require your OK before submitting.");
  const used = Math.min(1, a.perDay ? a.approvedToday / a.perDay : 0);
  return (
    <SettingsSection id="auto-apply" title="Auto apply" description="Approves practice jobs for you, so they skip Review.">
      <SettingsCard footer={<FromConfig />}>
        <SettingRow label="Status" description={note}>
          <StatusLabel tone={tone} label={label} className="text-fg" />
        </SettingRow>
        <SettingRow label="Minimum fit">
          <span className="tabular">{a.minScore}</span>
        </SettingRow>
        <SettingRow stack label="Approvals a day" description="Daily quotas reset at midnight UTC.">
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
        <SettingRow
          label="Submits on its own"
          description={a.submit ? "Approved jobs are sent without your confirmation." : "Approved jobs still stop for your OK before they're sent."}
        >
          <span>{a.submit ? "Yes" : "No"}</span>
        </SettingRow>
        <div className="px-5 py-3">
          <Disclosure id="settings-auto" summary="How auto apply decides">
            <div className="space-y-3">
              <p>
                <span className="font-medium text-fg">Practice gate. </span>A job counts as practice only when its employer is one your real search rules out:
                on your practice list, or judged an early-stage startup, a non-tech enterprise, an IT services firm or consultancy, or government. Employers on
                your frontier list, and every tech company at scale (a rejection there follows you across its teams), are held back for the real search. Pay,
                location and a low real score are not practice proof.
              </p>
              <p>
                <span className="font-medium text-fg">Safeguards. </span>Missing practice proof is held back (not spent); low fit or failed qualifications are
                skipped. Hand-picked postings{a.allowConcerns ? "" : " and jobs with concerns"} wait in Review.
                {a.allowConcerns ? " Concerns alone do not block a proven practice role." : ""} Invalid auto-approvals are held before fill. {confirmNote}
              </p>
            </div>
          </Disclosure>
        </div>
      </SettingsCard>
    </SettingsSection>
  );
}

function Browser({ s }: { s: Summary }) {
  const slots = s.browsers;
  return (
    <SettingsSection id="browser" title="Browser">
      <SettingsCard footer={<FromConfig />}>
        <SettingRow
          stack
          label={slots.length > 1 ? "Browser slots" : "Browser"}
          description={
            slots.length > 1
              ? `Up to ${slots.length} browser slots run on this machine.`
              : slots.length
                ? "Chrome runs on this machine."
                : "Chrome runs on this machine. Viewing it from here needs a VNC port in the config."
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
        <div className="px-5 py-3">
          <Disclosure id="settings-browser" summary="Before you take over a browser">
            These are shared slot views, not application links. Ordinary parked applications release their slots; inspect their saved screenshot and checkpoint
            instead. Only explicitly reserved manual hand-offs and ambiguous submissions expose a browser link on their application page. Do not take over a
            browser without checking its current application.
          </Disclosure>
        </div>
      </SettingsCard>
    </SettingsSection>
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
    <SettingsSection id="danger" title="Danger zone">
      <SettingsCard className="border-danger/30">
        <SettingRow
          stack
          label="Release held jobs"
          description={
            held
              ? `Send all ${plural(held, "held job")} back through triage, where each is assessed again against the current phase.`
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
      </SettingsCard>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Release ${plural(held, "held job")}?`}
        description={`All ${num(held)} go back through triage and are assessed again. This can't be undone.`}
        confirm="Release them"
        danger
        onConfirm={() => void release()}
      />
    </SettingsSection>
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
    <Page>
      <PageHeader title="Settings" description="How the app runs: what it may do on its own, where mail goes, and the browser it applies with." />
      <div className="grid gap-10 lg:grid-cols-[176px_minmax(0,1fr)]">
        <SectionNav ready={!!s} />
        {s ? (
          <div className="flex max-w-3xl min-w-0 flex-col gap-12">
            <General s={s} />
            <Models />
            <AutoApply s={s} />
            <SettingsSection id="mail" title="Mail & digest">
              <Gmail s={s} />
              <Digest d={s.digest} />
            </SettingsSection>
            <Browser s={s} />
            <DangerZone s={s} />
          </div>
        ) : (
          <div className="flex max-w-3xl flex-col gap-4">
            <Skeleton className="h-64 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}
      </div>
    </Page>
  );
}
