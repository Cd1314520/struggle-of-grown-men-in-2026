import {
  Activity,
  Archive,
  FileText,
  Handshake,
  Inbox,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Rocket,
  Send,
  Settings,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Summary } from "../../../src/api-types";
import { plural } from "../../lib/format";
import type { Page } from "../../lib/router";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  group: "workspace" | "library" | "system";
  go?: string;
  badge?: (s: Summary) => { value: number; tone: "neutral" | "accent" | "warning" } | null;
  describe?: (s: Summary) => string;
}

const parts = (pairs: readonly (readonly [number, string])[]) =>
  pairs
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n.toLocaleString()} ${what}`)
    .join(", ");

export const NAV: readonly NavItem[] = [
  { page: "overview", label: "Overview", icon: LayoutGrid, group: "workspace", go: "o" },
  { page: "review", label: "Review", icon: Inbox, group: "workspace", go: "r", badge: s => ({ value: s.attention.review, tone: "accent" }) },
  {
    page: "questions",
    label: "Questions",
    icon: MessageSquareText,
    group: "workspace",
    go: "q",
    badge: s => ({ value: s.attention.questions, tone: "warning" }),
    describe: s => `${plural(s.attention.questions, "question")} to answer`,
  },
  {
    page: "pipeline",
    label: "Pipeline",
    icon: Workflow,
    group: "workspace",
    go: "p",
    badge: s => {
      const a = s.attention;
      return { value: a.confirmSubmit + a.manual + a.coverLetter + a.ambiguous + a.failed, tone: "warning" };
    },
    describe: ({ attention: a }) =>
      parts([
        [a.confirmSubmit, a.confirmSubmit === 1 ? "submit to OK" : "submits to OK"],
        [a.manual, a.manual === 1 ? "browser hand-off" : "browser hand-offs"],
        [a.coverLetter, a.coverLetter === 1 ? "cover letter" : "cover letters"],
        [a.ambiguous, "to check if sent"],
        [a.failed, "failed"],
      ]),
  },
  {
    page: "applications",
    label: "Applications",
    icon: Send,
    group: "workspace",
    go: "a",
    badge: s => ({ value: s.quiet, tone: "warning" }),
    describe: s => `${s.quiet.toLocaleString()} gone quiet for ${s.quietDays}+ days`,
  },
  { page: "referrals", label: "Referrals", icon: Handshake, group: "workspace" },
  { page: "outreach", label: "Early outreach", icon: Rocket, group: "workspace" },
  { page: "archive", label: "Archive", icon: Archive, group: "library", go: "h" },
  { page: "activity", label: "Activity", icon: Activity, group: "library", go: "l" },
  { page: "resume", label: "Resume", icon: FileText, group: "library" },
  {
    page: "profile",
    label: "Profile",
    icon: UserRound,
    group: "library",
    badge: s => (s.profileProblems.length ? { value: s.profileProblems.length, tone: "warning" } : null),
    describe: s => `${plural(s.profileProblems.length, "file")} to fix`,
  },
  {
    page: "setup",
    label: "Setup",
    icon: ListChecks,
    group: "system",
    badge: s => (s.setupRemaining ? { value: s.setupRemaining, tone: "warning" } : null),
    describe: s => `${plural(s.setupRemaining, "step")} left`,
  },
  { page: "settings", label: "Settings", icon: Settings, group: "system", go: "s" },
];
export const TABS: readonly Page[] = ["overview", "review", "questions", "pipeline"];
export const navItem = (page: Page) => NAV.find(n => n.page === page);
