// Subprocess-only fixture: all state is throwaway; browser, model and mailbox are inert.
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mock } from "bun:test";
import type { WorkerHandle, WorkerOptions } from "../../src/omp";
import type { JobBrowser } from "../../src/chrome";
import type { Browser } from "../../src/fill-session";

// Dynamic imports intentionally exercise module initialization boundaries:
// isolation guards/config precede DB opening, and mocks precede scheduler loading.
assert(process.env["AUTO_APPLY_DATA"] && process.env["AUTO_APPLY_PROFILE"] && process.env["AUTO_APPLY_RESUME_DIR"], "isolated paths required");
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
  const respond = (url: string): Response => {
    if (url.endsWith("/json/version")) return Response.json({});
    if (url.endsWith("/json/list"))
      return Response.json([
        { type: "page", id: "recent", title: "Other job", url: "https://fixture.invalid/other" },
        { type: "page", id: "draft", title: "Parked draft", url: "https://fixture.invalid/draft" },
        { type: "page", id: "obsolete", title: "Old tab", url: "https://fixture.invalid/old" },
      ]);
    closed.push(url.slice(url.lastIndexOf("/") + 1));
    return new Response("ok");
  };
  globalThis.fetch = Object.assign((input: string | URL | Request) => Promise.resolve(respond(input instanceof Request ? input.url : String(input))), {
    preconnect: globalThis.fetch.preconnect,
  });
  const chrome = await import("../../src/chrome");
  await chrome.pruneTabs(0, 1, new Set(["draft"]));
  assert.deepEqual(closed, ["obsolete"]);
  // A tab that was given up is closed even though it is the most recent one.
  closed.length = 0;
  await chrome.pruneTabs(0, 1, new Set(["draft"]), new Set(["recent"]));
  assert.deepEqual(closed, ["recent"]);
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
  // The process ends with an error, as when the model provider refuses the turn.
  fail: (error: string) => void;
}
const workers: SimulatedWorker[] = [];
// The scheduler is handed a simulated agent runner and browser in place of the real ones.
const runWorker = (options: WorkerOptions): WorkerHandle => {
  const { promise: done, resolve } = Promise.withResolvers<Awaited<WorkerHandle["done"]>>();
  const worker: SimulatedWorker = {
    options,
    aborted: false,
    exit: () => {
      resolve({ status: "aborted", lastText: "" });
    },
    fail: error => {
      resolve({ status: "error", error, lastText: "" });
    },
  };
  workers.push(worker);
  // Abort deliberately does NOT settle done: assert slot stays owned until exit.
  return {
    done,
    abort: () => {
      worker.aborted = true;
    },
  };
};
const simulatedTabs = new Set<string>();
const jobBrowsers: JobBrowser[] = [];
let nextTab = 0;
let activateWait: Promise<void> | null = null;
if (scenario?.startsWith("restart-")) for (const id of [1, 2, 3, 4]) simulatedTabs.add(id === 1 ? "draft-tab" : `draft-tab-${id}`);
const browser: Browser = {
  ensureChrome: async () => {
    /* browser is inert in this fixture */
  },
  pruneTabs: async () => {
    /* simulated tabs are never pruned */
  },
  screenshot: () => Promise.resolve(null),
  tabs: () => Promise.resolve([...simulatedTabs].map(id => ({ id, title: "Fixture requisition", url: "https://fixture.invalid/draft", ws: "" }))),
  activateApplicationTab: async (_slot: number, tabId: string) => {
    if (!simulatedTabs.has(tabId)) throw new Error("Missing saved draft tab");
    if (activateWait) await activateWait;
  },
  prepareJobBrowser: (_slot: number, saved: string | null, excluded: ReadonlySet<string>): Promise<JobBrowser> => {
    if (saved && excluded.has(saved)) return Promise.reject(new Error("Checkpoint belongs to another application"));
    const reused = saved !== null && simulatedTabs.has(saved);
    const id = saved !== null && reused ? saved : ++nextTab === 1 ? "draft-tab" : `draft-tab-${nextTab}`;
    simulatedTabs.add(id);
    let revoked = false;
    const b: JobBrowser = {
      tabId: id,
      reused,
      port: config.chrome.proxyPort,
      ownsTarget: target => !revoked && target === id,
      revoke: () => {
        revoked = true;
      },
      close: () => {
        revoked = true;
      },
    };
    jobBrowsers.push(b);
    return Promise.resolve(b);
  },
};
await mock.module("../../src/gmail", () => ({
  gmailStatus: () => ({ connected: false, address: null }),
  search: () => {
    throw new Error("mail forbidden in fixture");
  },
  read: () => {
    throw new Error("mail forbidden in fixture");
  },
  markRead: () => {
    throw new Error("mail forbidden in fixture");
  },
}));
await mock.module("../../src/digest", () => ({
  tickQuestionDigest: async () => {
    /* digest mail is disabled in this fixture */
  },
}));
const { db, getJob, kvSet, updateJob } = await import("../../src/db");
const { authorizeSubmit, isSubmitting, isVerifying, isRecovering } = await import("../../src/fill-state");
const core = await import("../../src/questions");
const { backedOff, usedToday } = await import("../../src/limits");
const { Scheduler } = await import("../../src/scheduler");
const scheduler = new Scheduler({ runWorker, browser });

