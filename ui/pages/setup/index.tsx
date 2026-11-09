import { Check, ChevronDown, Copy, ExternalLink, Minus, Radar, RefreshCw, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { SetupCheck, SetupResult, SetupStep, SetupStepId } from "../../../src/api-types";
import { Button, Disclosure, ListIcon, SkeletonRows, Workspace } from "../../components/ui";
import { api, queryClient, refreshAll, useSetup, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { ago, dateTime } from "../../lib/format";
import { href } from "../../lib/router";

function Code({ children }: { children: string }) {
  return (
    <div className="group relative my-2 rounded-md border border-border bg-subtle">
      <pre className="overflow-x-auto px-3 py-2 pr-10 font-mono text-xs leading-5 text-fg max-sm:whitespace-pre-wrap max-sm:[overflow-wrap:anywhere]">
        {children}
      </pre>
      <button
        type="button"
        aria-label="Copy"
        onClick={() => {
          void navigator.clipboard.writeText(children).then(() => toast.success("Copied"));
        }}
        className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-md bg-subtle text-fg-subtle hover:bg-muted hover:text-fg touch:size-9"
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
  summary?: (step: SetupStep) => string | null | undefined;
}

const detail = (step: SetupStep, key: string) => step.checks.find(c => c.key === key)?.detail;
const lastScan = (d: string | null | undefined) => d?.match(/^Last scan (\S+)$/)?.[1];

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
    <>
      <Button
        variant={primary ? "primary" : "secondary"}
        icon={<Radar />}
        loading={busy}
        disabled={!ready || busy}
        onClick={() => {
          setBusy(true);
          api.run("scan").then(
            () => {
              toast.success("Scan started");
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
      {!ready && (
        <span className="self-center text-sm text-fg-muted">
          Fill in{" "}
          <a href={href("profile", "targets.md")} className="text-accent-text underline-offset-2 hover:underline">
            targets.md
          </a>{" "}
          first
        </span>
      )}
    </>
  );
}

const STEPS: Record<SetupStepId, StepCopy> = {
  tools: {
    title: "Programs",
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
    summary: step => {
      const missing = step.checks.filter(c => !c.ok).map(c => c.label);
      return missing.length ? `Not found (optional): ${missing.join(", ")}` : `All ${step.checks.length} found`;
    },
  },
  models: {
    title: "Models",
    description: "Every agent runs through omp or Claude Code. Sign in to at least one, then choose a model for each kind of work.",
    shown: c => !c.ok || c.key === "catalog",
    how: () => (
      <>
        <p>In a terminal on this machine, log in to a provider through omp (a subscription or an API key), or sign in to Claude Code, then check again:</p>
        <Code>omp login</Code>
        <Code>claude auth login</Code>
      </>
    ),
    action: link(href("settings", "models"), "Choose models"),
    summary: step => detail(step, "catalog"),
  },
  machine: {
    title: "Identity & address",
    description: "Your mailbox and name, kept in config.local.yml.",
    how: r => (
      <>
        <p>
          Settings saves to <Mono>{r.localConfig}</Mono>, which git does not track and which overrides <Mono>config.yml</Mono> key by key. To write it by hand,
          copy the example and fill in the mailbox applications are sent from and the name on your resume:
        </p>
        <Code>cp config.local.example.yml config.local.yml</Code>
        <p>
          Set <Mono>publicUrl</Mono> when you reach the app under another name (a tailnet address, say): requests to other names are refused, and the Gmail
          sign-in returns there.
        </p>
      </>
    ),
    action: ({ primary }) => (
      <>
        <Button asChild variant={primary ? "primary" : "secondary"}>
          <a href={href("settings", "mail")}>Set mailbox</a>
        </Button>
        <Button asChild variant="secondary">
          <a href={href("settings", "server")}>Set address</a>
        </Button>
      </>
    ),
    summary: step => detail(step, "mailbox"),
  },
  resume: {
    title: "Resume",
    description: "The stock resume every application is tailored from. Upload what you have, in any format, and an agent writes it on the template.",
    action: link(href("resume"), "Open Resume"),
    summary: step => {
      const pages = detail(step, "compiles");
      return pages && `Compiles to ${pages}`;
    },
  },
  profile: {
    title: "Profile",
    description: "What you want, how postings are scored, and the answers forms ask for. They started as examples: replace every placeholder.",
    action: link(href("profile"), "Open Profile"),
    summary: step => detail(step, "companies.yml"),
  },
  gmail: {
    title: "Gmail",
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
    summary: step => detail(step, "connected") && `Connected as ${detail(step, "connected")}`,
  },
  scan: {
    title: "First scan",
    description: "Reads every watched board and feed. After this, scans run on their schedule and matches wait for you in Review.",
    action: ScanNow,
    summary: step => {
      const at = lastScan(detail(step, "scan"));
      return at && `Last scan ${ago(at)}`;
    },
  },
};

function checkLink(key: string) {
  if (/\.(md|yml)$/.test(key) && key !== "config.local.yml") return href("profile", key);
  if (key === "mailbox") return href("settings", "mail");
  if (key === "publicUrl" || key === "pdfName") return href("settings", "server");
  if (key === "catalog" || key.startsWith("stage.") || key.startsWith("harness.")) return href("settings", "models");
  if (key === "main" || key === "compiles") return href("resume");
  return null;
}

function CheckRow({ c, optional }: { c: SetupCheck; optional: boolean }) {
  const needed = c.required && !optional;
  const Icon = c.ok ? Check : needed ? X : Minus;
  const to = checkLink(c.key);
  const at = c.key === "scan" ? lastScan(c.detail) : undefined;
  return (
    <li className="flex items-start gap-1 py-1">
      <Icon className={cn("mt-[3px] size-3.5 shrink-0", c.ok ? "text-success-text" : needed ? "text-danger-text" : "text-fg-subtle")} aria-hidden />
      <span className="sr-only">{c.ok ? "Done:" : needed ? "To do:" : "Optional:"}</span>
      <span className="min-w-0 flex-1 text-sm">
        {to ? (
          <a href={to} className="text-accent-text underline-offset-2 hover:underline">
            {c.label}
          </a>
        ) : (
          <span className="text-fg">{c.label}</span>
        )}
        {!c.ok && !needed && (
          <span aria-hidden className="ml-1.5 text-xs text-fg-subtle">
            optional
          </span>
        )}
        {c.detail && (
          <span className="block break-words text-fg-muted sm:ml-2 sm:inline">
            {at ? (
              <time dateTime={at} title={dateTime(at)}>
                Last scan {ago(at)}
              </time>
            ) : (
              c.detail
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function StepRow({ step, n, current, result }: { step: SetupStep; n: number; current: boolean; result: SetupResult }) {
  const [open, setOpen] = useState(false);
  const copy = STEPS[step.id];
  const rank = (c: SetupCheck) => (c.ok ? 2 : c.required && step.required ? 0 : 1);
  const checks = step.checks.filter(copy.shown ?? (() => true)).sort((a, b) => (step.done ? 0 : rank(a) - rank(b)));
  const summary = step.done && !open ? copy.summary?.(step) : null;
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
        "relative grid scroll-mt-14 grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-(--list-x) py-3 max-sm:items-start touch:items-start touch:py-3.5",
        "after:absolute after:right-0 after:bottom-0 after:left-[calc(var(--list-x)+2.75rem)] after:h-px after:bg-border/70",
        current && "bg-accent-soft/40 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
      )}
    >
      <ListIcon icon={step.done ? <Check /> : n} tone={step.done ? "success" : step.required ? "accent" : "neutral"} className="max-sm:-mt-1 touch:-mt-1" />
      <div className="min-w-0">
        <h3 className="text-base font-medium text-fg">{copy.title}</h3>
        <p className={cn("mt-0.5 text-sm text-fg-muted", step.done && !open ? "line-clamp-1 max-sm:line-clamp-2" : "max-w-[72ch]")}>
          {summary || copy.description}
        </p>
      </div>
      {step.done ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={details}
          onClick={() => {
            setOpen(!open);
          }}
          className="inline-flex h-8 items-center gap-1 pl-1 text-sm text-fg-muted hover:text-fg max-sm:-mt-1 touch:h-9 touch:-mt-1.5"
        >
          Details
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
        </button>
      ) : step.required ? (
        <span className="sr-only">To do</span>
      ) : (
        <span className="inline-flex h-8 items-center pl-1 text-sm whitespace-nowrap text-fg-muted max-sm:-mt-1 touch:-mt-1">Optional</span>
      )}
      {body && (list || (!step.done && (copy.how ?? action))) && (
        <div id={details} className={cn("col-start-2 col-end-4 max-w-[72ch] min-w-0 pt-2 text-sm", step.done && "animate-in")}>
          {list}
          {!step.done && (copy.how ?? action) && (
            <div className="mt-3 flex flex-col gap-3">
              {copy.how &&
                (current ? (
                  <section aria-label="How to do it" className="space-y-2 text-fg-muted">
                    {copy.how(result)}
                  </section>
                ) : (
                  <Disclosure id={`setup-${step.id}`} summary="How to do it">
                    <div className="space-y-2">{copy.how(result)}</div>
                  </Disclosure>
                ))}
              {action && <div className={cn("flex flex-wrap gap-2", current && "order-first")}>{action}</div>}
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
  const status =
    data &&
    (data.remaining ? `${done} of ${required.length} done` : s?.scanMinutes ? `Complete · scans every ${s.scanMinutes} min` : "Complete · scheduled scans off");
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: "Setup",
        meta: status,
        controls: status && (
          <span data-lead className="tabular flex-1 text-sm text-fg-muted lg:hidden">
            {status}
          </span>
        ),
        actions: (
          <Button size="sm" icon={<RefreshCw />} loading={checking} onClick={() => void recheck()}>
            Check again
          </Button>
        ),
      }}
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
