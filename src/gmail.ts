// Gmail access for the dedicated application mailbox (OAuth, gmail.modify scope).
// Client credentials: profile/gmail-client.json (the "Desktop app" or "Web" OAuth client
// JSON downloaded from Google Cloud). Tokens live in the local DB.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { config, PROFILE, publicUrl } from "./config";
import { kvGet, kvSet } from "./db";

const SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const redirectUri = () => `${publicUrl()}/oauth/callback`;

function client() {
  let raw: any;
  try {
    raw = JSON.parse(readFileSync(join(PROFILE, "gmail-client.json"), "utf8"));
  } catch {
    throw new Error("profile/gmail-client.json is missing; see README (Gmail setup)");
  }
  const c = raw.installed ?? raw.web ?? raw;
  return { id: c.client_id as string, secret: c.client_secret as string };
}

export function authUrl() {
  const q = new URLSearchParams({
    client_id: client().id,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params: Record<string, string>) {
  const c = client();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({ client_id: c.id, client_secret: c.secret, ...params }),
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`Google token error: ${body.error_description ?? body.error}`);
  return body;
}

export async function exchangeCode(code: string) {
  const t = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  if (t.refresh_token) kvSet("gmail.refresh", t.refresh_token);
  kvSet("gmail.access", JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }));
  const profile = await call("/profile");
  if (config.mailbox && profile.emailAddress.toLowerCase() !== config.mailbox.toLowerCase()) {
    kvSet("gmail.refresh", "");
    kvSet("gmail.access", "null");
    throw new Error(`Signed in as ${profile.emailAddress}, but the application mailbox is ${config.mailbox}. Sign in with that account.`);
  }
  kvSet("gmail.address", profile.emailAddress);
}

export const gmailStatus = () => ({ connected: !!kvGet("gmail.refresh"), address: kvGet("gmail.address") });

async function accessToken() {
  const cached = JSON.parse(kvGet("gmail.access") ?? "null");
  if (cached && cached.exp > Date.now()) return cached.token as string;
  const refresh = kvGet("gmail.refresh");
  if (!refresh) throw new Error("Gmail is not connected; connect it in the app's Settings tab");
  const t = await tokenRequest({ refresh_token: refresh, grant_type: "refresh_token" });
  kvSet("gmail.access", JSON.stringify({ token: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }));
  return t.access_token as string;
}

async function call(path: string, init?: RequestInit, token?: string) {
  const res = await fetch(API + path, {
    ...init,
    headers: { authorization: `Bearer ${token ?? await accessToken()}`, "content-type": "application/json" },
  });
  const body = (await res.json()) as any;
  if (!res.ok) throw new Error(`Gmail API ${res.status}: ${body.error?.message ?? "unknown error"}`);
  return body;
}

const header = (msg: { payload?: { headers?: { name: string; value: string }[] } }, name: string) => {
  // RFC header names are case-insensitive; normalize both sides of the lookup.
  const normalizedName = name.toLowerCase();
  return msg.payload?.headers?.find(h => h.name.toLowerCase() === normalizedName)?.value ?? "";
};

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");