function must<T>(value: T | null | undefined, what: string): T {
  if (value == null) throw new Error(`missing ${what}`);
  return value;
}
const jobRow = (id: number) => must(getJob(id), `job ${id}`);
const openGate = (jobId: number) => must(core.getOpenGate(jobId), `open gate for job ${jobId}`);
const workerAt = (index: number) => must(workers[index], `worker ${index}`);
function addJob(id: number) {
  db.query("INSERT INTO jobs (id,url,source,company,title,status,approved_by) VALUES (?,?,?, ?,?,'approved','user')").run(
    id,
    `https://fixture.invalid/job/${id}`,
    "fixture",
    `Employer ${id}`,
    `Requisition ${id}`,
  );
  const dir = jobDir(id);
  writeFileSync(join(dir, resume.PDF_NAME), `PDF for job ${id}`);
  writeFileSync(join(dir, resume.MAIN), `source for job ${id}`);
}
async function until(predicate: () => boolean) {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await Bun.sleep(5);
  }
  throw new Error(
    `fixture transition timed out: ${JSON.stringify({
      workers: workers.map(worker => worker.options.jobId),
      jobs: db.query("SELECT id,status,pending,note,fill_checkpoint FROM jobs ORDER BY id LIMIT 8").all(),
      gates: db.query("SELECT id,job_id,kind,state,text FROM question_gates WHERE state = 'open'").all(),
    })}`,
  );
}
const navigation = {
  tab_id: "draft-tab",
  url: "https://fixture.invalid/draft",
  step: "Requisition 1 / questions",
  notes: "Use candidate home; verify saved draft",
};
const question = { ...navigation, question: "Required salary?", context: "Employer 1 / annual USD base salary", options: [] };
function call(worker: SimulatedWorker, name: string, args: Record<string, unknown>) {
  return must(worker.options.tools[name], `host tool ${name}`).handler(args);
}

if (scenario === "restart-setup") {
  for (const id of [1, 2, 3, 4]) {
    addJob(id);
    const frozen = resume.freezeResume(id);
    updateJob(id, { status: "filling", resume_sha: frozen.sha, resume_frozen_at: new Date().toISOString() });
    core.recordCheckpoint(id, {
      version: 1,
      slot: 0,
      tabId: id === 1 ? "draft-tab" : `draft-tab-${id}`,
      url: navigation.url,
      step: `Requisition ${id}`,
      notes: "Existing draft",
      resumeSha: frozen.sha,
      savedAt: new Date().toISOString(),
    });
  }
  core.parkGate(1, { kind: "question", text: "Still unknown?", context: "Employer 1 exact question", options: [] }, core.readCheckpoint(1));
  const answered = core.parkGate(
    2,
    { kind: "question", text: "Known after restart?", context: "Employer 2 exact question", options: [] },
    core.readCheckpoint(2),
  );
  core.answerGate(answered.id, "durable answer", "application");
  // This interrupted runnable marker must become ambiguity, not an ordinary resume.
  authorizeSubmit(3);
  // Use another slot for ambiguity so its lease doesn't intentionally block the queued answer.
  const checkpoint = must(core.readCheckpoint(3), "checkpoint for job 3");
  core.recordCheckpoint(3, { ...checkpoint, slot: 1 });
  writeFileSync(join(DATA, "expected-sha.txt"), must(jobRow(2).resume_sha, "resume SHA for job 2"));
  process.exit(0);
}
if (scenario === "restart-resume") {
  scheduler.start();
  await until(() => workers.length === 1);
  assert.equal(jobRow(1).status, "needs_input");
  assert.equal(openGate(1).kind, "question");
  assert.equal(workerAt(0).options.jobId, 2);
  assert.equal(jobRow(2).resume_sha, readFileSync(join(DATA, "expected-sha.txt"), "utf8"));
  assert.equal(must(core.resumeContext(2).answers[0], "answer for job 2").answer, "durable answer");
  assert.equal(openGate(3).kind, "submission_ambiguous");
  assert.equal(isSubmitting(3), true);
  assert.equal(jobRow(4).status, "approved");
  assert.equal(core.respond(3, "approve"), false);
  process.exit(0);
}

