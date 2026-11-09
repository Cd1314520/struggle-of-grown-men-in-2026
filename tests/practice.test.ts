import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessPractice,
  DEFAULT_TARGETS,
  needsJudgment,
  parsePracticeAssessment,
  practiceReason,
  practiceRefusal,
  targetsKey,
  type PracticeAssessment,
} from "../src/practice";
import { evaluate, type Verdict } from "../src/rubric";
import { autoApproval, checkAutoApprovedPractice, confirmsSubmit, reconsiderAutoApproval } from "../src/auto";
import { config, PROFILE } from "../src/config";

const initialConfig = JSON.stringify(config);
const snapshot = () => JSON.parse(initialConfig) as Record<string, unknown>;

function restoreConfig() {
  const initial = snapshot();
  for (const key of Object.keys(config)) {
    if (!(key in initial)) {
      Reflect.deleteProperty(config, key);
    }
  }
  Object.assign(config, initial);
}

const fixtures: Record<string, string> = {
  "rubric.yml": readFileSync(join(import.meta.dir, "fixtures", "practice-rubric.yml"), "utf8"),
  "employers.yml": "frontier: [Stripe]\npractice: []\n",
};
const before = Object.fromEntries(Object.keys(fixtures).map(name => [name, readFileSync(join(PROFILE, name), "utf8")]));
beforeAll(() => {
  for (const [name, text] of Object.entries(fixtures)) writeFileSync(join(PROFILE, name), text);
});
afterAll(() => {
  for (const [name, text] of Object.entries(before)) writeFileSync(join(PROFILE, name), text);
});

beforeEach(restoreConfig);
afterEach(restoreConfig);
afterAll(restoreConfig);

const judged = (fields: Record<string, unknown> = {}) => ({
  target: "no",
  employerEvidence: "Regional insurer; internal claims tooling",
  agentNative: "unclear",
  agentNativeEvidence: "",
  ...fields,
});
const scaledTech = (fields: Record<string, unknown> = {}) =>
  judged({ target: "yes", employerEvidence: "Payments platform, thousands of engineers", ...fields });
const QUALIFIES: PracticeAssessment = {
  version: 4,
  target: "no",
  employerEvidence: "Regional insurer; internal claims tooling",
  agentNative: "unclear",
  agentNativeEvidence: "",
  listed: null,
  against: targetsKey(DEFAULT_TARGETS),
};
const KEPT: PracticeAssessment = { ...QUALIFIES, target: "yes", employerEvidence: "Payments platform, thousands of engineers" };

describe("practice assessment boundaries", () => {
  const CASES: [string, unknown, boolean][] = [
    ["an employer judged not a target qualifies", judged(), true],
    ["a non-target qualifies whatever its agent use", judged({ agentNative: "yes", agentNativeEvidence: "Internal agent platform" }), true],
    ["a target with unclear agent adoption does not", scaledTech(), false],
    ["an agent-native target does not", scaledTech({ agentNative: "yes", agentNativeEvidence: "Ships agents to customers" }), false],
    [
      "a target behind on agents does not: a rejection there follows the candidate across teams",
      scaledTech({ agentNative: "no", agentNativeEvidence: "Posting introduces Copilot as a new pilot" }),
      false,
    ],
    ["the frontier list overrides the judgment", judged({ listed: "frontier" }), false],
    ["the practice list overrides the judgment", scaledTech({ agentNative: "yes", agentNativeEvidence: "Agentic product", listed: "practice" }), true],
    ["a judgment without evidence fails closed", judged({ employerEvidence: "  " }), false],
    ["a target answer that is not yes or no fails closed", judged({ target: "maybe" }), false],
    ["an employer not judged against targets does not qualify", judged({ target: null }), false],
    ["an agent judgment without evidence fails closed", scaledTech({ agentNative: "no", agentNativeEvidence: "" }), false],
    ["an agent judgment that is not yes, no or unclear fails closed", judged({ agentNative: "maybe" }), false],
    ["an unknown list fails closed", judged({ listed: "favourites" }), false],
    ["non-object fails closed", "malformed", false],
  ];

  for (const [name, input, qualifies] of CASES) {
    it(name, () => {
      const assessed = assessPractice(input);
      const reason = practiceReason(assessed, true);
      expect(Boolean(reason)).toBe(qualifies);
    });
  }

  it("leaves the frontier list alone to decide when targets are not described", () => {
    expect(practiceReason(assessPractice(scaledTech({ target: null })), false)).toBe(
      "practice: not on your frontier list (Payments platform, thousands of engineers)",
    );
    expect(practiceReason(assessPractice(judged({ target: null, listed: "frontier" })), false)).toBeNull();
  });
});

