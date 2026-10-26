// What waits on the owner, one row per kind with its count, each a way into the page that clears it.
import {
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FileText,
  Inbox,
  MessageSquareText,
  MousePointerClick,
  Send,
  ListChecks,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Summary } from "../../../src/api-types";
import { Card, CardHeader, Skeleton } from "../../components/ui";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";
import { PROFILE_LABEL } from "../../lib/labels";

type Tone = "accent" | "warning" | "danger";
interface Row {
  key: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  icon: LucideIcon;
  tone: Tone;
}

const TILE: Record<Tone, string> = {
  accent: "bg-accent-soft text-accent-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
};

// In the order they are best dealt with: what is about to be sent first, then what holds applications
// back, then the new matches, which keep.
export function attentionRows(s: Summary): Row[] {
  const a = s.attention;
  const needsYou = "#pipeline?group=needs_you";
  const rows: Row[] = [
    {
      key: "confirm",
      label: "Confirm submit",
      hint: "Filled in and waiting for your OK to send",
      count: a.confirmSubmit,
      href: needsYou,
      icon: Send,
      tone: "warning",
    },
    {
      key: "ambiguous",
      label: "Check if sent",
      hint: "Submitted without a clear confirmation from the site",
      count: a.ambiguous,
      href: needsYou,
      icon: CircleHelp,
      tone: "warning",
    },
    {
      key: "manual",
      label: "Browser hand-offs",
      hint: "A step in the browser the agent can't do for you",
      count: a.manual,
      href: needsYou,
      icon: MousePointerClick,
      tone: "warning",
    },
    { key: "letter", label: "Cover letters", hint: "Applications asking for a letter", count: a.coverLetter, href: needsYou, icon: FileText, tone: "warning" },
    {
      key: "questions",
      label: "Questions",
      hint: "Answers only you can give, holding applications back",
      count: a.questions,
      href: "#questions",
      icon: MessageSquareText,
      tone: "warning",
    },
    {
      key: "failed",
      label: "Failed",
      hint: "Stopped with an error: retry or set aside",
      count: a.failed,
      href: "#pipeline?group=failed",
      icon: TriangleAlert,
      tone: "danger",
    },
    { key: "review", label: "Review", hint: "Assessed matches waiting for your approval", count: a.review, href: "#review", icon: Inbox, tone: "accent" },
  ];
  // Setup counts the profile among its steps; the files left are named, as they are what most often remains.
  const problems = s.profileProblems;
  if (s.setupRemaining)
    rows.push({
      key: "setup",
      label: "Finish setting up",
      hint: problems.length
        ? `${problems.map(p => PROFILE_LABEL[p] ?? p).join(", ")} ${problems.length === 1 ? "needs" : "need"} filling in`
        : "A few steps are left before the app can apply",
      count: s.setupRemaining,
      href: "#setup",
      icon: ListChecks,
      tone: "warning",
    });
  return rows.filter(r => r.count > 0);
}

export function NeedsYou({ summary }: { summary: Summary | undefined }) {
  const rows = summary ? attentionRows(summary) : null;
  return (
    <Card>
      <CardHeader title="Needs you" />
      {!rows ? (
        <div className="space-y-3 px-5 pb-5">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : rows.length ? (
        <ul className="border-t border-border">
          {rows.map(r => (
            <li key={r.key} className="border-b border-border last:border-b-0">
              <a
                href={r.href}
                className="group flex min-h-14 items-center gap-3.5 px-5 py-2.5 transition-colors outline-none last:rounded-b-xl hover:bg-subtle/70 focus-visible:bg-subtle"
              >
                <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", TILE[r.tone])}>
                  <r.icon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{r.label}</span>
                  <span className="block text-sm text-fg-muted sm:truncate">{r.hint}</span>
                </span>
                <span className="tabular text-lg font-semibold text-fg">{num(r.count)}</span>
                <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex items-center gap-3.5 border-t border-border px-5 py-5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-success-soft text-success-text [&_svg]:size-4">
            <CircleCheck />
          </span>
          <div>
            <p className="text-sm font-medium text-fg">All clear</p>
            <p className="text-sm text-fg-muted">New matches land in Review as soon as they are assessed.</p>
          </div>
        </div>
      )}
    </Card>
  );
}