if (scenario === "blocked-prefix") {
  const insert = db.query(
    "INSERT INTO jobs (id,url,source,company,title,status,approved_by,fill_checkpoint) VALUES (?,?, 'fixture', ?,?, 'approved','user',?)",
  );
  db.transaction(() => {
    for (let id = 1; id <= 1001; id++) {
      const checkpoint = {
        version: 1,
        slot: 1,
        tabId: `blocked-${id}`,
        url: null,
        step: "Other browser draft",
        notes: "Resume only in original slot",
        resumeSha: null,
        savedAt: new Date().toISOString(),
      };
      insert.run(id, `https://fixture.invalid/blocked/${id}`, `Blocked employer ${id}`, `Blocked requisition ${id}`, JSON.stringify(checkpoint));
    }
  })();
  addJob(1002); // Fresh and eligible, but checkpoint-bearing resumes must come first.
  addJob(1003);
  const frozen = resume.freezeResume(1003);
  updateJob(1003, { resume_sha: frozen.sha, resume_frozen_at: new Date().toISOString() });
  simulatedTabs.add("eligible-draft");
  core.recordCheckpoint(1003, {
    version: 1,
    slot: 0,
    tabId: "eligible-draft",
    url: navigation.url,
    step: "Exact eligible draft",
    notes: "Resume this draft",
    resumeSha: frozen.sha,
    savedAt: new Date().toISOString(),
  });
  scheduler.pump();
  await until(() => workers.length === 1);
  assert.equal(jobRow(1003).status, "filling");
  assert.equal(jobRow(1002).status, "approved");
  assert.equal(must(core.readCheckpoint(1003), "checkpoint for job 1003").tabId, "eligible-draft");
  assert.equal(jobRow(1003).resume_sha, frozen.sha);
  await call(workerAt(0), "report_result", { outcome: "closed", note: "Fixture draft was closed" });
  workerAt(0).exit();
  await until(() => workers.length === 2);
  assert.equal(jobRow(1002).status, "filling");
  assert.equal(
    must(db.query<{ count: number }, []>("SELECT count(*) AS count FROM jobs WHERE id <= 1001 AND status != 'approved'").get(), "blocked job count").count,
    0,
  );
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
    core.recordCheckpoint(id, {
      version: 1,
      slot: id === 2 ? 1 : 0,
      tabId,
      url: navigation.url,
      step: `Requisition ${id}`,
      notes: "Saved draft",
      resumeSha: frozen.sha,
      savedAt: new Date().toISOString(),
    });
    const gate = core.parkGate(id, { kind: "manual", text: "Saved login failure" }, core.readCheckpoint(id));
    if (id !== 2) core.queueRecovery(id, gate.id);
  }
  await scheduler.reserveBrowser(2, openGate(2).id);
  await until(() => workers.length === 1);
  assert.equal(workerAt(0).options.jobId, 4, "skip blocked recovery, preserve the next recovery's priority");
  assert.equal(jobRow(1).status, "approved");
  const parked = call(workerAt(0), "need_manual", { ...navigation, tab_id: "recovery-4", reason: "Still blocked" });
  await until(() => core.getOpenGate(4) !== null);
  workerAt(0).exit();
  await parked;
  await until(() => workers.length === 2);
  assert.equal(workerAt(1).options.jobId, 3, "unrunnable recovery must not block fresh work");
  assert.equal(openGate(4).kind, "manual");
  assert.equal(core.manualLeases().get(1), 2);
  process.exit(0);
}

addJob(1);
if (
  ["release", "manual", "manual-same-employer", "manual-lost-tab", "confirm", "terminal-success", "terminal-closed", "terminal-persistence-failure"].includes(
    scenario ?? "",
  )
)
  addJob(2);
if (["manual-same-employer", "terminal-success", "terminal-closed", "terminal-persistence-failure"].includes(scenario ?? ""))
  updateJob(2, { company: jobRow(1).company, company_key: jobRow(1).company_key });
scheduler.pump();
await until(() => workers.length === 1);
const first = workerAt(0);
const initialSha = must(jobRow(1).resume_sha, "resume SHA for job 1");

