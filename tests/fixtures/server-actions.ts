// Drives the HTTP handler in a fresh process with throwaway state. Run with a scenario name; the
// caller sets AUTO_APPLY_DATA, AUTO_APPLY_PROFILE and AUTO_APPLY_PORT.
import assert from "node:assert/strict";

const scenario = process.argv[2];
const { config } = await import("../../src/config");
const { db, getJob, updateJob } = await import("../../src/db");
const { createHandler } = await import("../../src/server");
const { Scheduler } = await import("../../src/scheduler");

const scheduler = new Scheduler({
  runWorker: () => {
    throw new Error("no worker may start in this fixture");
  },
});
// Only the handler is under test: nothing may be started on the strength of what it writes.
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
  // redo: only while awaiting approval, and never once the resume is frozen.
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

  // approve: only from gate 1.
  const held = job("held");
  assert.equal((await act(held, "approve")).status, 409);
  assert.equal(statusOf(held), "held");

  // An application that went out keeps its outcome and its submission time.
  for (const status of ["submitted", "interview", "offer", "rejected_by_company"]) {
    const id = job(status, { submitted_at: "2026-10-01T00:00:00.000Z" });
    assert.equal((await act(id, "reject", "changed my mind")).status, 409, `reject from ${status}`);
    assert.equal((await act(id, "mark_submitted")).status, 409, `mark_submitted from ${status}`);
    assert.equal(statusOf(id), status);
    assert.equal(getJob(id)?.submitted_at, "2026-10-01T00:00:00.000Z");
  }
  const rejected = job("rejected");
  assert.equal((await act(rejected, "reject")).status, 409);

  // What the guards leave alone.
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
} else if (scenario === "other-sites") {
  const refusedUnchanged = async (headers: Record<string, string>, base = BASE) => {
    const id = job("awaiting_approval");
    const res = await act(id, "approve", "", headers, base);
    assert.equal(res.status, 403, JSON.stringify({ headers, base }));
    assert.equal(statusOf(id), "awaiting_approval");
  };
  // A page on another site posting to the local port, as a form or with a JSON body.
  await refusedUnchanged({ origin: "https://careers.example.com" });
  await refusedUnchanged({ origin: "https://careers.example.com", "content-type": "text/plain" });
  await refusedUnchanged({ "sec-fetch-site": "cross-site" });
  await refusedUnchanged({ "sec-fetch-site": "same-site", origin: BASE });
  await refusedUnchanged({ origin: "null" });
  // A hostname re-pointed at this machine: the page and the request share an origin, but not one of ours.
  await refusedUnchanged({ origin: `http://rebound.example.com:${config.port}`, "sec-fetch-site": "same-origin" }, `http://rebound.example.com:${config.port}`);
  const read = await handle(new Request(`http://rebound.example.com:${config.port}/api/state`));
  assert.equal(read.status, 403, "reads under a foreign host name are refused too");

  // The app's own page, a local tunnel on another port, and a command-line client.
  const allowed = async (headers: Record<string, string>, base = BASE) => {
    const id = job("awaiting_approval");
    assert.equal((await act(id, "approve", "", headers, base)).status, 200, JSON.stringify({ headers, base }));
    assert.equal(statusOf(id), "approved");
    updateJob(id, { status: "rejected" });
  };
  await allowed({ origin: BASE, "sec-fetch-site": "same-origin" });
  await allowed({ origin: "http://localhost:9999", "sec-fetch-site": "same-origin" }, "http://localhost:9999");
  await allowed({});
  assert.equal((await handle(new Request(`${BASE}/api/state`))).status, 200);
} else {
  throw new Error(`unknown scenario: ${String(scenario)}`);
}
db.close();
