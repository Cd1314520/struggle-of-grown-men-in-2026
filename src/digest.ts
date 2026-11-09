import { createHash, randomUUID } from "node:crypto";
import { config, publicUrl } from "./config";
import { db, kvGet, kvSet } from "./db";
import { digestDeliveryReference, findSentSelfMessage, gmailStatus, GmailSendError, sendSelfMessage } from "./gmail";
import { listQuestionGroups } from "./questions";
import type { QuestionGroup } from "./questions";
import { dueSoon, type DueStep } from "./steps";

type DeliveryState = "sending" | "uncertain" | "failed" | "sent" | "abandoned";
export type DigestDeliveryState = "disabled" | "not_connected" | "ready" | "idle" | DeliveryState;

export interface DigestStatus {
  enabled: boolean;
  time: string;
  timeZone: string;
  recipient: string | null;
  lastSentAt: string | null;
  lastError: string | null;
  deliveryState: DigestDeliveryState;
  undeliveredGroups: number;
}

interface Result {
  sent: boolean;
  groups: number;
  messageId?: string;
  reason?: string;
}
interface Delivery {
  id: string;
  recipient: string;
  fingerprints: string;
  group_count: number;
  subject: string;
  body: string;
  state: DeliveryState;
  attempts: number;
  created_at: string;
  attempt_at: string;
  sent_at: string | null;
  gmail_id: string | null;
  error: string | null;
}

const lastSent = () =>
  db.query<{ sent_at: string }, []>("SELECT sent_at FROM question_digest_deliveries WHERE state = 'sent' ORDER BY sent_at DESC LIMIT 1").get();
const beginResend = (delivery: Delivery, timestamp: string) => {
  const footer = `Auto-Apply delivery reference: ${digestDeliveryReference(delivery.id)}`;
  if (!delivery.body.endsWith(footer)) delivery.body += `\n${footer}`;
  db.query(
    "UPDATE question_digest_deliveries SET body = ?, state = 'sending', attempts = attempts + 1, attempt_at = ? WHERE id = ? AND state NOT IN ('sent', 'abandoned')",
  ).run(delivery.body, timestamp, delivery.id);
  delivery.attempts += 1;
};
const markUnsent = (id: string, state: "uncertain" | "failed", error: string) =>
  db.query("UPDATE question_digest_deliveries SET state = ?, error = ? WHERE id = ? AND state NOT IN ('sent', 'abandoned')").run(state, error, id);

const RETRY_INTERVAL_MS = 5 * 60_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60_000;
const UNCERTAIN_TIMEOUT_MS = 60 * 60_000;
const MAX_ATTEMPTS = 5;
const retryDelay = (attempts: number) => Math.min(RETRY_INTERVAL_MS * 2 ** (attempts - 1), MAX_RETRY_DELAY_MS);
let inFlight = false;
let lastReconcile: { id: string; at: number } | null = null;

function settings() {
  return config.questionDigest ?? { enabled: true, time: "09:00", timeZone: "America/Chicago" };
}

function localClock(now: Date, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return { date: `${values["year"]}-${values["month"]}-${values["day"]}`, time: `${values["hour"]}:${values["minute"]}` };
}

function recipient(): string | null {
  const status = gmailStatus();
  if (!status.connected || !status.address) return null;
  const connected = status.address.trim().toLowerCase();
  const expected = config.mailbox?.trim().toLowerCase() ?? connected;
  return expected === connected ? connected : null;
}

function unnotifiedGroups(): { group: QuestionGroup; fingerprint: string }[] {
  const notified = new Set(
    db
      .query<{ fingerprint: string }, []>("SELECT fingerprint FROM question_digest_notified")
      .all()
      .map(row => row.fingerprint),
  );
  const groups = listQuestionGroups().map(group => ({
    group,
    fingerprint: createHash("sha256")
      .update(JSON.stringify([group.key, group.kind, group.text, group.context, group.options]))
      .digest("hex"),
  }));
  return groups.filter(item => !notified.has(item.fingerprint));
}

const DUE_WITHIN_HOURS = 48;
function unnotifiedSteps(now: number): { step: DueStep; fingerprint: string }[] {
  const notified = db.query<{ n: number }, [string]>("SELECT count(*) AS n FROM question_digest_notified WHERE fingerprint = ?");
  return dueSoon(DUE_WITHIN_HOURS, now)
    .map(step => ({
      step,
      fingerprint: createHash("sha256")
        .update(JSON.stringify(["step", step.id, step.due_at]))
        .digest("hex"),
    }))
    .filter(item => !notified.get(item.fingerprint)?.n);
}

