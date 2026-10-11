// Subprocess-only fixture: all state is throwaway; browser, model and mailbox are inert.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";
import type { WorkerHandle, WorkerOptions } from "../../src/omp";
import type { JobBrowser } from "../../src/chrome";

// Dynamic imports intentionally exercise module initialization boundaries:
// isolation guards/config precede DB opening, and mocks precede pipeline loading.
assert(process.env.AUTO_APPLY_DATA && process.env.AUTO_APPLY_PROFILE && process.env.AUTO_APPLY_RESUME_DIR, "isolated paths required");
const scenario = process.argv[2];
const { config, jobDir, DATA } = await import("../../src/config");
config.phase = "real";
config.confirmBeforeSubmit = true;
config.concurrency.fill = scenario?.startsWith("restart-") || scenario === "recovery-prefix" ? 2 : 1;
config.concurrency.prep = 0;
config.fillPauseSeconds = [0, 0];
config.schedule = { scanMinutes: 0, discoverMinutes: 0, trackMinutes: 0 };
config.autoApply = { enabled: false };
config.limits.applyPerDay = 50;

if (scenario === "target-isolation") {
  await import("./cdp-isolation"); // Deliberately load real proxy before any worker/browser mocks.
  process.exit(0);
}

if (scenario === "browser") {
  const closed: string[] = [];
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/json/version")) return Response.json({});
    if (url.endsWith("/json/list")) return Response.json([
      { type: "page", id: "recent", title: "Other job", url: "https://fixture.invalid/other" },
      { type: "page", id: "draft", title: "Parked draft", url: "https://fixture.invalid/draft" },
      { type: "page", id: "obsolete", title: "Old tab", url: "https://fixture.invalid/old" },
    ]);
    closed.push(url.split("/").at(-1)!);
    return new Response("ok");
  };
  const chrome = await import("../../src/chrome");
  await chrome.pruneTabs(0, 1, new Set(["draft"]));
  assert.deepEqual(closed, ["obsolete"]);
  assert.equal(await chrome.screenshot(0, "missing-parked-tab"), null);
  process.exit(0);
}

const resume = await import("../../src/resume");
if (scenario === "frozen") {
  const dir = jobDir(1);
  writeFileSync(join(dir, resume.PDF_NAME), "original PDF bytes");
  writeFileSync(join(dir, resume.MAIN), "original main source");
  writeFileSync(join(dir, "resume.typ"), "original template");
  const frozen = resume.freezeResume(1);
  writeFileSync(join(dir, resume.PDF_NAME), "new working PDF bytes");
  writeFileSync(join(dir, resume.MAIN), "new working main source");
  assert.equal(resume.frozenResume(1, frozen.sha).pdf, frozen.pdf);
  assert.equal(readFileSync(frozen.pdf, "utf8"), "original PDF bytes");
  const source = join(dir, "applied", frozen.sha.slice(0, 12), resume.MAIN);
  chmodSync(source, 0o644);
  writeFileSync(source, "tampered source");
  assert.throws(() => resume.frozenResume(1, frozen.sha), /source SHA mismatch/);
  chmodSync(frozen.pdf, 0o644);
  writeFileSync(frozen.pdf, "tampered PDF");
  assert.throws(() => resume.frozenResume(1, frozen.sha), /PDF SHA mismatch/);
  process.exit(0);
}

interface SimulatedWorker {
  options: WorkerOptions;
  aborted: boolean;
  exit: () => void;
}
const workers: SimulatedWorker[] = [];
const originalOmp = await import("../../src/omp");
mock.module("../../src/omp", () => ({
  ...originalOmp,
  runWorker: (options: WorkerOptions): WorkerHandle => {
    const { promise: done, resolve } = Promise.withResolvers<Awaited<WorkerHandle["done"]>>();
    const worker: SimulatedWorker = { options, aborted: false, exit: () => resolve({ status: "aborted", lastText: "" }) };
    workers.push(worker);
    // Abort deliberately does NOT settle done: assert slot stays owned until exit.
    return { done, abort: () => { worker.aborted = true; } };
  },
}));
const simulatedTabs = new Set<string>();
let nextTab = 0;
let activateWait: Promise<void> | null = null;
if (scenario?.startsWith("restart-"))
  for (const id of [1, 2, 3, 4]) simulatedTabs.add(id === 1 ? "draft-tab" : `draft-tab-${id}`);
