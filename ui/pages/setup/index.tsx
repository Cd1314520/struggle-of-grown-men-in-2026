import { Check, ChevronDown, CircleCheck, Copy, ExternalLink, Minus, Radar, RefreshCw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { SetupCheck, SetupResult, SetupStep, SetupStepId } from "../../../src/api-types";
import { Button, Disclosure, ListIcon, ListNotice, SkeletonRows, Workspace } from "../../components/ui";
import { api, queryClient, refreshAll, useSetup, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { href } from "../../lib/router";

function Code({ children }: { children: string }) {
  return (
    <div className="group relative my-2 rounded-md border border-border bg-subtle">
      <pre className="overflow-x-auto px-3 py-2 pr-10 font-mono text-xs leading-5 text-fg">{children}</pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => toast.success("Copied"));
        }}
        className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md text-fg-subtle hover:bg-muted hover:text-fg touch:size-9"
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}
const Mono = ({ children }: { children: ReactNode }) => <code className="font-mono text-xs text-fg">{children}</code>;

interface StepCopy {
  title: string;
  description: string;
  how?: (r: SetupResult) => ReactNode;
  action?: (props: { primary: boolean; step: SetupStep; result: SetupResult }) => ReactNode;
  shown?: (c: SetupCheck) => boolean;
}

const link = (to: string, label: string) =>
  function StepLink({ primary }: { primary: boolean }) {
    return (
      <Button asChild variant={primary ? "primary" : "secondary"}>
        <a href={to}>{label}</a>
      </Button>
    );
  };

function ScanNow({ primary, result }: { primary: boolean; result: SetupResult }) {
  const [busy, setBusy] = useState(false);
  const profile = result.steps.find(s => s.id === "profile");
  const ready = !!profile?.checks.find(c => c.key === "targets.md")?.ok;
  return (
    <Button
      variant={primary ? "primary" : "secondary"}
      icon={<Radar />}
      loading={busy}
      disabled={!ready || busy}
      onClick={() => {
        setBusy(true);
        api.run("scan").then(
          () => {
            toast.success("Scan started", { description: "New postings show up in Pipeline as triage reads them." });
            void refreshAll();
            setBusy(false);
          },
          () => {
            setBusy(false);
          },
        );
      }}
    >
      Scan now
    </Button>
  );
}