function subjectOf(groups: number, steps: number) {
  return `Auto Apply: ${[groups ? `${groups} new question group${groups === 1 ? "" : "s"}` : "", steps ? `${steps} step${steps === 1 ? "" : "s"} due soon` : ""]
    .filter(Boolean)
    .join(", ")}`;
}

function plaintext(groups: QuestionGroup[], steps: DueStep[], deliveryId: string): string {
  const totalJobs = new Set(groups.flatMap(group => group.jobs.map(job => job.id))).size;
  const lines = groups.length
    ? [
        `Auto Apply: ${groups.length} new question group${groups.length === 1 ? "" : "s"} across ${totalJobs} application${totalJobs === 1 ? "" : "s"}.`,
        "",
        `Questions inbox: ${publicUrl()}/#questions`,
        "Answer in the app. Answers are added to your answers for future applications unless you untick it.",
        "",
      ]
    : [];
  const labels: Record<QuestionGroup["kind"], string> = {
    question: "Question",
    cover_letter: "Cover letter requested",
    confirm_submit: "Final confirmation needed",
    manual: "Manual browser handoff",
    submission_ambiguous: "Submission needs inspection (do not retry)",
  };
  for (const group of groups) {
    lines.push(`${labels[group.kind]} — ${group.jobs.length} application${group.jobs.length === 1 ? "" : "s"}`);
    if (group.kind === "question") {
      lines.push(group.text);
      if (group.options.length) lines.push(`Choices: ${group.options.join(" | ")}`);
    }
    for (const job of group.jobs) lines.push(`  ${job.company} — ${job.title}: ${publicUrl()}/#progress/${job.id}`);
    lines.push("");
  }
  if (steps.length) {
    lines.push(`Due within ${DUE_WITHIN_HOURS} hours: ${steps.length} step${steps.length === 1 ? "" : "s"} from employers.`, "");
    for (const step of steps)
      lines.push(`${step.title} — due ${step.due_at ?? "?"}`, `  ${step.company} — ${step.title_of_job}: ${publicUrl()}/#applied/${step.job_id}`, "");
  }
  lines.push(`Auto-Apply delivery reference: ${digestDeliveryReference(deliveryId)}`);
  return lines.join("\n");
}

export function digestStatus(): DigestStatus {
  const cfg = settings();
  const latest = db.query<Delivery, []>("SELECT * FROM question_digest_deliveries ORDER BY created_at DESC, rowid DESC LIMIT 1").get();
  const sent = lastSent();
  const undeliveredGroups = unnotifiedGroups().length + unnotifiedSteps(Date.now()).length;
  const address = recipient();
  return {
    ...cfg,
    recipient: address,
    lastSentAt: sent?.sent_at ?? null,
    lastError: kvGet("questionDigest.error") || null,
    deliveryState: !cfg.enabled ? "disabled" : !address ? "not_connected" : (latest?.state ?? (undeliveredGroups ? "ready" : "idle")),
    undeliveredGroups,
  };
}

