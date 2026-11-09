import { describe, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const prelude = `
import assert from "node:assert/strict";
import { db, getJob, kvGet, kvSet, updateJob, onChange } from ${JSON.stringify(join(import.meta.dir, "../src/db.ts"))};
import { authorizeSubmit, queueVerification, isSubmitting, isVerifying, isRecovering, manualLeaseGate } from ${JSON.stringify(join(import.meta.dir, "../src/fill-state.ts"))};
import { parkGate, getGate, getOpenGate, findStoredAnswer, answerGate, listQuestionGroups, resumeContext, consumeSubmitApproval, returnManualControl, cancelJobGates, manualLeases, reserveManualLease, releaseManualLease, queueRecovery, resolveAmbiguous, resolveAmbiguityWithEvidence, recordCheckpoint, readCheckpoint, queueQuestion, nextQueuedQuestion, clearQueuedQuestions, unfiledAnswers, markFiled } from ${JSON.stringify(join(import.meta.dir, "../src/questions.ts"))};
const prompt = { kind: "question", text: "May we contact your current employer?", context: "Employer contact consent; applies to this hiring process", options: ["Yes", "No"] };
const checkpoint = { version: 1, slot: 2, tabId: "draft-tab", url: "https://ats.example/draft/123", step: "contact consent", notes: "Inspect the existing draft", resumeSha: "frozen-sha", savedAt: "2026-10-10T01:00:00.000Z" };
function job(id, company = "Acme, Inc.", title = "Engineer") {
  db.query("INSERT INTO jobs (id,url,source,company,title,status,resume_sha,resume_frozen_at) VALUES (?,?,?,?,?,'filling','frozen-sha','2026-10-10T00:00:00Z')").run(id, "https://ats.example/jobs/" + id, "test", company, title);
}
`;
function scenario(first: string, restart?: string) {
  const dir = mkdtempSync(join(tmpdir(), "auto-apply-questions-"));
  try {
    for (const body of restart === undefined ? [first] : [first, restart]) {
      const child = Bun.spawnSync([process.execPath, "--eval", prelude + body + "\ndb.close();"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, AUTO_APPLY_DATA: dir, AUTO_APPLY_PROFILE: join(dir, "profile") },
        stdout: "pipe",
        stderr: "pipe",
      });
      if (child.exitCode !== 0)
        throw new Error(`Durable question scenario failed (${child.exitCode}):\n${child.stdout.toString()}\n${child.stderr.toString()}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("parked browser tabs", () => {
  it("keeps only the most recently parked pages, drops finished jobs' pages, and never gives up submission evidence", () => {
    scenario(`
    const { tabPlan } = await import(${JSON.stringify(join(import.meta.dir, "../src/fill.ts"))});
    const park = (id, status, savedAt, slot = 2) => { job(id); recordCheckpoint(id, { ...checkpoint, slot, tabId: "tab-" + id, savedAt }); updateJob(id, { status }); };
    park(1, "needs_input", "2026-10-10T01:00:00.000Z");
    park(2, "needs_input", "2026-10-10T03:00:00.000Z");
    park(3, "needs_manual", "2026-10-10T02:00:00.000Z");
    park(4, "submitted", "2026-10-10T04:00:00.000Z");
    park(5, "needs_manual", "2026-10-09T00:00:00.000Z"); authorizeSubmit(5);
    park(6, "approved", "2026-10-08T00:00:00.000Z");
    park(7, "needs_input", "2026-10-10T05:00:00.000Z", 3);
    park(8, "filling", "2026-10-10T06:00:00.000Z"); authorizeSubmit(8); updateJob(8, { status: "submitted" });
    const plan = tabPlan(2, 6, 2);
    assert.deepEqual([...plan.keep].sort(), ["tab-2", "tab-3", "tab-5", "tab-6"]);
    assert.deepEqual([...plan.closing].sort(), [["tab-1", 1], ["tab-4", null], ["tab-8", null]]);
    assert.deepEqual([...plan.others].sort(), ["tab-1", "tab-2", "tab-3", "tab-4", "tab-5", "tab-8"]);
    `);
  });
});

describe("durable questions", () => {
  it("lists the question whose posting opened most recently first, whenever it was asked", () => {
    scenario(`
    const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString();
    job(1, "Old Co"); job(2, "New Co"); job(3, "Middle Co");
    updateJob(1, { posted_at: daysAgo(40) });
    updateJob(3, { posted_at: daysAgo(3) });
    for (const id of [1, 2, 3]) parkGate(id, { ...prompt, text: "Question " + id }, null);
    assert.deepEqual(listQuestionGroups().map(g => g.jobs[0].company), ["New Co", "Middle Co", "Old Co"]);
    `);
  });
  it("groups only exact structured employer questions and isolates sensitive wording, choices, and context", () => {
    scenario(`
    job(1); job(2, "Acme, Inc.", "Analyst"); job(3, "Acme Inc");
    const a = parkGate(1, prompt, checkpoint), b = parkGate(2, prompt, null);
    const c = parkGate(3, prompt, null);
    assert.equal(a.groupKey, b.groupKey);
    assert.notEqual(a.groupKey, c.groupKey);
    for (const [id, changed] of [
      [4, { options: ["No", "Yes"] }],
      [5, { context: "Employer contact consent; applies to all future hiring processes" }],
      [6, { text: "May we contact your current employer!" }],
      [7, { text: "may we contact your current employer?" }],
      [8, { context: "" }],
      [9, { options: undefined }],
    ]) {
      job(id);
      assert.notEqual(parkGate(id, { ...prompt, ...changed }, null).groupKey, a.groupKey);
    }
    const group = listQuestionGroups().find(g => g.key === a.groupKey);
    assert.deepEqual(group.jobs.map(j => j.id).sort(), [1, 2]);
    for (const id of [8, 9]) assert.deepEqual(listQuestionGroups().find(g => g.jobs.some(j => j.id === id)).jobs.map(j => j.id), [id]);
    assert.equal(getJob(1).status, "needs_input");
    assert.equal(JSON.parse(getJob(1).pending).gateId, a.id);
  `);
  });

  it("keeps application answers local and available after pending is cleared", () => {
    scenario(`
    job(1); job(2);
    const a = parkGate(1, prompt, checkpoint), b = parkGate(2, prompt, null);
    assert.deepEqual(answerGate(a.id, "No", "application"), { jobIds: [1] });
    assert.equal(getJob(1).status, "approved");
    assert.equal(getOpenGate(2).id, b.id);
    updateJob(1, { pending: null });
    assert.equal(findStoredAnswer(1, prompt), "No");
    assert.equal(findStoredAnswer(2, prompt), null);
    assert.equal(findStoredAnswer(1, { ...prompt, options: undefined }), null);
    assert.equal(findStoredAnswer(1, { ...prompt, context: "" }), null);
    assert.deepEqual(resumeContext(1).answers, [{ kind: "question", question: prompt.text, context: prompt.context, options: prompt.options, answer: "No" }]);
    assert.deepEqual(readCheckpoint(1), checkpoint);
    assert.throws(() => answerGate(a.id, "Yes", "bank"), /stale|answered/);
    assert.equal(findStoredAnswer(2, prompt), null);
  `);
  });

  it("does not upgrade an answer with unknown choices into an explicit free-text answer", () => {
    scenario(`
    job(1);
    const incomplete = { kind: "question", text: "Recruiter code", context: "Exact code for this hiring process" };
    const first = parkGate(1, incomplete, checkpoint);
    answerGate(first.id, "private-code", "application");
    const complete = { ...incomplete, options: [] };
    assert.equal(findStoredAnswer(1, complete), null);
    updateJob(1, { status: "filling" });
    const unknownAgain = parkGate(1, incomplete, checkpoint);
    const explicitText = parkGate(1, complete, checkpoint);
    assert.notEqual(explicitText.id, unknownAgain.id);
    assert.notEqual(explicitText.groupKey, unknownAgain.groupKey);
    assert.equal(getGate(unknownAgain.id).state, "closed");
    assert.equal(getOpenGate(1).id, explicitText.id);
  `);
  });

  it("keeps an answer for the answer bank once, and answers only its exact group now", () => {
    scenario(`
    for (let id = 1; id <= 5; id++) job(id);
    const a = parkGate(1, prompt, checkpoint);
    parkGate(2, prompt, null);
    const changed = parkGate(3, { ...prompt, options: ["Yes", "No", "Ask later"] }, null);
    const unstructured = parkGate(4, { ...prompt, context: "" }, null);
    assert.deepEqual(answerGate(a.id, "No", "bank"), { jobIds: [1, 2] });
    assert.equal(getGate(a.id).scope, "bank");
    assert.equal(getOpenGate(3).id, changed.id);
    assert.equal(findStoredAnswer(5, prompt), null);
    assert.deepEqual(unfiledAnswers(10).map(k => [k.employer, k.title, k.question, k.options, k.answer]), [["Acme, Inc.", "Engineer", prompt.text, ["Yes", "No"], "No"]]);
    assert.deepEqual(answerGate(unstructured.id, "Yes", "bank"), { jobIds: [4] });
    assert.equal(unfiledAnswers(10).length, 2);
    markFiled(unfiledAnswers(10).map(k => k.id));
    assert.deepEqual(unfiledAnswers(10), []);
    assert.deepEqual(answerGate(changed.id, "Ask later", "application"), { jobIds: [3] });
    assert.deepEqual(unfiledAnswers(10), []);
  `);
  });

  it("asks a page's queued questions one after another before requeueing the application once", () => {
    scenario(`
    job(1);
    const second = { ...prompt, text: "Have you ever used a different name?", options: [] };
    const third = { ...prompt, text: "Are you able to work from our office three days a week?", options: ["Yes", "No"] };
    queueQuestion(1, prompt); queueQuestion(1, second); queueQuestion(1, third);
    assert.deepEqual(nextQueuedQuestion(1), prompt);
    const first = parkGate(1, nextQueuedQuestion(1), checkpoint);
    const asking = () => listQuestionGroups().flatMap(g => g.jobs).find(j => j.id === 1);
    assert.equal(asking().queuedAfter, 2);
    assert.equal(asking().askedAt, first.createdAt);
    assert.deepEqual(answerGate(first.id, "No", "application"), { jobIds: [1] });
    assert.equal(getJob(1).status, "needs_input");
    assert.equal(getOpenGate(1).text, second.text);
    assert.equal(asking().queuedAfter, 1);
    assert.deepEqual(readCheckpoint(1), checkpoint);
    answerGate(getOpenGate(1).id, "No", "application");
    assert.equal(getOpenGate(1).text, third.text);
    answerGate(getOpenGate(1).id, "Yes", "application");
    assert.equal(getJob(1).status, "approved");
    assert.equal(getOpenGate(1), null);
    assert.deepEqual(resumeContext(1).answers.map(a => a.answer), ["No", "No", "Yes"]);

    job(2);
    queueQuestion(2, prompt); queueQuestion(2, second);
    clearQueuedQuestions(2);
    const only = parkGate(2, prompt, checkpoint);
    answerGate(only.id, "Yes", "application");
    assert.equal(getJob(2).status, "approved");

    // A question asked without context has no answer to reuse elsewhere, but once answered here it is not asked again.
    job(3);
    const bare = { ...prompt, context: "" };
    queueQuestion(3, bare);
    const asked = parkGate(3, nextQueuedQuestion(3), checkpoint);
    answerGate(asked.id, "No", "application");
    assert.equal(getJob(3).status, "approved");
    assert.equal(getOpenGate(3), null);
  `);
  });

  it("rejects replaced, cancelled, and detached responses without double requeue", () => {
    scenario(`
    job(1);
    const old = parkGate(1, prompt, checkpoint);
    const current = parkGate(1, { ...prompt, context: "New hiring process" }, checkpoint);
    assert.equal(getGate(old.id).state, "closed");
    assert.throws(() => answerGate(old.id, "No", "application"), /stale/);
    updateJob(1, { pending: JSON.stringify({ version: 1, gateId: "not-current", state: "open" }) });
    assert.equal(getOpenGate(1), null);
    assert.deepEqual(listQuestionGroups(), []);
    assert.throws(() => answerGate(current.id, "No", "application"), /stale/);
    cancelJobGates(1);
    assert.equal(getGate(current.id).state, "closed");
    assert.equal(getJob(1).pending, null);
    assert.equal(findStoredAnswer(1, { ...prompt, context: "New hiring process" }), null);
  `);
  });

  it("rolls back answers, the answer kept for the bank, and requeues as one transaction", () => {
    scenario(`
    job(1); job(2);
    const a = parkGate(1, prompt, checkpoint), b = parkGate(2, prompt, null);
    const notifications = [];
    const unsubscribe = onChange(change => notifications.push(change));
    db.exec("CREATE TRIGGER fail_second_requeue BEFORE UPDATE OF status ON jobs WHEN NEW.id = 2 AND NEW.status = 'approved' BEGIN SELECT RAISE(ABORT, 'blocked requeue'); END");
    assert.throws(() => answerGate(a.id, "No", "bank"), /blocked requeue/);
    assert.equal(getOpenGate(1).id, a.id);
    assert.equal(getOpenGate(2).id, b.id);
    assert.equal(findStoredAnswer(1, prompt), null);
    assert.deepEqual(resumeContext(1).answers, []);
    assert.deepEqual(unfiledAnswers(10), []);
    assert.deepEqual(notifications, []);
    db.exec("DROP TRIGGER fail_second_requeue");
    assert.deepEqual(answerGate(a.id, "No", "bank"), { jobIds: [1, 2] });
    unsubscribe();
  `);
  });

  it("keeps final approval job-scoped, exact-summary, one-use, and invalidated by new answers", () => {
    scenario(`
    job(1); job(2);
    const confirmation = { kind: "confirm_submit", text: "Apply to Acme for Engineer with the frozen resume", context: "Final review", options: [] };
    const a = parkGate(1, confirmation, checkpoint), b = parkGate(2, confirmation, null);
    assert.notEqual(a.groupKey, b.groupKey);
    assert.throws(() => answerGate(a.id, "approve", "bank"), /answer bank/);
    answerGate(a.id, "approve", "application");
    assert.equal(isSubmitting(1), false);
    assert.equal(resumeContext(1).approvedSummary, confirmation.text);
    assert.equal(consumeSubmitApproval(1, "Apply  to Acme\\nfor Engineer with the frozen resume"), true);
    assert.equal(consumeSubmitApproval(1, confirmation.text), false);
    const mismatch = parkGate(1, confirmation, checkpoint);
    answerGate(mismatch.id, "approve", "application");
    assert.equal(consumeSubmitApproval(1, confirmation.text + " and a different letter"), false);
    assert.equal(consumeSubmitApproval(1, confirmation.text), false);
    const renewed = parkGate(1, confirmation, checkpoint);
    answerGate(renewed.id, "approve", "application");
    const question = parkGate(1, prompt, checkpoint);
    assert.equal(resumeContext(1).approvedSummary, null);
    answerGate(question.id, "No", "application");
    assert.equal(consumeSubmitApproval(1, confirmation.text), false);
    answerGate(b.id, "Revise the cover letter", "application");
    assert.deepEqual(resumeContext(2).changeRequests, ["Revise the cover letter"]);
    const letter = parkGate(2, { kind: "cover_letter", text: "Letter draft", context: "Acme Engineer", options: [] }, null);
    assert.throws(() => answerGate(letter.id, "Revised letter", "bank"), /answer bank/);
    answerGate(letter.id, "Revised letter", "application");
    assert.equal(findStoredAnswer(2, { kind: "cover_letter", text: "Letter draft", context: "Acme Engineer", options: [] }), "Revised letter");
    cancelJobGates(2);
    assert.deepEqual(resumeContext(2).changeRequests, []);
    assert.equal(findStoredAnswer(2, { kind: "cover_letter", text: "Letter draft", context: "Acme Engineer", options: [] }), "Revised letter");
  `);
  });

  it("preserves unused exact approval and scoped answers when manual control returns after restart", () => {
    scenario(
      `
    job(1);
    const question = parkGate(1, prompt, checkpoint);
    answerGate(question.id, "No", "bank");
    const confirmation = parkGate(1, { kind: "confirm_submit", text: "Exact final submission summary" }, checkpoint);
    answerGate(confirmation.id, "approve", "application");
    const manual = parkGate(1, { kind: "manual", text: "Inspect the browser before continuing" }, checkpoint);
    assert.deepEqual([...manualLeases()], []);
    assert.equal(resumeContext(1).approvedSummary, "Exact final submission summary");
  `,
      `
    const manual = getOpenGate(1);
    const before = resumeContext(1);
    assert.equal(returnManualControl(1, manual.id, "Draft inspected; ready to continue"), true);
    assert.equal(getGate(manual.id).state, "closed");
    assert.equal(getJob(1).status, "approved");
    assert.equal(getJob(1).pending, null);
    assert.equal(getJob(1).note, "Manual control returned: Draft inspected; ready to continue");
    assert.deepEqual(resumeContext(1), before);
    assert.equal(findStoredAnswer(1, prompt), "No");
    job(2);
    assert.equal(findStoredAnswer(2, prompt), null);
    assert.deepEqual(unfiledAnswers(10).map(k => k.answer), ["No"]);
    assert.equal(isSubmitting(1), false);
    assert.deepEqual([...manualLeases()], []);
    assert.equal(consumeSubmitApproval(1, "Exact final submission summary"), true);
    assert.equal(consumeSubmitApproval(1, "Exact final submission summary"), false);
    assert.equal(returnManualControl(1, manual.id, "Duplicate return"), false);
  `,
    );
  }, 15000);

  it("preserves pending confirmation change requests and application answers on manual return", () => {
    scenario(`
    job(1);
    const question = parkGate(1, prompt, checkpoint);
    answerGate(question.id, "No", "application");
    const confirmation = parkGate(1, { kind: "confirm_submit", text: "Final review summary" }, checkpoint);
    answerGate(confirmation.id, "Remove the optional cover letter before submission", "application");
    const manual = parkGate(1, { kind: "manual", text: "Complete interactive verification" }, checkpoint);
    const before = resumeContext(1);
    assert.equal(returnManualControl(1, manual.id, "   "), true);
    assert.equal(getJob(1).status, "approved");
    assert.equal(getJob(1).pending, null);
    assert.equal(getGate(confirmation.id).state, "answered");
    assert.deepEqual(resumeContext(1), before);
    assert.deepEqual(resumeContext(1).changeRequests, ["Remove the optional cover letter before submission"]);
    assert.equal(resumeContext(1).approvedSummary, null);
    assert.equal(findStoredAnswer(1, prompt), "No");
  `);
  });

  it("refuses stale, detached, wrong-job, and ambiguous manual returns without mutations or notifications", () => {
    scenario(`
    for (let id = 1; id <= 6; id++) job(id);
    const stale = parkGate(1, { kind: "manual", text: "Old browser handoff" }, checkpoint);
    const current = parkGate(1, { kind: "manual", text: "Current browser handoff" }, checkpoint);
    const wrongStatus = parkGate(2, { kind: "manual", text: "Browser handoff" }, checkpoint);
    updateJob(2, { status: "approved" });
    const detached = parkGate(3, { kind: "manual", text: "Browser handoff" }, checkpoint);
    updateJob(3, { pending: JSON.stringify({ version: 1, gateId: "another-gate", state: "open" }) });
    const marker = parkGate(4, { kind: "manual", text: "Browser handoff" }, checkpoint);
    authorizeSubmit(4);
    authorizeSubmit(5);
    const ambiguity = parkGate(5, { kind: "submission_ambiguous", text: "Inspect possible submission" }, checkpoint);
    const question = parkGate(6, prompt, checkpoint);
    assert.deepEqual([...manualLeases()], []);
    const notifications = [];
    const unsubscribe = onChange(change => notifications.push(change));
    for (const [id, gateId] of [[1, stale.id], [1, "missing-gate"], [2, wrongStatus.id], [3, detached.id], [4, marker.id], [5, ambiguity.id], [6, question.id], [6, current.id], [999, current.id]]) {
      const beforeJob = getJob(id), beforeGate = getGate(gateId);
      const beforeContext = beforeJob ? resumeContext(id) : null;
      const beforeMarker = isSubmitting(id);
      assert.equal(returnManualControl(id, gateId, "done"), false);
      assert.deepEqual(getJob(id), beforeJob);
      assert.deepEqual(getGate(gateId), beforeGate);
      assert.deepEqual(beforeJob ? resumeContext(id) : null, beforeContext);
      assert.equal(isSubmitting(id), beforeMarker);
    }
    assert.deepEqual(notifications, []);
    assert.equal(getOpenGate(1).id, current.id);
    assert.equal(returnManualControl(1, current.id, "done"), true);
    assert.deepEqual(notifications, [{ type: "job", jobId: 1 }]);
    const afterReturn = getJob(1);
    assert.equal(returnManualControl(1, current.id, "again"), false);
    assert.deepEqual(getJob(1), afterReturn);
    assert.deepEqual(notifications, [{ type: "job", jobId: 1 }]);
    assert.equal(getGate(marker.id).state, "open");
    assert.equal(getGate(ambiguity.id).state, "open");
    assert.equal(isSubmitting(4), true);
    assert.equal(isSubmitting(5), true);
    unsubscribe();
  `);
  });

  it("makes submit-marker ambiguity explicitly inspect-only", () => {
    scenario(`
    job(2); job(3);
    authorizeSubmit(2);
    updateJob(2, { status: "failed", note: "Interrupted after authorization" });
    updateJob(3, { status: "submitted", submitted_at: "2026-10-10T01:00:00Z" });
    authorizeSubmit(3);
    const ambiguous = parkGate(2, { kind: "submission_ambiguous", text: "Submission may have occurred. Inspect the existing application before resolving." }, checkpoint);
    assert.equal(getJob(2).status, "needs_manual");
    assert.equal(isSubmitting(2), true);
    assert.deepEqual([...manualLeases()], []);
    assert.equal(getOpenGate(2).id, ambiguous.id);
    assert.equal(getOpenGate(3), null);
    assert.throws(() => answerGate(ambiguous.id, "approve", "application"), /manual/);
    assert.throws(() => parkGate(2, prompt, null), /Submission|ambiguity/);
    assert.equal(consumeSubmitApproval(2, ambiguous.text), false);
    assert.throws(() => resolveAmbiguous(2, "submitted"), /confirmed-not-submitted/);
    resolveAmbiguous(2, "not_submitted");
    assert.equal(isSubmitting(2), false);
    assert.equal(getJob(2).status, "approved");
    assert.equal(getGate(ambiguous.id).state, "closed");
    assert.deepEqual([...manualLeases()], []);
    assert.throws(() => resolveAmbiguous(2, "not_submitted"), /No current/);
    cancelJobGates(3);
    assert.equal(isSubmitting(3), true);
  `);
  });

  it("requires explicit reservations for interactive gates and refuses frozen-resume checkpoint changes atomically", () => {
    scenario(`
    job(1); job(2); job(3);
    assert.throws(() => parkGate(1, { kind: "manual", text: "Complete CAPTCHA" }, null), /checkpoint/);
    assert.equal(getJob(1).status, "filling");
    const manual = parkGate(1, { kind: "manual", text: "Complete CAPTCHA" }, checkpoint);
    assert.deepEqual([...manualLeases()], []);
    assert.deepEqual(reserveManualLease(1, manual.id), checkpoint);
    parkGate(2, prompt, { ...checkpoint, slot: 1 });
    assert.deepEqual([...manualLeases()], [[2, 1]]);
    assert.throws(() => answerGate(manual.id, "Finished", "application"), /manual/);
    assert.throws(() => recordCheckpoint(1, { ...checkpoint, resumeSha: "replacement-sha" }), /immutable/);
    assert.deepEqual(readCheckpoint(1), checkpoint);
    assert.throws(() => parkGate(3, prompt, { ...checkpoint, resumeSha: "replacement-sha" }), /immutable/);
    assert.equal(getOpenGate(3), null);
    assert.equal(getJob(3).status, "filling");
    assert.equal(readCheckpoint(3), null);
    releaseManualLease(1, manual.id);
    assert.equal(getOpenGate(1).id, manual.id);
    assert.equal(JSON.parse(getJob(1).pending).gateId, manual.id);
    assert.equal(manualLeaseGate(1), null);
    assert.deepEqual([...manualLeases()], []);
    reserveManualLease(1, manual.id);
    assert.deepEqual([...manualLeases()], [[2, 1]]);
    cancelJobGates(1);
    assert.deepEqual([...manualLeases()], []);
  `);
  });
  it("allows same-slot handoffs until explicitly reserved, then clears reservations on replacement or close", () => {
    scenario(`
    job(1); job(2);
    const ambiguous = parkGate(1, { kind: "submission_ambiguous", text: "Inspect possible submission" }, checkpoint);
    authorizeSubmit(1);
    const manual = parkGate(2, { kind: "manual", text: "Complete browser verification" }, checkpoint);
    assert.deepEqual([...manualLeases()], []);
    reserveManualLease(1, ambiguous.id);
    assert.deepEqual([...manualLeases()], [[2, 1]]);
    assert.throws(() => reserveManualLease(2, manual.id));
    releaseManualLease(1, ambiguous.id);
    assert.equal(getOpenGate(1).id, ambiguous.id);
    assert.equal(isSubmitting(1), true);
    assert.deepEqual([...manualLeases()], []);
    reserveManualLease(2, manual.id);
    assert.deepEqual([...manualLeases()], [[2, 2]]);
    const replacement = parkGate(2, { kind: "manual", text: "Replacement browser verification" }, checkpoint);
    assert.equal(getGate(manual.id).state, "closed");
    assert.equal(getOpenGate(2).id, replacement.id);
    assert.deepEqual([...manualLeases()], []);
    reserveManualLease(1, ambiguous.id);
    assert.deepEqual([...manualLeases()], [[2, 1]]);
    resolveAmbiguous(1, "not_submitted");
    assert.equal(getGate(ambiguous.id).state, "closed");
    assert.equal(isSubmitting(1), false);
    assert.deepEqual([...manualLeases()], []);
  `);
  });

  it("settles an unclear submission as sent when the employer's receipt arrives, and only that kind of hand-off", () => {
    scenario(`
    const { confirmSubmittedByMail, unconfirmedSubmissions } = await import(${JSON.stringify(join(import.meta.dir, "../src/questions.ts"))});
    job(1, "Shield AI", "EE Intern"); job(2); job(3);
    parkGate(1, { kind: "submission_ambiguous", text: "Captcha; inspect before resolving" }, checkpoint);
    authorizeSubmit(1);
    parkGate(2, { kind: "manual", text: "Sign in by hand" }, checkpoint);
    assert.deepEqual(unconfirmedSubmissions().map(j => j.id), [1]);
    assert.throws(() => confirmSubmittedByMail(2, "m2", "receipt"), /no unclear submission/);
    assert.throws(() => confirmSubmittedByMail(3, "m3", "receipt"), /being worked on/);
    assert.throws(() => confirmSubmittedByMail(1, " ", "receipt"), /message_id/);
    confirmSubmittedByMail(1, "m1", "Lever receipt from Shield AI");
    const done = getJob(1);
    assert.equal(done.status, "submitted");
    assert.match(done.note, /Lever receipt from Shield AI \\[confirmation email msg=m1\\]/);
    assert.equal(getOpenGate(1), null);
    assert.equal(isSubmitting(1), false);
    assert.deepEqual(unconfirmedSubmissions(), []);
    assert.throws(() => confirmSubmittedByMail(1, "m1", "again"), /already settled/);
  `);
  });

  it("reopens the database with queued answers, explicit reservations, and frozen checkpoints intact", () => {
    scenario(
      `
    job(1); job(2); job(3); job(4); job(5); job(6);
    const answered = parkGate(1, prompt, checkpoint);
    answerGate(answered.id, "No", "bank");
    parkGate(2, { ...prompt, context: "Separate consent" }, { ...checkpoint, slot: 4 });
    const final = parkGate(3, { kind: "confirm_submit", text: "Final exact summary" }, checkpoint);
    answerGate(final.id, "approve", "application");
    updateJob(1, { pending: null });
    parkGate(4, { kind: "manual", text: "Inspect the existing draft" }, checkpoint);
    parkGate(5, { kind: "submission_ambiguous", text: "Inspect possible submission" }, checkpoint);
    authorizeSubmit(5);
    assert.deepEqual([...manualLeases()], []);
    const reserved = parkGate(6, { kind: "manual", text: "Complete browser verification" }, checkpoint);
    reserveManualLease(6, reserved.id);
    assert.deepEqual([...manualLeases()], [[2, 6]]);
  `,
      `
    assert.equal(getJob(1).status, "approved");
    assert.equal(findStoredAnswer(1, prompt), "No");
    assert.deepEqual(readCheckpoint(1), checkpoint);
    assert.equal(resumeContext(1).answers[0].answer, "No");
    assert.equal(getOpenGate(2).context, "Separate consent");
    assert.equal(getJob(2).status, "needs_input");
    assert.equal(readCheckpoint(2).slot, 4);
    const group = listQuestionGroups().find(g => g.jobs.some(j => j.id === 2));
    assert.equal(group.key, getOpenGate(2).groupKey);
    job(7);
    assert.equal(findStoredAnswer(7, prompt), null);
    assert.deepEqual(unfiledAnswers(10).map(k => k.answer), ["No"]);
    assert.equal(resumeContext(3).approvedSummary, "Final exact summary");
    assert.equal(consumeSubmitApproval(3, "Final exact summary"), true);
    assert.equal(consumeSubmitApproval(3, "Final exact summary"), false);
    assert.equal(getJob(3).resume_sha, "frozen-sha");
    assert.equal(getOpenGate(4).kind, "manual");
    assert.equal(getOpenGate(5).kind, "submission_ambiguous");
    assert.equal(isSubmitting(5), true);
    assert.deepEqual([...manualLeases()], [[2, 6]]);
    assert.equal(manualLeaseGate(6), getOpenGate(6).id);
  `,
    );
  }, 15000);

  it("queues manual and ambiguous recovery safely while enforcing guards and preserving evidence", () => {
    scenario(`
    job(1); job(2); job(3);
    recordCheckpoint(1, checkpoint);
    recordCheckpoint(2, checkpoint);

    assert.throws(() => queueRecovery(999, "nonexistent"));
    const qGate = parkGate(3, prompt, checkpoint);
    assert.throws(() => queueRecovery(3, qGate.id));
    cancelJobGates(3);

    const mGate = parkGate(1, { kind: "manual", text: "Cloudflare CAPTCHA blocked navigation", context: "Site maintenance outage" }, checkpoint);
    assert.deepEqual([...manualLeases()], []);
    assert.throws(() => queueRecovery(1, "stale-gate-id"));

    const mRec = queueRecovery(1, mGate.id);
    assert.equal(mRec.mode, "fill");
    assert.equal(mRec.slot, checkpoint.slot);
    assert.equal(getOpenGate(1), null);
    assert.equal(getGate(mGate.id).state, "closed");
    assert.equal(getJob(1).status, "approved");
    assert.equal(getJob(1).note, "Cloudflare CAPTCHA blocked navigation");
    assert.equal(isRecovering(1), true);
    assert.deepEqual([...manualLeases()], []);

    const aGate = parkGate(2, { kind: "submission_ambiguous", text: "Final submission timed out", context: "Network dropped during submit" }, checkpoint);
    authorizeSubmit(2);
    assert.deepEqual([...manualLeases()], []);
    const aRec = queueRecovery(2, aGate.id);
    assert.equal(aRec.mode, "verify");
    assert.equal(aRec.slot, checkpoint.slot);
    assert.equal(getOpenGate(2), null);
    assert.equal(getGate(aGate.id).state, "closed");
    assert.equal(getJob(2).status, "needs_manual");
    assert.equal(isSubmitting(2), true);
    assert.equal(isVerifying(2), true);
    assert.equal(isRecovering(2), true);
    assert.deepEqual([...manualLeases()], []);
  `);
  });

  it("enforces typed evidence validation and resolves submission ambiguity safely", () => {
    scenario(`
    job(1);
    recordCheckpoint(1, checkpoint);
    queueVerification(1);
    updateJob(1, { status: "filling" });

    const badEvidence = { notes: "", requisitionId: "", source: "portal", status: "submitted", checkpoint };
    assert.throws(() => resolveAmbiguityWithEvidence(1, "submitted", badEvidence));
    assert.throws(() => resolveAmbiguityWithEvidence(1, "submitted", { ...badEvidence, notes: "Valid notes" }));

    assert.throws(() => resolveAmbiguityWithEvidence(1, "submitted", {
      notes: "Valid notes", requisitionId: "REQ-100", source: "portal", status: "not_submitted", checkpoint
    }));

    assert.throws(() => resolveAmbiguityWithEvidence(1, "not_submitted", {
      notes: "Valid notes", requisitionId: "REQ-100", source: "portal", status: "submitted", checkpoint
    }));

    resolveAmbiguityWithEvidence(1, "not_submitted", {
      notes: "Draft application active on portal",
      requisitionId: "REQ-100",
      source: "portal",
      status: "draft",
      checkpoint,
    });

    assert.equal(getJob(1).status, "approved");
    assert.match(getJob(1).note, /Draft application active on portal/);
    assert.match(getJob(1).note, /req=REQ-100/);
    assert.equal(isSubmitting(1), false);
    assert.equal(isVerifying(1), false);
    assert.equal(isRecovering(1), true);

    job(2);
    recordCheckpoint(2, checkpoint);
    queueVerification(2);
    updateJob(2, { status: "filling" });

    resolveAmbiguityWithEvidence(2, "submitted", {
      notes: "Confirmed submission on portal",
      requisitionId: "REQ-200",
      source: "portal",
      status: "submitted",
      checkpoint,
    });

    assert.equal(getJob(2).status, "submitted");
    assert.notEqual(getJob(2).submitted_at, null);
    assert.match(getJob(2).note, /Confirmed submission on portal/);
    assert.match(getJob(2).note, /req=REQ-200/);
    assert.equal(isSubmitting(2), false);
    assert.equal(isVerifying(2), false);
    assert.equal(isRecovering(2), false);
  `);
  });

  it("includes bounded handoff history in resumeContext preserving root failure and newest context", () => {
    scenario(`
    job(1);
    recordCheckpoint(1, checkpoint);

    parkGate(1, prompt, checkpoint);
    cancelJobGates(1);
    assert.deepEqual(resumeContext(1).handoffHistory, []);

    const g1 = parkGate(1, { kind: "manual", text: "Workday outage HTTP 302 before account", context: "No account created" }, checkpoint);
    cancelJobGates(1);

    const g2 = parkGate(1, { kind: "manual", text: "Intermediate attempt 2", context: "Do not create account" }, checkpoint);
    cancelJobGates(1);

    const g3 = parkGate(1, { kind: "manual", text: "Intermediate attempt 3", context: "Wait for human" }, checkpoint);
    cancelJobGates(1);

    const g4 = parkGate(1, { kind: "manual", text: "Intermediate attempt 4", context: "Session expired" }, checkpoint);
    cancelJobGates(1);

    const g5 = parkGate(1, { kind: "manual", text: "Intermediate attempt 5", context: "Retry login" }, checkpoint);
    cancelJobGates(1);

    const g6 = parkGate(1, { kind: "submission_ambiguous", text: "Final submission timed out", context: "Inspect exact application" }, checkpoint);
    cancelJobGates(1);

    const g7 = parkGate(1, { kind: "manual", text: "Latest status check failed", context: "Check candidate home" }, checkpoint);

    const ctx = resumeContext(1);
    assert.equal(ctx.handoffHistory.length, 6, "strictly bounded to 6 records");
    assert.equal(ctx.handoffHistory[0].text, "Workday outage HTTP 302 before account");
    assert.equal(ctx.handoffHistory[0].context, "No account created");
    assert.equal(ctx.handoffHistory[0].kind, "manual");
    assert.equal(ctx.handoffHistory[1].text, "Intermediate attempt 2");
    assert.equal(ctx.handoffHistory[2].text, "Intermediate attempt 4");
    assert.equal(ctx.handoffHistory[3].text, "Intermediate attempt 5");
    assert.equal(ctx.handoffHistory[4].text, "Final submission timed out");
    assert.equal(ctx.handoffHistory[4].kind, "submission_ambiguous");
    assert.equal(ctx.handoffHistory[5].text, "Latest status check failed");
  `);
  });
});