const STEPS: Record<SetupStepId, StepCopy> = {
  tools: {
    title: "Install the programs it runs",
    description: "The app starts these itself, so they must be on the PATH the service runs with.",
    how: () => (
      <>
        <p>On Debian or Ubuntu, most come from the package manager:</p>
        <Code>sudo apt install xvfb x11vnc websockify novnc poppler-utils git</Code>
        <p>
          Install Google Chrome from its <Mono>.deb</Mono>, Typst from its releases (or <Mono>cargo install typst-cli</Mono>), and omp, Claude Code or Codex
          (any of them), so that <Mono>omp --version</Mono>, <Mono>claude --version</Mono> or <Mono>codex --version</Mono> runs. On Windows the Codex desktop
          app&apos;s own CLI is found without being on the PATH. Then restart the service so it sees them:
        </p>
        <Code>systemctl --user restart auto-apply</Code>
        <p>
          The unit sets its own <Mono>PATH</Mono> (<Mono>deploy/systemd/auto-apply.service</Mono>): a program installed somewhere else needs adding there.
        </p>
      </>
    ),
  },
  models: {
    title: "Connect a model provider",
    description: "Every agent runs through omp, Claude Code or Codex. Sign in to at least one, then choose a model for each kind of work.",
    shown: c => !c.ok || c.key === "catalog",
    how: () => (
      <>
        <p>
          In a terminal on this machine, log in to a provider through omp (a subscription or an API key), sign in to Claude Code, or sign in to Codex for this
          app (its workers keep their own sign-in under <Mono>data/codex</Mono>, apart from your own Codex setup), then check again:
        </p>
        <Code>omp login</Code>
        <Code>claude auth login</Code>
        <Code>bun run codex:login</Code>
        <p>
          A stage on a <Mono>claude-code/…</Mono> model runs through Claude Code, one on a <Mono>codex/…</Mono> model through Codex; any other through omp.
        </p>
        <p>
          A stage left on omp&apos;s default uses whatever model omp picks. Cheap, fast models suit triage and the screen; assessing, tailoring and filling
          forms need a capable one.
        </p>
      </>
    ),
    action: link(href("settings", "models"), "Choose models"),
  },
  machine: {
    title: "Say who you are and where the app lives",
    description: "config.local.yml holds what identifies you and this machine. It is not tracked, and is laid over config.yml key by key.",
    how: r => (
      <>
        <p>Start from the example, then fill in the mailbox applications are sent from, and the name employers see on your resume:</p>
        <Code>cp config.local.example.yml config.local.yml</Code>
        <p>
          Set <Mono>publicUrl</Mono> when you reach the app under another name (a tailnet address, say): the app refuses requests to names it does not know, and
          the Gmail sign-in returns there. Settings changes any of these too, writing this file: <Mono>{r.localConfig}</Mono>.
        </p>
      </>
    ),
  },
  resume: {
    title: "Add your resume",
    description: "The stock resume every application is tailored from. Upload what you have, in any format, and an agent writes it on the template.",
    action: link(href("resume"), "Open Resume"),
  },
  profile: {
    title: "Fill in your profile",
    description: "What you want, how postings are scored, and the answers forms ask for. They started as examples: replace every placeholder.",
    action: link(href("profile"), "Open Profile"),
  },
  gmail: {
    title: "Connect the application mailbox",
    description: "Confirmation codes, replies and interview invitations arrive here. The app reads it and sends you a daily digest of open questions.",
    how: r => (
      <ol className="list-decimal space-y-1.5 pl-4">
        <li>In Google Cloud, create a project and enable the Gmail API.</li>
        <li>Configure the OAuth consent screen (External), and add the mailbox as a test user.</li>
        <li>
          Create an OAuth client of type Web application, with this redirect URI:
          <Code>{r.redirectUri}</Code>
        </li>
        <li>
          Download its JSON and save it as <Mono>profile/gmail-client.json</Mono>.
        </li>
        <li>Connect, and sign in as the mailbox named in config.local.yml. Any other account is refused.</li>
      </ol>
    ),
    action: ({ primary, step }) =>
      step.checks.find(c => c.key === "client")?.ok ? (
        <Button asChild variant={primary ? "primary" : "secondary"}>
          <a href="/oauth/start">
            Connect Gmail
            <ExternalLink />
          </a>
        </Button>
      ) : null,
  },
  scan: {
    title: "Run the first scan",
    description: "Reads every watched board and feed. After this, scans run on their schedule and matches wait for you in Review.",
    action: ScanNow,
  },
};

function CheckRow({ c, optional }: { c: SetupCheck; optional: boolean }) {
  const needed = c.required && !optional;
  const Icon = c.ok ? Check : needed ? X : Minus;
  const file = /\.(md|yml)$/.test(c.key) ? c.key : null;
  return (
    <li className="flex items-start gap-2.5 py-1">
      <Icon className={cn("mt-0.5 size-4 shrink-0", c.ok ? "text-success-text" : needed ? "text-danger-text" : "text-fg-subtle")} aria-hidden />
      <span className="sr-only">{c.ok ? "Done:" : needed ? "To do:" : "Optional:"}</span>
      <span className="min-w-0 flex-1 text-sm">
        {file ? (
          <a href={href("profile", file)} className="text-fg underline-offset-2 hover:text-accent-text hover:underline">
            {c.label}
          </a>
        ) : (
          <span className="text-fg">{c.label}</span>
        )}
        {c.detail && <span className="block break-words text-fg-muted sm:ml-2 sm:inline">{c.detail}</span>}
      </span>
    </li>
  );
}