function completeDelivery(delivery: Delivery, gmailId: string, sentAt: string) {
  db.transaction(() => {
    db.query("UPDATE question_digest_deliveries SET state = 'sent', gmail_id = ?, sent_at = ?, error = NULL WHERE id = ?").run(gmailId, sentAt, delivery.id);
    for (const fingerprint of JSON.parse(delivery.fingerprints) as string[])
      db.query("INSERT OR IGNORE INTO question_digest_notified (fingerprint, delivery_id, sent_at) VALUES (?, ?, ?)").run(fingerprint, delivery.id, sentAt);
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

  const claimed = db
    .transaction((): { delivery: Delivery; reconcile: boolean } | Result => {
      let active = db.query<Delivery, []>("SELECT * FROM question_digest_deliveries WHERE state NOT IN ('sent', 'abandoned') LIMIT 1").get();
      if (active?.state === "failed" && active.attempts >= MAX_ATTEMPTS) {
        db.query("UPDATE question_digest_deliveries SET state = 'abandoned' WHERE id = ? AND state = 'failed'").run(active.id);
        active = null;
      }
      if (active) {
        const reconcile = active.state === "sending" || active.state === "uncertain";
        if (!options.force) {
          const age = now.getTime() - Date.parse(active.attempt_at);
          const idle = reconcile && lastReconcile?.id === active.id ? Math.min(age, now.getTime() - lastReconcile.at) : age;
          if (idle < (reconcile ? RETRY_INTERVAL_MS : retryDelay(active.attempts)))
            return { sent: false, groups: active.group_count, messageId: active.id, reason: "retry_later" };
        }
        if (reconcile) {
          db.query("UPDATE question_digest_deliveries SET state = 'uncertain' WHERE id = ?").run(active.id);
          return { delivery: active, reconcile };
        }
        beginResend(active, timestamp);
        return { delivery: active, reconcile };
      }
      if (!options.force) {
        const last = lastSent();
        if (last && localClock(new Date(last.sent_at), cfg.timeZone).date >= clock.date) return { sent: false, groups: 0, reason: "already_sent_today" };
      }
      const groups = unnotifiedGroups(),
        steps = unnotifiedSteps(now.getTime());
      if (!groups.length && !steps.length) return { sent: false, groups: 0, reason: "no_new_groups" };
      const address = recipient();
      if (!address) throw new Error("Digest requires the configured mailbox to be connected with a matching Gmail identity");
      const id = `<auto-apply.questions.${randomUUID()}@${address.split("@")[1]}>`;
      const delivery: Delivery = {
        id,
        recipient: address,
        fingerprints: JSON.stringify([...groups, ...steps].map(item => item.fingerprint)),
        group_count: groups.length + steps.length,
        subject: subjectOf(groups.length, steps.length),
        body: plaintext(
          groups.map(item => item.group),
          steps.map(item => item.step),
          id,
        ),
        state: "sending",
        attempts: 1,
        created_at: timestamp,
        attempt_at: timestamp,
        sent_at: null,
        gmail_id: null,
        error: null,
      };
      db.query(
        `
        INSERT INTO question_digest_deliveries (id, recipient, fingerprints, group_count, subject, body, state, created_at, attempt_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        delivery.id,
        delivery.recipient,
        delivery.fingerprints,
        delivery.group_count,
        delivery.subject,
        delivery.body,
        delivery.state,
        delivery.created_at,
        delivery.attempt_at,
      );
      return { delivery, reconcile: false };
    })
    .immediate();
  if (!("delivery" in claimed)) return claimed;
  const { delivery, reconcile } = claimed;
  const resending = !reconcile;
  try {
    if (reconcile) {
      lastReconcile = { id: delivery.id, at: now.getTime() };
      const match = await findSentSelfMessage(delivery.id, delivery.recipient);
      if (match) {
        completeDelivery(delivery, match.id, match.sentAt);
        return { sent: true, groups: delivery.group_count, messageId: delivery.id, reason: "reconciled" };
      }
      const stale = now.getTime() - Date.parse(delivery.attempt_at) > UNCERTAIN_TIMEOUT_MS;
      if (!stale) {
        const error = "Send outcome is unknown; no matching self-message in Sent yet. It will be re-sent if it has not appeared within an hour.";
        markUnsent(delivery.id, "uncertain", error);
        kvSet("questionDigest.error", error);
        return { sent: false, groups: delivery.group_count, messageId: delivery.id, reason: "delivery_uncertain" };
      }
      const error = "No matching self-message appeared in Sent within an hour; the digest will be re-sent.";
      markUnsent(delivery.id, "failed", error);
      kvSet("questionDigest.error", error);
      return { sent: false, groups: delivery.group_count, messageId: delivery.id, reason: "retry_scheduled" };
    }
    const gmailId = await sendSelfMessage({
      messageId: delivery.id,
      subject: delivery.subject,
      text: delivery.body,
      expectedMailbox: delivery.recipient,
      date: delivery.created_at,
    });
    completeDelivery(delivery, gmailId, timestamp);
    return { sent: true, groups: delivery.group_count, messageId: delivery.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Digest delivery failed";
    const state = resending && error instanceof GmailSendError && !error.ambiguous ? "failed" : "uncertain";
    markUnsent(delivery.id, state, message);
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
  await sendQuestionDigest(now ? { now } : {});
}
