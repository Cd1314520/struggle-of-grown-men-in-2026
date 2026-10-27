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
import { ListIcon, ListPanel, ListRow, SkeletonRows } from "../../components/ui";
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
    <ListPanel frame="card" title="Needs you">
      {!rows ? (
        <SkeletonRows rows={3} />
      ) : rows.length ? (
        rows.map(r => (
          <ListRow
            key={r.key}
            href={r.href}
            lead={<ListIcon icon={r.icon} tone={r.tone} />}
            title={r.label}
            snippet={r.hint}
            trail={
              <span className="flex items-center gap-1.5">
                <span className="tabular text-base font-semibold text-fg">{num(r.count)}</span>
                <ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </span>
            }
          />
        ))
      ) : (
        <ListRow lead={<ListIcon icon={CircleCheck} tone="success" />} title="All clear" snippet="New matches land in Review as soon as they are assessed." />
      )}
    </ListPanel>
  );
}