function bodyText(payload: any): string {
  const plain: string[] = [];
  const html: string[] = [];
  const walk = (p: any) => {
    if (!p) return;
    if (p.body?.data && p.mimeType === "text/plain") plain.push(decode(p.body.data));
    if (p.body?.data && p.mimeType === "text/html") html.push(decode(p.body.data));
    for (const part of p.parts ?? []) walk(part);
  };
  walk(payload);
  if (plain.join("").trim()) return plain.join("\n");
  // Keep link targets: verification mails often carry the code only in an href.
  return html
    .join("\n")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 [$1]")
    .replace(/<\/(p|div|tr|li|h[1-6])>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

export async function search(query: string, max = 10) {
  const list = await call(`/messages?${new URLSearchParams({ q: query, maxResults: String(Math.min(max, 25)) })}`);
  const out = [];
  for (const m of list.messages ?? []) {
    const msg = await call(`/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({
      id: m.id,
      thread: msg.threadId,
      from: header(msg, "from"),
      subject: header(msg, "subject"),
      date: header(msg, "date"),
      unread: (msg.labelIds ?? []).includes("UNREAD"),
      snippet: msg.snippet,
    });
  }
  return out;
}

export async function read(id: string) {
  const msg = await call(`/messages/${encodeURIComponent(id)}?format=full`);
  return {
    id: msg.id,
    thread: msg.threadId,
    from: header(msg, "from"),
    to: header(msg, "to"),
    subject: header(msg, "subject"),
    date: header(msg, "date"),
    body: bodyText(msg.payload).slice(0, 20_000),
  };
}

export async function markRead(id: string) {
  await call(`/messages/${encodeURIComponent(id)}/modify`, { method: "POST", body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) });
}

// Digest-only sending: recipient is resolved from the OAuth identity, never from worker input.
export class GmailSendError extends Error {
  constructor(message: string, readonly ambiguous: boolean) {
    super(message);
  }
}

const mailboxAddress = (value: string) => {
  const address = value.trim().toLowerCase();
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(address))
    throw new Error("Invalid Gmail mailbox identity");
  return address;
};

async function verifiedSelfIdentity(): Promise<{ recipient: string; token: string }> {
  const status = gmailStatus();
  if (!status.connected || !status.address) throw new Error("Gmail is not connected");
  const connected = mailboxAddress(status.address);
  const expected = config.mailbox ? mailboxAddress(config.mailbox) : connected;
  if (connected !== expected) throw new Error("Connected Gmail identity does not match the configured mailbox");
  // Keep this credential snapshot through all subsequent requests. OAuth callbacks can replace
  // the cache while profile verification is pending; rereading it would authorize another mailbox.
  const token = await accessToken();
  const profile = await call("/profile", { signal: AbortSignal.timeout(30_000) }, token);
  if (typeof profile.emailAddress !== "string" || mailboxAddress(profile.emailAddress) !== expected)
    throw new Error("Authenticated Gmail identity does not match the digest mailbox");
  return { recipient: expected, token };
}

export function digestDeliveryReference(messageId: string): string {
  if (!/^<[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+>$/.test(messageId))
    throw new Error("Invalid digest delivery identifier");
  return messageId.slice(1, -1);
}

export async function sendSelfMessage(message: {
  messageId: string; subject: string; text: string; expectedMailbox: string; date: string;
}): Promise<string> {
  let recipient: string;
  let token: string;
  let raw: string;
  try {
    const reference = digestDeliveryReference(message.messageId);
    if (!message.text.endsWith(`Auto-Apply delivery reference: ${reference}`))
      throw new Error("Digest body is missing its persisted delivery reference");
    if (/[\r\n]/.test(message.subject)) throw new Error("Invalid digest subject");
    const date = new Date(message.date);
    if (!Number.isFinite(date.getTime())) throw new Error("Invalid digest message date");
    ({ recipient, token } = await verifiedSelfIdentity());
    if (recipient !== mailboxAddress(message.expectedMailbox)) throw new Error("Digest mailbox changed before delivery");
    raw = Buffer.from([
      `From: ${recipient}`,
      `To: ${recipient}`,
      `Date: ${date.toUTCString()}`,
      `Message-ID: ${message.messageId}`,
      `X-Auto-Apply-Delivery-ID: ${reference}`,
      `Subject: =?UTF-8?B?${Buffer.from(message.subject, "utf8").toString("base64")}?=`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      Buffer.from(message.text, "utf8").toString("base64").match(/.{1,76}/g)?.join("\r\n") ?? "",
      "",
    ].join("\r\n"), "utf8").toString("base64url");
  } catch (error) {
    throw new GmailSendError(error instanceof Error ? error.message : "Gmail send preflight failed", false);
  }
  try {
    const res = await fetch(`${API}/messages/send`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ raw }),
      signal: AbortSignal.timeout(30_000),
    });
    // A definite rejection is safe to retry. A timeout/server error may follow acceptance.
    if (!res.ok) throw new GmailSendError(`Gmail send rejected (${res.status})`, res.status >= 500 || res.status === 408);
    const body = await res.json() as { id?: string };
    if (!body.id) throw new GmailSendError("Gmail send returned no message identifier", true);
    return body.id;
  } catch (error) {
    if (error instanceof GmailSendError) throw error;
    throw new GmailSendError("Gmail send outcome is unknown; reconcile against Sent before any retry", true);
  }
}

export async function findSentSelfMessage(messageId: string, expectedMailbox: string): Promise<{ id: string; sentAt: string } | null> {
  const reference = digestDeliveryReference(messageId);
  const { recipient, token } = await verifiedSelfIdentity();
  if (recipient !== mailboxAddress(expectedMailbox)) throw new Error("Digest mailbox changed before reconciliation");
  // Gmail may replace RFC Message-ID. Search the persisted body reference, then require the
  // exact custom identity header; search indexing alone is never delivery proof.
  const q = `in:sent "${reference}"`;
  const list = await call(`/messages?${new URLSearchParams({ q, maxResults: "100" })}`, { signal: AbortSignal.timeout(30_000) }, token);
  for (const item of list.messages ?? []) {
    const msg = await call(`/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=X-Auto-Apply-Delivery-ID&metadataHeaders=From&metadataHeaders=To`, { signal: AbortSignal.timeout(30_000) }, token);
    if ((msg.labelIds ?? []).includes("SENT") && header(msg, "X-Auto-Apply-Delivery-ID").trim() === reference
      && [header(msg, "From"), header(msg, "To")].every(value => (value.match(/<([^<>]+)>/)?.[1] ?? value).trim().toLowerCase() === recipient)) {
      const date = new Date(Number(msg.internalDate));
      if (!Number.isFinite(date.getTime())) throw new Error("Sent digest has no valid delivery timestamp");
      return { id: msg.id, sentAt: date.toISOString() };
    }
  }
  return null;
}