mock.module("../../src/chrome", () => ({
  ensureChrome: async () => {}, pruneTabs: async () => {}, screenshot: async () => null,
  tabs: async () => [...simulatedTabs].map(id => ({ id, title: "Fixture requisition", url: "https://fixture.invalid/draft", ws: "" })),
  activateApplicationTab: async (_slot: number, tabId: string) => {
    if (!simulatedTabs.has(tabId)) throw new Error("Missing saved draft tab");
    if (activateWait) await activateWait;
  },
  prepareJobBrowser: async (_slot: number, saved: string | null, excluded: ReadonlySet<string>): Promise<JobBrowser> => {
    if (saved && excluded.has(saved)) throw new Error("Checkpoint belongs to another application");
    const reused = saved !== null && simulatedTabs.has(saved);
    const id = saved !== null && reused ? saved : (++nextTab === 1 ? "draft-tab" : `draft-tab-${nextTab}`);
    simulatedTabs.add(id);
    let revoked = false;
    return { tabId: id, reused, port: config.chrome.proxyPort, ownsTarget: target => !revoked && target === id, revoke: () => { revoked = true; }, close: () => { revoked = true; } };
  },
}));
mock.module("../../src/gmail", () => ({
  gmailStatus: () => ({ connected: false, address: null }),
  search: () => { throw new Error("mail forbidden in fixture"); },
  read: () => { throw new Error("mail forbidden in fixture"); },
  markRead: () => { throw new Error("mail forbidden in fixture"); },
}));
mock.module("../../src/digest", () => ({ tickQuestionDigest: async () => {} }));
const { db, getJob, updateJob, kvGet } = await import("../../src/db");
const core = await import("../../src/questions");
const pipeline = await import("../../src/pipeline");

function addJob(id: number) {
  db.query("INSERT INTO jobs (id,url,source,company,title,status,approved_by) VALUES (?,?,?, ?,?,'approved','user')")
    .run(id, `https://fixture.invalid/job/${id}`, "fixture", `Employer ${id}`, `Requisition ${id}`);
  const dir = jobDir(id);
  writeFileSync(join(dir, resume.PDF_NAME), `PDF for job ${id}`);
  writeFileSync(join(dir, resume.MAIN), `source for job ${id}`);
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error(`fixture transition timed out: ${JSON.stringify({
    workers: workers.map(worker => worker.options.jobId),
    jobs: db.query("SELECT id,status,pending,note,fill_checkpoint FROM jobs ORDER BY id LIMIT 8").all(),
    gates: db.query("SELECT id,job_id,kind,state,text FROM question_gates WHERE state = 'open'").all(),
  })}`);
}
const navigation = { tab_id: "draft-tab", url: "https://fixture.invalid/draft", step: "Requisition 1 / questions", notes: "Use candidate home; verify saved draft" };
const question = { ...navigation, question: "Required salary?", context: "Employer 1 / annual USD base salary", options: [] };
function call(worker: SimulatedWorker, name: string, args: Record<string, unknown>) {
  return worker.options.tools[name]!.handler(args);
}

