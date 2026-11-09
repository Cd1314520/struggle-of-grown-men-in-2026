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
    const userinfoRes = JSON.parse(await resolveAccount("https://user:supersecret@careers.rei.com/login", "app@example.com", false));
    assert.equal(userinfoRes.existing, false);
    assert.equal(userinfoRes.error, "invalid_domain");
    assert.ok(!JSON.stringify(userinfoRes).includes("supersecret"));

    const ftpRes = JSON.parse(await resolveAccount("ftp://careers.rei.com", "app@example.com", false));
    assert.equal(ftpRes.existing, false);
    assert.equal(ftpRes.error, "invalid_domain");

    const bareWd = JSON.parse(await resolveAccount("https://wd5.myworkdayjobs.com", "app@example.com", false));
    assert.equal(bareWd.existing, false);
    assert.equal(bareWd.error, "invalid_domain");

    const bareGh = JSON.parse(await resolveAccount("https://boards.greenhouse.io", "app@example.com", false));
    assert.equal(bareGh.existing, false);
    assert.equal(bareGh.error, "invalid_domain");

    const emptyRes = JSON.parse(await resolveAccount("   ", "app@example.com", false));
    assert.equal(emptyRes.existing, false);
    assert.equal(emptyRes.error, "invalid_domain");
  `);
  });

  it("safely looks up stored credentials without leaking secrets or creating unpermitted accounts", () => {
    scenario(`
    const raw = await resolveAccount("https://acrisure.wd5.myworkdayjobs.com/en-US/careers", "app@example.com", false);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.existing, false);
    assert.equal(parsed.error, "no_account_found");
    assert.equal(parsed.password, undefined);

    const count = db.query("SELECT COUNT(*) AS c FROM accounts").get();
    assert.equal(count.c, 0);
  `);
  });

  it("creates and persists credentials only when allowCreate is true and mailbox is provided", () => {
    scenario(`
    const noMailbox = JSON.parse(await resolveAccount("acrisure.wd5.myworkdayjobs.com", "", true));
    assert.equal(noMailbox.existing, false);
    assert.equal(noMailbox.error, "no_mailbox");

    const created = JSON.parse(await resolveAccount("acrisure.wd5.myworkdayjobs.com", "app@example.com", true));
    assert.equal(created.existing, false);
    assert.equal(created.email, "app@example.com");
    assert.ok(typeof created.password === "string" && created.password.length === 16);

    const row = db.query("SELECT email, password FROM accounts WHERE domain = ?").get("acrisure.wd5.myworkdayjobs.com");
    assert.ok(row !== null);
    assert.equal(row.email, "app@example.com");
    assert.equal(row.password, created.password);
  `);
  });

  it("fits a new password to the site's stated limits, and replaces a stored one only when it breaks them", () => {
    scenario(`
    const strong = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^a-zA-Z0-9])/;
    const long = JSON.parse(resolveAccount("comcast.wd115.myworkdayjobs.com", "app@example.com", true, { min: 20 }));
    assert.equal(long.password.length, 20);
    assert.match(long.password, strong);
    const short = JSON.parse(resolveAccount("careers.short.example", "app@example.com", true, { max: 12 }));
    assert.equal(short.password.length, 12);
    assert.match(short.password, strong);

    db.query("INSERT INTO accounts (domain, email, password) VALUES ('career55.sapsf.eu?company=wipro', 'app@example.com', 'abcdefghijklmnopaA1!')").run();
    const kept = JSON.parse(resolveAccount("https://career55.sapsf.eu/careers?company=wipro", "app@example.com", true, { min: 8, max: 20 }));
    assert.equal(kept.existing, true);
    assert.equal(kept.password, "abcdefghijklmnopaA1!");
    const lookup = JSON.parse(resolveAccount("https://career55.sapsf.eu/careers?company=wipro", "app@example.com", false, { max: 18 }));
    assert.equal(lookup.password, "abcdefghijklmnopaA1!", "a lookup never replaces");
    const replaced = JSON.parse(resolveAccount("https://career55.sapsf.eu/careers?company=wipro", "app@example.com", true, { max: 18 }));
    assert.equal(replaced.existing, false);
    assert.equal(replaced.password.length, 16);
    assert.match(replaced.replaced, /never|could not/);
    assert.equal(db.query("SELECT password FROM accounts WHERE domain = 'career55.sapsf.eu?company=wipro'").get().password, replaced.password);
  `);
  });

  it("reuses existing stored credentials and refuses to overwrite known accounts even when allowCreate is true", () => {
    scenario(`
    const initial = JSON.parse(await resolveAccount("careers.rei.com", "app@example.com", true));
    assert.equal(initial.existing, false);
    const password = initial.password;

    const lookup = JSON.parse(await resolveAccount("https://careers.rei.com/jobs/123", "other@example.com", false));
    assert.equal(lookup.existing, true);
    assert.equal(lookup.email, "app@example.com");
    assert.equal(lookup.password, password);

    const createAttempt = JSON.parse(await resolveAccount("careers.rei.com", "other2@example.com", true));
    assert.equal(createAttempt.existing, true);
    assert.equal(createAttempt.email, "app@example.com");
    assert.equal(createAttempt.password, password);

    const row = db.query("SELECT email, password FROM accounts WHERE domain = ?").get("careers.rei.com");
    assert.equal(row.password, password);
  `);
  });

  it("strictly isolates credentials across different tenants on multi-tenant SaaS and Workday platforms", () => {
    scenario(`
    const acrisure = JSON.parse(await resolveAccount("https://acrisure.wd5.myworkdayjobs.com/en-US/careers/job/1", "app@example.com", true));
    assert.equal(acrisure.existing, false);

    const amerisure = JSON.parse(await resolveAccount("amerisure.wd5.myworkdayjobs.com", "app@example.com", false));
    assert.equal(amerisure.existing, false);
    assert.equal(amerisure.error, "no_account_found");

    const airbnb = JSON.parse(await resolveAccount("https://boards.greenhouse.io/airbnb/jobs/100", "app@example.com", true));
    assert.equal(airbnb.existing, false);

    const stripe = JSON.parse(await resolveAccount("https://boards.greenhouse.io/stripe/jobs/200", "app@example.com", false));
    assert.equal(stripe.existing, false);
    assert.equal(stripe.error, "no_account_found");
    assert.equal(stripe.password, undefined);

    const airbnbLookup = JSON.parse(await resolveAccount("https://boards.greenhouse.io/airbnb/jobs/101", "app@example.com", false));
    assert.equal(airbnbLookup.existing, true);
    assert.equal(airbnbLookup.password, airbnb.password);
  `);
  });
});

describe("tenants named in the path or query of shared ATS hosts", () => {
  it("keeps UKG, SuccessFactors, myworkdaysite, BrassRing and JobDiva employers apart", () => {
    scenario(`
    const create = (d) => JSON.parse(resolveAccount(d, "app@example.com", true));
    const look = (d) => JSON.parse(resolveAccount(d, "app@example.com", false));

    const miso = create("https://recruiting.ultipro.com/MID1029MISO/JobBoard/362b/OpportunityDetail?opportunityId=ef6b");
    assert.equal(look("recruiting.ultipro.com/mid1029miso").password, miso.password);
    assert.equal(look("https://recruiting.ultipro.com/HOM1007HSUC/JobBoard/0436").error, "no_account_found");
    assert.equal(look("recruiting2.ultipro.com/MID1029MISO").error, "no_account_found");

    const wipro = create("https://career55.sapsf.eu/careers?company=wiprolimitP2");
    assert.equal(look("https://career55.sapsf.eu/career?company=WIPROLIMITP2&career_job_req_id=1").password, wipro.password);
    assert.equal(look("https://career55.sapsf.eu/career?company=HCLPRD").error, "no_account_found");
    assert.equal(look("https://career4.successfactors.com/careers").error, "invalid_domain");

    const magna = create("https://wd3.myworkdaysite.com/recruiting/magna/Magna");
    assert.equal(look("wd3.myworkdaysite.com/en-US/recruiting/Magna/Careers/job/1").password, magna.password);
    assert.equal(look("wd3.myworkdaysite.com/recruiting/other/Site").error, "no_account_found");
    assert.equal(look("wd3.myworkdaysite.com/").error, "invalid_domain");

    const brass = create("https://sjobs.brassring.com/TGnewUI/Search/home/HomeWithPreLoad?partnerid=368&siteid=5205");
    assert.equal(look("sjobs.brassring.com/TGNewUI/?partnerid=368&siteid=1").password, brass.password);
    assert.equal(look("sjobs.brassring.com/TGNewUI/?partnerid=25771").error, "no_account_found");
    create("https://www1.jobdiva.com/portal/?a=abc");
    assert.equal(look("https://www1.jobdiva.com/portal/?a=xyz").error, "no_account_found");
  `);
  });
});
