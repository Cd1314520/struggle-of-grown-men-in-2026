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
} else if (scenario === "referrals") {
  const { readFileSync } = await import("node:fs");
  const call = async (path: string, init?: RequestInit) => {
    const res = await handle(new Request(`${BASE}${path}`, init));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  type State = import("../../src/api-types").ReferralsState;
  const state = async () => (await call("/api/referrals")).body as unknown as State;

  // The example profile: the list works, drafts wait for the facts.
  writeFileSync(join(PROFILE, "referral.yml"), readFileSync(join(import.meta.dir, "..", "..", "profile.example", "referral.yml"), "utf8"));
  const sent = job("submitted", { submitted_at: new Date().toISOString() });
  let s = await state();
  assert.deepEqual(
    s.companies.map(c => [c.company, c.kind, c.job?.id]),
    [["Acme", "applied", sent]],
  );
  assert.ok(s.problems.some(p => p.includes("TODO-FILL")));

  assert.equal((await post("/api/referrals/contacts", { name: "Ana Diaz", relation: "friend", jobId: sent })).status, 409);
  assert.equal((await post("/api/referrals/contacts", { name: "Ana Diaz", relation: "engineer", jobId: 999 })).status, 409);
  const added = await post("/api/referrals/contacts", {
    name: "Ana Diaz",
    relation: "engineer",
    jobId: sent,
    profileUrl: "https://www.linkedin.com/in/ana-diaz",
  });
  assert.equal(added.status, 200);
  const id = added.body["id"] as number;
  s = await state();
  const ana = s.contacts.find(c => c.id === id);
  assert.equal(ana?.company, "Acme", "a contact about a job takes its employer");
  assert.equal(ana.drafts, null);
  assert.deepEqual(s.due, [{ contactId: id, overdue: false }]);
  // Acme has a conversation open now: the list leaves it alone.
  assert.deepEqual(s.companies, []);
  assert.deepEqual(
    ((await call("/api/referrals/jobs?company=ACME,%20Inc.")).body["jobs"] as { id: number }[]).map(j => j.id),
    [sent],
  );

  // Filled in, the drafts appear, built from what the file says.
  writeFileSync(
    join(PROFILE, "referral.yml"),
    [
      "me: {short: CS senior at Example University, opener: I'm a CS senior.}",
      "interest: new grad roles",
      "areas: [{name: Software, hook: have built a course planner, fact: I built a course planner 300 students use.}]",
    ].join("\n"),
  );
  s = await state();
  assert.deepEqual(s.problems, []);
  assert.match(
    s.contacts[0]?.drafts?.note ?? "",
    /^Hi Ana, I'm a CS senior at Example University\. I applied to Acme's Engineer 1 role and have built a course planner/,
  );

  // The owner sends the invite with a note, then uploads an export that shows the accept and a reply.
  assert.equal((await post(`/api/referrals/contacts/${id}`, { op: "stage", stage: "requested", withNote: true })).status, 200);
  assert.equal((await state()).notes.left, 2);
  assert.equal((await post(`/api/referrals/contacts/${id}`, { op: "stage", stage: "nope" })).status, 409);
  assert.equal((await post("/api/referrals/contacts/999", { op: "remove" })).status, 404);
  // A one-file form as a browser sends it: multipart, its length known up front.
  const asBrowser = (name: string, content: string): RequestInit => {
    const body = [
      "--XYZ",
      `Content-Disposition: form-data; name="file"; filename="${name}"`,
      "Content-Type: application/octet-stream",
      "",
      content,
      "--XYZ--",
      "",
    ].join("\r\n");
    return {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=XYZ", "content-length": String(Buffer.byteLength(body)) },
      body,
    };
  };
  const connections = [
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    "Ana,Diaz,https://www.linkedin.com/in/ana-diaz,,Acme,Engineer,23 Oct 2026",
    "Bo,Chen,https://www.linkedin.com/in/bo,,Acme,Backend Engineer,01 Jan 2025",
  ].join("\n");
  const upload = await call("/api/referrals/import", asBrowser("Connections.csv", connections));
  assert.equal(upload.status, 200, JSON.stringify(upload.body));
  assert.deepEqual(upload.body, { connections: 2, updates: 1 });
  s = await state();
  assert.equal(s.contacts[0]?.stage, "connected");
  assert.equal(s.linkedin.connections, 2);
  assert.equal(s.contacts[0].next.kind, "send_message");
  assert.equal((await call("/api/referrals/import", asBrowser("notes.txt", "hello"))).status, 422);
  const unsized = new FormData();
  unsized.append("file", new File([connections], "Connections.csv"));
  assert.equal((await call("/api/referrals/import", { method: "POST", body: unsized })).status, 413, "a body of unknown length is refused");

  // Mail without a connected mailbox: nothing is searched.
  assert.deepEqual((await post("/api/referrals/mail", {})).body, { checked: 0, updates: 0 });
  assert.equal((await post(`/api/referrals/contacts/${id}`, { op: "edit", notes: "met at the fair", email: "not an address" })).status, 409);
  assert.equal((await post(`/api/referrals/contacts/${id}`, { op: "edit", notes: "met at the fair" })).status, 200);
  assert.equal((await state()).contacts[0]?.notes, "met at the fair");
  assert.equal((await post(`/api/referrals/contacts/${id}`, { op: "remove" })).status, 200);
  assert.deepEqual((await state()).contacts, []);
} else if (scenario === "early-outreach") {
  const { leadsStore } = await import("../../src/outreach-scout");
  const call = async (path: string, init?: RequestInit) => {
    const res = await handle(new Request(`${BASE}${path}`, init));
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const post = (path: string, body: unknown) => call(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  type State = import("../../src/api-types").OutreachState;
  const state = async () => (await call("/api/outreach")).body as unknown as State;

  assert.deepEqual((await state()).today, []);
  const lead = leadsStore.addLead({
    kind: "seed",
    company: "Acme Power",
    domain: "acme.com",
    source_url: "https://news.example.com/acme",
    source_title: "Acme Power raises a seed round",
    posted_at: new Date().toISOString(),
    likes: null,
    what_they_do: "Chargers",
    why_fit: "Power electronics",
    score: 80,
  });
  assert.ok(lead);
  const person = leadsStore.addPerson({
    lead_id: lead.id,
    name: "Sam Lee",
    role: "CEO",
    profile_url: null,
    email: "sam@acme.com",
    email_source: "public",
    email_confidence: "high",
    subject: "EE intern",
    body: "Hi Sam,\nshort.",
    drafted_on: (await state()).day,
  });
  assert.ok(person);
  assert.equal((await state()).today[0]?.person.id, person.id);
  assert.equal((await post(`/api/outreach/people/${person.id}`, { stage: "ghosted" })).status, 400);
  assert.equal((await post("/api/outreach/people/999", { stage: "sent" })).status, 404);
  assert.equal((await post(`/api/outreach/people/${person.id}`, { stage: "sent" })).status, 200);
  const after = await state();
  assert.equal(after.sentToday, 1);
  assert.equal(after.waiting[0]?.person.id, person.id);
  // Mail without a connected mailbox: nothing is searched.
  assert.deepEqual((await post("/api/outreach/mail", {})).body, { checked: 0, replied: 0 });
  assert.equal((await post("/api/outreach/leads/999/drop", {})).status, 404);
  assert.equal((await post(`/api/outreach/leads/${lead.id}/drop`, {})).status, 200);
} else {
  throw new Error(`unknown scenario: ${String(scenario)}`);
}
db.close();