if (scenario === "restart-setup") {
  for (const id of [1, 2, 3, 4]) {
    addJob(id);
    const frozen = resume.freezeResume(id);
    updateJob(id, { status: "filling", resume_sha: frozen.sha, resume_frozen_at: new Date().toISOString() });
    core.recordCheckpoint(id, { version: 1, slot: 0, tabId: id === 1 ? "draft-tab" : `draft-tab-${id}`, url: navigation.url, step: `Requisition ${id}`, notes: "Existing draft", resumeSha: frozen.sha, savedAt: new Date().toISOString() });
  }
  core.parkGate(1, { kind: "question", text: "Still unknown?", context: "Employer 1 exact question", options: [] }, core.readCheckpoint(1));
  const answered = core.parkGate(2, { kind: "question", text: "Known after restart?", context: "Employer 2 exact question", options: [] }, core.readCheckpoint(2));
  core.answerGate(answered.id, "durable answer", "application");
  // This interrupted runnable marker must become ambiguity, not an ordinary resume.
  db.query("INSERT INTO kv (key,value) VALUES ('fill.submitting.3','1')").run();
  // Use another slot for ambiguity so its lease doesn't intentionally block the queued answer.
  const checkpoint = core.readCheckpoint(3)!;
  core.recordCheckpoint(3, { ...checkpoint, slot: 1 });
  writeFileSync(join(DATA, "expected-sha.txt"), getJob(2)!.resume_sha!);
  process.exit(0);
}
if (scenario === "restart-resume") {
  pipeline.startScheduler();
  await until(() => workers.length === 1);
  assert.equal(getJob(1)!.status, "needs_input");
  assert.equal(core.getOpenGate(1)!.kind, "question");
  assert.equal(workers[0]!.options.jobId, 2);
  assert.equal(getJob(2)!.resume_sha, readFileSync(join(DATA, "expected-sha.txt"), "utf8"));
  assert.equal(core.resumeContext(2).answers[0]!.answer, "durable answer");
  assert.equal(core.getOpenGate(3)!.kind, "submission_ambiguous");
  assert.equal(kvGet("fill.submitting.3"), "1");
  assert.equal(getJob(4)!.status, "approved");
  assert.equal(pipeline.respond(3, "approve"), false);
  process.exit(0);
}

if (scenario === "blocked-prefix") {
  const insert = db.query("INSERT INTO jobs (id,url,source,company,title,status,approved_by,fill_checkpoint) VALUES (?,?, 'fixture', ?,?, 'approved','user',?)");
  db.transaction(() => {
    for (let id = 1; id <= 1001; id++) {
      const checkpoint = { version: 1, slot: 1, tabId: `blocked-${id}`, url: null, step: "Other browser draft", notes: "Resume only in original slot", resumeSha: null, savedAt: new Date().toISOString() };
      insert.run(id, `https://fixture.invalid/blocked/${id}`, `Blocked employer ${id}`, `Blocked requisition ${id}`, JSON.stringify(checkpoint));
    }
  })();
  addJob(1002); // Fresh and eligible, but checkpoint-bearing resumes must come first.
  addJob(1003);
  const frozen = resume.freezeResume(1003);
  updateJob(1003, { resume_sha: frozen.sha, resume_frozen_at: new Date().toISOString() });
  simulatedTabs.add("eligible-draft");
  core.recordCheckpoint(1003, { version: 1, slot: 0, tabId: "eligible-draft", url: navigation.url, step: "Exact eligible draft", notes: "Resume this draft", resumeSha: frozen.sha, savedAt: new Date().toISOString() });
  pipeline.pump();
  await until(() => workers.length === 1);
  assert.equal(getJob(1003)!.status, "filling");
  assert.equal(getJob(1002)!.status, "approved");
  assert.equal(core.readCheckpoint(1003)!.tabId, "eligible-draft");
  assert.equal(getJob(1003)!.resume_sha, frozen.sha);
  await call(workers[0]!, "report_result", { outcome: "closed", note: "Fixture draft was closed" });
  workers[0]!.exit();
  await until(() => workers.length === 2);
  assert.equal(getJob(1002)!.status, "filling");
  assert.equal(db.query<{ count: number }, []>("SELECT count(*) AS count FROM jobs WHERE id <= 1001 AND status != 'approved'").get()!.count, 0);
  process.exit(0);
}

if (scenario === "recovery-prefix") {
  for (const id of [1, 2, 3, 4]) addJob(id);
  updateJob(1, { company: "Shared employer", company_key: "shared-employer" });
  updateJob(2, { company: "Shared employer", company_key: "shared-employer" });
  for (const id of [1, 2, 4]) {
    const frozen = resume.freezeResume(id);
    updateJob(id, { resume_sha: frozen.sha });
    const tabId = `recovery-${id}`;
    simulatedTabs.add(tabId);
    core.recordCheckpoint(id, { version: 1, slot: id === 2 ? 1 : 0, tabId, url: navigation.url,
      step: `Requisition ${id}`, notes: "Saved draft", resumeSha: frozen.sha, savedAt: new Date().toISOString() });
    const gate = core.parkGate(id, { kind: "manual", text: "Saved login failure" }, core.readCheckpoint(id));
    if (id !== 2) core.queueRecovery(id, gate.id);
  }
  await pipeline.reserveBrowser(2, core.getOpenGate(2)!.id);
  await until(() => workers.length === 1);
  assert.equal(workers[0]!.options.jobId, 4, "skip blocked recovery, preserve the next recovery's priority");
  assert.equal(getJob(1)!.status, "approved");
  const parked = call(workers[0]!, "need_manual", { ...navigation, tab_id: "recovery-4", reason: "Still blocked" });
  await until(() => core.getOpenGate(4) !== null);
  workers[0]!.exit();
  await parked;
  await until(() => workers.length === 2);
  assert.equal(workers[1]!.options.jobId, 3, "unrunnable recovery must not block fresh work");
  assert.equal(core.getOpenGate(4)!.kind, "manual");
  assert.equal(core.manualLeases().get(1), 2);
  process.exit(0);
}