describe("parsePracticeAssessment version gate", () => {
  const v3 = (fields: Record<string, unknown> = {}) => ({
    version: 3,
    employerType: "non_tech_enterprise",
    employerEvidence: "Regional insurer",
    agentNative: "unclear",
    agentNativeEvidence: "",
    listed: null,
    ...fields,
  });
  const PARSE_CASES: [string, string | null | undefined, boolean][] = [
    ["valid version 4 parses", JSON.stringify(KEPT), true],
    ["version 3 parses, its employer type read as a judgment against targets", JSON.stringify(v3()), true],
    [
      "version 1 parses, as not judged",
      JSON.stringify({ version: 1, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
      true,
    ],
    ["version 2 parses, as not judged", JSON.stringify({ version: 2, annualBaseMaxUsd: null, highEndTech: "no", highEndTechEvidence: "Insurer" }), true],
    ["missing version fails closed", JSON.stringify(judged()), false],
    ["old version 0 fails closed", JSON.stringify({ version: 0, ...judged() }), false],
    ["future version 5 fails closed", JSON.stringify({ ...KEPT, version: 5 }), false],
    ["version 3 with an unknown employer type fails closed", JSON.stringify(v3({ employerType: "nonprofit" })), false],
    ["version 3 without evidence fails closed", JSON.stringify(v3({ employerEvidence: " " })), false],
    ["malformed version 4 fails closed", JSON.stringify({ ...KEPT, target: "maybe" }), false],
    ["malformed json fails closed", "{ bad json", false],
    ["null input fails closed", null, false],
  ];

  for (const [name, serialized, valid] of PARSE_CASES) {
    it(name, () => {
      const parsed = parsePracticeAssessment(serialized);
      expect(Boolean(parsed)).toBe(valid);
    });
  }

  it("reads a version 3 tech company at scale as a target, judged against the default description", () => {
    expect(parsePracticeAssessment(JSON.stringify(v3({ employerType: "tech_scaled", employerEvidence: "Payments platform" })))).toEqual({
      version: 4,
      target: "yes",
      employerEvidence: "tech company at scale: Payments platform",
      agentNative: "unclear",
      agentNativeEvidence: "",
      listed: null,
      against: targetsKey(DEFAULT_TARGETS),
    });
    expect(parsePracticeAssessment(JSON.stringify(v3()))?.target).toBe("no");
  });
});

describe("why a job is or is not one for practice", () => {
  it("says what about the employer makes it practice", () => {
    expect(practiceReason(assessPractice(judged()), true)).toBe("practice: not a target employer (Regional insurer; internal claims tooling)");
  });

  it("says why a target is kept back", () => {
    expect(practiceRefusal(assessPractice(scaledTech()), true)).toBe("a target employer, kept for later (Payments platform, thousands of engineers)");
    expect(practiceRefusal(assessPractice(judged({ listed: "frontier" })), true)).toBe("the employer is on your frontier list");
  });

  it("reads an assessment from before version 3 as not judged, so the job is assessed again", () => {
    const old = parsePracticeAssessment(
      JSON.stringify({ version: 2, annualBaseMaxUsd: 65000, salaryEvidence: "$65k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
    );
    expect(practiceRefusal(old, true)).toBe("the employer has not been judged under the current practice rules");
    expect(needsJudgment(old, true)).toBe(true);
    expect(needsJudgment(assessPractice(judged()), true)).toBe(false);
    expect(needsJudgment(assessPractice(judged({ target: null })), true)).toBe(true);
    expect(needsJudgment(assessPractice(judged({ target: null })), false)).toBe(false);
    expect(needsJudgment(null, true)).toBe(false);
  });

  it("fingerprints a description by its words, not its spacing or case", () => {
    expect(targetsKey("  A Tech company\n at scale ")).toBe(targetsKey("a tech company at scale"));
    expect(targetsKey("a tech company at scale")).not.toBe(targetsKey("a developer tools company"));
    expect(targetsKey("   ")).toBe("");
  });
});

function answersList(overrides: Record<string, "yes" | "no" | "unclear"> = {}) {
  const keys = [
    "practice.us_employer",
    "practice.legit_paid",
    "practice.no_clearance",
    "practice.engineering_work",
    "practice.not_senior",
    "practice.not_internship",
    "practice.experience_fits",
    "practice.skills_overlap",
    "practice.coding_is_core",
    "practice.python",
    "practice.degree_fits",
    "practice.not_new_grad",
    "practice.not_ai_training",
    "practice.not_hardware",
    "practice.low_priority_setting",
    "real.employer_ok",
    "real.us_based",
    "real.no_clearance",
    "real.travel_ok",
    "real.not_senior",
    "real.not_internship",
    "real.not_new_grad",
    "real.not_ai_training",
    "real.not_hardware",
    "real.scale",
    "real.agent_native",
    "real.core_work",
    "real.experience_fits",
    "real.skills_overlap",
  ];
  return keys.map(id => ({ id, answer: overrides[id] ?? "yes", evidence: "quote" }));
}

describe("rubric evaluate", () => {
  it("applies on the practice rubric at an employer that is not a target", () => {
    config.targets.holdBack = true;
    const res = evaluate(answersList(), judged()) as Verdict;
    expect(res.decision).toBe("apply");
    expect(res.rubric).toBe("practice");
    expect(res.practice).not.toBeNull();
  });

  it("holds a target on the real rubric, whatever its practice fit", () => {
    config.targets.holdBack = true;
    const answers = answersList({ "practice.python": "no", "practice.coding_is_core": "no", "practice.skills_overlap": "no" });
    const res = evaluate(answers, scaledTech()) as Verdict;
    expect(res.decision).toBe("hold");
    expect(res.rubric).toBe("real");
    expect(res.reason).toMatch(/^not a practice job: .*; real score 100 \(threshold 65\)$/);
    expect(res.score).toBe(100);
  });

  it("applies to a target on the real rubric when nothing is held back", () => {
    config.targets.holdBack = false;
    const answers = answersList({ "practice.python": "no", "practice.coding_is_core": "no", "practice.skills_overlap": "no" });
    const res = evaluate(answers, scaledTech()) as Verdict;
    expect(res.decision).toBe("apply");
    expect(res.rubric).toBe("real");
    expect(res.score).toBe(100);
    expect(res.reason).toBe("a target employer, kept for later (Payments platform, thousands of engineers); real score 100 (threshold 65)");
    expect((evaluate(answersList(), judged()) as Verdict).rubric).toBe("practice");
  });

  it("skips a target the real rubric turns down", () => {
    config.targets.holdBack = true;
    const low = answersList({
      "real.scale": "no",
      "real.agent_native": "no",
      "real.core_work": "no",
      "real.experience_fits": "no",
      "real.skills_overlap": "no",
    });
    expect((evaluate(low, scaledTech()) as Verdict).reason).toBe("not a practice job, and real score 0 below threshold 65");
    const failed = evaluate(answersList({ "real.not_senior": "no" }), scaledTech()) as Verdict;
    expect(failed.decision).toBe("skip");
    expect(failed.reason).toBe("not a practice job, and failed real requirement: not_senior");
  });

  it("skips new-grad and AI-training roles whatever the employer", () => {
    for (const holdBack of [true, false]) {
      config.targets.holdBack = holdBack;
      expect((evaluate(answersList({ "practice.not_new_grad": "no" }), judged()) as Verdict).decision).toBe("skip");
      expect((evaluate(answersList({ "practice.not_ai_training": "no" }), judged()) as Verdict).decision).toBe("skip");
      expect((evaluate(answersList({ "real.not_new_grad": "no" }), scaledTech()) as Verdict).decision).toBe("skip");
      expect((evaluate(answersList({ "real.employer_ok": "no" }), scaledTech()) as Verdict).decision).toBe("skip");
    }
  });

  it("skips on qualification failure regardless of employer", () => {
    config.targets.holdBack = true;
    const answers = answersList({ "practice.engineering_work": "no" });
    const res = evaluate(answers, judged()) as Verdict;
    expect(res.decision).toBe("skip");
  });

  it("asks both rubrics whether or not targets are held back", () => {
    config.targets.holdBack = false;
    expect(
      evaluate(
        answersList().filter(a => a.id.startsWith("real.")),
        judged(),
      ),
    ).toMatch(/^missing answers for: practice\./);
  });
});

describe("autoApproval and submission safety", () => {
  it("autoApproval independently requires practiceReason in practice mode", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 60, perDay: 5 };

    const baseVerdict: Verdict = {
      decision: "apply",
      rubric: "practice",
      score: 80,
      threshold: 60,
      reason: "passed",
      items: [],
      practice: null,
    };
    expect(autoApproval(baseVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(false);

    const highSalaryVerdict: Verdict = {
      ...baseVerdict,
      practice: KEPT,
    };
    expect(autoApproval(highSalaryVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(false);

    const validVerdict: Verdict = {
      ...baseVerdict,
      practice: QUALIFIES,
    };
    expect(autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(true);

    const handPickedRes = autoApproval(validVerdict, { concerns: null, handPicked: true, approvedToday: 0 });
    expect(handPickedRes.approve).toBe(false);
    expect(handPickedRes.deferred).toBeUndefined();

    const capBlockedRes = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(capBlockedRes.approve).toBe(false);
    expect(capBlockedRes.deferred).toBe("daily_cap");

    expect(autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 0, employerHold: null }).approve).toBe(true);
    const employerRes = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 0, employerHold: "already applying to 1 other role" });
    expect(employerRes.approve).toBe(false);
    expect(employerRes.deferred).toBe("employer");
    expect(employerRes.note).toBe("needs your review: already applying to 1 other role");
  });

  it("confirmsSubmit fails closed for auto jobs that no longer prove practice while targets are held back", () => {
    config.approval = "auto";
    config.targets.holdBack = true;
    const validEvidence = JSON.stringify(QUALIFIES);

    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: null })).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: JSON.stringify({ version: 0 }) })).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: JSON.stringify(KEPT) })).toBe(true);

    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(false);

    config.targets.holdBack = false;
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: JSON.stringify(KEPT) })).toBe(false);

    config.approval = "gated";
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(true);
  });

  it("confirmsSubmit follows the approval mode for jobs the user approved", () => {
    config.approval = "gated";
    expect(confirmsSubmit({ approved_by: "user" })).toBe(true);
    config.approval = "auto";
    expect(confirmsSubmit({ approved_by: "user" })).toBe(false);
  });

  it("checkAutoApprovedPractice guards fill start before freeze or browser", () => {
    config.targets.holdBack = true;
    expect(checkAutoApprovedPractice({ approved_by: "user" }).ok).toBe(true);

    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: null }).ok).toBe(false);
    expect(
      checkAutoApprovedPractice({
        approved_by: "auto",
        practice_assessment: JSON.stringify(KEPT),
      }).ok,
    ).toBe(false);

    expect(
      checkAutoApprovedPractice({
        approved_by: "auto",
        practice_assessment: JSON.stringify(QUALIFIES),
      }).ok,
    ).toBe(true);

    const listed = checkAutoApprovedPractice({ approved_by: "auto", company: "Stripe, Inc.", practice_assessment: JSON.stringify(QUALIFIES) });
    expect(listed).toEqual({ ok: false, reason: "auto-approved, but not a practice job: the employer is on your frontier list" });
  });
});

