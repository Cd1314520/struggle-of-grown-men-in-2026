import type { Blocker, ListedBlocker } from "./blockers";
import type { BoardJob, EventRow, Job, StatusChange } from "./db";
import type { DigestStatus } from "./digest";
import type { ModelStage } from "./config";
import type { ModelCatalog } from "./models";
import type { ImportState } from "./resume-import";
import type { StockResume } from "./resume";
import type { FillCheckpoint, Gate, QuestionGroup } from "./questions";
import type { InterviewPrep } from "./interview";
import type { Lead, Person } from "./leads";
import type { NextStep, Step } from "./steps";
import type { Drafts } from "./referral-drafts";
import type { ContactStep, PickKind } from "./referral-plan";
import type { Contact } from "./referrals";

export type ListedJob = BoardJob & { opened_at: number; next: NextStep | null };

export type Highlight = Omit<EventRow, "worker"> & { company: string | null; title: string | null };

export interface AppState {
  jobs: ListedJob[];
  counts: Record<string, number>;
  quiet: number;
  quietDays: number;
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
    perEmployer: number | null;
    cooldownDays: number;
    approvedToday: number;
  };
  applyPerDay: number;
  thresholds: { practice: number; real: number } | null;
  vncUrl: string | null;
  browsers: string[];
  redirectUri: string;
  mailbox: string | null;
  profileFiles: string[];
  setupRemaining: number;
}

export interface JobDetail extends Job {
  opened_at: number;
  events: Pick<EventRow, "worker" | "kind" | "message" | "at">[];
  history: StatusChange[];
  sources: { url: string; source: string; location: string | null }[];
  siblings: Pick<Job, "id" | "title" | "status">[];
  steps: Step[];
  blockers: Blocker[];
  next: NextStep | null;
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

export interface AnswerResult {
  ok: true;
  jobIds: number[];
}

export interface DigestResult {
  sent: boolean;
  groups: number;
  messageId?: string;
  reason?: string;
}

export interface BlockersResult {
  blockers: ListedBlocker[];
}

export interface Attention {
  review: number;
  questions: number;
  confirmSubmit: number;
  manual: number;
  coverLetter: number;
  ambiguous: number;
  failed: number;
  blocked: number;
  total: number;
}

export type Summary = Omit<AppState, "jobs" | "events" | "highlights" | "questionGroups"> & { attention: Attention };

export type { ListGroup, ListResult, ListRow, ListView } from "./listing";
export type { Reason } from "./reasons";

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
  next: number | null;
}

export type { Stats } from "./stats";

export type { SetupCheck, SetupResult, SetupStep, SetupStepId } from "./setup";
export type { CatalogModel, ModelCatalog } from "./models";
export type { ModelStage } from "./config";

export interface ModelsResult {
  catalog: ModelCatalog;
  stages: Record<ModelStage, string | null>;
  localConfig: string;
}

export interface SettingsResult {
  values: Record<string, unknown>;
  local: unknown;
  pending: string[];
  restart: string[];
  localConfig: string;
}

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
export type { AtsReport, Dimension, Keyword } from "./ats-score";

// The Early outreach page (src/outreach-leads-api.ts).
export interface OutreachItem {
  person: Person;
  lead: Lead;
}
export interface OutreachState {
  day: string;
  sentToday: number;
  perDay: number;
  sendFrom: string | null; // the address the owner sends from, for the page; null: not set
  gmail: boolean; // replies are noticed only in the connected mailbox
  today: OutreachItem[]; // drafts to send today, best first
  followUps: OutreachItem[]; // sent, follow-up due
  checkFirst: OutreachItem[]; // a guessed address to check before it goes on the list
  waiting: OutreachItem[]; // drafts beyond today's list, and emails sent with no follow-up due yet
  replied: OutreachItem[];
  done: OutreachItem[];
}
