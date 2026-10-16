import { describe, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prelude = `
import assert from "node:assert/strict";
import { db } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import { resolveAccount } from ${JSON.stringify(join(import.meta.dir, "../src/accounts.ts"))};
`;

function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-accounts-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) {
      throw new Error(`Scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("account resolution behavioral semantics", () => {
  it("rejects unsafe URLs, non-http schemes, userinfo, and tenantless Workday domains without echoing secrets", () => {
    scenario(`
    // URL with embedded credentials must be rejected without echoing secrets
    const userinfoRes = JSON.parse(await resolveAccount("https://user:supersecret@careers.rei.com/login", "app@example.com", false));
    assert.equal(userinfoRes.existing, false);
    assert.equal(userinfoRes.error, "invalid_domain");
    assert.ok(!JSON.stringify(userinfoRes).includes("supersecret"));

    // Non-http schemes rejected
    const ftpRes = JSON.parse(await resolveAccount("ftp://careers.rei.com", "app@example.com", false));
    assert.equal(ftpRes.existing, false);
    assert.equal(ftpRes.error, "invalid_domain");

    // Tenantless Workday domain rejected (not assuming arbitrary path routing)
    const bareWd = JSON.parse(await resolveAccount("https://wd5.myworkdayjobs.com", "app@example.com", false));
    assert.equal(bareWd.existing, false);
    assert.equal(bareWd.error, "invalid_domain");

    // Multi-tenant SaaS without tenant slug rejected
    const bareGh = JSON.parse(await resolveAccount("https://boards.greenhouse.io", "app@example.com", false));
    assert.equal(bareGh.existing, false);
    assert.equal(bareGh.error, "invalid_domain");

    // Empty or blank input rejected
    const emptyRes = JSON.parse(await resolveAccount("   ", "app@example.com", false));
    assert.equal(emptyRes.existing, false);
    assert.equal(emptyRes.error, "invalid_domain");
  `);
  });

  it("safely looks up stored credentials without leaking secrets or creating unpermitted accounts", () => {
    scenario(`
    // Lookup-only when account does not exist
    const raw = await resolveAccount("https://acrisure.wd5.myworkdayjobs.com/en-US/careers", "app@example.com", false);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.existing, false);
    assert.equal(parsed.error, "no_account_found");
    assert.equal(parsed.password, undefined);

    // Verify DB accounts table remains empty
    const count = db.query("SELECT COUNT(*) AS c FROM accounts").get();
    assert.equal(count.c, 0);
  `);
  });

  it("creates and persists credentials only when allowCreate is true and mailbox is provided", () => {
    scenario(`
    // Missing mailbox returns error without inserting
    const noMailbox = JSON.parse(await resolveAccount("acrisure.wd5.myworkdayjobs.com", "", true));
    assert.equal(noMailbox.existing, false);
    assert.equal(noMailbox.error, "no_mailbox");

    // Valid creation generates credentials and inserts into DB
    const created = JSON.parse(await resolveAccount("acrisure.wd5.myworkdayjobs.com", "app@example.com", true));
    assert.equal(created.existing, false);
    assert.equal(created.email, "app@example.com");
    assert.ok(typeof created.password === "string" && created.password.length === 14);

    // Verify stored in DB under normalized key
    const row = db.query("SELECT email, password FROM accounts WHERE domain = ?").get("acrisure.wd5.myworkdayjobs.com");
    assert.ok(row !== null);
    assert.equal(row.email, "app@example.com");
    assert.equal(row.password, created.password);
  `);
  });

  it("reuses existing stored credentials and refuses to overwrite known accounts even when allowCreate is true", () => {
    scenario(`
    // Create initial account
    const initial = JSON.parse(await resolveAccount("careers.rei.com", "app@example.com", true));
    assert.equal(initial.existing, false);
    const password = initial.password;

    // Lookup with allowCreate=false reuses stored credentials
    const lookup = JSON.parse(await resolveAccount("https://careers.rei.com/jobs/123", "other@example.com", false));
    assert.equal(lookup.existing, true);
    assert.equal(lookup.email, "app@example.com");
    assert.equal(lookup.password, password);

    // Call with allowCreate=true STILL reuses stored credentials and does not overwrite
    const createAttempt = JSON.parse(await resolveAccount("careers.rei.com", "other2@example.com", true));
    assert.equal(createAttempt.existing, true);
    assert.equal(createAttempt.email, "app@example.com");
    assert.equal(createAttempt.password, password);

    // DB record remains unchanged
    const row = db.query("SELECT email, password FROM accounts WHERE domain = ?").get("careers.rei.com");
    assert.equal(row.password, password);
  `);
  });

  it("strictly isolates credentials across different tenants on multi-tenant SaaS and Workday platforms", () => {
    scenario(`
    // Create account for Acrisure Workday tenant
    const acrisure = JSON.parse(await resolveAccount("https://acrisure.wd5.myworkdayjobs.com/en-US/careers/job/1", "app@example.com", true));
    assert.equal(acrisure.existing, false);

    // Amerisure Workday lookup returns no_account_found (no cross-tenant leakage)
    const amerisure = JSON.parse(await resolveAccount("amerisure.wd5.myworkdayjobs.com", "app@example.com", false));
    assert.equal(amerisure.existing, false);
    assert.equal(amerisure.error, "no_account_found");

    // Greenhouse Airbnb tenant account
    const airbnb = JSON.parse(await resolveAccount("https://boards.greenhouse.io/airbnb/jobs/100", "app@example.com", true));
    assert.equal(airbnb.existing, false);

    // Greenhouse Stripe tenant lookup returns no_account_found
    const stripe = JSON.parse(await resolveAccount("https://boards.greenhouse.io/stripe/jobs/200", "app@example.com", false));
    assert.equal(stripe.existing, false);
    assert.equal(stripe.error, "no_account_found");
    assert.equal(stripe.password, undefined);

    // Airbnb lookup finds original account
    const airbnbLookup = JSON.parse(await resolveAccount("https://boards.greenhouse.io/airbnb/jobs/101", "app@example.com", false));
    assert.equal(airbnbLookup.existing, true);
    assert.equal(airbnbLookup.password, airbnb.password);
  `);
  });
});
