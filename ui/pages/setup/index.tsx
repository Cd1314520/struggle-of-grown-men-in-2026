// Setup: what a new install still needs, step by step, each checked live against this machine. The first
// step not done is the one open, with the page's one primary action; done steps fold to a line.
import { Check, CircleCheck, Copy, ExternalLink, Minus, Radar, RefreshCw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { SetupCheck, SetupResult, SetupStep, SetupStepId } from "../../../src/api-types";
import { Button, Callout, Card, Disclosure, Page, PageHeader, Skeleton, StatusLabel } from "../../components/ui";
import { api, queryClient, refreshAll, useSetup, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { href } from "../../lib/router";

// A shell command, with a button that copies it.
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
  // The step's way forward. `primary` when it is the step to do next.
  action?: (props: { primary: boolean; step: SetupStep; result: SetupResult }) => ReactNode;
  // Checks shown as a list; the rest are only counted.
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
          Install Google Chrome from its <Mono>.deb</Mono>, Typst from its releases (or <Mono>cargo install typst-cli</Mono>), and omp or Claude Code (or both),
          so that <Mono>omp --version</Mono> or <Mono>claude --version</Mono> runs. Then restart the service so it sees them:
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
    description: "Every agent runs through omp or Claude Code. Sign in to at least one, then choose a model for each kind of work.",
    shown: c => !c.ok || c.key === "catalog",
    how: () => (
      <>
        <p>In a terminal on this machine, log in to a provider through omp (a subscription or an API key), or sign in to Claude Code, then check again:</p>
        <Code>omp login</Code>
        <Code>claude auth login</Code>
        <p>
          A stage on a <Mono>claude-code/…</Mono> model runs through Claude Code; any other through omp.
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
          the Gmail sign-in returns there. Restart the service after editing. This file is at <Mono>{r.localConfig}</Mono>.
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

// A check's line: what it is, and what was found.
function CheckRow({ c, optional }: { c: SetupCheck; optional: boolean }) {
  const needed = c.required && !optional;
  const Icon = c.ok ? Check : needed ? X : Minus;
  const file = /\.(md|yml)$/.test(c.key) ? c.key : null;
  return (
    <li className="flex min-h-8 items-start gap-2.5 py-1">
      <Icon className={cn("mt-0.5 size-4 shrink-0", c.ok ? "text-success-text" : needed ? "text-danger-text" : "text-fg-subtle")} aria-hidden />
      <span className="sr-only">{c.ok ? "Done:" : needed ? "To do:" : "Optional:"}</span>
      <span className="min-w-0 flex-1 text-sm">
        {file ? (
          <a href={href("profile", file)} className="font-mono text-xs text-fg hover:text-accent-text hover:underline">
            {c.label}
          </a>
        ) : (
          <span className={cn("text-fg", /^[a-z][\w.-]*$/.test(c.label) && "font-mono text-xs")}>{c.label}</span>
        )}
        {c.detail && <span className="block break-words text-fg-muted sm:ml-2 sm:inline">{c.detail}</span>}
      </span>
    </li>
  );
}

function StepCard({ step, n, current, result }: { step: SetupStep; n: number; current: boolean; result: SetupResult }) {
  const copy = STEPS[step.id];
  const checks = step.checks.filter(copy.shown ?? (() => true));
  const action = copy.action?.({ primary: current, step, result });
  const body = (
    <>
      {checks.length > 0 && (
        <ul className="mt-3">
          {checks.map(c => (
            <CheckRow key={c.key} c={c} optional={!step.required} />
          ))}
        </ul>
      )}
      {(copy.how ?? action) && (
        <div className="mt-4 flex flex-col gap-4">
          {copy.how && (
            <Disclosure id={`setup-${step.id}`} summary="How to do it">
              <div className="space-y-2">{copy.how(result)}</div>
            </Disclosure>
          )}
          {action && <div className="flex flex-wrap gap-2">{action}</div>}
        </div>
      )}
    </>
  );
  return (
    <li>
      <Card className={cn("p-5", current && "border-accent/40 ring-3 ring-accent/10")}>
        <div className="flex items-start gap-4">
          <span
            aria-hidden
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular",
              step.done ? "bg-success-soft text-success-text" : current ? "bg-accent text-accent-fg" : "bg-muted text-fg-muted",
            )}
          >
            {step.done ? <Check className="size-4" /> : n}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="flex-1 text-base font-semibold text-fg">{copy.title}</h2>
              <StatusLabel
                tone={step.done ? "success" : step.required ? "warning" : "neutral"}
                label={step.done ? "Done" : step.required ? "To do" : "Optional"}
              />
            </div>
            <p className="mt-0.5 text-sm text-fg-muted">{copy.description}</p>
            {step.done ? (
              <Disclosure id={`setup-done-${step.id}`} summary="Details" className="mt-3">
                {body}
              </Disclosure>
            ) : (
              body
            )}
          </div>
        </div>
      </Card>
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
      // shown by the request
    } finally {
      setChecking(false);
    }
  };
  const required = data?.steps.filter(st => st.required) ?? [];
  const done = required.filter(st => st.done).length;
  const current = data?.steps.find(st => !st.done && st.required) ?? data?.steps.find(st => !st.done);
  return (
    <Page width="narrow">
      <PageHeader
        title="Setup"
        description="Everything a new install needs, checked against this machine as it is now. Work down the list."
        actions={
          <Button icon={<RefreshCw />} loading={checking} onClick={() => void recheck()}>
            Check again
          </Button>
        }
      />
      {isPending || !data ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-10 rounded-lg" />
          <Skeleton className="h-48 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
      ) : (
        <>
          {data.remaining === 0 ? (
            <Callout tone="success" icon={<CircleCheck />} title="Setup is complete" className="mb-6">
              {s?.scanMinutes
                ? `Boards are scanned every ${s.scanMinutes} minutes. Matches wait for you in Review; questions the agents can't answer wait in Questions.`
                : "Scheduled scans are off: start one from the sidebar. Matches wait for you in Review."}
            </Callout>
          ) : (
            <div className="mb-6 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / Math.max(1, required.length)) * 100}%` }} />
              </div>
              <span className="text-sm text-fg-muted tabular">
                {done} of {required.length} done
              </span>
            </div>
          )}
          <ol className="flex flex-col gap-4">
            {data.steps.map((step, i) => (
              <StepCard key={step.id} step={step} n={i + 1} current={step.id === current?.id} result={data} />
            ))}
          </ol>
        </>
      )}
    </Page>
  );
}
