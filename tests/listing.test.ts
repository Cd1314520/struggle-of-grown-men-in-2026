import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { employerCapNote } from "../src/auto";
import { homeOf, nearHome } from "../src/home";
import { practiceRefusal, type PracticeAssessment } from "../src/practice";
import { setAsideReason } from "../src/reasons";

const judged = (fields: Partial<PracticeAssessment>): PracticeAssessment => ({
  version: 4,
  target: "yes",
  employerEvidence: "Smarsh sells an established compliance platform (SaaS) to banks.",
  agentNative: "unclear",
  agentNativeEvidence: "",
  listed: null,
  against: "k",
  ...fields,
});
const refusal = (fields: Partial<PracticeAssessment>) => practiceRefusal(judged(fields), true) ?? "";
const held = (fields: Partial<PracticeAssessment>) => `not a practice job: ${refusal(fields)}; real score 88 (threshold 65)`;

describe("why a job was set aside", () => {
  it("names what tells one held job from another, without the real-search preamble", () => {
    for (const note of ["held back at triage", null])
      expect(setAsideReason(note, "found", "triage")).toEqual({
        label: "Held at triage",
        detail: "Held back on the title, company and place alone, before a full assessment",
      });
    expect(setAsideReason(held({}), "prepping", "target")).toEqual({
      label: "Target employer",
      detail: "Smarsh sells an established compliance platform (SaaS) to banks.",
    });
    expect(
      setAsideReason(
        "not a practice job: a target employer, as judged on job #12 (Payments platform); held without a full assessment until it is released",
        "prepping",
        "target",
      ),
    ).toEqual({ label: "Target employer", detail: "Payments platform" });
    expect(
      setAsideReason("not a practice job: a tech company at scale, kept for the real search (Smarsh SaaS); real score 88 (threshold 65)", "prepping", "target"),
    ).toEqual({
      label: "Tech company at scale",
      detail: "Smarsh SaaS",
    });
    expect(setAsideReason(held({ listed: "frontier" }), "prepping", "target")).toEqual({
      label: "Frontier employer",
      detail: "The employer is on your frontier list",
    });
    expect(setAsideReason(`needs your review: ${employerCapNote(1)}`, "awaiting_approval", "review")?.label).toStartWith("Already applying to 1 other role");
    expect(setAsideReason("needs your review: posted base ceiling $129,120 is above the $100,000 practice limit", "awaiting_approval", "review")).toEqual({
      label: "Posted base ceiling $129,120 is above the $100,000 practice limit",
      detail: null,
    });
  });

  it("names an employer cap on a job that was not held", () => {
    expect(setAsideReason("second parked role at Netic (auto apply allows 1 per employer)", "awaiting_approval", null)?.label).toBe(
      "Already applying at this employer",
    );
    expect(setAsideReason(employerCapNote(1), "prepping", null)?.label).toBe("Already applying at this employer");
  });

  it("reads notes typed by hand the same way", () => {
    expect(setAsideReason("held for the real search: frontier-ish employer, not to be spent on practice", "found", "target")?.label).toBe("Frontier employer");
    expect(setAsideReason("tech company at scale (Suno): kept for the real search", "found", "target")).toEqual({
      label: "Tech company at scale",
      detail: "Tech company at scale (Suno): kept for the real search",
    });
    expect(setAsideReason("held by you", "triaged", "user")).toEqual({ label: "Held by you", detail: null });
    expect(setAsideReason("hardware/embedded role, not a goal", "triaged", "user")).toEqual({ label: "Hardware/embedded role, not a goal", detail: null });
  });

  it("explains a rejection without a note by where it was stopped", () => {
    expect(setAsideReason(null, "awaiting_approval", null)).toEqual({ label: "Turned down at review", detail: null });
    expect(setAsideReason(null, "awaiting_submit", null)?.label).toBe("Stopped before submitting");
    expect(setAsideReason(null, "held", null)).toBeNull();
    expect(setAsideReason("  ", null, null)).toBeNull();
  });
});

describe("the near filter", () => {
  it("names a city or a state, and is left out for a whole country", () => {
    for (const country of ["United States", "USA", "US", "United States of America", "Canada", "", null]) expect(homeOf(country)).toBeNull();
    expect(homeOf("Austin, TX")).toEqual({ kind: "city", name: "Austin" });
    expect(homeOf("san francisco, California, United States")).toEqual({ kind: "city", name: "San Francisco" });
    expect(homeOf("Texas")).toEqual({ kind: "state", name: "Texas", code: "TX" });
    expect(homeOf("Texas, United States")).toEqual({ kind: "state", name: "Texas", code: "TX" });
    expect(homeOf("ny")).toEqual({ kind: "state", name: "New York", code: "NY" });
  });

  it("matches listings in the area, and everything the job boards found there", () => {
    const city = nearHome({ kind: "city", name: "Austin" });
    expect(city.label).toBe("Near Austin");
    expect(city.test("Austin, Texas, United States", "greenhouse")).toBe(true);
    expect(city.test("Dallas, TX", "greenhouse")).toBe(false);
    expect(city.test(null, "linkedin")).toBe(true);
    const state = nearHome({ kind: "state", name: "Texas", code: "TX" });
    expect(state.label).toBe("In Texas");
    expect(state.test("Dallas, TX", "ashby")).toBe(true);
    expect(state.test("Houston, Texas, United States", "ashby")).toBe(true);
    expect(state.test("Toronto, ON", "ashby")).toBe(false);
    expect(state.test("Remote", "indeed")).toBe(true);
  });
});

