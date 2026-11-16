import { randomBytes } from "node:crypto";
import { db } from "./db";

const PATH_TENANT_HOSTS: Record<string, true> = {
  "boards.greenhouse.io": true,
  "job-boards.greenhouse.io": true,
  "jobs.lever.co": true,
  "jobs.smartrecruiters.com": true,
  "apply.workable.com": true,
  "jobs.ashbyhq.com": true,
  "jobs.jobvite.com": true,
  "recruiting.ultipro.com": true,
  "recruiting2.ultipro.com": true,
  "www.jobapscloud.com": true,
};

const QUERY_TENANT_HOSTS: [RegExp, string][] = [
  [/^career\d*\.(successfactors|sapsf)\.(com|eu|cn)$/, "company"],
  [/^sjobs\.brassring\.com$/, "partnerid"],
  [/^www\d*\.jobdiva\.com$/, "a"],
];

export function normalizeTenantDomain(urlOrDomain: string): string {
  if (typeof urlOrDomain !== "string") {
    throw new Error("Domain must be a non-empty string");
  }
  let s = urlOrDomain.trim();
  if (!s) {
    throw new Error("Domain must be a non-empty string");
  }

  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s)) {
    s = "https://" + s;
  }

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    throw new Error("Invalid domain or URL format");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are supported");
  }

  if (url.username || url.password) {
    throw new Error("URLs with user credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || (!hostname.includes(".") && hostname !== "localhost")) {
    throw new Error("Invalid hostname");
  }

  const portSuffix = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";

  if (PATH_TENANT_HOSTS[hostname]) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) {
      throw new Error("Multi-tenant domain requires tenant slug in path");
    }
    const tenantSlug = decodeURIComponent(segments[0] ?? "").toLowerCase();
    return `${hostname}${portSuffix}/${tenantSlug}`;
  }

  for (const [host, param] of QUERY_TENANT_HOSTS) {
    if (!host.test(hostname)) continue;
    const tenant = [...url.searchParams]
      .find(([key]) => key.toLowerCase() === param)?.[1]
      ?.trim()
      .toLowerCase();
    if (!tenant) throw new Error(`Multi-tenant domain requires its ${param}= query parameter`);
    return `${hostname}${portSuffix}?${param}=${tenant}`;
  }

  if (hostname.endsWith(".myworkdaysite.com")) {
    const segments = url.pathname.split("/").filter(Boolean);
    const at = segments.findIndex(s => s.toLowerCase() === "recruiting");
    const tenant = at < 0 ? undefined : segments[at + 1];
    if (!tenant) throw new Error("Workday domain requires employer tenant in path");
    return `${hostname}${portSuffix}/${decodeURIComponent(tenant).toLowerCase()}`;
  }

  if (hostname.endsWith(".myworkdayjobs.com") || hostname === "myworkdayjobs.com") {
    const parts = hostname.split(".");
    if (parts.length < 4) {
      throw new Error("Workday domain requires employer tenant subdomain");
    }
    return `${hostname}${portSuffix}`;
  }

  return `${hostname}${portSuffix}`;
}

export interface PasswordRule {
  min?: number;
  max?: number;
}

const DEFAULT_LENGTH = 16;
const SUFFIX = "aA1!";

function passwordLength(rule: PasswordRule): number {
  const min = Math.max(SUFFIX.length + 4, Math.floor(rule.min ?? 0));
  const max = Math.max(min, Math.floor(rule.max ?? 64));
  return Math.min(Math.max(DEFAULT_LENGTH, min), max);
}

export function newPassword(rule: PasswordRule = {}): string {
  const length = passwordLength(rule) - SUFFIX.length;
  return randomBytes(length).toString("base64url").replace(/[-_]/g, "x").slice(0, length) + SUFFIX;
}

const breaksRule = (password: string, rule: PasswordRule) =>
  (rule.min !== undefined && password.length < rule.min) || (rule.max !== undefined && password.length > rule.max);

export function saveResetPassword(domain: string, mailbox: string, password: string): string {
  const existing = db.query<{ email: string }, [string]>("SELECT email FROM accounts WHERE domain = ?").get(domain);
  const email = existing?.email ?? mailbox.trim();
  if (!email) return JSON.stringify({ saved: false, error: "no_mailbox", message: "No application mailbox configured; cannot save the login." });
  db.query("INSERT INTO accounts (domain, email, password) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET password = excluded.password").run(
    domain,
    email,
    password,
  );
  return JSON.stringify({ saved: true, domain, email });
}

export function resolveAccount(domain: string, mailbox: string, allowCreate: boolean, rule: PasswordRule = {}): string {
  let key: string;
  try {
    key = normalizeTenantDomain(domain);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Invalid domain or URL";
    return JSON.stringify({
      existing: false,
      error: "invalid_domain",
      message,
    });
  }

  const existingRow = db.query<{ email: string; password: string }, [string]>("SELECT email, password FROM accounts WHERE domain = ?").get(key);

  if (existingRow && allowCreate && breaksRule(existingRow.password, rule)) {
    const password = newPassword(rule);
    db.query("UPDATE accounts SET password = ? WHERE domain = ?").run(password, key);
    return JSON.stringify({
      email: existingRow.email,
      password,
      existing: false,
      replaced: "The stored password could not have been registered here: it breaks the length rule you gave. Register with this one.",
    });
  }

  if (existingRow) {
    return JSON.stringify({
      email: existingRow.email,
      password: existingRow.password,
      existing: true,
    });
  }

  if (!allowCreate) {
    return JSON.stringify({
      existing: false,
      error: "no_account_found",
      message: "No stored credentials for this tenant. Check the existing login or registration state; this does not prove no account exists.",
    });
  }

  const cleanMailbox = typeof mailbox === "string" ? mailbox.trim() : "";
  if (!cleanMailbox) {
    return JSON.stringify({
      existing: false,
      error: "no_mailbox",
      message: "No application mailbox configured; cannot create account.",
    });
  }

  const password = newPassword(rule);
  db.query("INSERT INTO accounts (domain, email, password) VALUES (?, ?, ?)").run(key, cleanMailbox, password);
  return JSON.stringify({ email: cleanMailbox, password, existing: false });
}
