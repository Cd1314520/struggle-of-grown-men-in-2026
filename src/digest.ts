import { createHash, randomUUID } from "node:crypto";
import { config, publicUrl } from "./config";
import { db, kvGet, kvSet } from "./db";
import { digestDeliveryReference, findSentSelfMessage, gmailStatus, GmailSendError, sendSelfMessage } from "./gmail";
import { listQuestionGroups } from "./questions";
import type { QuestionGroup } from "./questions";

export interface DigestStatus {
  enabled: boolean;
  time: string;
  timeZone: string;
  recipient: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  deliveryState: string;
  undeliveredGroups: number;
}

type Result = { sent: boolean; groups: number; messageId?: string; reason?: string };
interface Delivery {
  id: string;
  recipient: string;
  fingerprints: string;
  group_count: number;
  subject: string;
  body: string;
  state: "sending" | "uncertain" | "failed" | "sent";
  created_at: string;
  attempt_at: string;
  sent_at: string | null;
  gmail_id: string | null;
  error: string | null;
}

// The ledger is independent of gate lifetime. Closing or adding jobs cannot erase delivery proof.
db.exec(`
CREATE TABLE IF NOT EXISTS question_digest_deliveries (
  id TEXT PRIMARY KEY,
  recipient TEXT NOT NULL,
  fingerprints TEXT NOT NULL,
  group_count INTEGER NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'uncertain', 'failed', 'sent')),
  created_at TEXT NOT NULL,
  attempt_at TEXT NOT NULL,
  sent_at TEXT,
  gmail_id TEXT,
  error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS question_digest_one_pending
  ON question_digest_deliveries ((1)) WHERE state != 'sent';
CREATE TABLE IF NOT EXISTS question_digest_notified (
  fingerprint TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL,
  sent_at TEXT NOT NULL
);
`);

const RETRY_INTERVAL_MS = 5 * 60_000;
let inFlight = false;

function settings() {
  return config.questionDigest ?? { enabled: true, time: "09:00", timeZone: "America/Chicago" };
}

function localClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function recipient(): string | null {
  const status = gmailStatus();
  if (!status.connected || !status.address) return null;
  const connected = status.address.trim().toLowerCase();
  const expected = config.mailbox?.trim().toLowerCase() ?? connected;
  return expected === connected ? connected : null;
}

function unnotifiedGroups(): { group: QuestionGroup; fingerprint: string }[] {
  const notified = new Set(db.query<{ fingerprint: string }, []>("SELECT fingerprint FROM question_digest_notified").all().map(row => row.fingerprint));
  const groups = listQuestionGroups().map(group => ({
    group,
    // Membership, gate IDs, timestamps and answer values are deliberately absent.
    fingerprint: createHash("sha256").update(JSON.stringify([group.key, group.kind, group.text, group.context, group.options])).digest("hex"),
  }));
  return groups.filter(item => !notified.has(item.fingerprint));
}

function plaintext(groups: QuestionGroup[], deliveryId: string): string {
  const totalJobs = new Set(groups.flatMap(group => group.jobs.map(job => job.id))).size;
  const lines = [
    `Auto Apply: ${groups.length} new question group${groups.length === 1 ? "" : "s"} across ${totalJobs} application${totalJobs === 1 ? "" : "s"}.`,
    "",
    `Questions inbox: ${publicUrl()}/#questions`,
    "Answer in the app. Application-only is the default; standing answers require explicit approval.",
    "",
  ];
  const labels: Record<QuestionGroup["kind"], string> = {
    question: "Question", cover_letter: "Cover letter requested", confirm_submit: "Final confirmation needed",
    manual: "Manual browser handoff", submission_ambiguous: "Submission needs inspection (do not retry)",
  };
  for (const group of groups) {
    lines.push(`${labels[group.kind]} — ${group.jobs.length} application${group.jobs.length === 1 ? "" : "s"}`);
    // Context and non-question gate text can contain filled answers, cover letters or submission
    // summaries. Keep those in the app; mail contains unanswered prompts, counts and links only.
    if (group.kind === "question") {
      lines.push(group.text);
      if (group.options.length) lines.push(`Choices: ${group.options.join(" | ")}`);
    }
    for (const job of group.jobs)
      lines.push(`  ${job.company} — ${job.title}: ${publicUrl()}/#progress/${job.id}`);
    lines.push("");
  }
  lines.push(`Auto-Apply delivery reference: ${digestDeliveryReference(deliveryId)}`);
  return lines.join("\n");
}