const prelude = `
import assert from "node:assert/strict";
import { db, moveJob } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import { to } from ${JSON.stringify(join(import.meta.dir, "../src/status.ts"))};
import { config } from ${JSON.stringify(join(import.meta.dir, "../src/config.ts"))};
import { listJobs } from ${JSON.stringify(join(import.meta.dir, "../src/listing.ts"))};
let next = 1;
function job(fields = {}) {
  const id = next++;
  const row = { url: "https://ats.example/jobs/" + id, source: "test", company: "Co " + id, title: "Engineer " + id, status: "held", found_at: "2026-10-20 15:00:00", ...fields };
  const names = Object.keys(row);
  db.query("INSERT INTO jobs (id, " + names.join(", ") + ") VALUES (?" + ", ?".repeat(names.length) + ")").run(id, ...names.map(name => row[name]));
  return id;
}
`;
function scenario(body: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-listing-"));
  try {
    const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (child.exitCode !== 0) throw new Error(`Listing scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("job lists", () => {
  it("count each employer's jobs in the view, whatever the search", () => {
    scenario(`
      job({ company: "Acme", title: "Platform Engineer" });
      job({ company: "Acme", title: "Data Engineer" });
      job({ company: "Acme", status: "awaiting_approval" });
      job();
      const r = listJobs({ view: "held", q: "platform" });
      assert.equal(r.rows.length, 1);
      assert.equal(r.rows[0].companyCount, 2);
      assert.equal(listJobs({ view: "held", q: "Co" }).rows[0].companyCount, 1);
    `);
  });

  it("give held and rejected jobs their reason, and no other view's", () => {
    scenario(`
      job({ note: "held back at triage", hold_reason: "triage" });
      const turned = job({ status: "awaiting_approval" });
      moveJob(turned, "awaiting_approval", to.rejected(null));
      job({ status: "awaiting_approval", note: "needs your review: you asked for this one yourself" });
      assert.equal(listJobs({ view: "held" }).rows[0].reason.label, "Held at triage");
      assert.deepEqual(listJobs({ view: "rejected" }).rows[0].reason, { label: "Turned down at review", detail: null });
      assert.equal(listJobs({ view: "review" }).rows[0].reason, null);
      assert.equal(listJobs({ view: "held", q: "triage" }).total, 1);
    `);
  });

  it("page to a focused job, and say where it is and which group it is in", () => {
    scenario(`
      for (let i = 0; i < 130; i++) job({ score: 40 + (i % 60) });
      const order = listJobs({ view: "held", limit: 500 }).rows.map(j => j.id);
      const id = order[117];
      const r = listJobs({ view: "held", focus: id, limit: 50 });
      assert.ok(r.rows.some(j => j.id === id));
      const where = query => {
        const r = listJobs({ view: "held", ...query });
        return [r.offset, r.focusIndex, r.focusGroup];
      };
      assert.deepEqual(where({ focus: id, limit: 50 }), [100, 117, "other"]);
      assert.deepEqual(where({ group: "other", focus: order[0], offset: 50 }), [50, null, "strong"]);
      assert.deepEqual(where({ q: "nothing like it", focus: id }), [0, null, "other"]);
      assert.deepEqual(where({ focus: 999 }), [0, null, null]);
      assert.deepEqual(where({}), [0, null, null]);
    `);
  });

  it("offer a near filter only for a city or a state", () => {
    scenario(`
      job({ location: "Austin, TX" });
      job({ location: "Dallas, Texas, United States" });
      job({ location: "Toronto, ON" });
      const near = () => listJobs({ view: "held" }).filters.find(f => f.key === "near");
      config.boards = { ...config.boards, location: "United States" };
      assert.equal(near(), undefined);
      config.boards = { ...config.boards, location: "Austin, TX" };
      assert.deepEqual(near(), { key: "near", label: "Near Austin", count: 1 });
      config.boards = { ...config.boards, location: "Texas" };
      assert.deepEqual(near(), { key: "near", label: "In Texas", count: 2 });
      assert.equal(listJobs({ view: "held", filters: ["near"] }).total, 2);
    `);
  });

  it("put a quiet application only under Gone quiet, longest quiet first", () => {
    scenario(`
      config.quietDays = 10;
      const DAY = 86400000;
      const sent = (company, doneDaysAgo) => {
        const id = job({ company, status: "interview", submitted_at: "2026-09-01T00:00:00Z" });
        const done = doneDaysAgo === null ? null : new Date(Date.now() - doneDaysAgo * DAY).toISOString();
        if (done) db.query("INSERT INTO application_steps (job_id, kind, title, state, source, done_at) VALUES (?, 'assessment', 'OA', 'done', 'user', ?)").run(id, done);
        return id;
      };
      const fresh = sent("Fresh", 3), old = sent("Old", 12), older = sent("Older", 30);
      const bare = job({ company: "Bare", status: "submitted", submitted_at: "2026-09-01T00:00:00Z" });
      const all = listJobs({ view: "applications", limit: 100 });
      const count = key => all.groups.find(g => g.key === key).count;
      assert.deepEqual(["waiting", "quiet", "no_reply"].map(count), [1, 2, 1]);
      assert.deepEqual(listJobs({ view: "applications", group: "quiet" }).rows.map(j => j.id), [older, old]);
      assert.deepEqual(listJobs({ view: "applications", group: "waiting" }).rows.map(j => j.id), [fresh]);
      assert.deepEqual(listJobs({ view: "applications", group: "no_reply" }).rows.map(j => j.id), [bare]);
      assert.deepEqual(all.rows.map(j => j.id), [fresh, older, old, bare]);
    `);
  });
});
