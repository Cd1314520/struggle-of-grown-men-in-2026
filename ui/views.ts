// The sections of the app and how a job's status reads in them.
import type { Status } from "../src/status";

// An application under way that cannot continue without the user. Shown first in "In progress", with a marker.
export const STUCK: readonly Status[] = ["awaiting_submit", "needs_input", "needs_manual", "failed"];
export const SENT: readonly Status[] = ["submitted", "interview", "offer", "withdrawn"];

export type ViewKey = "review" | "progress" | "questions" | "applied" | "held" | "rejected" | "activity" | "blockers" | "profile" | "settings" | "more";
interface View {
  label: string;
  short?: string; // the label in the phone's tab bar, where five tabs share 360px
  group?: string; // heading above it in the sidebar
  primary?: boolean; // gets its own tab on a phone; the rest sit under "More"
  hidden?: boolean;
  statuses?: readonly Status[]; // a list of jobs in these statuses; without it, a full-width page
  empty?: string;
}
export const VIEWS: Record<ViewKey, View> = {
  review: { label: "To review", short: "Review", group: "Applications", primary: true, statuses: ["awaiting_approval"], empty: "Nothing to review." },
  progress: {
    label: "In progress",
    short: "Progress",
    primary: true,
    statuses: [...STUCK, "filling", "approved", "prepping", "locating", "triaged"],
    empty: "Nothing is being worked on.",
  },
  questions: { label: "Questions", primary: true },
  applied: {
    label: "Applied",
    primary: true,
    statuses: ["offer", "interview", "submitted", "rejected_by_company", "withdrawn"],
    empty: "No applications sent yet.",
  },
  held: { label: "Held", group: "Archive", statuses: ["held"], empty: "No jobs are being held back." },
  rejected: { label: "Rejected", statuses: ["rejected"], empty: "You haven't rejected anything." },
  activity: { label: "Activity", group: "System" },
  blockers: { label: "Blockers" },
  profile: { label: "Profile" },
  settings: { label: "Settings" },
  more: { label: "More", hidden: true },
};
export const ARCHIVE: readonly ViewKey[] = ["held", "rejected"];
export const VIEW_KEYS = Object.keys(VIEWS) as ViewKey[];
export const isView = (key: string | undefined): key is ViewKey => key !== undefined && Object.hasOwn(VIEWS, key);
// The section a job in this status is listed in.
export const viewOf = (status: Status | undefined): ViewKey => VIEW_KEYS.find(k => status && VIEWS[k].statuses?.includes(status)) ?? "review";

// [colour class, wording]
export const STATUS: Partial<Record<Status, readonly [cls: string, label: string]>> = {
  awaiting_approval: ["need", "Review"],
  needs_input: ["need", "Question"],
  awaiting_submit: ["need", "Confirm submit"],
  needs_manual: ["need", "Browser hand-off"],
  failed: ["bad", "Failed"],
  triaged: ["idle", "Not assessed yet"],
  locating: ["run", "Finding the posting"],
  prepping: ["run", "Assessing"],
  approved: ["run", "Queued to apply"],
  filling: ["run", "Applying"],
  submitted: ["ok", "Submitted"],
  interview: ["ok", "In process"],
  offer: ["ok", "Offer"],
  rejected_by_company: ["bad", "Declined"],
  withdrawn: ["idle", "Withdrawn"],
  rejected: ["idle", "Rejected"],
  skipped: ["idle", "Skipped"],
  held: ["idle", "Held"],
};
export const statusOf = (status: Status): readonly [cls: string, label: string] => STATUS[status] ?? ["idle", status];

export const TABS = { summary: "Summary", score: "Score", resume: "Resume", posting: "Posting", log: "Log" };
export type Tab = keyof typeof TABS;
export const TAB_KEYS = Object.keys(TABS) as Tab[];
export const isTab = (key: string | undefined): key is Tab => key !== undefined && Object.hasOwn(TABS, key);