describe("applications already under way when the rules asked for a judgment", () => {
  const unjudged = JSON.stringify({
    version: 1,
    annualBaseMaxUsd: null,
    salaryEvidence: "",
    mandatoryNonlocalOnsite: "yes",
    locationEvidence: "Onsite in Omaha",
  });
  const kept = JSON.stringify(KEPT);
  const sha = "a".repeat(64);

  it("may carry on filling, but never submit without the user", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged, resume_sha: sha }).ok).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: unjudged })).toBe(true);
  });

  it("are still stopped when not started, or when the employer settles it", () => {
    config.targets.holdBack = true;
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged, resume_sha: null }).ok).toBe(false);
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged }).ok).toBe(false);
    const stopped = checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: kept, resume_sha: sha });
    expect(stopped.ok).toBe(false);
    expect(stopped.reason).toBe("auto-approved, but not a practice job: a target employer, kept for later (Payments platform, thousands of engineers)");
  });
});

describe("autoApproval deferred 'daily_cap' contract", () => {
  it("returns deferred: 'daily_cap' ONLY when all other gates pass and daily quota denies", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 5, allowConcerns: false };

    const validVerdict: Verdict = {
      decision: "apply",
      rubric: "practice",
      score: 90,
      threshold: 60,
      reason: "passed",
      items: [],
      practice: QUALIFIES,
    };

    const underQuota = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 4 });
    expect(underQuota.approve).toBe(true);
    expect(underQuota.deferred).toBeUndefined();

    const atQuota = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(atQuota.approve).toBe(false);
    expect(atQuota.deferred).toBe("daily_cap");

    const lowScoreVerdict: Verdict = { ...validVerdict, score: 75 };
    const lowScoreRes = autoApproval(lowScoreVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(lowScoreRes.approve).toBe(false);
    expect(lowScoreRes.deferred).toBeUndefined();

    const skipVerdict: Verdict = { ...validVerdict, decision: "skip", reason: "failed required" };
    const skipRes = autoApproval(skipVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(skipRes.approve).toBe(false);
    expect(skipRes.deferred).toBeUndefined();

    const noPracticeVerdict: Verdict = {
      ...validVerdict,
      practice: KEPT,
    };
    const noPracticeRes = autoApproval(noPracticeVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(noPracticeRes.approve).toBe(false);
    expect(noPracticeRes.deferred).toBeUndefined();

    const unclearVerdict: Verdict = {
      ...validVerdict,
      items: [
        {
          key: "practice.us_employer",
          phase: "practice",
          label: "US Employer",
          statement: "Must be US employer",
          required: true,
          weight: 0,
          answer: "unclear",
          evidence: "",
          points: 0,
        },
      ],
    };
    const unclearRes = autoApproval(unclearVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(unclearRes.approve).toBe(false);
    expect(unclearRes.deferred).toBeUndefined();

    const settledByForm: Verdict = { ...unclearVerdict, items: unclearVerdict.items.map(i => ({ ...i, unclearOk: true })) };
    expect(autoApproval(settledByForm, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(true);

    const concernsRes = autoApproval(validVerdict, { concerns: "relocation required", handPicked: false, approvedToday: 5 });
    expect(concernsRes.approve).toBe(false);
    expect(concernsRes.deferred).toBeUndefined();

    const handPickedRes = autoApproval(validVerdict, { concerns: null, handPicked: true, approvedToday: 5 });
    expect(handPickedRes.approve).toBe(false);
    expect(handPickedRes.deferred).toBeUndefined();

    config.approval = "gated";
    const disabledRes = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(disabledRes.approve).toBe(false);
    expect(disabledRes.deferred).toBeUndefined();
  });
});

describe("reconsiderAutoApproval pure helper", () => {
  const validPracticeObj = QUALIFIES;
  const validPracticeJson = JSON.stringify(validPracticeObj);

  function validStoredChecklistArray(overrides: Record<string, "yes" | "no" | "unclear"> = {}) {
    return answersList(overrides).map(a => ({ key: a.id, answer: a.answer, evidence: a.evidence }));
  }

  it("defers when cap is hit, then approves upon daily cap reset (snapshot/restore)", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 5 };
    const job = {
      id: 101,
      status: "awaiting_approval" as const,
      checklist: JSON.stringify(validStoredChecklistArray()),
      practice_assessment: validPracticeJson,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
    };

    const capRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 });
    expect(capRes.approved).toBe(false);
    expect(capRes.approval.deferred).toBe("daily_cap");
    expect(capRes.verdict).not.toBeNull();
    expect(capRes.verdict?.score).toBeGreaterThanOrEqual(80);
    expect(capRes.verdict?.items.length).toBeGreaterThan(0);

    const resetRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 0 });
    expect(resetRes.approved).toBe(true);
    expect(resetRes.approval.approve).toBe(true);
    expect(resetRes.approval.deferred).toBeUndefined();
    expect(resetRes.reason).toBeNull();
    expect(resetRes.verdict?.decision).toBe("apply");
    expect(resetRes.verdict?.score).toBeGreaterThanOrEqual(80);
    expect(resetRes.verdict?.practice?.target).toBe("no");
  });

  it("approves when autoApply perDay limit is increased", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 5 };

    const job = {
      id: 102,
      status: "awaiting_approval" as const,
      checklist: JSON.stringify(validStoredChecklistArray()),
      practice_assessment: validPracticeJson,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
    };

    expect(reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 }).approved).toBe(false);

    config.autoApply.perDay = 50;
    const unblockedRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 });
    expect(unblockedRes.approved).toBe(true);
    expect(unblockedRes.approval.approve).toBe(true);
  });

  it("evaluates stored checklist mapping key->id from persisted JSON array", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const resKey = reconsiderAutoApproval(
      {
        status: "awaiting_approval",
        approved_by: null,
        resume_sha: null,
        resume_frozen_at: null,
        submitted_at: null,
        concerns: null,
        checklist: JSON.stringify(validStoredChecklistArray()),
        practice_assessment: validPracticeJson,
      },
      { handPicked: false, approvedToday: 0 },
    );
    expect(resKey.approved).toBe(true);

    const resId = reconsiderAutoApproval(
      {
        status: "awaiting_approval",
        approved_by: null,
        resume_sha: null,
        resume_frozen_at: null,
        submitted_at: null,
        concerns: null,
        checklist: JSON.stringify(answersList()),
        practice_assessment: validPracticeJson,
      },
      { handPicked: false, approvedToday: 0 },
    );
    expect(resId.approved).toBe(false);
  });

  it("fails closed on malformed checklist or missing answers", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    expect(reconsiderAutoApproval({ ...base, checklist: null }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...base, checklist: "{ not json" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...base, checklist: "[]" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(
      reconsiderAutoApproval({ ...base, checklist: JSON.stringify([{ id: "practice.us_employer" }]) }, { handPicked: false, approvedToday: 0 }).approved,
    ).toBe(false);
  });

  it("fails closed on stale qualifications (missing current rubric items)", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const partial = validStoredChecklistArray().slice(0, 5);
    const res = reconsiderAutoApproval(
      {
        status: "awaiting_approval",
        approved_by: null,
        resume_sha: null,
        resume_frozen_at: null,
        submitted_at: null,
        concerns: null,
        checklist: JSON.stringify(partial),
        practice_assessment: validPracticeJson,
      },
      { handPicked: false, approvedToday: 0 },
    );
    expect(res.approved).toBe(false);
  });

  it("fails closed on unknown required items (answer: unclear)", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const unclearAnswers = validStoredChecklistArray({ "practice.us_employer": "unclear" });
    const res = reconsiderAutoApproval(
      {
        status: "awaiting_approval",
        approved_by: null,
        resume_sha: null,
        resume_frozen_at: null,
        submitted_at: null,
        concerns: null,
        checklist: JSON.stringify(unclearAnswers),
        practice_assessment: validPracticeJson,
      },
      { handPicked: false, approvedToday: 0 },
    );
    expect(res.approved).toBe(false);
  });

  it("fails closed on low fit (score below auto-apply bar or failed required)", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    const failedRequired = validStoredChecklistArray({ "practice.us_employer": "no" });
    const resReq = reconsiderAutoApproval({ ...base, checklist: JSON.stringify(failedRequired) }, { handPicked: false, approvedToday: 0 });
    expect(resReq.approved).toBe(false);

    const lowScore = validStoredChecklistArray({
      "practice.coding_is_core": "no",
      "practice.python": "no",
      "practice.degree_fits": "no",
      "practice.low_priority_setting": "no",
      "practice.skills_overlap": "no",
      "practice.experience_fits": "no",
    });
    const resLow = reconsiderAutoApproval({ ...base, checklist: JSON.stringify(lowScore) }, { handPicked: false, approvedToday: 0 });
    expect(resLow.approved).toBe(false);
  });

  it("fails closed on malformed checklist: coerced array answer, key array, object evidence, and duplicate keys", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    const badAnswerList = validStoredChecklistArray();
    const arrayAnswerChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, answer: ["yes"] } : item)));
    const resArrayAnswer = reconsiderAutoApproval({ ...base, checklist: arrayAnswerChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resArrayAnswer.approved).toBe(false);

    const arrayKeyChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, key: ["practice.us_employer"] } : item)));
    const resArrayKey = reconsiderAutoApproval({ ...base, checklist: arrayKeyChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resArrayKey.approved).toBe(false);

    const objectEvidenceChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, evidence: { quote: "evidence text" } } : item)));
    const resObjectEvidence = reconsiderAutoApproval({ ...base, checklist: objectEvidenceChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resObjectEvidence.approved).toBe(false);

    const numberEvidenceChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, evidence: 123 } : item)));
    const resNumberEvidence = reconsiderAutoApproval({ ...base, checklist: numberEvidenceChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resNumberEvidence.approved).toBe(false);

    const duplicateKeyChecklist = JSON.stringify([...badAnswerList, { key: "practice.us_employer", answer: "yes", evidence: "duplicate item" }]);
    const resDuplicateKey = reconsiderAutoApproval({ ...base, checklist: duplicateKeyChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resDuplicateKey.approved).toBe(false);
  });

  it("fails closed on high salary and invalid practice assessment", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      checklist: JSON.stringify(validStoredChecklistArray()),
    };

    const highSalaryObj = KEPT;
    const resHigh = reconsiderAutoApproval({ ...base, practice_assessment: JSON.stringify(highSalaryObj) }, { handPicked: false, approvedToday: 0 });
    expect(resHigh.approved).toBe(false);

    const badVersion = { ...validPracticeObj, version: 5 };
    const resVer = reconsiderAutoApproval({ ...base, practice_assessment: JSON.stringify(badVersion) }, { handPicked: false, approvedToday: 0 });
    expect(resVer.approved).toBe(false);
  });

  it("protects handpicked, manual approvals, and frozen/submitted states", () => {
    config.targets.holdBack = true;
    config.approval = "auto";
    config.autoApply = { minScore: 80, perDay: 10 };

    const baseJob = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      checklist: JSON.stringify(validStoredChecklistArray()),
      practice_assessment: validPracticeJson,
    };

    expect(reconsiderAutoApproval(baseJob, { handPicked: true, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, approved_by: "user" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, approved_by: "auto" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, resume_sha: "frozen_sha" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, resume_frozen_at: "2026-10-10" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, status: "submitted" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, submitted_at: "2026-10-10" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, status: "held" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, status: "rejected" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
  });

  it("guards disabled autoApply", () => {
    config.targets.holdBack = true;
    config.approval = "gated";
    config.autoApply = { minScore: 80, perDay: 10 };

    const baseJob = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      checklist: JSON.stringify(validStoredChecklistArray()),
      practice_assessment: validPracticeJson,
    };

    const resDis = reconsiderAutoApproval(baseJob, { handPicked: false, approvedToday: 0 });
    expect(resDis.approved).toBe(false);
  });
});
