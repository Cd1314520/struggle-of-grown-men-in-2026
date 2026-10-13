import { randomBytes } from "node:crypto";
import { db } from "./db";

/**
 * Known multi-tenant SaaS hosts where tenant isolation requires the path prefix.
 */
const PATH_TENANT_HOSTS: Record<string, true> = {
  "boards.greenhouse.io": true,
  "job-boards.greenhouse.io": true,
  "jobs.lever.co": true,
  "jobs.smartrecruiters.com": true,
  "apply.workable.com": true,
  "jobs.ashbyhq.com": true,
  "jobs.jobvite.com": true,
};

/**
 * Conservatively normalizes a URL or domain string into an isolated tenant key.
 * Enforces strict host/tenant separation without cross-tenant aliasing.
 * Throws on non-http schemes, userinfo, or missing tenant indicators without leaking inputs.
 */
function normalizeTenantDomain(urlOrDomain: string): string {
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

  // Reject non-http protocols (e.g. javascript:, ftp:, data:)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only HTTP and HTTPS protocols are supported");
  }

  // Reject userinfo to prevent secret leakage or credential abuse
  if (url.username || url.password) {
    throw new Error("URLs with user credentials are not allowed");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname || (!hostname.includes(".") && hostname !== "localhost")) {
    throw new Error("Invalid hostname");
  }

  const portSuffix = url.port && url.port !== "80" && url.port !== "443" ? `:${url.port}` : "";

  // Multi-tenant hosts where path prefix isolates tenants
  if (PATH_TENANT_HOSTS[hostname]) {
    const segments = url.pathname.split("/").filter(Boolean);
    if (!segments.length) {
      throw new Error("Multi-tenant domain requires tenant slug in path");
    }
    const tenantSlug = decodeURIComponent(segments[0] ?? "").toLowerCase();
    return `${hostname}${portSuffix}/${tenantSlug}`;
  }

  // Workday: <tenant>.<wdN>.myworkdayjobs.com has tenant in subdomain.
  // Reject tenantless Workday hosts (e.g. bare myworkdayjobs.com or wd5.myworkdayjobs.com)
  if (hostname.endsWith(".myworkdayjobs.com") || hostname === "myworkdayjobs.com") {
    const parts = hostname.split(".");
    if (parts.length < 4) {
      throw new Error("Workday domain requires employer tenant subdomain");
    }
    return `${hostname}${portSuffix}`;
  }

  // Standard employer domain: exact hostname + non-standard port
  return `${hostname}${portSuffix}`;
}

/**
 * Resolves account credentials for an ATS tenant.
 * Sole exported interface for account recovery.
 *
 * - Stored credentials found: returns JSON { email, password, existing: true }.
 * - Missing and allowCreate=false: returns JSON { existing: false, error: "no_account_found", message: "..." }.
 * - Missing and allowCreate=true: generates a strong password, persists it, and returns JSON { email, password, existing: false }.
 */
export function resolveAccount(domain: string, mailbox: string, allowCreate: boolean): string {
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

  // 1. Look up existing stored credentials
  const existingRow = db.query<{ email: string; password: string }, [string]>("SELECT email, password FROM accounts WHERE domain = ?").get(key);

  if (existingRow) {
    return JSON.stringify({
      email: existingRow.email,
      password: existingRow.password,
      existing: true,
    });
  }

  // 2. Not found, and creation is not allowed (lookup-only or ambiguous submission safety)
  if (!allowCreate) {
    return JSON.stringify({
      existing: false,
      error: "no_account_found",
      message: "No stored credentials for this tenant. Check the existing login or registration state; this does not prove no account exists.",
    });
  }

  // 3. Creation allowed: validate mailbox
  const cleanMailbox = typeof mailbox === "string" ? mailbox.trim() : "";
  if (!cleanMailbox) {
    return JSON.stringify({
      existing: false,
      error: "no_mailbox",
      message: "No application mailbox configured; cannot create account.",
    });
  }

  // 4. Generate compliant password and persist
  const password = `${randomBytes(12).toString("base64url")}aA1!`;
  db.query("INSERT INTO accounts (domain, email, password) VALUES (?, ?, ?)").run(key, cleanMailbox, password);
  return JSON.stringify({ email: cleanMailbox, password, existing: false });
}