function StepRow({ step, n, current, result }: { step: SetupStep; n: number; current: boolean; result: SetupResult }) {
  const [open, setOpen] = useState(false);
  const copy = STEPS[step.id];
  const checks = step.checks.filter(copy.shown ?? (() => true));
  const action = copy.action?.({ primary: current, step, result });
  const list = checks.length > 0 && (
    <ul className="mt-1">
      {checks.map(c => (
        <CheckRow key={c.key} c={c} optional={!step.required} />
      ))}
    </ul>
  );
  const details = `setup-details-${step.id}`;
  const body = !step.done || open;
  return (
    <li
      aria-current={current ? "step" : undefined}
      className={cn(
        "relative grid scroll-mt-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-(--list-x) py-3 touch:py-3.5",
        "after:absolute after:right-0 after:bottom-0 after:left-[calc(var(--list-x)+2.75rem)] after:h-px after:bg-border",
        current && "bg-accent-soft/40 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
      )}
    >
      <ListIcon icon={step.done ? <Check /> : n} tone={step.done ? "success" : step.required ? "accent" : "neutral"} />
      <div className="min-w-0">
        <h3 className="text-base font-medium text-fg">{copy.title}</h3>
        <p className={cn("mt-0.5 max-w-[72ch] text-sm text-fg-muted", step.done && !open && "truncate")}>{copy.description}</p>
      </div>
      {step.done ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={details}
          onClick={() => {
            setOpen(!open);
          }}
          className="inline-flex h-8 items-center gap-1 pl-1 text-sm text-fg-muted hover:text-fg touch:h-9"
        >
          Details
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      ) : (
        <span className={cn("pl-1 text-sm whitespace-nowrap", step.required ? "font-medium text-warning-text" : "text-fg-muted")}>
          {step.required ? "To do" : "Optional"}
        </span>
      )}
      {body && (list || (!step.done && (copy.how ?? action))) && (
        <div id={details} className={cn("col-start-2 col-end-4 max-w-[56rem] min-w-0 pt-2", step.done && "animate-in")}>
          {list}
          {!step.done && (copy.how ?? action) && (
            <div className="mt-3 flex flex-col gap-3">
              {copy.how && (
                <Disclosure id={`setup-${step.id}`} summary="How to do it">
                  <div className="space-y-2">{copy.how(result)}</div>
                </Disclosure>
              )}
              {action && <div className="flex flex-wrap gap-2">{action}</div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function SetupPage() {
  const { data, isPending } = useSetup();
  const { data: s } = useSummary();
  const [checking, setChecking] = useState(false);
  const recheck = async () => {
    setChecking(true);
    try {
      queryClient.setQueryData(["setup"], await api.setup(true));
      void refreshAll();
    } catch {
    } finally {
      setChecking(false);
    }
  };
  const required = data?.steps.filter(st => st.required) ?? [];
  const done = required.filter(st => st.done).length;
  const current = data?.steps.find(st => !st.done && st.required) ?? data?.steps.find(st => !st.done);
  const progress = data && (
    <>
      <span className="tabular text-sm whitespace-nowrap text-fg-muted">
        <span className="font-semibold text-fg">
          {done} of {required.length}
        </span>{" "}
        <span className="max-sm:hidden">required steps </span>done
      </span>
      <div className="h-1.5 max-w-48 min-w-8 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / Math.max(1, required.length)) * 100}%` }} />
      </div>
    </>
  );
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: "Setup",
        meta: data && (data.remaining ? `${data.remaining} to do` : "Complete"),
        hint: "Everything a new install needs, checked against this machine as it is now. Work down the list.",
        controls: progress && (
          <div data-lead className="flex min-w-0 items-center gap-3 lg:hidden">
            {progress}
          </div>
        ),
        actions: (
          <Button size="sm" icon={<RefreshCw />} loading={checking} onClick={() => void recheck()}>
            Check again
          </Button>
        ),
      }}
      strip={progress && <div className="flex h-12 shrink-0 items-center gap-4 border-b border-border px-(--list-x) max-lg:hidden">{progress}</div>}
      notice={
        data?.remaining === 0 && (
          <ListNotice icon={<CircleCheck />}>
            <span className="font-medium">Setup is complete.</span>{" "}
            {s?.scanMinutes
              ? `Boards are scanned every ${s.scanMinutes} minutes. Matches wait for you in Review; questions the agents can't answer wait in Questions.`
              : "Scheduled scans are off: start one from the sidebar. Matches wait for you in Review."}
          </ListNotice>
        )
      }
    >
      {isPending || !data ? (
        <SkeletonRows rows={6} />
      ) : (
        <ol aria-label="Steps">
          {data.steps.map((step, i) => (
            <StepRow key={step.id} step={step} n={i + 1} current={step.id === current?.id} result={data} />
          ))}
        </ol>
      )}
    </Workspace>
  );
}
