// The shapes the HTTP API answers with. The server builds them (src/server.ts) and the UI reads them
// (ui/), so a field renamed on one side fails the other's typecheck. Types only: the UI's bundle
// must never pull in server code.
import type { Blocker, ListedBlocker } from "./blockers";
import type { BoardJob, EventRow, Job, StatusChange } from "./db";
import type { DigestStatus } from "./digest";
import type { FillCheckpoint, Gate, QuestionGroup } from "./questions";
import type { NextStep, Step } from "./steps";

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
  confirmBeforeSubmit: boolean;
  autoApply: {
    enabled: boolean;
    phases: string[];
    minScore: number;
    allowConcerns: boolean;
    perDay: number;
    submit: boolean;
    approvedToday: number;
  };
  applyPerDay: number;
  threshold: number | null;
  vncUrl: string | null;
  browsers: string[];
  redirectUri: string;
  mailbox: string | null;
  phase: "practice" | "real";
  home: string | null;
  profileFiles: string[];
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
