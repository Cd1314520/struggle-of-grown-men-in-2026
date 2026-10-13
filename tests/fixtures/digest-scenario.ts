import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

// Module-loading boundary under test: static imports would initialize the production DB before
// this isolation guard. Dynamic imports are required so direct accidental execution fails safely.
const directory = process.env["AUTO_APPLY_DATA"];
assert.ok(directory && basename(directory).startsWith("auto-apply-digest-test-"));
assert.equal(process.env["AUTO_APPLY_PROFILE"], join(directory, "profile"));

const { config } = await import("../../src/config");
const { db, kvSet, companyKey } = await import("../../src/db");
const { parkGate, answerGate, listQuestionGroups } = await import("../../src/questions");
const { digestStatus, sendQuestionDigest, tickQuestionDigest } = await import("../../src/digest");
const mailbox = "digest@example.com";
config.mailbox = mailbox;
config.publicUrl = "https://auto-apply.example.com";
config.questionDigest = { enabled: true, time: "09:00", timeZone: "America/Chicago" };
const tokenA = "TEST-ACCESS-NOT-A-CREDENTIAL";
const tokenB = "TEST-OTHER-MAILBOX-ACCESS";
const otherMailbox = "other@example.com";
kvSet("gmail.refresh", "TEST-REFRESH-NOT-A-CREDENTIAL");
kvSet("gmail.access", JSON.stringify({ token: tokenA, exp: Date.parse("2100-01-01T00:00:00Z") }));
kvSet("gmail.address", mailbox);

interface SentMessage {
  id: string;
  owner: string;
  messageId: string;
  deliveryReference: string | null;
  from: string;
  to: string;
  text: string;
  internalDate: string;
  labels: string[];
}
const sent: SentMessage[] = [];
const attempts: string[] = [];
let authenticatedMailbox = mailbox;
let outcome: "success" | "reject" | "ambiguous" | "server_error" = "success";
let visible = true;
let now = new Date("2026-10-10T14:00:00Z");
let nextJob = 1;
const sentFile = join(directory, "synthetic-sent.json");
let profilePause: { reached: () => void; release: Promise<void> } | null = null;

function pauseNextProfile() {
  let reached!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => {
    reached = resolve;
  });
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  profilePause = { reached, release: released };
  return { waiting, release };
}

// This transport is intentionally closed: an unexpected URL fails, never falls back to fetch.
function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing ${what}`);
  return value;
}

globalThis.fetch = Object.assign(
  async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    assert.equal(url.origin, "https://gmail.googleapis.com");
    const path = url.pathname.replace("/gmail/v1/users/me", "");
    const authorization = new Headers(init?.headers).get("authorization");
    assert.ok(authorization === `Bearer ${tokenA}` || authorization === `Bearer ${tokenB}`);
    const requestMailbox = authorization === `Bearer ${tokenB}` ? otherMailbox : authenticatedMailbox;
    if (path === "/profile") {
      const pause = profilePause;
      profilePause = null;
      if (pause) {
        pause.reached();
        await pause.release;
      }
      return Response.json({ emailAddress: requestMailbox });
    }
    if (path === "/messages/send") {
      const body = init?.body;
      assert.ok(typeof body === "string");
      const raw = Buffer.from((JSON.parse(body) as { raw: string }).raw, "base64url").toString("utf8");
      const split = raw.indexOf("\r\n\r\n");
      const headers = Object.fromEntries(
        raw
          .slice(0, split)
          .split("\r\n")
          .map(line => {
            const colon = line.indexOf(":");
            return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
          }),
      );
      const text = Buffer.from(raw.slice(split + 4).replace(/\s/g, ""), "base64").toString("utf8");
      attempts.push(must(headers["message-id"], "Message-ID header"));
      assert.equal(headers["from"], mailbox);
      assert.equal(headers["to"], mailbox);
      if (outcome === "reject") return Response.json({ error: { message: "Denied" } }, { status: 403 });
      const message: SentMessage = {
        id: `gmail-${sent.length + 1}`,
        owner: requestMailbox,
        // Provider replaces the RFC identity but preserves our custom header and body.
        messageId: `<CANEwGNQfixture${sent.length + 1}=accepted@mail.gmail.com>`,
        deliveryReference: headers["x-auto-apply-delivery-id"] ?? null,
        from: headers["from"],
        to: headers["to"],
        text,
        internalDate: String(now.getTime()),
        labels: ["SENT", "INBOX", "UNREAD"],
      };
      sent.push(message);
      if (process.argv[2] === "restart-before") {
        writeFileSync(sentFile, JSON.stringify(message));
        // Simulate process death after Gmail acceptance, before any result or ledger update.
        process.exit(0);
      }
      if (outcome === "ambiguous") throw new TypeError("Connection closed after acceptance");
      if (outcome === "server_error") return Response.json({ error: { message: "Unavailable" } }, { status: 503 });
      return Response.json({ id: message.id });
    }
    if (path === "/messages") {
      const query = url.searchParams.get("q") ?? "";
      const match = /^in:sent "([^"]+)"$/.exec(query);
      assert.ok(match, "Reconciliation must search the quoted body reference, never RFC Message-ID");
      const reference = must(match[1], "delivery reference");
      return Response.json({
        messages: visible
          ? sent.filter(message => message.owner === requestMailbox && message.text.includes(reference)).map(message => ({ id: message.id }))
          : [],
      });
    }
    if (path.startsWith("/messages/")) {
      const message = sent.find(item => item.owner === requestMailbox && item.id === decodeURIComponent(path.slice("/messages/".length)));
      assert.ok(message);
      return Response.json({
        id: message.id,
        labelIds: message.labels,
        internalDate: message.internalDate,
        payload: {
          headers: [
            { name: "Message-ID", value: message.messageId },
            { name: "From", value: message.from },
            { name: "To", value: message.to },
            ...(message.deliveryReference === null ? [] : [{ name: "X-Auto-Apply-Delivery-ID", value: message.deliveryReference }]),
          ].filter(item => item.value),
        },
      });
    }
    throw new Error(`Unexpected Gmail request: ${url.href}`);
  },
  { preconnect: globalThis.fetch.preconnect },
);

function gate(
  text: string,
  context = "Acme employment eligibility",
  options = ["Yes", "No"],
  kind: "question" | "confirm_submit" | "cover_letter" = "question",
) {
  const id = nextJob++;
  db.query("INSERT INTO jobs (id, url, source, company, company_key, title) VALUES (?, ?, 'test', 'Acme', ?, 'Engineer')").run(
    id,
    `https://jobs.example.com/${id}`,
    companyKey("Acme"),
  );
  return parkGate(id, { kind, text, context, options }, null);
}

