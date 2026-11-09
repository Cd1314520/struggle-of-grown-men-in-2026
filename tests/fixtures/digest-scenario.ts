import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

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

function minutesAfter(minutes: number, seconds = 0) {
  return new Date(now.getTime() + minutes * 60_000 + seconds * 1_000);
}

function gate(
  text: string,
  context = "Acme employment eligibility",
  options = ["Yes", "No"],
  kind: "question" | "confirm_submit" | "cover_letter" = "question",
) {
  const id = nextJob++;
  db.query("INSERT INTO jobs (id, url, source, company, company_key, title, status) VALUES (?, ?, 'test', 'Acme', ?, 'Engineer', 'filling')").run(
    id,
    `https://jobs.example.com/${id}`,
    companyKey("Acme"),
  );
  return parkGate(id, { kind, text, context, options }, null);
}

function delivery() {
  const row = db
    .query<{ id: string; state: string; body: string; sent_at: string | null; gmail_id: string | null; attempts: number }, []>(
      "SELECT id, state, body, sent_at, gmail_id, attempts FROM question_digest_deliveries ORDER BY rowid DESC LIMIT 1",
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
  case "stale-uncertain": {
    gate("Are you authorized to work?");
    outcome = "ambiguous";
    visible = false;
    await assert.rejects(sendQuestionDigest({ force: true, now }), /outcome is unknown/);
    assert.equal(delivery().state, "uncertain");
    const id = delivery().id;
    outcome = "success";
    assert.equal((await sendQuestionDigest({ now: minutesAfter(30) })).reason, "delivery_uncertain");
    assert.equal(delivery().state, "uncertain");
    assert.equal(attempts.length, 1);
    const stale = await sendQuestionDigest({ now: minutesAfter(61) });
    assert.equal(stale.reason, "retry_scheduled");
    assert.equal(delivery().state, "failed");
    assert.equal(delivery().attempts, 1);
    assert.equal(attempts.length, 1);
    const resent = await sendQuestionDigest({ now: minutesAfter(62) });
    assert.equal(resent.sent, true);
    assert.equal(resent.messageId, id);
    assert.equal(delivery().id, id);
    assert.equal(delivery().state, "sent");
    assert.equal(delivery().attempts, 2);
    assert.equal(attempts.length, 2);
    assert.equal(attempts[1], id);
    break;
  }
  case "stale-uncertain-matched": {
    gate("Are you authorized to work?");
    outcome = "ambiguous";
    await assert.rejects(sendQuestionDigest({ force: true, now }), /outcome is unknown/);
    const result = await sendQuestionDigest({ now: minutesAfter(90) });
    assert.equal(result.reason, "reconciled");
    assert.equal(delivery().state, "sent");
    assert.equal(delivery().attempts, 1);
    assert.equal(attempts.length, 1);
    break;
  }
  case "failed-backoff": {
    gate("Are you authorized to work?");
    outcome = "reject";
    await assert.rejects(sendQuestionDigest({ now }), /403/);
    assert.equal(delivery().state, "failed");
    assert.equal(delivery().attempts, 1);
    let elapsed = 0;
    for (const [wait, attempt] of [
      [5, 2],
      [10, 3],
      [20, 4],
    ] as const) {
      assert.equal((await sendQuestionDigest({ now: minutesAfter(elapsed + wait, -1) })).reason, "retry_later");
      assert.equal(delivery().attempts, attempt - 1);
      elapsed += wait;
      await assert.rejects(sendQuestionDigest({ now: minutesAfter(elapsed) }), /403/);
      assert.equal(delivery().state, "failed");
      assert.equal(delivery().attempts, attempt);
      assert.equal(attempts.length, attempt);
    }
    outcome = "success";
    assert.equal((await sendQuestionDigest({ now: minutesAfter(elapsed + 39, 59) })).reason, "retry_later");
    const result = await sendQuestionDigest({ now: minutesAfter(elapsed + 40) });
    assert.equal(result.sent, true);
    assert.equal(delivery().state, "sent");
    assert.equal(delivery().attempts, 5);
    assert.equal(new Set(attempts).size, 1);
    break;
  }
  case "abandon": {
    gate("Are you authorized to work?");
    outcome = "reject";
    await assert.rejects(sendQuestionDigest({ now }), /403/);
    const firstId = delivery().id;
    let elapsed = 0;
    for (const wait of [5, 10, 20, 40]) {
      elapsed += wait;
      await assert.rejects(sendQuestionDigest({ now: minutesAfter(elapsed) }), /403/);
    }
    assert.equal(delivery().attempts, 5);
    assert.equal(delivery().state, "failed");
    assert.equal(attempts.length, 5);
    outcome = "success";
    const result = await sendQuestionDigest({ now: minutesAfter(elapsed, 1) });
    assert.equal(result.sent, true);
    assert.equal(result.groups, 1);
    assert.notEqual(result.messageId, firstId);
    assert.equal(db.query<{ state: string }, [string]>("SELECT state FROM question_digest_deliveries WHERE id = ?").get(firstId)?.state, "abandoned");
    assert.equal(delivery().id, result.messageId);
    assert.equal(delivery().state, "sent");
    assert.equal(delivery().attempts, 1);
    assert.equal(attempts.length, 6);
    assert.equal(digestStatus().undeliveredGroups, 0);
    break;
  }
  case "restart-before": {
    gate("Are you authorized to work?");
    await sendQuestionDigest({ force: true, now });
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
  case "steps": {
    const { addStep } = await import("../../src/steps");
    const sentJob = (title: string) => {
      const id = nextJob++;
      db.query("INSERT INTO jobs (id, url, source, company, company_key, title, status, submitted_at) VALUES (?, ?, 'test', 'Acme', ?, ?, 'submitted', ?)").run(
        id,
        `https://jobs.example.com/${id}`,
        companyKey("Acme"),
        title,
        "2026-10-01T00:00:00Z",
      );
      return { id, status: "submitted" as const };
    };
    addStep(sentJob("Backend Engineer"), { kind: "assessment", title: "Codility OA", due_at: "2026-10-11", source: "mail" });
    addStep(sentJob("Data Engineer"), { kind: "questionnaire", title: "Later form", due_at: "2026-10-20", source: "mail" });
    addStep(sentJob("SRE"), { kind: "schedule", title: "Book a call", source: "mail" });
    const first = await sendQuestionDigest({ now });
    assert.equal(first.sent, true);
    assert.equal(first.groups, 1);
    const text = must(sent[0], "sent message 0").text;
    const subject = () => db.query<{ subject: string }, []>("SELECT subject FROM question_digest_deliveries ORDER BY rowid DESC LIMIT 1").get()?.subject;
    assert.equal(subject(), "Auto Apply: 1 step due soon");
    assert.ok(text.includes("Codility OA — due 2026-10-11"));
    assert.ok(text.includes("Acme — Backend Engineer: https://auto-apply.example.com/#applied/1"));
    assert.equal(text.includes("Later form"), false);
    assert.equal(text.includes("Questions inbox"), false);
    assert.equal((await sendQuestionDigest({ force: true, now })).reason, "no_new_groups");
    gate("Are you authorized to work?");
    const next = await sendQuestionDigest({ force: true, now: new Date("2026-10-19T14:00:00Z") });
    assert.equal(next.groups, 2);
    const both = must(sent[1], "sent message 1").text;
    assert.equal(subject(), "Auto Apply: 1 new question group, 1 step due soon");
    assert.ok(both.includes("Later form"));
    break;
  }
  default:
    throw new Error(`Unknown scenario: ${process.argv[2]}`);
}
db.close();
