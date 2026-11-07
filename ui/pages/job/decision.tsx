import {
  ArrowRight,
  Clock,
  Ban,
  Check,
  CircleHelp,
  ExternalLink,
  FileCheck2,
  FileText,
  Hand,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  PenLine,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  X,
  XCircle,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { JobDetail } from "../../../src/api-types";
import { RETRYABLE } from "../../../src/status";
import {
  Button,
  Clamp,
  ConfirmDialog,
  Dialog,
  DialogContent,
  Disclosure,
  Kbd,
  Linkified,
  ListIcon,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Properties,
  Spinner,
  StatusDot,
  Textarea,
  Time,
} from "../../components/ui";
import { useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ago, cap, plain } from "../../lib/format";
import { combo, useHotkeys } from "../../lib/hotkeys";
import type { Tone } from "../../lib/labels";
import { href } from "../../lib/router";
import { whyLabel } from "../../lib/why";
import { useDraft, type JobActions } from "./actions";
import { enteredOf, IN_PROGRESS, parsePending, setAsideOf, type DecisionKind } from "./model";

interface Act {
  key: string;
  label: string;
  run: () => void;
  icon?: ReactNode;
  keyable?: boolean;
  danger?: boolean;
  href?: string;
  shortcut?: string;
}

export interface Decision {
  placement: "card" | "bar";
  tone: Tone;
  icon: ReactNode;
  title: string;
  lead?: ReactNode;
  body?: ReactNode;
  primary?: Act | undefined;
  secondary: Act[];
  menu: Act[];
  why: string[];
  evidence: boolean;
  running?: boolean;
  saveKey?: boolean;
}

const CHECKPOINT_WHY =
  "A local checkpoint does not prove the employer saved the page. The worker verifies the existing draft before continuing. Its former browser may now belong to another application.";
const RESERVED_WHY = "You reserved this browser for inspection. Release browser when finished so other applications can use the slot.";

const RUNNING_TITLE: Partial<Record<JobDetail["status"], string>> = {
  approved: "Queued to apply",
  filling: "Applying",
  triaged: "Not assessed yet",
  prepping: "Assessing",
  locating: "Finding the posting",
};

function Asked({ text, context }: { text: string; context?: string | undefined }) {
  const long = text.length > 220 || text.split("\n").length > 3;
  const extra = context?.trim() && context.trim() !== text.trim() ? context.trim() : "";
  return (
    <div className="flex flex-col gap-2">
      {long ? (
        <blockquote className="border-l-2 border-border-strong pl-3">
          <Clamp lines={5} className="text-sm text-fg">
            <Linkified text={text} />
          </Clamp>
        </blockquote>
      ) : (
        <p className="text-base font-medium text-fg">
          <Linkified text={text} />
        </p>
      )}
      {extra && (
        <Clamp lines={3} className="text-sm text-fg-muted">
          <Linkified text={extra} />
        </Clamp>
      )}
    </div>
  );
}

function WhyAsked({ gate }: { gate: NonNullable<JobDetail["gate"]> }) {
  const label = whyLabel(gate.why);
  if (!label && !gate.missing) return null;
  return (
    <p className="text-sm break-words text-fg-muted">
      {label && <span className="font-medium text-fg">{label}</span>}
      {label && gate.missing && " · "}
      {gate.missing && `Missing: ${gate.missing}`}
    </p>
  );
}

function Options({ options, value, onPick }: { options: readonly string[]; value?: string; onPick?: (o: string) => void }) {
  if (!options.length) return null;
  const inline = options.length <= 4 && options.every(o => o.length <= 28);
  return (
    <div className={cn("flex gap-1.5", inline ? "flex-wrap" : "flex-col")} role={onPick ? "radiogroup" : undefined} aria-label="Options">
      {options.map(o =>
        onPick ? (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={value === o}
            onClick={() => {
              onPick(o);
            }}
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded-md border px-3 py-1.5 text-left text-sm transition-colors",
              !inline && "w-full",
              value === o ? "border-accent bg-accent-soft text-fg" : "border-border bg-surface text-fg hover:border-border-strong hover:bg-subtle",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                value === o ? "border-accent bg-accent text-accent-fg" : "border-border-strong",
              )}
            >
              {value === o && <Check className="size-2.5" strokeWidth={3.5} />}
            </span>
            {o}
          </button>
        ) : (
          <div key={o} className="flex items-center gap-2 text-sm text-fg-muted">
            <span className="size-1 shrink-0 rounded-full bg-fg-subtle" />
            {o}
          </div>
        ),
      )}
    </div>
  );
}