addJob(1);
if (["release", "manual", "manual-same-employer", "manual-lost-tab", "confirm"].includes(scenario!)) addJob(2);
if (scenario === "manual-same-employer") updateJob(2, { company: getJob(1)!.company, company_key: getJob(1)!.company_key });
pipeline.pump();
await until(() => workers.length === 1);
const first = workers[0]!;
const initialSha = getJob(1)!.resume_sha!;

if (scenario === "release" || scenario === "quick-answer") {
  const parking = call(first, "ask_user", question);
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(first.aborted, true);
  assert.equal(getJob(1)!.status, "needs_input");
  assert.equal(pipeline.fillSlot(1), null);
  assert.equal(kvGet("fill.submitting.1"), null);
  if (scenario === "quick-answer") {
    assert.equal(pipeline.respond(1, "100000"), true);
    assert.equal(pipeline.respond(1, "200000"), false);
    writeFileSync(join(jobDir(1), resume.PDF_NAME), "changed working PDF must not upload");
    writeFileSync(join(jobDir(1), resume.MAIN), "changed working source must not freeze");
  }
  pipeline.pump();
  assert.equal(workers.length, 1, "abort is not process exit; slot must not be reused yet");
  await call(first, "report_result", { outcome: "failed", note: "late old callback" });
  assert.equal(getJob(1)!.status, scenario === "release" ? "needs_input" : "approved");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.equal(workers[1]!.options.jobId, scenario === "release" ? 2 : 1);
  if (scenario === "release") {
    assert.equal(getJob(1)!.status, "needs_input");
    assert.equal(pipeline.fillSlot(1), null);
  } else {
    assert.equal(getJob(1)!.resume_sha, initialSha);
    assert.equal(readFileSync(resume.frozenResume(1, initialSha).pdf, "utf8"), "PDF for job 1");
    assert.match(await call(workers[1]!, "ask_user", question), /100000/);
    await call(first, "report_result", { outcome: "submitted", note: "stale generation" });
    assert.equal(getJob(1)!.status, "filling");
    assert.equal(core.getOpenGate(1), null);
  }
} else if (scenario === "cover-letter") {
  const args = { ...navigation, prompt: "Required letter, plain text" };
  const parking = call(first, "ask_cover_letter", args);
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(pipeline.respond(1, "My exact application letter."), true);
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.match(await call(workers[1]!, "ask_cover_letter", args), /My exact application letter\./);
  assert.equal(readFileSync(join(jobDir(1), "cover_letter.txt"), "utf8"), "My exact application letter.\n");
  assert.equal(core.getOpenGate(1), null);
} else if (["manual", "manual-same-employer", "manual-lost-tab"].includes(scenario!)) {
  if (scenario === "manual-lost-tab") simulatedTabs.delete(navigation.tab_id);
  const parking = call(first, "need_manual", { ...navigation, reason: "CAPTCHA/session needs human" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = core.getOpenGate(1)!;
  await assert.rejects(pipeline.reserveBrowser(1, gate.id));
  pipeline.pump();
  assert.equal(workers.length, 1, "stopping worker still owns the slot");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.equal(workers[1]!.options.jobId, 2);
  assert.equal(pipeline.fillSlot(1), null);
  assert.equal(core.manualLeases().size, 0);
  assert.equal(core.getOpenGate(1)?.id, gate.id);
  await assert.rejects(pipeline.reserveBrowser(1, gate.id), "another worker owns the reused browser");
  await call(workers[1]!, "report_result", { outcome: "closed", note: "Other posting closed" });
  workers[1]!.exit();
  await until(() => !pipeline.activeFillSession(2));
  if (scenario === "manual-lost-tab") {
    await assert.rejects(pipeline.reserveBrowser(1, gate.id));
    assert.equal(core.manualLeases().size, 0, "missing target must not leave a reservation");
  }
  pipeline.scheduleRecovery(1, gate.id);
  await until(() => workers.length === 3);
  assert.equal(workers[2]!.options.jobId, 1);
  assert.equal(getJob(1)!.resume_sha, initialSha);
} else if (scenario === "manual-reservation" || scenario === "manual-activation-race") {
  const parking = call(first, "need_manual", { ...navigation, reason: "Human inspection requested" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = core.getOpenGate(1)!;
  first.exit();
  await parking;
  await until(() => !pipeline.activeFillSession(1));
  if (scenario === "manual-activation-race") {
    const activation = Promise.withResolvers<void>();
    activateWait = activation.promise;
    const reserving = pipeline.reserveBrowser(1, gate.id);
    pipeline.scheduleRecovery(1, gate.id);
    assert.equal(workers.length, 1, "activating browser remains busy after gate resolution");
    activation.resolve();
    await assert.rejects(reserving);
    await until(() => workers.length === 2);
    assert.equal(workers[1]!.options.jobId, 1);
    assert.equal(core.manualLeases().size, 0);
  } else {
    await pipeline.reserveBrowser(1, gate.id);
    assert.equal(pipeline.manualBrowserReserved(1), true);
    assert.equal(pipeline.fillSlot(1), 0);
    addJob(2);
    pipeline.pump();
    assert.equal(workers.length, 1);
    assert.throws(() => pipeline.releaseBrowser(1, "stale-gate"));
    assert.equal(pipeline.manualBrowserReserved(1), true);
    pipeline.releaseBrowser(1, gate.id);
    assert.equal(core.getOpenGate(1)?.id, gate.id);
    assert.equal(pipeline.manualBrowserReserved(1), false);
    await until(() => workers.length === 2);
    assert.equal(workers[1]!.options.jobId, 2);
  }
} else if (scenario === "manual-approval" || scenario === "manual-changes") {
  const summary = "Salary 100000; all fields checked";
  const review = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(pipeline.respond(1, scenario === "manual-approval" ? "approve" : "Change salary to 110000"), true);
  first.exit();
  await review;
  await until(() => workers.length === 2);
  const second = workers[1]!;
  const handoff = call(second, "need_manual", { ...navigation, reason: "Session recovery before final re-observation" });
  await until(() => core.getOpenGate(1)?.kind === "manual");
  assert.equal(pipeline.respond(1, "done"), true);
  assert.equal(pipeline.respond(1, "duplicate return-control"), false);
  second.exit();
  await handoff;
  await until(() => workers.length === 3);
  const third = workers[2]!;
  if (scenario === "manual-approval") {
    const authorization = call(third, "confirm_submit", { ...navigation, summary });
    await until(() => kvGet("fill.submitting.1") === "1" || core.getOpenGate(1) !== null);
    assert.equal(kvGet("fill.submitting.1"), "1", "manual return must not erase unchanged unused approval");
    assert.equal(core.getOpenGate(1), null);
    await authorization;
  } else {
    assert.deepEqual(core.resumeContext(1).changeRequests, ["Change salary to 110000"]);
    const revisedReview = call(third, "confirm_submit", { ...navigation, summary: "Salary 110000; changed fields checked" });
    await until(() => core.getOpenGate(1) !== null);
    assert.equal(core.getOpenGate(1)!.kind, "confirm_submit");
    assert.notEqual(kvGet("fill.submitting.1"), "1", "manual return cannot turn a change request into approval");
    third.exit();
    await revisedReview;
  }
} else if (scenario === "confirm" || scenario === "changed-summary") {
  const parking = call(first, "confirm_submit", { ...navigation, summary: "Salary 100000; all fields checked" });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.getOpenGate(1)!.kind, "confirm_submit");
  assert.notEqual(kvGet("fill.submitting.1"), "1", "queuing approval cannot authorize a click");
  assert.equal(pipeline.respond(1, "approve"), true);
  assert.notEqual(kvGet("fill.submitting.1"), "1", "answering approval cannot authorize a click");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  const second = workers[1]!;
  if (scenario === "changed-summary") {
    const reparking = call(second, "confirm_submit", { ...navigation, summary: "Salary 110000; changed fields" });
    await until(() => core.getOpenGate(1) !== null);
    assert.equal(core.getOpenGate(1)!.kind, "confirm_submit");
    assert.notEqual(kvGet("fill.submitting.1"), "1");
    second.exit();
    await reparking;
  } else {
    assert.match(await call(second, "confirm_submit", { ...navigation, summary: "Salary 100000; all fields checked" }), /^APPROVED/);
    assert.equal(kvGet("fill.submitting.1"), "1");
    const ambiguity = call(second, "report_result", { outcome: "failed", note: "Timed out after final click" });
    await ambiguity;
    assert.equal(core.getOpenGate(1)!.kind, "submission_ambiguous");
    assert.equal(pipeline.respond(1, "approve"), false);
    pipeline.pump();
    assert.equal(workers.length, 2, "stopping ambiguous worker retains capacity until exit");
    second.exit();
    await until(() => workers.length === 3);
    assert.equal(workers[2]!.options.jobId, 2);
    assert.equal(kvGet("fill.submitting.1"), "1");
    assert.equal(pipeline.fillSlot(1), null);
    core.resolveAmbiguous(1, "not_submitted");
    assert.equal(kvGet("fill.submitting.1"), "0");
    assert.equal(core.resumeContext(1).approvedSummary, null);
    await call(workers[2]!, "report_result", { outcome: "closed", note: "Other job closed" });
    workers[2]!.exit();
    await until(() => workers.length === 4);
    assert.equal(workers[3]!.options.jobId, 1);
  }
} else if (scenario === "recovery-manual") {
  const parking = call(first, "need_manual", { ...navigation, reason: "Pre-submit site outage; no account yet" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = core.getOpenGate(1)!;
  assert.equal(gate.kind, "manual");
  first.exit();
  await parking;
  await until(() => !pipeline.activeFillSession(1));
  pipeline.pump();
  assert.equal(workers.length, 1);
  assert.equal(core.manualLeases().size, 0);

  assert.throws(() => pipeline.scheduleRecovery(1, "stale-gate-id"));
  assert.equal(core.getOpenGate(1)?.id, gate.id);
  assert.equal(core.manualLeases().size, 0);

  pipeline.scheduleRecovery(1, gate.id);
  assert.equal(core.getOpenGate(1), null);
  assert.equal(getJob(1)!.note, "Pre-submit site outage; no account yet");

  pipeline.pump();
  await until(() => workers.length === 2);
  const second = workers[1]!;
  assert.equal(second.options.jobId, 1);
  assert.equal(kvGet("fill.recovery.1"), "0", "recovery flag cleared as worker starts");
  second.exit();
} else if (scenario === "recovery-verify-guards") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(core.getOpenGate(1)!.id, "approve", "application");
  first.exit();
  await parking;
  pipeline.pump();
  await until(() => workers.length === 2);
  const second = workers[1]!;
  assert.match(await call(second, "confirm_submit", { ...navigation, summary }), /^APPROVED/);
  assert.equal(kvGet("fill.submitting.1"), "1");

  const ambiguity = call(second, "report_result", { outcome: "failed", note: "Timeout waiting for confirmation" });
  await ambiguity;
  const gate = core.getOpenGate(1)!;
  assert.equal(gate.kind, "submission_ambiguous");
  second.exit();
  await Bun.sleep(10);
  config.limits.applyPerDay = 0;

  pipeline.scheduleRecovery(1, gate.id);
  assert.equal(core.getOpenGate(1), null);
  assert.equal(kvGet("fill.submitting.1"), "1", "submit marker preserved up front");
  assert.equal(kvGet("fill.verify.1"), "1", "durable verify mode set");

  pipeline.pump();
  await until(() => workers.length === 3);
  const third = workers[2]!;
  assert.equal(third.options.jobId, 1);

  const submitAttempt = await call(third, "confirm_submit", { ...navigation, summary });
  assert.match(submitAttempt, /ERROR: verification workers are strictly forbidden/);

  const reportAttempt = await call(third, "report_result", { outcome: "submitted", note: "done" });
  assert.match(reportAttempt, /ERROR: verification workers must record status through verify_status/);

  third.exit();
} else if (scenario === "recovery-verify-inconclusive") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(core.getOpenGate(1)!.id, "approve", "application");
  first.exit();
  await parking;
  pipeline.pump();
  await until(() => workers.length === 2);
  const second = workers[1]!;
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Browser dropped connection" });
  const gate = core.getOpenGate(1)!;
  second.exit();
  await until(() => !pipeline.activeFillSession(1));

  pipeline.scheduleRecovery(1, gate.id);
  pipeline.pump();
  await until(() => workers.length === 3);
  const third = workers[2]!;

  const inconclusive = call(third, "verify_status", {
    ...navigation,
    outcome: "unresolved",
    evidence: "Portal dashboard returns 502 Bad Gateway; cannot observe status",
  });
  await until(() => core.getOpenGate(1) !== null);
  const reparked = core.getOpenGate(1)!;
  assert.equal(reparked.kind, "submission_ambiguous");
  assert.match(reparked.text, /Verification inconclusive: Portal dashboard returns 502/);
  assert.equal(kvGet("fill.submitting.1"), "1");
  assert.equal(kvGet("fill.verify.1"), "0");
  assert.equal(kvGet("fill.recovery.1"), "0");
  assert.equal(third.aborted, true);
  third.exit();
  await inconclusive;
  await Bun.sleep(10);
  assert.equal(workers.length, 3, "does not auto-repeat after inconclusive verification");
} else if (scenario === "recovery-verify-submitted") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(core.getOpenGate(1)!.id, "approve", "application");
  first.exit();
  await parking;
  pipeline.pump();
  await until(() => workers.length === 2);
  const second = workers[1]!;
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Timeout after click" });
  const gate = core.getOpenGate(1)!;
  second.exit();
  await until(() => !pipeline.activeFillSession(1));

  pipeline.scheduleRecovery(1, gate.id);
  pipeline.pump();
  await until(() => workers.length === 3);
  const third = workers[2]!;

  const submittedRes = call(third, "verify_status", {
    ...navigation,
    outcome: "submitted",
    evidence: "Applicant portal displays 'Application Submitted for Requisition 1' on 2026-10-10",
    source: "portal",
    status: "submitted",
    requisition_id: "REQ-001",
  });
  await until(() => getJob(1)!.status === "submitted");
  assert.equal(kvGet("fill.submitting.1"), "0");
  assert.equal(kvGet("fill.verify.1"), "0");
  assert.equal(core.getOpenGate(1), null);
  assert.equal(third.aborted, true);
  third.exit();
  await submittedRes;
} else if (scenario === "recovery-verify-draft") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(core.getOpenGate(1)!.id, "approve", "application");
  first.exit();
  await parking;
  pipeline.pump();
  await until(() => workers.length === 2);
  const second = workers[1]!;
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Timeout after click" });
  const gate = core.getOpenGate(1)!;
  second.exit();
  await until(() => !pipeline.activeFillSession(1));

  pipeline.scheduleRecovery(1, gate.id);
  pipeline.pump();
  await until(() => workers.length === 3);
  const third = workers[2]!;

  const draftRes = call(third, "verify_status", {
    ...navigation,
    outcome: "not_submitted",
    evidence: "Applicant portal displays 'Draft - Not Submitted' for Requisition 1",
    source: "portal",
    status: "draft",
    requisition_id: "REQ-001",
  });
  await until(() => getJob(1)!.status === "approved");
  assert.equal(kvGet("fill.submitting.1"), "0");
  assert.equal(kvGet("fill.verify.1"), "0");
  assert.equal(core.resumeContext(1).approvedSummary, null, "approval invalidated");
  assert.equal(third.aborted, true);
  third.exit();
  await draftRes;
  pipeline.pump();
  await until(() => workers.length === 4);
  const fourth = workers[3]!;
  assert.equal(fourth.options.jobId, 1);
  const repark = call(fourth, "confirm_submit", { ...navigation, summary: "New summary verification" });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.getOpenGate(1)!.kind, "confirm_submit");
  fourth.exit();
  await repark;
} else {
  throw new Error(`Unknown fixture scenario: ${scenario}`);
}
process.exit(0);
