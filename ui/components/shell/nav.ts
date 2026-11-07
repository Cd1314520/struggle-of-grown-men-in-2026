import {
  Activity,
  Archive,
  FileText,
  Inbox,
  LayoutGrid,
  ListChecks,
  MessageSquareText,
  Send,
  Settings,
  UserRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import type { Summary } from "../../../src/api-types";
import type { Page } from "../../lib/router";

export interface NavItem {
  page: Page;
  label: string;
  icon: LucideIcon;
  group: "workspace" | "library" | "system";
  go?: string;
  badge?: (s: Summary) => { value: number; tone: "neutral" | "accent" | "warning" } | null;
}

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
  },
  { page: "applications", label: "Applications", icon: Send, group: "workspace", go: "a", badge: s => ({ value: s.quiet, tone: "warning" }) },
  { page: "archive", label: "Archive", icon: Archive, group: "library", go: "h" },
  { page: "activity", label: "Activity", icon: Activity, group: "library", go: "l" },
  { page: "resume", label: "Resume", icon: FileText, group: "library" },
  {
    page: "profile",
    label: "Profile",
    icon: UserRound,
    group: "library",
    badge: s => (s.profileProblems.length ? { value: s.profileProblems.length, tone: "warning" } : null),
  },
  {
    page: "setup",
    label: "Setup",
    icon: ListChecks,
    group: "system",
    badge: s => (s.setupRemaining ? { value: s.setupRemaining, tone: "warning" } : null),
  },
  { page: "settings", label: "Settings", icon: Settings, group: "system", go: "s" },
];
export const navItem = (page: Page) => NAV.find(n => n.page === page);