export function digestStatus(): DigestStatus {
  const cfg = settings();
  const latest = db.query<Delivery, []>("SELECT * FROM question_digest_deliveries ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
  const sent = db.query<{ sent_at: string }, []>("SELECT sent_at FROM question_digest_deliveries WHERE state = 'sent' ORDER BY sent_at DESC LIMIT 1").get();
  const undeliveredGroups = unnotifiedGroups().length;
  const address = recipient();
  return {
    ...cfg,
    recipient: address,
    lastSentAt: sent?.sent_at ?? null,
    lastError: kvGet("questionDigest.error") || null,
    deliveryState: !cfg.enabled ? "disabled" : !address ? "not_connected" : latest?.state ?? (undeliveredGroups ? "ready" : "idle"),
    undeliveredGroups,
  };
}

function completeDelivery(delivery: Delivery, gmailId: string, sentAt: string) {
  db.transaction(() => {
    db.query("UPDATE question_digest_deliveries SET state = 'sent', gmail_id = ?, sent_at = ?, error = NULL WHERE id = ?")
      .run(gmailId, sentAt, delivery.id);
    for (const fingerprint of JSON.parse(delivery.fingerprints) as string[])
      db.query("INSERT OR IGNORE INTO question_digest_notified (fingerprint, delivery_id, sent_at) VALUES (?, ?, ?)")
        .run(fingerprint, delivery.id, sentAt);
    kvSet("questionDigest.error", "");
  }).immediate();
}

async function deliver(options: { force?: boolean; now?: Date }): Promise<Result> {
  const now = options.now ?? new Date();
  const cfg = settings();
  if (!cfg.enabled) return { sent: false, groups: 0, reason: "disabled" };
  const clock = localClock(now, cfg.timeZone);
  if (!options.force && clock.time < cfg.time) return { sent: false, groups: 0, reason: "before_schedule" };
  const timestamp = now.toISOString();

  // Claim before any await. A unique pending row plus immediate transaction prevents two
  // server processes from preparing overlapping messages or retrying the same failure.
  const claimed = db.transaction((): { delivery: Delivery; reconcile: boolean } | Result => {
    const active = db.query<Delivery, []>("SELECT * FROM question_digest_deliveries WHERE state != 'sent' LIMIT 1").get();
    if (active) {
      if (!options.force && now.getTime() - Date.parse(active.attempt_at) < RETRY_INTERVAL_MS)
        return { sent: false, groups: active.group_count, messageId: active.id, reason: "retry_later" };
      const reconcile = active.state === "sending" || active.state === "uncertain";
      // Only definitely rejected legacy deliveries may acquire the new footer before retry.
      // Never rewrite a sent/uncertain snapshot or resend an older ambiguous message.
      if (active.state === "failed") {
        const footer = `Auto-Apply delivery reference: ${digestDeliveryReference(active.id)}`;
        if (!active.body.endsWith(footer)) {
          active.body += `\n${footer}`;
          db.query("UPDATE question_digest_deliveries SET body = ? WHERE id = ?").run(active.body, active.id);
        }
      }
      db.query("UPDATE question_digest_deliveries SET state = ?, attempt_at = ? WHERE id = ?")
        .run(reconcile ? "uncertain" : "sending", timestamp, active.id);
      return { delivery: active, reconcile };
    }
    if (!options.force) {
      const last = db.query<{ sent_at: string }, []>("SELECT sent_at FROM question_digest_deliveries WHERE state = 'sent' ORDER BY sent_at DESC LIMIT 1").get();
      if (last && localClock(new Date(last.sent_at), cfg.timeZone).date >= clock.date)
        return { sent: false, groups: 0, reason: "already_sent_today" };
    }
    const groups = unnotifiedGroups();
    if (!groups.length) return { sent: false, groups: 0, reason: "no_new_groups" };
    const address = recipient();
    if (!address) throw new Error("Digest requires the configured mailbox to be connected with a matching Gmail identity");
    const id = `<auto-apply.questions.${randomUUID()}@${address.split("@")[1]}>`;
    const delivery: Delivery = {
      id,
      recipient: address,
      fingerprints: JSON.stringify(groups.map(item => item.fingerprint)),
      group_count: groups.length,
      subject: `Auto Apply: ${groups.length} new question group${groups.length === 1 ? "" : "s"}`,
      body: plaintext(groups.map(item => item.group), id),
      state: "sending", created_at: timestamp, attempt_at: timestamp, sent_at: null, gmail_id: null, error: null,
    };
    db.query(`INSERT INTO question_digest_deliveries
      (id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(delivery.id, delivery.recipient, delivery.fingerprints,
        delivery.group_count, delivery.subject, delivery.body, delivery.state, delivery.created_at, delivery.attempt_at);
    return { delivery, reconcile: false };
  }).immediate();
  if (!("delivery" in claimed)) return claimed;
  const { delivery, reconcile } = claimed;
  try {
    if (reconcile) {
      const match = await findSentSelfMessage(delivery.id, delivery.recipient);
      if (!match) {
        // Search indexing can lag. Absence is not proof of rejection, even after a restart.
        const error = "Send outcome is unknown; no matching self-message in Sent yet. Automatic resend is blocked to avoid duplicates.";
        db.query("UPDATE question_digest_deliveries SET state = 'uncertain', error = ? WHERE id = ? AND state != 'sent'").run(error, delivery.id);
        kvSet("questionDigest.error", error);
        return { sent: false, groups: delivery.group_count, messageId: delivery.id, reason: "delivery_uncertain" };
      }
      completeDelivery(delivery, match.id, match.sentAt);
      return { sent: true, groups: delivery.group_count, messageId: delivery.id, reason: "reconciled" };
    }
    const gmailId = await sendSelfMessage({ messageId: delivery.id, subject: delivery.subject, text: delivery.body, expectedMailbox: delivery.recipient, date: delivery.created_at });
    completeDelivery(delivery, gmailId, timestamp);
    return { sent: true, groups: delivery.group_count, messageId: delivery.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Digest delivery failed";
    const state = reconcile || !(error instanceof GmailSendError) || error.ambiguous ? "uncertain" : "failed";
    db.query("UPDATE question_digest_deliveries SET state = ?, error = ? WHERE id = ? AND state != 'sent'").run(state, message, delivery.id);
    kvSet("questionDigest.error", message);
    throw error;
  }
}

export async function sendQuestionDigest(options: { force?: boolean; now?: Date } = {}): Promise<Result> {
  if (inFlight) return { sent: false, groups: 0, reason: "busy" };
  inFlight = true;
  try {
    return await deliver(options);
  } catch (error) {
    kvSet("questionDigest.error", error instanceof Error ? error.message : "Digest delivery failed");
    throw error;
  } finally {
    inFlight = false;
  }
}

export async function tickQuestionDigest(now?: Date): Promise<void> {
  await sendQuestionDigest({ now });
}
