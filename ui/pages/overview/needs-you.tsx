import {
  ChevronRight,
  CircleCheck,
  CircleHelp,
  FileText,
  Inbox,
  MailX,
  MessageSquareText,
  MousePointerClick,
  Radar,
  Send,
  ShieldBan,
  ListChecks,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { Summary } from "../../../src/api-types";
import { ListBody, ListIcon, ListRow } from "../../components/ui";
import { cn } from "../../lib/cn";
import { MINUTE, num } from "../../lib/format";
import { PROFILE_LABEL } from "../../lib/labels";
import { CLOSED, RailHead } from "./rail";

type Tone = "accent" | "warning" | "danger";
interface Row {
  key: string;
  label: string;
  hint: string;
  detail?: string | undefined;
  count: number;
  href: string;
  icon: LucideIcon;
  tone: Tone;
  bare?: boolean;
}

const COUNT_TONE: Record<Tone, string> = { accent: "text-fg", warning: "text-warning-text", danger: "text-danger-text" };

function systemRows(s: Summary): Row[] {
  const rows: Row[] = [];
  if (!s.gmail.connected)
    rows.push({
      key: "mailbox",
      label: "Mailbox disconnected",
      hint: "Replies and codes aren't tracked until you connect Gmail",
      count: 1,
      href: "#settings",
      icon: MailX,
      tone: "danger",
      bare: true,
    });
  if (s.digest.enabled && (s.digest.deliveryState === "failed" || s.digest.deliveryState === "abandoned"))
    rows.push({
      key: "digest",
      label: s.digest.deliveryState === "failed" ? "Daily digest failed" : "Daily digest gave up",
      hint: "The daily digest email didn't go out",
      detail: s.digest.lastError ?? undefined,
      count: 1,
      href: "#settings",
      icon: TriangleAlert,
      tone: "danger",
      bare: true,
    });
  const sinceScan = s.lastScan ? Date.now() - Date.parse(s.lastScan) : Infinity;
  if (!s.running.scan && s.scanMinutes && sinceScan > 3 * s.scanMinutes * MINUTE)
    rows.push({
      key: "scanner",
      label: "Scanner behind",
      hint: `Scheduled every ${s.scanMinutes} min but hasn't run lately`,
      count: 1,
      href: "#settings",
      icon: Radar,
      tone: "warning",
      bare: true,
    });
  return rows;
}

export function attentionRows(s: Summary): Row[] {
  const a = s.attention;
  const needsYou = "#pipeline?group=needs_you";
  const problems = s.profileProblems;
  const fresh = s.setupRemaining > 0 && !Object.values(s.counts).some(Boolean);
  const rows: Row[] = [
    ...systemRows(s),
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
      key: "blocked",
      label: "Blocked by site",
      hint: "The site refused the agent: finish it by hand or set it aside",
      count: a.blocked,
      href: "#pipeline?group=blocked",
      icon: ShieldBan,
      tone: "accent",
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
  ];
  if (s.setupRemaining && (problems.length || fresh))
    rows.push({
      key: "setup",
      label: "Finish setting up",
      hint: "A few steps are left before the app can apply",
      detail: problems.length ? `${problems.map(p => PROFILE_LABEL[p] ?? p).join(", ")} ${problems.length === 1 ? "needs" : "need"} filling in` : undefined,
      count: s.setupRemaining,
      href: "#setup",
      icon: ListChecks,
      tone: "warning",
    });
  rows.push({
    key: "review",
    label: "Review",
    hint: "Assessed matches waiting for your approval",
    count: a.review,
    href: "#review",
    icon: Inbox,
    tone: "accent",
  });
  return rows.filter(r => r.count > 0);
}

export function waitingCounts(s: Summary, yourMove: number) {
  const rows = attentionRows(s);
  const review = rows.find(r => r.key === "review")?.count ?? 0;
  const blocking = rows.filter(r => r.key !== "review" && !r.bare).reduce((n, r) => n + r.count, 0) + rows.filter(r => r.bare).length + yourMove;
  return { blocking, review };
}

export function NeedsYou({ summary }: { summary: Summary | undefined }) {
  const rows = summary ? attentionRows(summary) : null;
  return (
    <ListBody label="Needs you" loading={!rows} className={cn("border-b border-border", CLOSED)}>
      <RailHead label="Needs you" />
      {rows?.length ? (
        rows.map(r => (
          <ListRow
            key={r.key}
            href={r.href}
            lead={<ListIcon icon={r.icon} tone={r.tone} />}
            title={<span title={r.hint}>{r.label}</span>}
            gist={r.detail}
            fact={
              <span className="flex items-center gap-1.5">
                {!r.bare && <span className={cn("tabular text-base font-semibold", COUNT_TONE[r.tone])}>{num(r.count)}</span>}
                <ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
              </span>
            }
          />
        ))
      ) : (
        <ListRow lead={<ListIcon icon={CircleCheck} tone="success" />} title="All clear" />
      )}
    </ListBody>
  );
}