if (scenario === "release" || scenario === "quick-answer") {
  const parking = call(first, "ask_user", question);
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(first.aborted, true);
  assert.equal(jobRow(1).status, "needs_input");
  assert.equal(scheduler.fillSlot(1), null);
  assert.equal(isSubmitting(1), false);
  if (scenario === "quick-answer") {
    assert.equal(core.respond(1, "100000"), true);
    assert.equal(core.respond(1, "200000"), false);
    // The cap is spent, but resuming an application already started does not wait for tomorrow's.
    config.limits.applyPerDay = 1;
    writeFileSync(join(jobDir(1), resume.PDF_NAME), "changed working PDF must not upload");
    writeFileSync(join(jobDir(1), resume.MAIN), "changed working source must not freeze");
  }
  scheduler.pump();
  assert.equal(workers.length, 1, "abort is not process exit; slot must not be reused yet");
  await call(first, "report_result", { outcome: "failed", note: "late old callback" });
  assert.equal(jobRow(1).status, scenario === "release" ? "needs_input" : "approved");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.equal(workerAt(1).options.jobId, scenario === "release" ? 2 : 1);
  if (scenario === "release") {
    assert.equal(jobRow(1).status, "needs_input");
    assert.equal(scheduler.fillSlot(1), null);
  } else {
    assert.equal(usedToday("fill"), 1, "a resume is not counted as a new application");
    assert.equal(jobRow(1).resume_sha, initialSha);
    assert.equal(readFileSync(resume.frozenResume(1, initialSha).pdf, "utf8"), "PDF for job 1");
    assert.match(await call(workerAt(1), "ask_user", question), /100000/);
    await call(first, "report_result", { outcome: "submitted", note: "stale generation" });
    assert.equal(jobRow(1).status, "filling");
    assert.equal(core.getOpenGate(1), null);
  }
} else if (scenario === "cover-letter") {
  const args = { ...navigation, prompt: "Required letter, plain text" };
  const parking = call(first, "ask_cover_letter", args);
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.respond(1, "My exact application letter."), true);
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.match(await call(workerAt(1), "ask_cover_letter", args), /My exact application letter\./);
  assert.equal(readFileSync(join(jobDir(1), "cover_letter.txt"), "utf8"), "My exact application letter.\n");
  assert.equal(core.getOpenGate(1), null);
} else if (scenario === "capacity") {
  await call(first, "checkpoint", navigation);
  first.fail("Codex error event: Codex is at capacity, please try again later (code=turn_rate_limit_exceeded)");
  await until(() => !scheduler.activeFillSession(1));
  assert.equal(jobRow(1).status, "approved", "back in the fill queue, not parked for a person");
  assert.equal(core.getOpenGate(1), null);
  assert.equal(isRecovering(1), true);
  assert.equal(backedOff(), true);
  scheduler.pump();
  assert.equal(workers.length, 1, "nothing starts while the provider is at capacity");
  kvSet("backoff.until", "0");
  scheduler.pump();
  await until(() => workers.length === 2);
  assert.equal(workerAt(1).options.jobId, 1, "the same draft resumes");
  assert.equal(jobRow(1).resume_sha, initialSha);
  assert.equal(usedToday("fill"), 1, "resuming is not a new application");
} else if (scenario === "manual-same-employer") {
  const parking = call(first, "need_manual", { ...navigation, reason: "CAPTCHA/session needs human" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = openGate(1);
  first.exit();
  await parking;
  await until(() => !scheduler.activeFillSession(1));
  scheduler.pump();
  assert.equal(workers.length, 1, "a new application waits while the employer's started one is unfinished");
  assert.equal(jobRow(2).status, "approved");
  scheduler.scheduleRecovery(1, gate.id);
  await until(() => workers.length === 2);
  assert.equal(workerAt(1).options.jobId, 1);
  scheduler.pump();
  assert.equal(workers.length, 2, "nor while that one resumes its draft");
  await call(workerAt(1), "report_result", { outcome: "submitted", note: "Submitted after recovery" });
  workerAt(1).exit();
  await until(() => workers.length === 3);
  assert.equal(workerAt(2).options.jobId, 2);
} else if (["manual", "manual-lost-tab"].includes(scenario ?? "")) {
  if (scenario === "manual-lost-tab") simulatedTabs.delete(navigation.tab_id);
  const parking = call(first, "need_manual", { ...navigation, reason: "CAPTCHA/session needs human" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = openGate(1);
  await assert.rejects(scheduler.reserveBrowser(1, gate.id));
  scheduler.pump();
  assert.equal(workers.length, 1, "stopping worker still owns the slot");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  assert.equal(workerAt(1).options.jobId, 2);
  assert.equal(scheduler.fillSlot(1), null);
  assert.equal(core.manualLeases().size, 0);
  assert.equal(core.getOpenGate(1)?.id, gate.id);
  await assert.rejects(scheduler.reserveBrowser(1, gate.id), "another worker owns the reused browser");
  await call(workerAt(1), "report_result", { outcome: "closed", note: "Other posting closed" });
  workerAt(1).exit();
  await until(() => !scheduler.activeFillSession(2));
  if (scenario === "manual-lost-tab") {
    await assert.rejects(scheduler.reserveBrowser(1, gate.id));
    assert.equal(core.manualLeases().size, 0, "missing target must not leave a reservation");
  }
  scheduler.scheduleRecovery(1, gate.id);
  await until(() => workers.length === 3);
  assert.equal(workerAt(2).options.jobId, 1);
  assert.equal(jobRow(1).resume_sha, initialSha);
} else if (scenario === "manual-reservation" || scenario === "manual-activation-race") {
  const parking = call(first, "need_manual", { ...navigation, reason: "Human inspection requested" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = openGate(1);
  first.exit();
  await parking;
  await until(() => !scheduler.activeFillSession(1));
  if (scenario === "manual-activation-race") {
    const activation = Promise.withResolvers<undefined>();
    activateWait = activation.promise;
    const reserving = scheduler.reserveBrowser(1, gate.id);
    scheduler.scheduleRecovery(1, gate.id);
    assert.equal(workers.length, 1, "activating browser remains busy after gate resolution");
    activation.resolve(undefined);
    await assert.rejects(reserving);
    await until(() => workers.length === 2);
    assert.equal(workerAt(1).options.jobId, 1);
    assert.equal(core.manualLeases().size, 0);
  } else {
    await scheduler.reserveBrowser(1, gate.id);
    assert.equal(scheduler.manualBrowserReserved(1), true);
    assert.equal(scheduler.fillSlot(1), 0);
    addJob(2);
    scheduler.pump();
    assert.equal(workers.length, 1);
    assert.throws(() => {
      scheduler.releaseBrowser(1, "stale-gate");
    });
    assert.equal(scheduler.manualBrowserReserved(1), true);
    scheduler.releaseBrowser(1, gate.id);
    assert.equal(core.getOpenGate(1)?.id, gate.id);
    assert.equal(scheduler.manualBrowserReserved(1), false);
    await until(() => workers.length === 2);
    assert.equal(workerAt(1).options.jobId, 2);
  }
} else if (scenario === "manual-approval" || scenario === "manual-changes") {
  const summary = "Salary 100000; all fields checked";
  const review = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.respond(1, scenario === "manual-approval" ? "approve" : "Change salary to 110000"), true);
  first.exit();
  await review;
  await until(() => workers.length === 2);
  const second = workerAt(1);
  const handoff = call(second, "need_manual", { ...navigation, reason: "Session recovery before final re-observation" });
  await until(() => core.getOpenGate(1)?.kind === "manual");
  assert.equal(core.respond(1, "done"), true);
  assert.equal(core.respond(1, "duplicate return-control"), false);
  second.exit();
  await handoff;
  await until(() => workers.length === 3);
  const third = workerAt(2);
  if (scenario === "manual-approval") {
    const authorization = call(third, "confirm_submit", { ...navigation, summary });
    await until(() => isSubmitting(1) || core.getOpenGate(1) !== null);
    assert.equal(isSubmitting(1), true, "manual return must not erase unchanged unused approval");
    assert.equal(core.getOpenGate(1), null);
    await authorization;
  } else {
    assert.deepEqual(core.resumeContext(1).changeRequests, ["Change salary to 110000"]);
    const revisedReview = call(third, "confirm_submit", { ...navigation, summary: "Salary 110000; changed fields checked" });
    await until(() => core.getOpenGate(1) !== null);
    assert.equal(openGate(1).kind, "confirm_submit");
    assert.equal(isSubmitting(1), false, "manual return cannot turn a change request into approval");
    third.exit();
    await revisedReview;
  }
} else if (scenario === "confirm" || scenario === "changed-summary") {
  const parking = call(first, "confirm_submit", { ...navigation, summary: "Salary 100000; all fields checked" });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(openGate(1).kind, "confirm_submit");
  assert.equal(isSubmitting(1), false, "queuing approval cannot authorize a click");
  assert.equal(core.respond(1, "approve"), true);
  assert.equal(isSubmitting(1), false, "answering approval cannot authorize a click");
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  const second = workerAt(1);
  if (scenario === "changed-summary") {
    const reparking = call(second, "confirm_submit", { ...navigation, summary: "Salary 110000; changed fields" });
    await until(() => core.getOpenGate(1) !== null);
    assert.equal(openGate(1).kind, "confirm_submit");
    assert.equal(isSubmitting(1), false);
    second.exit();
    await reparking;
  } else {
    assert.match(await call(second, "confirm_submit", { ...navigation, summary: "Salary 100000; all fields checked" }), /^APPROVED/);
    assert.equal(isSubmitting(1), true);
    const ambiguity = call(second, "report_result", { outcome: "failed", note: "Timed out after final click" });
    await ambiguity;
    assert.equal(openGate(1).kind, "submission_ambiguous");
    assert.equal(core.respond(1, "approve"), false);
    scheduler.pump();
    assert.equal(workers.length, 2, "stopping ambiguous worker retains capacity until exit");
    second.exit();
    await until(() => workers.length === 3);
    assert.equal(workerAt(2).options.jobId, 2);
    assert.equal(isSubmitting(1), true);
    assert.equal(scheduler.fillSlot(1), null);
    core.resolveAmbiguous(1, "not_submitted");
    assert.equal(isSubmitting(1), false);
    assert.equal(core.resumeContext(1).approvedSummary, null);
    await call(workerAt(2), "report_result", { outcome: "closed", note: "Other job closed" });
    workerAt(2).exit();
    await until(() => workers.length === 4);
    assert.equal(workerAt(3).options.jobId, 1);
  }
} else if (scenario === "recovery-manual") {
  const parking = call(first, "need_manual", { ...navigation, reason: "Pre-submit site outage; no account yet" });
  await until(() => core.getOpenGate(1) !== null);
  const gate = openGate(1);
  assert.equal(gate.kind, "manual");
  first.exit();
  await parking;
  await until(() => !scheduler.activeFillSession(1));
  scheduler.pump();
  assert.equal(workers.length, 1);
  assert.equal(core.manualLeases().size, 0);

  assert.throws(() => {
    scheduler.scheduleRecovery(1, "stale-gate-id");
  });
  assert.equal(core.getOpenGate(1)?.id, gate.id);
  assert.equal(core.manualLeases().size, 0);

  scheduler.scheduleRecovery(1, gate.id);
  assert.equal(core.getOpenGate(1), null);
  assert.equal(jobRow(1).note, "Pre-submit site outage; no account yet");

  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  assert.equal(second.options.jobId, 1);
  assert.equal(isRecovering(1), false, "recovery flag cleared as worker starts");
  second.exit();
} else if (scenario === "recovery-verify-guards") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(openGate(1).id, "approve", "application");
  first.exit();
  await parking;
  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  assert.match(await call(second, "confirm_submit", { ...navigation, summary }), /^APPROVED/);
  assert.equal(isSubmitting(1), true);

  const ambiguity = call(second, "report_result", { outcome: "failed", note: "Timeout waiting for confirmation" });
  await ambiguity;
  const gate = openGate(1);
  assert.equal(gate.kind, "submission_ambiguous");
  second.exit();
  await Bun.sleep(10);
  config.limits.applyPerDay = 0;

  scheduler.scheduleRecovery(1, gate.id);
  assert.equal(core.getOpenGate(1), null);
  assert.equal(isSubmitting(1), true, "submit marker preserved up front");
  assert.equal(isVerifying(1), true, "durable verify mode set");

  scheduler.pump();
  await until(() => workers.length === 3);
  const third = workerAt(2);
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
  core.answerGate(openGate(1).id, "approve", "application");
  first.exit();
  await parking;
  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Browser dropped connection" });
  const gate = openGate(1);
  second.exit();
  await until(() => !scheduler.activeFillSession(1));

  scheduler.scheduleRecovery(1, gate.id);
  scheduler.pump();
  await until(() => workers.length === 3);
  const third = workerAt(2);

  const inconclusive = call(third, "verify_status", {
    ...navigation,
    outcome: "unresolved",
    evidence: "Portal dashboard returns 502 Bad Gateway; cannot observe status",
  });
  await until(() => core.getOpenGate(1) !== null);
  const reparked = openGate(1);
  assert.equal(reparked.kind, "submission_ambiguous");
  assert.match(reparked.text, /Verification inconclusive: Portal dashboard returns 502/);
  assert.equal(isSubmitting(1), true);
  assert.equal(isVerifying(1), false);
  assert.equal(isRecovering(1), false);
  assert.equal(third.aborted, true);
  third.exit();
  await inconclusive;
  await Bun.sleep(10);
  assert.equal(workers.length, 3, "does not auto-repeat after inconclusive verification");
} else if (scenario === "recovery-verify-submitted") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(openGate(1).id, "approve", "application");
  first.exit();
  await parking;
  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Timeout after click" });
  const gate = openGate(1);
  second.exit();
  await until(() => !scheduler.activeFillSession(1));

  scheduler.scheduleRecovery(1, gate.id);
  scheduler.pump();
  await until(() => workers.length === 3);
  const third = workerAt(2);

  const submittedRes = call(third, "verify_status", {
    ...navigation,
    outcome: "submitted",
    evidence: "Applicant portal displays 'Application Submitted for Requisition 1' on 2026-10-10",
    source: "portal",
    status: "submitted",
    requisition_id: "REQ-001",
  });
  await until(() => jobRow(1).status === "submitted");
  assert.equal(isSubmitting(1), false);
  assert.equal(isVerifying(1), false);
  assert.equal(core.getOpenGate(1), null);
  assert.equal(third.aborted, true);
  third.exit();
  await submittedRes;
} else if (scenario === "recovery-verify-draft") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  core.answerGate(openGate(1).id, "approve", "application");
  first.exit();
  await parking;
  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  await call(second, "confirm_submit", { ...navigation, summary });
  await call(second, "report_result", { outcome: "failed", note: "Timeout after click" });
  const gate = openGate(1);
  second.exit();
  await until(() => !scheduler.activeFillSession(1));

  scheduler.scheduleRecovery(1, gate.id);
  scheduler.pump();
  await until(() => workers.length === 3);
  const third = workerAt(2);

  const draftRes = call(third, "verify_status", {
    ...navigation,
    outcome: "not_submitted",
    evidence: "Applicant portal displays 'Draft - Not Submitted' for Requisition 1",
    source: "portal",
    status: "draft",
    requisition_id: "REQ-001",
  });
  await until(() => jobRow(1).status === "approved");
  assert.equal(isSubmitting(1), false);
  assert.equal(isVerifying(1), false);
  assert.equal(core.resumeContext(1).approvedSummary, null, "approval invalidated");
  assert.equal(third.aborted, true);
  third.exit();
  await draftRes;
  scheduler.pump();
  await until(() => workers.length === 4);
  const fourth = workerAt(3);
  assert.equal(fourth.options.jobId, 1);
  const repark = call(fourth, "confirm_submit", { ...navigation, summary: "New summary verification" });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(openGate(1).kind, "confirm_submit");
  fourth.exit();
  await repark;
} else if (scenario === "terminal-success") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.respond(1, "approve"), true);
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  const second = workerAt(1);
  assert.match(await call(second, "confirm_submit", { ...navigation, summary }), /^APPROVED/);
  assert.equal(isSubmitting(1), true);

  const terminalReport = call(second, "report_result", { outcome: "submitted", note: "Confirmation #ABC-123" });
  assert.equal(await terminalReport, "Recorded.");

  // Consumer-visible terminal status is immediate
  assert.equal(jobRow(1).status, "submitted");
  assert.equal(jobRow(1).pending, null);
  assert.equal(core.getOpenGate(1), null, "success clears marker without ambiguity gate");
  assert.equal(isSubmitting(1), false, "submit marker cleared on conclusive success");
  assert.equal(isVerifying(1), false);
  assert.equal(isRecovering(1), false);
  assert.equal(second.aborted, true, "terminal result aborts worker process");
  assert.equal(must(jobBrowsers[1], "job browser 1").ownsTarget("draft-tab"), false, "browser revoked on terminal result");

  // Scheduler and employer slot remain occupied until process exits
  scheduler.pump();
  assert.equal(workers.length, 2, "slot remains occupied until handle.done / process exit");
  assert.equal(scheduler.activeFillSession(1), true, "session remains until process exit");
  assert.equal(scheduler.fillSlot(1), null, "slot ownership revoked for inactive session");
  assert.equal(jobRow(2).status, "approved", "same-employer job cannot start while previous worker runs");

  // Stale callbacks while process is winding down cannot alter terminal status
  const staleSubmit = await call(second, "confirm_submit", { ...navigation, summary: "Stale attempt" });
  assert.match(staleSubmit, /ERROR: stale or parked fill worker/);
  const staleFail = await call(second, "report_result", { outcome: "failed", note: "Stale late failure" });
  assert.match(staleFail, /ERROR: stale or parked fill worker/);
  assert.equal(jobRow(1).status, "submitted");
  assert.equal(isSubmitting(1), false);

  // Worker process exits
  second.exit();
  scheduler.pump();
  await until(() => workers.length === 3);
  const third = workerAt(2);
  assert.equal(third.options.jobId, 2, "same-employer job starts only after process exit");
  assert.equal(scheduler.activeFillSession(1), false, "fill session freed after process exit");

  // Stale callbacks after successor has started cannot touch terminal job or successor
  const stalePostExit = await call(second, "report_result", { outcome: "closed", note: "Late callback" });
  assert.match(stalePostExit, /ERROR: stale or parked fill worker/);
  assert.equal(jobRow(1).status, "submitted");
  assert.equal(jobRow(2).status, "filling");

  // Tabs and frozen resume preserved
  assert.equal(simulatedTabs.has("draft-tab"), true, "tabs preserved");
  assert.equal(jobRow(1).resume_sha, initialSha, "frozen resume preserved");
  assert.equal(resume.frozenResume(1, initialSha).sha, initialSha);
  third.exit();
} else if (scenario === "terminal-closed") {
  const terminalReport = call(first, "report_result", { outcome: "closed", note: "Posting expired" });
  assert.equal(await terminalReport, "Recorded.");

  assert.equal(jobRow(1).status, "skipped");
  assert.equal(jobRow(1).note, "posting closed: Posting expired");
  assert.equal(core.getOpenGate(1), null);
  assert.equal(isSubmitting(1), false);
  assert.equal(first.aborted, true);
  assert.equal(must(jobBrowsers[0], "job browser 0").ownsTarget("draft-tab"), false, "browser revoked on closed report");

  // Slot remains held until process exit
  scheduler.pump();
  assert.equal(workers.length, 1);
  assert.equal(scheduler.activeFillSession(1), true);
  assert.equal(jobRow(2).status, "approved");

  const staleCall = await call(first, "report_result", { outcome: "submitted", note: "Late submitted" });
  assert.match(staleCall, /ERROR: stale or parked fill worker/);
  assert.equal(jobRow(1).status, "skipped");

  first.exit();
  scheduler.pump();
  await until(() => workers.length === 2);
  const second = workerAt(1);
  assert.equal(second.options.jobId, 2);
  assert.equal(scheduler.activeFillSession(1), false);
  second.exit();
} else if (scenario === "terminal-persistence-failure") {
  const summary = "Salary 100000; all fields checked";
  const parking = call(first, "confirm_submit", { ...navigation, summary });
  await until(() => core.getOpenGate(1) !== null);
  assert.equal(core.respond(1, "approve"), true);
  first.exit();
  await parking;
  await until(() => workers.length === 2);
  const second = workerAt(1);
  assert.match(await call(second, "confirm_submit", { ...navigation, summary }), /^APPROVED/);
  assert.equal(isSubmitting(1), true);

  db.query(
    "INSERT INTO question_gates (id, job_id, kind, group_key, match_key, employer, text, context, options, state, created_at) VALUES ('gate-persist-test', 1, 'manual', 'group-persist-test', 'match-persist-test', 'Employer 1', 'Inspect draft', 'Employer 1 / draft', '[]', 'open', datetime('now'))",
  ).run();
  assert.equal(core.getGate("gate-persist-test")?.state, "open");

  db.run("CREATE TRIGGER fail_jobs_update BEFORE UPDATE ON jobs BEGIN SELECT RAISE(ABORT, 'injected persistence failure'); END;");
  assert.throws(() => call(second, "report_result", { outcome: "submitted", note: "Should fail persistence" }), /injected persistence failure/);

  assert.equal(isSubmitting(1), true, "failed persistence must not clear submit marker");
  assert.equal(core.getGate("gate-persist-test")?.state, "open", "failed persistence must not drop durable gates");
  assert.equal(jobRow(1).status, "filling", "job status remains filling");
  assert.equal(second.aborted, false, "worker must not be aborted when persistence fails");

  db.run("DROP TRIGGER fail_jobs_update;");
  assert.equal(await call(second, "report_result", { outcome: "submitted", note: "Successful retry" }), "Recorded.");
  assert.equal(isSubmitting(1), false, "marker cleared upon successful persistence commit");
  assert.equal(core.getGate("gate-persist-test")?.state, "closed", "gates dropped upon successful persistence commit");
  assert.equal(jobRow(1).status, "submitted");
  assert.equal(second.aborted, true);
  second.exit();
} else {
  throw new Error(`Unknown fixture scenario: ${scenario}`);
}
process.exit(0);
