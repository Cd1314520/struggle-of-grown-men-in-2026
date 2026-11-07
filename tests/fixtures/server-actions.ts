import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const scenario = process.argv[2];
const { config, PROFILE } = await import("../../src/config");
const { db, getJob, statusHistory } = await import("../../src/db");
const { createHandler } = await import("../../src/server");
const { Scheduler, reviewStandingApprovals } = await import("../../src/scheduler");

const scheduler = new Scheduler({
  runWorker: () => {
    throw new Error("no worker may start in this fixture");
  },
});
scheduler.pump = () => undefined;
const handle = createHandler(scheduler);

const BASE = `http://127.0.0.1:${config.port}`;
const SHA = "a".repeat(64);
let nextId = 1;
function job(status: string, extra: { resume_sha?: string; submitted_at?: string } = {}) {
  const id = nextId++;
  db.query("INSERT INTO jobs (id, url, source, company, title, status, resume_sha, submitted_at) VALUES (?, ?, 'test', 'Acme', ?, ?, ?, ?)").run(
    id,
    `https://ats.example/jobs/${id}`,
    `Engineer ${id}`,
    status,
    extra.resume_sha ?? null,
    extra.submitted_at ?? null,
  );
  return id;
}
async function act(id: number, action: string, text = "", headers: Record<string, string> = {}, base = BASE) {
  const res = await handle(
    new Request(`${base}/api/jobs/${id}/action`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ action, text }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
}
const statusOf = (id: number) => getJob(id)?.status;

if (scenario === "action-guards") {
  const fresh = job("awaiting_approval");
  assert.equal((await act(fresh, "redo", "lead with the data work")).status, 200);
  assert.equal(statusOf(fresh), "triaged");

  const frozen = job("awaiting_approval", { resume_sha: SHA });
  const refused = await act(frozen, "redo", "lead with the data work");
  assert.equal(refused.status, 409);
  assert.match(refused.body.error ?? "", /frozen resume/);
  assert.equal(statusOf(frozen), "awaiting_approval", "a refused redo changes nothing");

  for (const status of ["filling", "approved", "submitted", "held", "prepping"]) {
    const id = job(status);
    assert.equal((await act(id, "redo", "change it")).status, 409, `redo from ${status}`);
    assert.equal(statusOf(id), status);
  }

  const held = job("held");
  assert.equal((await act(held, "approve")).status, 409);
  assert.equal(statusOf(held), "held");

  for (const status of ["submitted", "interview", "offer", "rejected_by_company"]) {
    const id = job(status, { submitted_at: "2026-10-01T00:00:00.000Z" });
    assert.equal((await act(id, "reject", "changed my mind")).status, 409, `reject from ${status}`);
    assert.equal((await act(id, "mark_submitted")).status, 409, `mark_submitted from ${status}`);
    assert.equal(statusOf(id), status);
    assert.equal(getJob(id)?.submitted_at, "2026-10-01T00:00:00.000Z");
  }
  const rejected = job("rejected");
  assert.equal((await act(rejected, "reject")).status, 409);
  assert.equal((await act(rejected, "hold")).status, 409);
  assert.equal((await act(held, "hold")).status, 409);
  const sent = job("submitted", { submitted_at: "2026-10-01T00:00:00.000Z" });
  assert.equal((await act(sent, "hold")).status, 409);
  assert.equal(statusOf(sent), "submitted");

  for (const status of ["awaiting_approval", "awaiting_submit", "needs_input"]) {
    const id = job(status);
    assert.equal((await act(id, "hold", "not a practice job")).status, 200, `hold from ${status}`);
    assert.equal(statusOf(id), "held");
    assert.equal(getJob(id)?.note, "not a practice job");
  }

  const review = job("awaiting_approval");
  assert.equal((await act(review, "approve")).status, 200);
  assert.equal(statusOf(review), "approved");
  assert.equal(getJob(review)?.approved_by, "user");
  const failed = job("failed");
  assert.equal((await act(failed, "mark_submitted", "sent it by hand")).status, 200);
  assert.equal(statusOf(failed), "submitted");
  const prepping = job("prepping");
  assert.equal((await act(prepping, "reject")).status, 200);
  assert.equal(statusOf(prepping), "rejected");
  const skipped = job("skipped");
  assert.equal((await act(skipped, "retry")).status, 200);
  assert.equal(statusOf(skipped), "triaged");
  assert.equal(getJob(skipped)?.hand_picked, 0, "retrying a skipped job does not hand-pick it");

  const chosen = job("held");
  db.run("UPDATE jobs SET locate_tries = 3, hold_reason = 'target' WHERE id = ?", [chosen]);
  assert.equal((await act(chosen, "retry")).status, 200);
  assert.equal(statusOf(chosen), "triaged");
  assert.equal(getJob(chosen)?.hand_picked, 1);
  assert.match(getJob(chosen)?.feedback ?? "", /chose to apply/);
  assert.equal(getJob(chosen)?.locate_tries, 0);
  assert.equal(getJob(chosen)?.hold_reason, null);

  const redone = job("awaiting_approval");
  assert.equal((await act(redone, "redo", "lead with the data work")).status, 200);
  assert.equal(getJob(redone)?.feedback, "lead with the data work");

  const kept = job("awaiting_approval");
  assert.equal((await act(kept, "hold", "later")).status, 200);
  assert.equal(getJob(kept)?.hold_reason, "user");
} else if (scenario === "other-sites") {
  const refusedUnchanged = async (headers: Record<string, string>, base = BASE) => {
    const id = job("awaiting_approval");
    const res = await act(id, "approve", "", headers, base);
    assert.equal(res.status, 403, JSON.stringify({ headers, base }));
    assert.equal(statusOf(id), "awaiting_approval");
  };
  await refusedUnchanged({ origin: "https://careers.example.com" });
  await refusedUnchanged({ origin: "https://careers.example.com", "content-type": "text/plain" });
  await refusedUnchanged({ "sec-fetch-site": "cross-site" });
  await refusedUnchanged({ "sec-fetch-site": "same-site", origin: BASE });
  await refusedUnchanged({ origin: "null" });
  await refusedUnchanged({ origin: `http://rebound.example.com:${config.port}`, "sec-fetch-site": "same-origin" }, `http://rebound.example.com:${config.port}`);
  const read = await handle(new Request(`http://rebound.example.com:${config.port}/api/state`));
  assert.equal(read.status, 403, "reads under a foreign host name are refused too");

  const allowed = async (headers: Record<string, string>, base = BASE) => {
    const id = job("awaiting_approval");
    assert.equal((await act(id, "approve", "", headers, base)).status, 200, JSON.stringify({ headers, base }));
    assert.equal(statusOf(id), "approved");
    db.run("UPDATE jobs SET status = 'rejected' WHERE id = ?", [id]);
  };
  await allowed({ origin: BASE, "sec-fetch-site": "same-origin" });
  await allowed({ origin: "http://localhost:9999", "sec-fetch-site": "same-origin" }, "http://localhost:9999");
  await allowed({});
  assert.equal((await handle(new Request(`${BASE}/api/state`))).status, 200);
} else if (scenario === "add-posting") {
  const add = async (url: string) => {
    const res = await handle(
      new Request(`${BASE}/api/jobs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }),
    );
    return { status: res.status, body: (await res.json()) as { id?: number | null; error?: string } };
  };
  const first = await add("https://boards.example/acme/123?utm_source=x");
  assert.equal(first.status, 200);
  assert.equal(typeof first.body.id, "number");
  const again = await add("https://boards.example/acme/123?utm_campaign=y");
  assert.equal(again.status, 409);
  assert.deepEqual(again.body, { error: "already known", id: first.body.id });
} else if (scenario === "profile-poll") {
  const errors = () => db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'error'").get()?.n ?? 0;
  for (let i = 0; i < 3; i++) assert.equal((await handle(new Request(`${BASE}/api/state`))).status, 200);
  assert.equal(errors(), 1);
} else if (scenario === "standing-approvals") {
  config.approval = "auto";
  config.targets.holdBack = true;
  const practice = {
    version: 4,
    target: "no",
    employerEvidence: "Insurer, internal tools",
    agentNative: "unclear",
    agentNativeEvidence: "",
    listed: null,
    against: "k",
  };
  const oldRules = { version: 2, annualBaseMaxUsd: null, salaryEvidence: "", mandatoryNonlocalOnsite: "yes", locationEvidence: "Onsite in Denver" };
  const approved = (assessment: object | null, extra: { approved_by?: string; resume_sha?: string; company?: string } = {}) => {
    const id = job("approved", extra.resume_sha ? { resume_sha: extra.resume_sha } : {});
    db.query("UPDATE jobs SET approved_by = ?, practice_assessment = ?, company = ? WHERE id = ?").run(
      extra.approved_by ?? "auto",
      assessment ? JSON.stringify(assessment) : null,
      extra.company ?? "Acme",
      id,
    );
    return id;
  };
  const kept = approved({ ...practice, target: "yes", employerEvidence: "Autonomy company at scale" });
  const ordinary = approved(practice);
  writeFileSync(join(PROFILE, "employers.yml"), "frontier: [Stripe]\n");
  const listed = approved(practice, { company: "Stripe, Inc." });
  const unjudged = approved(oldRules);
  const unreadable = approved(null);
  const byHand = approved(oldRules, { approved_by: "user" });
  const started = approved(oldRules, { resume_sha: SHA });

  reviewStandingApprovals();

  for (const id of [ordinary, byHand, started]) assert.equal(statusOf(id), "approved", `job ${id}`);
  assert.equal(statusOf(kept), "held");
  assert.equal(getJob(kept)?.note, "needs your review: auto-approved, but not a practice job: a target employer, kept for later (Autonomy company at scale)");
  assert.equal(getJob(kept)?.approved_by, null);
  assert.equal(statusOf(listed), "held");
  assert.match(getJob(listed)?.note ?? "", /on your frontier list/);
  assert.equal(statusOf(unreadable), "held");
  assert.equal(statusOf(unjudged), "triaged");
  assert.equal(getJob(unjudged)?.approved_by, null);
  assert.deepEqual(
    statusHistory(unjudged).map(c => [c.from_status, c.to_status]),
    [["approved", "triaged"]],
  );

  reviewStandingApprovals();
  assert.equal(statusHistory(kept).length, 1);
  assert.equal(statusOf(ordinary), "approved");

  config.targets.holdBack = false;
  const real = approved({ ...practice, target: "yes" });
  reviewStandingApprovals();
  assert.equal(statusOf(real), "approved");
} else if (scenario === "steps") {
  const { jobSteps } = await import("../../src/steps");
  const steps = async (id: number, change: Record<string, unknown>) => {
    const res = await handle(
      new Request(`${BASE}/api/jobs/${id}/steps`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }),
    );
    return { status: res.status, body: (await res.json()) as { ok?: boolean; error?: string } };
  };
  const detail = async (id: number) => (await (await handle(new Request(`${BASE}/api/jobs/${id}`))).json()) as { steps: { id: number; state: string }[] };

  const draft = job("awaiting_approval");
  assert.equal((await steps(draft, { op: "add", kind: "assessment", title: "OA" })).status, 409);

  const sent = job("submitted", { submitted_at: "2026-10-01T00:00:00Z" });
  assert.equal((await steps(sent, { op: "add", kind: "phone", title: "OA" })).status, 409, "an unknown kind is refused");
  assert.equal((await steps(sent, { op: "add", kind: "assessment", title: "Codility OA", due: "2026-10-27", link: "https://codility.example/t" })).status, 200);
  assert.equal(statusOf(sent), "interview");
  const [oa] = (await detail(sent)).steps;
  assert.ok(oa);
  assert.equal((await steps(sent, { op: "done", step: oa.id, note: "2 of 3" })).status, 200);
  assert.equal(jobSteps(sent)[0]?.done_note, "2 of 3");
  assert.equal((await steps(sent, { op: "book", step: oa.id })).status, 409, "booking needs a time");
  assert.equal((await steps(sent, { op: "book", step: oa.id, at: "2026-10-30T15:00:00.000Z" })).status, 200);
  assert.equal(jobSteps(sent)[0]?.scheduled_at, "2026-10-30T15:00:00.000Z");
  assert.equal((await steps(sent, { op: "edit", step: oa.id, title: "Onsite", due: "" })).status, 200);
  assert.equal(jobSteps(sent)[0]?.title, "Onsite");
  assert.equal(jobSteps(sent)[0]?.due_at, null);

  const other = job("submitted", { submitted_at: "2026-10-01T00:00:00Z" });
  assert.equal((await steps(other, { op: "remove", step: oa.id })).status, 409);
  assert.equal(jobSteps(sent).length, 1);

  assert.equal((await act(draft, "withdraw")).status, 409);
  assert.equal((await act(sent, "mark_declined")).status, 200);
  assert.equal(statusOf(sent), "rejected_by_company");
  assert.equal(jobSteps(sent)[0]?.state, "closed");
  assert.equal((await act(sent, "mark_declined")).status, 409);
  assert.equal((await act(sent, "reopen_application")).status, 200);
  assert.equal(statusOf(sent), "interview");
  assert.equal((await act(other, "withdraw", "took another offer")).status, 200);
  assert.equal(getJob(other)?.note, "took another offer");
  assert.equal((await act(other, "reopen_application")).status, 200);
  assert.equal(statusOf(other), "submitted");
  assert.equal((await steps(sent, { op: "remove", step: oa.id })).status, 200);
  assert.deepEqual(jobSteps(sent), []);
} else {
  throw new Error(`unknown scenario: ${String(scenario)}`);
}
db.close();