function delivery() {
  const row = db
    .query<{ id: string; state: string; body: string; sent_at: string | null; gmail_id: string | null }, []>(
      "SELECT id, state, body, sent_at, gmail_id FROM question_digest_deliveries ORDER BY rowid DESC LIMIT 1",
    )
    .get();
  assert.ok(row);
  return row;
}

switch (process.argv[2]) {
  case "schedule": {
    gate("Are you authorized to work?");
    assert.equal((await sendQuestionDigest({ now: new Date("2026-10-10T13:59:59Z") })).reason, "before_schedule");
    assert.equal(attempts.length, 0);
    await tickQuestionDigest(now);
    assert.equal(attempts.length, 1);
    gate("Can you start in November?");
    assert.equal((await sendQuestionDigest({ now: new Date("2026-10-10T20:00:00Z") })).reason, "already_sent_today");
    assert.equal((await sendQuestionDigest({ force: true, now })).groups, 1);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    assert.equal(attempts.length, 2);
    assert.equal(digestStatus().lastError, null);
    assert.equal(digestStatus().undeliveredGroups, 0);
    break;
  }
  case "dst": {
    for (const [date, utcHour] of [
      ["2026-03-07", 15],
      ["2026-03-08", 14],
      ["2026-10-31", 14],
      ["2026-11-01", 15],
    ] as const) {
      gate(`Availability on ${date}?`);
      now = new Date(`${date}T${utcHour}:00:00Z`);
      const before = new Date(now.getTime() - 1_000);
      const count = attempts.length;
      assert.equal((await sendQuestionDigest({ now: before })).reason, "before_schedule");
      assert.equal(attempts.length, count);
      assert.equal((await sendQuestionDigest({ now })).sent, true);
      assert.equal(attempts.length, count + 1);
    }
    config.questionDigest = { enabled: true, time: "10:15", timeZone: "Europe/London" };
    gate("Custom schedule?");
    assert.equal((await sendQuestionDigest({ now: new Date("2026-11-02T10:14:00Z") })).reason, "before_schedule");
    assert.equal((await sendQuestionDigest({ now: new Date("2026-11-02T10:15:00Z") })).sent, true);
    break;
  }
  case "groups": {
    gate("Are you authorized to work?");
    assert.equal((await sendQuestionDigest({ force: true, now })).groups, 1);
    gate("Are you authorized to work?");
    assert.equal(listQuestionGroups().length, 1);
    assert.equal(must(listQuestionGroups()[0], "question group").jobs.length, 2);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    assert.equal((await sendQuestionDigest({ now: new Date("2026-10-11T14:00:00Z") })).reason, "no_new_groups");
    gate("Are you authorized to work?", "Different jurisdiction");
    gate("Are you authorized to work?", "Acme employment eligibility", ["Yes", "No", "Requires sponsorship"]);
    assert.equal(digestStatus().undeliveredGroups, 2);
    assert.equal((await sendQuestionDigest({ force: true, now })).groups, 2);
    assert.equal(attempts.length, 2);
    break;
  }
  case "rejection": {
    gate("Are you authorized to work?");
    outcome = "reject";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /403/);
    assert.equal(delivery().state, "failed");
    assert.equal(delivery().sent_at, null);
    assert.equal(digestStatus().lastSentAt, null);
    assert.equal(digestStatus().undeliveredGroups, 1);
    assert.equal((await sendQuestionDigest({ now })).reason, "retry_later");
    assert.equal(attempts.length, 1);
    outcome = "success";
    const result = await sendQuestionDigest({ force: true, now });
    assert.equal(result.sent, true);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1]);
    assert.equal(result.messageId, attempts[0]);
    assert.equal(delivery().state, "sent");
    assert.equal(digestStatus().undeliveredGroups, 0);
    break;
  }
  case "ambiguous": {
    gate("Are you authorized to work?");
    outcome = "server_error";
    visible = false;
    await assert.rejects(sendQuestionDigest({ force: true, now }), /503/);
    assert.equal(delivery().state, "uncertain");
    assert.equal(delivery().sent_at, null);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    assert.equal(attempts.length, 1);
    assert.equal(digestStatus().undeliveredGroups, 1);
    visible = true;
    const message = must(sent[0], "sent message");
    const reference = delivery().id.slice(1, -1);
    assert.notEqual(message.messageId, delivery().id);
    assert.equal(delivery().body.endsWith(`Auto-Apply delivery reference: ${reference}`), true);
    message.deliveryReference = null;
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.deliveryReference = `${reference}.wrong`;
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.deliveryReference = reference;
    const indexedBody = message.text;
    message.text = indexedBody.replace(reference, "different-delivery-reference");
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.text = indexedBody;
    message.from = "";
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.from = "attacker@example.com";
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.from = mailbox;
    message.to = "";
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.to = "someone-else@example.com";
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.to = mailbox;
    message.labels = [];
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.labels = ["INBOX"];
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "delivery_uncertain");
    message.labels = ["SENT"];
    const result = await sendQuestionDigest({ force: true, now });
    assert.equal(result.reason, "reconciled");
    assert.equal(result.messageId, attempts[0]);
    assert.equal(delivery().state, "sent");
    assert.equal(digestStatus().lastSentAt, now.toISOString());
    assert.equal(attempts.length, 1);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    break;
  }
  case "lost-ack": {
    gate("Are you authorized to work?");
    outcome = "ambiguous";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /outcome is unknown/);
    assert.equal(delivery().state, "uncertain");
    assert.equal(delivery().sent_at, null);
    assert.notEqual(must(sent[0], "sent message 0").messageId, delivery().id);
    const result = await sendQuestionDigest({ force: true, now });
    assert.equal(result.reason, "reconciled");
    assert.equal(result.messageId, attempts[0]);
    assert.equal(delivery().gmail_id, must(sent[0], "sent message 0").id);
    assert.equal(attempts.length, 1);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    break;
  }
  case "restart-before": {
    gate("Are you authorized to work?");
    await sendQuestionDigest({ force: true, now });
    // Explicit throw (not assert.fail) so control flow visibly never reaches the next case.
    throw new assert.AssertionError({ message: "Restart transport must terminate before recording success", operator: "fail" });
  }
  case "restart-after": {
    sent.push(JSON.parse(readFileSync(sentFile, "utf8")) as SentMessage);
    assert.equal(digestStatus().deliveryState, "sending");
    const originalId = delivery().id;
    assert.notEqual(must(sent[0], "sent message 0").messageId, originalId);
    assert.equal(delivery().body.endsWith(`Auto-Apply delivery reference: ${originalId.slice(1, -1)}`), true);
    const result = await sendQuestionDigest({ force: true, now });
    assert.equal(result.messageId, originalId);
    assert.equal(result.reason, "reconciled");
    assert.equal(attempts.length, 0);
    assert.equal(delivery().gmail_id, must(sent[0], "sent message 0").id);
    assert.equal(digestStatus().undeliveredGroups, 0);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    break;
  }
  case "identity": {
    gate("Are you authorized to work?");
    config.mailbox = "other@example.com";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /matching Gmail identity/);
    assert.equal(digestStatus().recipient, null);
    assert.equal(attempts.length, 0);
    config.mailbox = mailbox;
    kvSet("gmail.address", "cached-wrong@example.com");
    await assert.rejects(sendQuestionDigest({ force: true, now }), /matching Gmail identity/);
    kvSet("gmail.address", mailbox);
    authenticatedMailbox = "authenticated-wrong@example.com";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /Authenticated Gmail identity/);
    assert.equal(delivery().state, "failed");
    assert.equal(digestStatus().lastSentAt, null);
    assert.equal(attempts.length, 0);
    authenticatedMailbox = mailbox;
    assert.equal((await sendQuestionDigest({ force: true, now })).sent, true);
    assert.equal(attempts.length, 1);
    break;
  }
  case "token-swap": {
    gate("Are you authorized to work?");
    const sendPause = pauseNextProfile();
    const sending = sendQuestionDigest({ force: true, now });
    await sendPause.waiting;
    // Match exchangeCode's transient state: B token cached while A's address remains recorded.
    kvSet("gmail.access", JSON.stringify({ token: tokenB, exp: Date.parse("2100-01-01T00:00:00Z") }));
    sendPause.release();
    assert.equal((await sending).sent, true);
    assert.equal(must(sent[0], "sent message 0").owner, mailbox);
    assert.equal(sent.filter(message => message.owner === otherMailbox).length, 0);

    kvSet("gmail.access", JSON.stringify({ token: tokenA, exp: Date.parse("2100-01-01T00:00:00Z") }));
    gate("When can you start?");
    outcome = "ambiguous";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /outcome is unknown/);
    const reconcilePause = pauseNextProfile();
    const reconciling = sendQuestionDigest({ force: true, now });
    await reconcilePause.waiting;
    kvSet("gmail.access", JSON.stringify({ token: tokenB, exp: Date.parse("2100-01-01T00:00:00Z") }));
    reconcilePause.release();
    const result = await reconciling;
    assert.equal(result.reason, "reconciled");
    assert.equal(result.messageId, delivery().id);
    assert.equal(delivery().gmail_id, must(sent[1], "sent message 1").id);
    assert.equal(delivery().state, "sent");
    assert.equal(attempts.length, 2);
    assert.equal(sent.filter(message => message.owner === otherMailbox).length, 0);
    break;
  }
  case "concurrent": {
    gate("Are you authorized to work?");
    const [first, second] = await Promise.all([sendQuestionDigest({ force: true, now }), sendQuestionDigest({ force: true, now })]);
    assert.equal(first.sent, true);
    assert.equal(second.reason, "busy");
    assert.equal(attempts.length, 1);
    gate("Another question?");
    config.questionDigest.enabled = false;
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "disabled");
    assert.equal(digestStatus().deliveryState, "disabled");
    assert.equal(digestStatus().undeliveredGroups, 1);
    assert.equal(attempts.length, 1);
    break;
  }
  case "privacy": {
    const answered = gate("Previously answered question?");
    answerGate(answered.id, "PRIVATE-APPLICATION-ANSWER", "application");
    gate("Unanswered work authorization?", "PRIVATE-CONTEXT-FILLED-VALUE");
    gate("PRIVATE-SUBMISSION-SUMMARY", "PRIVATE-SUBMISSION-CONTEXT", [], "confirm_submit");
    gate("PRIVATE-COVER-LETTER", "PRIVATE-COVER-CONTEXT", [], "cover_letter");
    db.query("INSERT INTO accounts (domain, email, password) VALUES ('example.com', ?, 'PRIVATE-PASSWORD')").run(mailbox);
    assert.equal((await sendQuestionDigest({ force: true, now })).sent, true);
    const text = must(sent[0], "sent message 0").text;
    assert.ok(text.includes("Unanswered work authorization?"));
    assert.ok(text.includes("3 new question groups across 3 applications"));
    assert.ok(text.includes("https://auto-apply.example.com/#questions"));
    assert.ok(text.includes("https://auto-apply.example.com/#progress/2"));
    for (const secret of [
      "PRIVATE-APPLICATION-ANSWER",
      "PRIVATE-CONTEXT",
      "PRIVATE-SUBMISSION",
      "PRIVATE-COVER",
      "PRIVATE-PASSWORD",
      "TEST-REFRESH",
      "TEST-ACCESS",
    ])
      assert.equal(text.includes(secret), false);
    break;
  }
  default:
    throw new Error(`Unknown scenario: ${process.argv[2]}`);
}
db.close();