const PriorNote = ({ note }: { note: string | null }) =>
  note ? (
    <Disclosure id="prior-note" summary="Previous run note">
      <p className="text-sm text-fg-muted">
        <Linkified text={note} />
      </p>
    </Disclosure>
  ) : null;

function Entered({ text }: { text: string }) {
  const e = enteredOf(text);
  if ("text" in e)
    return (
      <p className="text-base text-fg">
        <Linkified text={e.text} />
      </p>
    );
  return (
    <div className="@container divide-y divide-border border-y border-border text-sm">
      {e.rows.map(([k, v], i) =>
        k ? (
          <div key={i} className="grid gap-0.5 py-2.5 @md:grid-cols-[150px_minmax(0,1fr)] @md:gap-6">
            <div className="text-fg-muted">{k}</div>
            <div className="break-words whitespace-pre-line text-fg">
              <Linkified text={v} />
            </div>
          </div>
        ) : (
          <p key={i} className="py-2.5 break-words whitespace-pre-line text-fg-muted">
            <Linkified text={v} />
          </p>
        ),
      )}
    </div>
  );
}

function AnswerBox({
  label,
  hint,
  value,
  onChange,
  onSubmit,
  rows,
  placeholder,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  rows: number;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-fg">{label}</span>
      <Textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={e => {
          onChange(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
      {hint && <span className="text-sm text-fg-muted">{hint}</span>}
    </label>
  );
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

export function useDecision(job: JobDetail, kind: DecisionKind | null, a: JobActions): { decision: Decision | null; dialogs: ReactNode } {
  const { data: summary } = useSummary();
  const gate = job.gate;
  const [answer, setAnswer] = useDraft(`answer:${gate?.id ?? job.id}`);
  const [change, setChange] = useDraft(`change:${gate?.id ?? job.id}`);
  const [feedback, setFeedback] = useDraft(`redo:${job.id}`);
  const feedbackBox = useRef<HTMLTextAreaElement>(null);
  const [changing, setChanging] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [confirm, setConfirm] = useState<"mark_submitted" | "confirmed_not_submitted" | null>(null);

  const ambiguous = job.submissionAmbiguous;
  const checkpointWhy = job.checkpoint ? [CHECKPOINT_WHY] : [];
  const asked = gate?.createdAt ? `Asked ${ago(gate.createdAt)}` : "";
  const hold: Act[] = ambiguous ? [] : [{ key: "hold", label: "Hold for later", icon: <Pause />, shortcut: "H", run: () => void a.act("hold") }];
  const reject = (label = "Reject"): Act => ({ key: "reject", label, icon: <X />, danger: true, shortcut: "X", run: () => void a.act("reject") });
  const markSubmitted = (label: string): Act => ({
    key: "mark_submitted",
    label,
    icon: <Send />,
    run: () => {
      if (ambiguous) setConfirm("mark_submitted");
      else void a.act("mark_submitted");
    },
  });
  const live: Act[] = job.vncUrl ? [{ key: "live", label: "Inspect reserved browser", icon: <MonitorPlay />, href: job.vncUrl, run: () => undefined }] : [];
  const reserve: Act = { key: "reserve", label: "Reserve browser", icon: <MonitorPlay />, run: () => void a.browser("reserve") };
  const release: Act = { key: "release", label: "Release browser", icon: <Ban />, run: () => void a.browser("release") };
  const recover: Act = { key: "recover", label: "Check status and recover", icon: <RefreshCw />, run: () => void a.recover() };
  const typed = (text: string, then?: () => void) => {
    if (!text.trim()) {
      toastTypeFirst();
      return;
    }
    void a.act("respond", text.trim()).then(ok => {
      if (ok) then?.();
    });
  };

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={o => {
          if (!o) setConfirm(null);
        }}
        title={confirm === "confirmed_not_submitted" ? "Verified not submitted?" : "Verified submitted?"}
        description={
          confirm === "confirmed_not_submitted"
            ? "I inspected the existing employer application/account and confirmation mail and verified this application was NOT submitted. Requeue this existing application?"
            : "I verified the existing application was submitted. Mark it submitted without another submit attempt?"
        }
        confirm={confirm === "confirmed_not_submitted" ? "Requeue application" : "Mark submitted"}
        onConfirm={() => {
          if (confirm) void a.act(confirm);
        }}
      />
      <Dialog open={redoOpen} onOpenChange={setRedoOpen}>
        <DialogContent
          onOpenAutoFocus={e => {
            e.preventDefault();
            feedbackBox.current?.focus();
          }}
          title="Change the resume"
          description="The assessment runs again with your note, and the tailored resume is rebuilt before this job comes back for review."
          footer={
            <>
              <Button
                onClick={() => {
                  setRedoOpen(false);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={a.busy === "redo"}
                onClick={() => {
                  if (!feedback.trim()) {
                    toastTypeFirst();
                    return;
                  }
                  void a.act("redo", feedback.trim()).then(ok => {
                    if (!ok) return;
                    setFeedback("");
                    setRedoOpen(false);
                  });
                }}
              >
                Redo with this note
              </Button>
            </>
          }
        >
          <Textarea
            ref={feedbackBox}
            rows={4}
            value={feedback}
            placeholder="What should change in the resume?"
            onChange={e => {
              setFeedback(e.target.value);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );

  const evidence = !!gate?.shot || !!job.checkpoint;
  const base = { secondary: [] as Act[], menu: [] as Act[], why: [] as string[], evidence: false };
  let d: Decision | null = null;

  if (kind === "verify") {
    const running = job.status === "filling";
    d = {
      ...base,
      placement: "card",
      tone: "info",
      icon: <ShieldAlert />,
      running,
      title: running ? "Checking application status" : "Queued to check status",
      lead: running ? "The agent is checking the exact application and mail in the browser." : "Waiting for an eligible browser worker.",
      body: <PriorNote note={job.note} />,
      menu: [reject("Reject application")],
      why: ["No new submit happens while the status is unknown.", ...checkpointWhy],
      evidence,
    };
  } else if (kind === "ambiguous") {
    const context = (gate?.context || parsePending(job.pending)?.context || "").trim();
    const reason = context && context !== gate?.text ? context : (gate?.text ?? job.note ?? "");
    d = {
      ...base,
      placement: "card",
      tone: "warning",
      icon: <ShieldAlert />,
      title: "Submission outcome unknown",
      lead: "The final submit may already have happened. Check before anything is sent again.",
      body: (
        <div className="flex flex-col gap-4">
          {reason && (
            <p className="text-base text-fg">
              <Linkified text={reason} />
            </p>
          )}
          <div className="divide-y divide-border border-y border-border">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <span className="min-w-36 flex-1 text-sm text-fg-muted">Look for yourself</span>
              {job.manualBrowserReserved ? (
                <>
                  {live.map(l => (
                    <ActButton key={l.key} act={l} busy={a.busy} size="sm" />
                  ))}
                  <ActButton act={release} busy={a.busy} size="sm" />
                </>
              ) : (
                <ActButton act={reserve} busy={a.busy} size="sm" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
              <span className="min-w-36 flex-1 text-sm text-fg-muted">I checked it myself</span>
              <ActButton act={markSubmitted("Verified submitted")} busy={a.busy} size="sm" />
              <ActButton
                act={{
                  key: "confirmed_not_submitted",
                  label: "Verified not submitted",
                  icon: <RotateCcw />,
                  run: () => {
                    setConfirm("confirmed_not_submitted");
                  },
                }}
                busy={a.busy}
                size="sm"
              />
            </div>
          </div>
        </div>
      ),
      primary: a.gateId ? { ...recover, keyable: true } : undefined,
      menu: [reject()],
      why: [
        "Check status and recover: the agent signs in with saved credentials and checks the exact application and mail; no new submit while the status is unknown.",
        "To check yourself, inspect the existing application/account and confirmation mail. Ordinary retry and response are disabled; never create another application to check.",
        job.manualBrowserReserved
          ? RESERVED_WHY
          : "This blocker releases its slot after the worker exits. Reserve the browser only when you need to inspect it. The saved draft, checkpoint and submission protection remain intact.",
        ...checkpointWhy,
      ],
      evidence,
    };
  } else if (kind === "review") {
    d = {
      ...base,
      placement: "bar",
      tone: "accent",
      icon: <Send />,
      title: "Apply to this job?",
      lead: job.resumeFrozen
        ? "This application already started with its frozen resume, so the resume can no longer be changed."
        : summary?.approval === "auto"
          ? "The agent fills the form and sends it."
          : "The agent fills the form, then asks before sending.",
      primary: { key: "approve", label: "Approve", icon: <Check />, keyable: true, run: () => void a.act("approve") },
      secondary: job.resumeFrozen
        ? []
        : [
            {
              key: "redo",
              label: "Change resume",
              icon: <PenLine />,
              run: () => {
                setRedoOpen(true);
              },
            },
          ],
      menu: [...hold, reject()],
    };
  } else if ((kind === "question" || kind === "cover_letter") && gate) {
    const letter = kind === "cover_letter";
    const save = () => {
      typed(answer, () => {
        setAnswer("");
      });
    };
    d = {
      ...base,
      placement: "card",
      tone: "warning",
      icon: letter ? <FileText /> : <CircleHelp />,
      title: letter ? "This application needs a cover letter" : "The agent needs an answer",
      lead: asked,
      body: (
        <div className="flex flex-col gap-4">
          <Asked text={gate.text} context={gate.context} />
          {!letter && <WhyAsked gate={gate} />}
          {!letter && <Options options={gate.options} value={answer} onPick={setAnswer} />}
          <AnswerBox
            label={letter ? "Cover letter" : "Your answer"}
            hint={letter ? (answer ? `${words(answer)} words` : "Entered exactly as you write it") : "For this application only"}
            rows={letter ? 12 : 3}
            value={answer}
            onChange={setAnswer}
            onSubmit={save}
            placeholder={letter ? "Dear hiring team," : "Type the answer the agent should enter"}
          />
          {!letter && (
            <p className="text-sm text-fg-muted">
              Other applications ask this too?{" "}
              <a href={href("questions", gate.groupKey)} className="text-accent-text underline-offset-2 hover:underline">
                Answer all matching in Questions
              </a>
            </p>
          )}
        </div>
      ),
      primary: { key: "respond", label: letter ? "Save letter and queue" : "Save and queue", icon: <ArrowRight />, run: save },
      saveKey: true,
      menu: [...hold, reject()],
      why: [
        letter
          ? "The letter is stored for this application only and typed into the form as written."
          : "Stored for this application only, not added to your answers. To add it to them as well, answer it from Questions.",
        ...checkpointWhy,
      ],
      evidence,
    };
  } else if (kind === "confirm_submit" && gate) {
    d = {
      ...base,
      placement: "card",
      tone: "warning",
      icon: <FileCheck2 />,
      title: "Submit this application?",
      lead: `Filled in and waiting. ${asked}`.trim(),
      body: (
        <div className="flex flex-col gap-4">
          <Entered text={gate.text} />
          {changing && (
            <div className="flex animate-in flex-col gap-3 border-t border-border pt-4">
              <AnswerBox
                label="Changes for this application"
                rows={3}
                value={change}
                onChange={setChange}
                onSubmit={() => {
                  typed(change, () => {
                    setChange("");
                  });
                }}
                placeholder="What should the agent change first?"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setChanging(false);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  loading={a.busy === "respond"}
                  onClick={() => {
                    typed(change, () => {
                      setChange("");
                    });
                  }}
                >
                  Save changes and queue
                </Button>
              </div>
            </div>
          )}
        </div>
      ),
      primary: { key: "respond", label: "Approve submission", icon: <Send />, run: () => void a.act("respond", "approve") },
      secondary: changing
        ? []
        : [
            {
              key: "change",
              label: "Change something",
              icon: <PenLine />,
              run: () => {
                setChanging(true);
              },
            },
          ],
      menu: [...hold, reject()],
      why: ["Approval applies only to this application's exact saved summary. The worker resumes and verifies it before submitting.", ...checkpointWhy],
      evidence,
    };
  } else if (kind === "manual" && gate) {
    const reserved = job.manualBrowserReserved;
    const handBack: Act = { key: "respond", label: "Hand control back", icon: <ArrowRight />, keyable: true, run: () => void a.act("respond", "done") };
    d = {
      ...base,
      placement: "card",
      tone: "warning",
      icon: <Hand />,
      title: "Browser hand-off",
      lead: `The agent needs you to take over. ${asked}`.trim(),
      body: (
        <div className="flex flex-col gap-3">
          <Asked text={gate.text} context={gate.context} />
          <Options options={gate.options} />
        </div>
      ),
      primary: reserved ? handBack : { ...reserve, keyable: true },
      secondary: reserved ? live : [recover],
      menu: reserved ? [release, recover, markSubmitted("I submitted it"), ...hold, reject()] : [markSubmitted("I submitted it"), ...hold, reject()],
      why: [
        reserved
          ? RESERVED_WHY
          : "This blocker releases its slot after the worker exits. Reserve the browser before inspecting or changing it. The saved draft and checkpoint remain intact.",
        "Hand control back and Check status and recover resume the authorized application after checking its current state; existing drafts are reused and submission approval rules still apply.",
        ...checkpointWhy,
      ],
      evidence,
    };
  } else if (kind === "failed") {
    d = {
      ...base,
      placement: "card",
      tone: "danger",
      icon: <XCircle />,
      title: "This application failed",
      body: (
        <p className="text-base text-fg-muted">
          <Linkified text={cap(job.note ?? "No reason was recorded.")} />
        </p>
      ),
      primary: { key: "retry", label: "Retry", icon: <RotateCcw />, keyable: true, run: () => void a.act("retry") },
      secondary: live,
      menu: [markSubmitted("Mark submitted"), ...hold, reject()],
      evidence,
    };
  } else if (kind === "held") {
    d = {
      ...base,
      placement: "bar",
      tone: "neutral",
      icon: <Pause />,
      title: "Held for later",
      lead: <SetAside job={job} />,
      primary: { key: "retry", label: "Assess now", icon: <RotateCcw />, keyable: true, run: () => void a.act("retry") },
      menu: [reject()],
    };
  } else if (kind === "rejected" || kind === "skipped") {
    const blocked = !RETRYABLE.includes(job.status) || (kind === "rejected" && ambiguous);
    d = {
      ...base,
      placement: "bar",
      tone: "neutral",
      icon: <Ban />,
      title: kind === "rejected" ? "Rejected" : "Skipped by the assessment",
      lead: blocked ? "Rejected with an unresolved submission marker. Reconsidering is disabled to prevent a duplicate application." : <SetAside job={job} />,
      secondary: blocked ? [] : [{ key: "retry", label: "Reconsider", icon: <RotateCcw />, run: () => void a.act("retry") }],
    };
  } else if (kind === "running") {
    const working = IN_PROGRESS.includes(job.status);
    const last = working ? job.events.find(e => e.kind === "step") : undefined;
    const resuming = job.checkpoint && (job.status === "approved" || job.status === "filling");
    d = {
      ...base,
      placement: "card",
      tone: "info",
      icon: working ? <Spinner className="size-4" /> : <Clock />,
      running: working,
      title: RUNNING_TITLE[job.status] ?? cap(job.status),
      lead: resuming
        ? job.status === "approved"
          ? "Queued to resume the authorized application when a worker is available."
          : "Resuming the authorized application with its saved answers and frozen resume."
        : last
          ? plain(last.message)
          : "Waiting for a free worker.",
      body: <PriorNote note={job.note} />,
      menu: [reject("Stop and reject")],
      why: checkpointWhy,
      evidence,
    };
  }
  return { decision: d, dialogs };
}

function SetAside({ job }: { job: JobDetail }) {
  const why = setAsideOf(job);
  if (!why) return null;
  return <span title={why.detail ?? undefined}>{why.label}</span>;
}

const toastTypeFirst = () => toast.error("Type something first.");

function ActButton({
  act,
  busy,
  variant = "secondary",
  size = "md",
  className,
}: {
  act: Act;
  busy: string | null;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  className?: string;
}) {
  if (act.href)
    return (
      <Button asChild variant={variant} size={size} className={className}>
        <a href={act.href} target="_blank" rel="noopener noreferrer">
          {act.icon}
          {act.label}
          <ExternalLink className="text-fg-subtle" />
        </a>
      </Button>
    );
  return (
    <Button
      variant={act.danger && variant !== "primary" ? "danger-ghost" : variant}
      size={size}
      className={className}
      icon={act.icon}
      loading={busy === act.key}
      disabled={!!busy && busy !== act.key}
      {...(variant === "primary" && act.keyable && { shortcut: "A" })}
      onClick={act.run}
    >
      {act.label}
    </Button>
  );
}

function MoreMenu({ acts, busy, label = "More actions" }: { acts: Act[]; busy: string | null; label?: string }) {
  if (!acts.length) return null;
  const safe = acts.filter(x => !x.danger),
    risky = acts.filter(x => x.danger);
  return (
    <Menu>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={label} disabled={!!busy}>
          <MoreHorizontal />
        </Button>
      </MenuTrigger>
      <MenuContent>
        {safe.map(x => (
          <MenuItem key={x.key + x.label} icon={x.icon} {...(x.shortcut && { shortcut: x.shortcut })} onSelect={x.run}>
            {x.label}
          </MenuItem>
        ))}
        {safe.length > 0 && risky.length > 0 && <MenuSeparator />}
        {risky.map(x => (
          <MenuItem key={x.key + x.label} icon={x.icon} {...(x.shortcut && { shortcut: x.shortcut })} danger onSelect={x.run}>
            {x.label}
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

export function useDecisionKeys(d: Decision | null, busy: string | null) {
  const find = (key: string) => d?.menu.find(x => x.key === key);
  useHotkeys([
    {
      key: "a",
      run: () => {
        if (!busy && d?.primary?.keyable) d.primary.run();
      },
    },
    {
      key: "x",
      run: () => {
        if (!busy) find("reject")?.run();
      },
    },
    {
      key: "h",
      run: () => {
        if (!busy) find("hold")?.run();
      },
    },
  ]);
}

function Evidence({ job }: { job: JobDetail }) {
  const shot = job.gate?.shot,
    c = job.checkpoint;
  return (
    <Disclosure id="gate-evidence" summary={shot ? (c ? "Saved page and checkpoint" : "Saved page") : "Saved checkpoint"}>
      <div className="flex flex-col gap-4 pt-1">
        {shot && (
          <a
            href={`/api/jobs/${job.id}/gate.png?v=${shot}`}
            target="_blank"
            rel="noopener noreferrer"
            className="block overflow-hidden rounded-lg border border-border shadow-xs"
            title="Open full size"
          >
            <img src={`/api/jobs/${job.id}/gate.png?v=${shot}`} alt="Saved application page, not a live browser" className="w-full" />
          </a>
        )}
        {c && (
          <Properties
            items={[
              ["Saved", <Time key="t" at={c.savedAt} />],
              ["Step", c.step],
              ["Page", c.url ? <Linkified text={c.url} /> : "Not recorded"],
              c.notes ? ["Notes", <Linkified key="n" text={c.notes} />] : null,
              ["Resume", c.resumeSha ? <code className="font-mono text-xs">{c.resumeSha.slice(0, 16)}</code> : "Not recorded"],
            ]}
          />
        )}
      </div>
    </Disclosure>
  );
}

export function DecisionCard({ d, job, busy }: { d: Decision; job: JobDetail; busy: string | null }) {
  const hasActions = !!d.primary || d.secondary.length > 0;
  return (
    <section data-decision={d.title}>
      <div className="flex items-start gap-3">
        <ListIcon icon={d.icon} tone={d.tone} />
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-fg">
            {d.title}
            {d.running && <StatusDot tone="info" pulse />}
          </h3>
          {d.lead && <p className="mt-0.5 text-sm text-fg-muted">{d.lead}</p>}
        </div>
        <MoreMenu acts={d.menu} busy={busy} />
      </div>
      {d.body && <div className="pt-4">{d.body}</div>}
      {hasActions && (
        <div className="flex flex-wrap items-center gap-2 pt-5">
          {d.primary && <ActButton act={d.primary} busy={busy} variant="primary" />}
          {d.secondary.map(x => (
            <ActButton key={x.key + x.label} act={x} busy={busy} />
          ))}
          {d.saveKey && (
            <span className="ml-auto hidden items-center gap-1.5 text-xs text-fg-muted sm:inline-flex">
              <Kbd>{combo("↵")}</Kbd>
              to save
            </span>
          )}
        </div>
      )}
      {(d.why.length > 0 || d.evidence) && (
        <div className="mt-4 flex flex-col gap-1 border-t border-border pt-3">
          {d.why.length > 0 && (
            <Disclosure id="gate-why" summary="How this works">
              <div className="flex flex-col gap-1.5">
                {d.why.map(w => (
                  <p key={w}>{w}</p>
                ))}
              </div>
            </Disclosure>
          )}
          {d.evidence && <Evidence job={job} />}
        </div>
      )}
    </section>
  );
}

const FILL = "max-sm:h-9 @max-lg:flex-1 max-sm:[&_kbd]:hidden";

export function DecisionBar({ d, busy, docked }: { d: Decision; busy: string | null; docked: boolean }) {
  return (
    <div
      className={cn(
        "border-t border-border bg-surface/95 backdrop-blur",
        docked ? "sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 animate-slide-up px-(--list-x) py-3 lg:bottom-0" : "px-4 py-3 sm:px-6",
      )}
      data-decision={d.title}
    >
      <div className="@container flex max-w-3xl items-center gap-3">
        <div className={cn("min-w-0 flex-1", (d.primary ?? d.secondary.length) && "hidden @lg:block")}>
          <p className="truncate text-sm font-medium text-fg">{d.title}</p>
          {d.lead && <div className="line-clamp-2 text-sm text-fg-muted">{d.lead}</div>}
        </div>
        <MoreMenu acts={d.menu} busy={busy} />
        {d.secondary.map(x => (
          <ActButton key={x.key + x.label} act={x} busy={busy} className={FILL} />
        ))}
        {d.primary && <ActButton act={d.primary} busy={busy} variant="primary" className={FILL} />}
      </div>
    </div>
  );
}
