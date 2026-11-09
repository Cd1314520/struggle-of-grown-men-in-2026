import { ExternalLink, MailWarning, RotateCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { Button, ConfirmDialog, ListNotice, SectionNav, Skeleton, SkeletonRows, StatusLabel, Workspace, WorkspaceBody } from "../../components/ui";
import { api, refreshAll, useModels, useSettings, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num, plural } from "../../lib/format";
import { href, useRoute } from "../../lib/router";
import { onPageScroll, pageScroller } from "../../lib/scroller";
import { Mail } from "./mail";
import { Models } from "./models";
import { ConfigRow, type Confirm } from "./field";
import { SettingRow, SettingsPanel } from "./parts";
import { BrowserRows, Schedule, Server, Sources } from "./sections";

const SECTIONS = [
  ["general", "General"],
  ["auto-apply", "Auto-apply"],
  ["mail", "Mail & digest"],
  ["schedule", "Schedule & limits"],
  ["models", "Models"],
  ["sources", "Sources"],
  ["browser", "Browser"],
  ["server", "Server"],
  ["danger", "Danger zone"],
] as const;
type Section = (typeof SECTIONS)[number][0];

function Nav({ ready }: { ready: boolean }) {
  const [active, setActive] = useState<Section>(SECTIONS[0][0]);
  const picked = useRef(0);
  useEffect(() => {
    if (!ready) return;
    const onScroll = () => {
      if (Date.now() - picked.current < 1000) return;
      let current: Section = SECTIONS[0][0];
      for (const [id] of SECTIONS) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= 140) current = id;
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
const COVER_LETTERS = [
  { value: "skip", label: "Skip the job" },
  { value: "draft", label: "Draft for me" },
] as const;

function RestartNotice() {
  const { data } = useSettings();
  if (!data?.pending.length) return null;
  return (
    <ListNotice tone="warning" icon={<RotateCw />}>
      Saved changes to {data.pending.join(", ")} are used once the app restarts: <code className="font-mono text-xs">systemctl --user restart auto-apply</code>
    </ListNotice>
  );
}

function MailNotice({ s }: { s: Summary }) {
  const d = s.digest;
  const digestDown = d.enabled && (d.deliveryState === "failed" || d.deliveryState === "abandoned");
  if (s.gmail.connected && !digestDown) return null;
  return (
    <ListNotice tone="warning" icon={<MailWarning />}>
      {!s.gmail.connected ? (
        <>
          Gmail isn&apos;t connected: applications that need an account or an emailed code stop, and no digest goes out.{" "}
          <a className="font-medium underline underline-offset-2" href="/oauth/start">
            Connect Gmail
          </a>
        </>
      ) : (
        <>
          {d.deliveryState === "abandoned" ? "The questions digest gave up after repeated failures" : "The last questions digest failed to send"}
          {d.lastError ? `: ${d.lastError}` : "."}{" "}
          <a className="font-medium underline underline-offset-2" href={href("settings", "mail")}>
            Mail &amp; digest
          </a>
        </>
      )}
    </ListNotice>
  );
}

const link = "text-accent-text underline-offset-2 hover:underline";
const APPROVAL_LABEL: Record<string, string> = { auto: "Auto-apply", gated: "Gated" };

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
  const raw = useSettings().data?.values["approval"];
  const saved = typeof raw === "string" ? raw : undefined;
  const a = s.autoApply;
  return (
    <SettingsPanel id="general" title="General">
      <ConfigRow
        path="approval"
        label="Approval"
        description={
          <>
            {(saved ?? s.approval) === "auto"
              ? "Approves and sends jobs that clear the auto-apply bar. Hand-picked jobs and questions it can't answer still wait for you."
              : "You approve every job in Review and OK every application before it's sent."}
            {saved !== undefined && saved !== s.approval && (
              <span className="block text-warning-text">
                Saved as {APPROVAL_LABEL[saved] ?? saved}; the app is running {APPROVAL_LABEL[s.approval] ?? s.approval}.
              </span>
            )}
            {a.enabled && (
              <span className="block">
                {num(a.approvedToday)} of {num(a.perDay)} auto-approvals used today.
              </span>
            )}
          </>
        }
        field={{ kind: "choice", options: APPROVALS }}
      />
      <ConfigRow
        path="coverLetters"
        label="Required cover letters"
        description="When a form requires a cover letter: skip the application, or have the agent draft one that waits for you to edit and approve, even under Auto-apply. Optional cover letters are always left empty."
        field={{ kind: "choice", options: COVER_LETTERS }}
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
      {s.targets.holdBack && (
        <SettingRow label="Held for later" description="Released back through triage when you stop holding them back.">
          <span className="tabular">{num(held)}</span>
          <Button asChild size="sm" variant="link" className="-my-1 px-0 touch:-my-1.5 touch:px-0">
            <a href={href("archive", "held")}>View</a>
          </Button>
        </SettingRow>
      )}
      <ConfigRow
        path="targets.describe"
        label="Target employers"
        description={
          <>
            Besides the frontier list in{" "}
            <a className={link} href={href("profile", "employers.yml")}>
              employers.yml
            </a>
            , employers the assessment judges to fit this. Empty: the list alone.
          </>
        }
        field={{ kind: "words", placeholder: "The list alone" }}
      />
    </SettingsPanel>
  );
}

function AutoApply({ s }: { s: Summary }) {
  const a = s.autoApply;
  const t = s.thresholds;
  const used = Math.min(1, a.perDay ? a.approvedToday / a.perDay : 0);
  return (
    <SettingsPanel
      id="auto-apply"
      title="Auto-apply"
      description={a.enabled ? "Used while Approval is Auto-apply." : "Off: Approval is Gated, so every job waits for you in Review."}
    >
      <SettingRow stack label="Status" description="Approvals reset at midnight UTC.">
        <StatusLabel tone={a.enabled ? "success" : "neutral"} label={a.enabled ? "On" : "Off"} className="text-fg" />
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
          <div className={cn("h-full rounded-full", used >= 1 ? "bg-warning" : "bg-accent")} style={{ width: `${used * 100}%` }} />
        </div>
        <span className="tabular">
          {a.approvedToday > a.perDay ? `${num(a.approvedToday)} today, limit ${num(a.perDay)}` : `${num(a.approvedToday)} of ${num(a.perDay)} today`}
        </span>
      </SettingRow>
      <ConfigRow
        path="autoApply.minScore"
        label="Minimum fit"
        description={
          t ? (
            <>
              Fit thresholds in{" "}
              <a className={link} href={href("profile", "rubric.yml")}>
                rubric.yml
              </a>
              : practice {t.practice}, real {t.real}. A score alone never makes a job practice.
            </>
          ) : (
            "A score alone never makes a job practice."
          )
        }
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
        description={`New applications are still capped at ${num(s.applyPerDay)} a day.`}
        field={{ kind: "number", unit: "a day" }}
      />
      <ConfigRow
        path="autoApply.perEmployer"
        label="Applications per employer"
        description="Ever, sent or under way. Further passing roles there wait for your review."
        field={{ kind: "number" }}
      />
    </SettingsPanel>
  );
}

function Browser({ s }: { s: Summary }) {
  const slots = s.browsers;
  return (
    <SettingsPanel
      id="browser"
      title="Browser"
      description={slots.length ? undefined : "Live view is off: set a live view port to watch the browser from here."}
    >
      {slots.length > 0 && (
        <SettingRow stack label="Live view" description="Shared browser slots. Check which application a browser is on before you take it over.">
          {slots.map((u, i) => (
            <Button key={u} asChild size="sm">
              <a href={u} target="_blank" rel="noopener noreferrer">
                {slots.length > 1 ? `Open browser ${i + 1}` : "Open browser"}
                <ExternalLink />
              </a>
            </Button>
          ))}
        </SettingRow>
      )}
      <BrowserRows />
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
          held ? (
            <>
              Sends {plural(held, "held job")} back through triage to be assessed again.{" "}
              <a className={link} href={href("archive", "held")}>
                View
              </a>
            </>
          ) : (
            "No jobs are held back."
          )
        }
      >
        <Button
          size="sm"
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
  const { data: settings } = useSettings();
  const { isPending: modelsPending } = useModels();
  const { parts } = useRoute();
  const section = parts[0];
  const ready = !!s;
  const settled = ready && !!settings && !modelsPending;
  useEffect(() => {
    if (settled && section) requestAnimationFrame(() => document.getElementById(section)?.scrollIntoView({ block: "start" }));
  }, [settled, section]);
  return (
    <Workspace
      className="max-lg:[&>:first-child]:border-b-0"
      bar={{ title: "Settings", hint: "Changes are saved to config.local.yml, laid over config.yml; reset goes back to config.yml." }}
    >
      <WorkspaceBody asideSide="left" asideWidth="nav" aside={<Nav ready={ready} />}>
        {s ? (
          <>
            <RestartNotice />
            <MailNotice s={s} />
            <General s={s} />
            <AutoApply s={s} />
            <Mail s={s} />
            <Schedule />
            <Models />
            <Sources />
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
