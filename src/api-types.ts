// The shapes the HTTP API answers with. The server builds them (src/server.ts) and the UI reads them
// (ui/), so a field renamed on one side fails the other's typecheck. Types only: the UI's bundle
// must never pull in server code.
import type { Blocker, ListedBlocker } from "./blockers";
import type { BoardJob, EventRow, Job, StatusChange } from "./db";
import type { DigestStatus } from "./digest";
import type { ModelStage } from "./config";
import type { ModelCatalog } from "./models";
import type { ImportState } from "./resume-import";
import type { StockResume } from "./resume";
import type { FillCheckpoint, Gate, QuestionGroup } from "./questions";
import type { InterviewPrep } from "./interview";
import type { NextStep, Step } from "./steps";
import type { Drafts } from "./referral-drafts";
import type { ContactStep, PickKind } from "./referral-plan";
import type { Contact } from "./referrals";

// A job as the lists show it. `next`: whose move it is, for an application in process with steps.
export type ListedJob = BoardJob & { opened_at: number; next: NextStep | null };

// A decision or an outcome in the feed, with the job it belongs to.
export type Highlight = Omit<EventRow, "worker"> & { company: string | null; title: string | null };

// GET /api/state
export interface AppState {
  jobs: ListedJob[];
  counts: Record<string, number>;
  questionGroups: QuestionGroup[];
  digest: DigestStatus;
  events: EventRow[];
  highlights: Highlight[];
  gmail: { connected: boolean; address: string | null };
  profileProblems: string[];
  running: { scan: boolean; track: boolean };
  lastScan: string | null;
  scanMinutes: number;
  boards: number;
  lastTrack: string | null;
  approval: "auto" | "gated";
  targets: { holdBack: boolean; describe: string };
  autoApply: {
    enabled: boolean;
    minScore: number;
    allowConcerns: boolean;
    perDay: number;
    perEmployer: number | null; // null: no limit
    approvedToday: number;
  };
  applyPerDay: number;
  thresholds: { practice: number; real: number } | null;
  vncUrl: string | null;
  browsers: string[];
  redirectUri: string;
  mailbox: string | null;
  profileFiles: string[];
  setupRemaining: number; // required setup steps not done (src/setup.ts)
}

// GET /api/jobs/:id
export interface JobDetail extends Job {
  opened_at: number;
  events: Pick<EventRow, "worker" | "kind" | "message" | "at">[];
  history: StatusChange[];
  sources: { url: string; source: string; location: string | null }[];
  siblings: Pick<Job, "id" | "title" | "status">[];
  steps: Step[];
  blockers: Blocker[]; // every time this application stopped short, and why
  next: NextStep | null; // whose move it is, while the application is in process
  gate: Gate | null;
  checkpoint: FillCheckpoint | null;
  browserReserved: boolean;
  manualBrowserReserved: boolean;
  submissionAmbiguous: boolean;
  recoveryMode: "verify" | "fill" | null;
  interviewPrep: InterviewPrep | null; // the story bank and a prep note, once the employer moves it on
  vncUrl: string | null;
  hasPdf: boolean;
  resumeFrozen: boolean;
  pdfName: string;
  diff: string;
}

// POST /api/questions/:gateId/answer
export interface AnswerResult {
  ok: true;
  jobIds: number[];
}

// POST /api/digest/send
export interface DigestResult {
  sent: boolean;
  groups: number;
  messageId?: string;
  reason?: string;
}

// GET /api/blockers: every stop, newest first.
export interface BlockersResult {
  blockers: ListedBlocker[];
}

// What waits on the user, by kind: the badges in the navigation and the Overview's inbox.
export interface Attention {
  review: number; // jobs awaiting approval
  questions: number; // question groups to answer
  confirmSubmit: number;
  manual: number; // browser hand-offs
  coverLetter: number;
  ambiguous: number; // submissions whose outcome is unknown
  failed: number;
  total: number; // everything above but review
}

// GET /api/summary: the app's state without its lists. Small enough to fetch on every change.
export type Summary = Omit<AppState, "jobs" | "events" | "highlights" | "questionGroups"> & { attention: Attention };

// GET /api/jobs?view=…: one page of a job list. See src/listing.ts.
export type { ListGroup, ListResult, ListRow, ListView } from "./listing";
export type { Reason } from "./reasons";

// GET /api/activity?feed=highlights|all&kind=…&before=…: one page of the event log, newest first.
export interface ActivityItem {
  id: number;
  job_id: number | null;
  worker: string | null;
  kind: string;
  message: string;
  at: string;
  company: string | null;
  title: string | null;
}
export interface ActivityResult {
  items: ActivityItem[];
  next: number | null; // pass as `before` for the page after this one
}

// GET /api/stats: see src/stats.ts.
export type { Stats } from "./stats";

export type { SetupCheck, SetupResult, SetupStep, SetupStepId } from "./setup";
export type { CatalogModel, ModelCatalog } from "./models";
export type { ModelStage } from "./config";

// GET /api/models
export interface ModelsResult {
  catalog: ModelCatalog;
  stages: Record<ModelStage, string | null>;
  localConfig: string;
}

// GET /api/settings: the settings as config.yml and config.local.yml have them, what the latter sets, those read
// only at start (dotted prefixes), and which of those wait for a restart.
export interface SettingsResult {
  values: Record<string, unknown>;
  local: unknown;
  pending: string[];
  restart: string[];
  localConfig: string;
}

// GET /api/resume
export interface ResumeState {
  stock: StockResume;
  import: ImportState & { steps: { message: string; at: string }[] };
  notes: { example: boolean; empty: boolean };
  pdfName: string;
  main: string;
  limits: { files: number; bytes: number };
}

// GET /api/referrals: the referral outreach page (src/outreach.ts). The daily list names contacts, connections
// and employers; every draft is built from profile/referral.yml.
export interface ReferralJob {
  id: number;
  title: string;
  company: string;
  url: string;
  status: Job["status"];
}
export type ReferralContact = Contact & {
  job: ReferralJob | null;
  next: ContactStep;
  area: string | null; // the facts its drafts use
  drafts: Drafts | null; // null while referral.yml is not filled in
};
export interface ReferralsState {
  day: string;
  problems: string[]; // what in referral.yml stops drafting
  due: { contactId: number; overdue: boolean }[];
  people: { key: string; name: string; url: string | null; position: string; company: string; why: string; jobId: number | null }[];
  companies: {
    key: string;
    company: string;
    kind: PickKind;
    place: string | null;
    why: string;
    job: ReferralJob | null;
    careers: string | null;
    links: { label: string; url: string }[];
  }[];
  peopleTotal: number;
  contacts: ReferralContact[];
  notes: { left: number; perMonth: number; limit: number };
  linkedin: { lastExportOn: string | null; file: string | null; connections: number; due: boolean; exportUrl: string };
  mail: { connected: boolean; checkedAt: string | null };
  areas: string[];
}
export interface ReferralImportResult {
  connections: number | null; // null: the upload had no Connections.csv
  updates: number;
}
