import { afterAll, afterEach, beforeEach, describe, expect, it } from "bun:test";
import { assessPractice, needsJudgment, parsePracticeAssessment, practiceReason, practiceRefusal } from "../src/practice";
import { evaluate, type Verdict } from "../src/rubric";
import { autoApproval, checkAutoApprovedPractice, confirmsSubmit, reconsiderAutoApproval } from "../src/auto";
import { config } from "../src/config";

// Snapshot config for clean restoration
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

beforeEach(restoreConfig);
afterEach(restoreConfig);
afterAll(restoreConfig);

describe("practice assessment boundaries", () => {
  const away = { annualBaseMaxUsd: null, salaryEvidence: "", mandatoryNonlocalOnsite: "yes", locationEvidence: "Onsite in Seattle five days a week" };
  const CASES: [string, unknown, boolean][] = [
    ["<= 80k inclusive qualifies", { annualBaseMaxUsd: 80000, salaryEvidence: "$80k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, true],
    ["> 80k crossing does not qualify", { annualBaseMaxUsd: 80001, salaryEvidence: "$80,001", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, false],
    ["unknown salary + local does not qualify", { annualBaseMaxUsd: null, salaryEvidence: "", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, false],
    // Attendance elsewhere only makes a practice job of one that is not worth keeping for later.
    [
      "nonlocal onsite, pay not posted, ordinary work qualifies",
      { ...away, highEndTech: "no", highEndTechEvidence: "Insurer's internal claims tooling" },
      true,
    ],
    [
      "nonlocal onsite, pay not posted, high-end tech does not",
      { ...away, highEndTech: "yes", highEndTechEvidence: "Autonomy company, distributed simulation platform" },
      false,
    ],
    ["nonlocal onsite, pay not posted, not judged does not", away, false],
    ["nonlocal onsite at the $100k ceiling qualifies", { ...away, annualBaseMaxUsd: 100000, salaryEvidence: "$85,000 - $100,000" }, true],
    ["nonlocal onsite just above the ceiling does not", { ...away, annualBaseMaxUsd: 100001, salaryEvidence: "up to $100,001" }, false],
    [
      "nonlocal onsite well above the ceiling does not, whatever the work",
      { ...away, annualBaseMaxUsd: 197000, salaryEvidence: "$153k - $197k", highEndTech: "no", highEndTechEvidence: "said to be routine" },
      false,
    ],
    [
      "posted pay under the ceiling decides it even at a high-end tech company",
      { ...away, annualBaseMaxUsd: 95000, salaryEvidence: "$95,000", highEndTech: "yes", highEndTechEvidence: "Robotics company" },
      true,
    ],
    [
      "between $80k and $100k without mandatory attendance does not",
      { annualBaseMaxUsd: 90000, salaryEvidence: "$90k", mandatoryNonlocalOnsite: "no", locationEvidence: "" },
      false,
    ],
    [
      "<= 80k qualifies wherever the job is and whatever the work",
      { ...away, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", highEndTech: "yes", highEndTechEvidence: "Tech company" },
      true,
    ],
    ["a judgment without its evidence fails closed", { ...away, highEndTech: "no", highEndTechEvidence: "  " }, false],
    ["a judgment that is neither yes nor no fails closed", { ...away, highEndTech: "unclear", highEndTechEvidence: "hard to say" }, false],
    [
      "nonlocal unclear does not qualify",
      { annualBaseMaxUsd: null, salaryEvidence: "", mandatoryNonlocalOnsite: "unclear", locationEvidence: "Hybrid" },
      false,
    ],
    ["zero salary fails closed", { annualBaseMaxUsd: 0, salaryEvidence: "$0", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, false],
    ["negative salary fails closed", { annualBaseMaxUsd: -1000, salaryEvidence: "-1k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, false],
    ["missing salary evidence fails closed", { annualBaseMaxUsd: 50000, salaryEvidence: "   ", mandatoryNonlocalOnsite: "no", locationEvidence: "" }, false],
    [
      "nonlocal yes with empty evidence fails closed",
      { annualBaseMaxUsd: null, salaryEvidence: "", mandatoryNonlocalOnsite: "yes", locationEvidence: "   " },
      false,
    ],
    ["non-object fails closed", "malformed", false],
  ];

  for (const [name, input, qualifies] of CASES) {
    it(name, () => {
      const assessed = assessPractice(input);
      const reason = practiceReason(assessed);
      expect(Boolean(reason)).toBe(qualifies);
    });
  }
});

describe("parsePracticeAssessment version gate", () => {
  const PARSE_CASES: [string, string | null | undefined, boolean][] = [
    [
      "valid version 1 parses",
      JSON.stringify({ version: 1, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
      true,
    ],
    [
      "missing version fails closed",
      JSON.stringify({ annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
      false,
    ],
    [
      "old version 0 fails closed",
      JSON.stringify({ version: 0, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
      false,
    ],
    [
      "valid version 2 parses",
      JSON.stringify({
        version: 2,
        annualBaseMaxUsd: null,
        salaryEvidence: "",
        mandatoryNonlocalOnsite: "yes",
        locationEvidence: "Onsite in Omaha",
        highEndTech: "no",
        highEndTechEvidence: "Insurer, internal reporting",
      }),
      true,
    ],
    [
      "future version 3 fails closed",
      JSON.stringify({ version: 3, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }),
      false,
    ],
    ["malformed json fails closed", "{ bad json", false],
    ["null input fails closed", null, false],
  ];

  for (const [name, serialized, valid] of PARSE_CASES) {
    it(name, () => {
      const parsed = parsePracticeAssessment(serialized);
      expect(Boolean(parsed)).toBe(valid);
    });
  }
});

describe("why a job is or is not one for practice", () => {
  const stored = (fields: Record<string, unknown>) =>
    parsePracticeAssessment(
      JSON.stringify({
        version: 1,
        annualBaseMaxUsd: null,
        salaryEvidence: "",
        mandatoryNonlocalOnsite: "yes",
        locationEvidence: "Onsite in Denver",
        ...fields,
      }),
    );

  it("says which limit a well-paid onsite job is over", () => {
    const assessment = stored({ annualBaseMaxUsd: 197000, salaryEvidence: "$153k - $197k" });
    expect(practiceReason(assessment)).toBeNull();
    expect(practiceRefusal(assessment)).toBe("posted base ceiling $197,000 is above the $100,000 practice limit");
  });

  it("reads an assessment from before version 2 as not judged, and decides it by pay where pay is posted", () => {
    expect(practiceRefusal(stored({}))).toBe("pay is not posted and the company and work have not been judged yet");
    expect(needsJudgment(stored({}))).toBe(true);
    expect(practiceReason(stored({ annualBaseMaxUsd: 90000, salaryEvidence: "$90k" }))).toBe(
      "practice: mandatory nonlocal onsite/hybrid with posted base ceiling $90,000 <= $100,000",
    );
    expect(practiceReason(stored({ annualBaseMaxUsd: 65000, salaryEvidence: "$65k", mandatoryNonlocalOnsite: "no", locationEvidence: "" }))).toBe(
      "practice: posted base ceiling $65,000 <= $80,000",
    );
    // Only a missing judgment sends a job back for assessment; a posted ceiling settles it either way.
    expect(needsJudgment(stored({ annualBaseMaxUsd: 197000, salaryEvidence: "$197k" }))).toBe(false);
    expect(needsJudgment(stored({ mandatoryNonlocalOnsite: "no", locationEvidence: "" }))).toBe(false);
    expect(needsJudgment(null)).toBe(false);
  });

  it("quotes the judgment when it is what keeps a job out", () => {
    const assessment = stored({ version: 2, highEndTech: "yes", highEndTechEvidence: "Autonomy company; distributed simulation at scale" });
    expect(practiceRefusal(assessment)).toBe("pay is not posted and this is high-end tech work (Autonomy company; distributed simulation at scale)");
    expect(practiceReason(stored({ version: 2, highEndTech: "no", highEndTechEvidence: "Insurer, internal tools" }))).toBe(
      "practice: mandatory nonlocal onsite/hybrid; pay not posted, and not high-end tech work",
    );
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
    "practice.low_priority_setting",
    "real.location_ok",
    "real.no_clearance",
    "real.pay_floor",
    "real.travel_ok",
    "real.not_senior",
    "real.not_internship",
    "real.ai_core",
    "real.experience_fits",
    "real.skills_overlap",
    "real.llm_explicit",
    "real.python",
    "real.pay_target",
  ];
  return keys.map(id => ({ id, answer: overrides[id] ?? "yes", evidence: "quote" }));
}

describe("rubric evaluate", () => {
  it("applies when practice qualifications pass and salary <= 80k", () => {
    config.phase = "practice";
    const res = evaluate(answersList(), {
      annualBaseMaxUsd: 75000,
      salaryEvidence: "$75k",
      mandatoryNonlocalOnsite: "no",
      locationEvidence: "",
    }) as Verdict;
    expect(res.decision).toBe("apply");
    expect(res.practice).not.toBeNull();
  });

  it("holds desirable high salary even when real score is low", () => {
    config.phase = "practice";
    // Zero out real weighted criteria so real score is 0
    const answers = answersList({
      "real.ai_core": "no",
      "real.experience_fits": "no",
      "real.skills_overlap": "no",
      "real.llm_explicit": "no",
      "real.python": "no",
      "real.pay_target": "no",
    });
    const res = evaluate(answers, {
      annualBaseMaxUsd: 150000,
      salaryEvidence: "$150k",
      mandatoryNonlocalOnsite: "no",
      locationEvidence: "",
    }) as Verdict;
    expect(res.decision).toBe("hold");
  });

  it("skips on qualification failure regardless of salary", () => {
    config.phase = "practice";
    const answers = answersList({ "practice.engineering_work": "no" });
    const res = evaluate(answers, {
      annualBaseMaxUsd: 50000,
      salaryEvidence: "$50k",
      mandatoryNonlocalOnsite: "no",
      locationEvidence: "",
    }) as Verdict;
    expect(res.decision).toBe("skip");
  });

  it("leaves real phase behavior unchanged with practice: null", () => {
    config.phase = "real";
    const res = evaluate(answersList(), {
      annualBaseMaxUsd: 70000,
      salaryEvidence: "$70k",
      mandatoryNonlocalOnsite: "no",
      locationEvidence: "",
    }) as Verdict;
    expect(res.decision).toBe("apply");
    expect(res.practice).toBeNull();
  });
});

describe("autoApproval and submission safety", () => {
  it("autoApproval independently requires practiceReason in practice mode", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 60, perDay: 5 };

    const baseVerdict: Verdict = {
      decision: "apply",
      score: 80,
      threshold: 60,
      reason: "passed",
      items: [],
      practice: null,
    };
    // Missing practice facts -> denied
    expect(autoApproval(baseVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(false);

    // High salary facts -> denied
    const highSalaryVerdict: Verdict = {
      ...baseVerdict,
      practice: {
        version: 2,
        annualBaseMaxUsd: 150000,
        salaryEvidence: "$150k",
        mandatoryNonlocalOnsite: "no",
        locationEvidence: "",
        highEndTech: null,
        highEndTechEvidence: "",
      },
    };
    expect(autoApproval(highSalaryVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(false);

    // Valid practice facts -> approved
    const validVerdict: Verdict = {
      ...baseVerdict,
      practice: {
        version: 2,
        annualBaseMaxUsd: 75000,
        salaryEvidence: "$75k",
        mandatoryNonlocalOnsite: "no",
        locationEvidence: "",
        highEndTech: null,
        highEndTechEvidence: "",
      },
    };
    expect(autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 0 }).approve).toBe(true);

    // Gated caps: handPicked and daily limits
    const handPickedRes = autoApproval(validVerdict, { concerns: null, handPicked: true, approvedToday: 0 });
    expect(handPickedRes.approve).toBe(false);
    expect(handPickedRes.deferred).toBeUndefined();

    const capBlockedRes = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(capBlockedRes.approve).toBe(false);
    expect(capBlockedRes.deferred).toBe("daily_cap");
  });

  it("confirmsSubmit fails closed for auto jobs even when confirmBeforeSubmit is false", () => {
    config.confirmBeforeSubmit = false;
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], submit: true };
    const validEvidence = JSON.stringify({ version: 1, annualBaseMaxUsd: 70000, salaryEvidence: "$70k", mandatoryNonlocalOnsite: "no", locationEvidence: "" });

    // Missing or invalid evidence -> fails closed (true)
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: null })).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: JSON.stringify({ version: 0 }) })).toBe(true);
    expect(
      confirmsSubmit({
        approved_by: "auto",
        practice_assessment: JSON.stringify({
          version: 1,
          annualBaseMaxUsd: 120000,
          salaryEvidence: "$120k",
          mandatoryNonlocalOnsite: "no",
          locationEvidence: "",
        }),
      }),
    ).toBe(true);

    // Phase mismatch with confirmBeforeSubmit=false -> fails closed (true) even with valid evidence
    config.phase = "real";
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: null })).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(true);

    // Disabled submit rule with confirmBeforeSubmit=false -> fails closed (true)
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], submit: false };
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(true);

    // Disabled autoApply entirely with confirmBeforeSubmit=false -> fails closed (true)
    config.autoApply = { enabled: false, phases: ["practice"], submit: true };
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(true);

    // Fully qualifying auto job -> skips confirmation (false)
    config.autoApply = { enabled: true, phases: ["practice"], submit: true };
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: validEvidence })).toBe(false);
  });

  it("confirmsSubmit preserves global semantics for manual approvals", () => {
    config.confirmBeforeSubmit = true;
    expect(confirmsSubmit({ approved_by: "user" })).toBe(true);
    config.confirmBeforeSubmit = false;
    expect(confirmsSubmit({ approved_by: "user" })).toBe(false);
  });

  it("checkAutoApprovedPractice guards fill start before freeze or browser", () => {
    config.phase = "practice";
    // Manual job always passes
    expect(checkAutoApprovedPractice({ approved_by: "user" }).ok).toBe(true);

    // Auto job requires valid assessment
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: null }).ok).toBe(false);
    expect(
      checkAutoApprovedPractice({
        approved_by: "auto",
        practice_assessment: JSON.stringify({
          version: 1,
          annualBaseMaxUsd: 120000,
          salaryEvidence: "$120k",
          mandatoryNonlocalOnsite: "no",
          locationEvidence: "",
        }),
      }).ok,
    ).toBe(false);

    expect(
      checkAutoApprovedPractice({
        approved_by: "auto",
        practice_assessment: JSON.stringify({
          version: 1,
          annualBaseMaxUsd: 70000,
          salaryEvidence: "$70k",
          mandatoryNonlocalOnsite: "no",
          locationEvidence: "",
        }),
      }).ok,
    ).toBe(true);
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
  const wellPaid = JSON.stringify({
    version: 1,
    annualBaseMaxUsd: 197000,
    salaryEvidence: "$197k",
    mandatoryNonlocalOnsite: "yes",
    locationEvidence: "Onsite",
  });
  const sha = "a".repeat(64);

  it("may carry on filling, but never submit without the user", () => {
    config.phase = "practice";
    config.confirmBeforeSubmit = false;
    config.autoApply = { enabled: true, phases: ["practice"], submit: true };
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged, resume_sha: sha }).ok).toBe(true);
    expect(confirmsSubmit({ approved_by: "auto", practice_assessment: unjudged })).toBe(true);
  });

  it("are still stopped when not started, or when the posted pay settles it", () => {
    config.phase = "practice";
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged, resume_sha: null }).ok).toBe(false);
    expect(checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: unjudged }).ok).toBe(false);
    const stopped = checkAutoApprovedPractice({ approved_by: "auto", practice_assessment: wellPaid, resume_sha: sha });
    expect(stopped.ok).toBe(false);
    expect(stopped.reason).toBe("auto-approved, but not a practice job: posted base ceiling $197,000 is above the $100,000 practice limit");
  });
});

describe("autoApproval deferred 'daily_cap' contract", () => {
  it("returns deferred: 'daily_cap' ONLY when all other gates pass and daily quota denies", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 5, allowConcerns: false };

    const validVerdict: Verdict = {
      decision: "apply",
      score: 90,
      threshold: 60,
      reason: "passed",
      items: [],
      practice: {
        version: 2,
        annualBaseMaxUsd: 70000,
        salaryEvidence: "$70k",
        mandatoryNonlocalOnsite: "no",
        locationEvidence: "",
        highEndTech: null,
        highEndTechEvidence: "",
      },
    };

    // Quota below limit -> approves without deferred
    const underQuota = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 4 });
    expect(underQuota.approve).toBe(true);
    expect(underQuota.deferred).toBeUndefined();

    // Quota hit -> denies with deferred: 'daily_cap'
    const atQuota = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(atQuota.approve).toBe(false);
    expect(atQuota.deferred).toBe("daily_cap");

    // Prior gate failure: score below minScore does NOT get deferred even when quota is full
    const lowScoreVerdict: Verdict = { ...validVerdict, score: 75 };
    const lowScoreRes = autoApproval(lowScoreVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(lowScoreRes.approve).toBe(false);
    expect(lowScoreRes.deferred).toBeUndefined();

    // Prior gate failure: non-apply decision does NOT get deferred
    const skipVerdict: Verdict = { ...validVerdict, decision: "skip", reason: "failed required" };
    const skipRes = autoApproval(skipVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(skipRes.approve).toBe(false);
    expect(skipRes.deferred).toBeUndefined();

    // Prior gate failure: practice assessment lacks evidence does NOT get deferred
    const noPracticeVerdict: Verdict = {
      ...validVerdict,
      practice: {
        version: 2,
        annualBaseMaxUsd: 120000,
        salaryEvidence: "$120k",
        mandatoryNonlocalOnsite: "no",
        locationEvidence: "",
        highEndTech: null,
        highEndTechEvidence: "",
      },
    };
    const noPracticeRes = autoApproval(noPracticeVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(noPracticeRes.approve).toBe(false);
    expect(noPracticeRes.deferred).toBeUndefined();

    // Prior gate failure: unclear required item does NOT get deferred
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

    // Prior gate failure: assessment raised concerns does NOT get deferred
    const concernsRes = autoApproval(validVerdict, { concerns: "relocation required", handPicked: false, approvedToday: 5 });
    expect(concernsRes.approve).toBe(false);
    expect(concernsRes.deferred).toBeUndefined();

    // Prior gate failure: handPicked does NOT get deferred
    const handPickedRes = autoApproval(validVerdict, { concerns: null, handPicked: true, approvedToday: 5 });
    expect(handPickedRes.approve).toBe(false);
    expect(handPickedRes.deferred).toBeUndefined();

    // Prior gate failure: autoApply disabled does NOT get deferred
    config.autoApply.enabled = false;
    const disabledRes = autoApproval(validVerdict, { concerns: null, handPicked: false, approvedToday: 5 });
    expect(disabledRes.approve).toBe(false);
    expect(disabledRes.deferred).toBeUndefined();
  });
});

describe("reconsiderAutoApproval pure helper", () => {
  const validPracticeObj = {
    version: 1 as const,
    annualBaseMaxUsd: 70000,
    salaryEvidence: "$70k base",
    mandatoryNonlocalOnsite: "no" as const,
    locationEvidence: "",
  };
  const validPracticeJson = JSON.stringify(validPracticeObj);

  function validStoredChecklistArray(overrides: Record<string, "yes" | "no" | "unclear"> = {}) {
    return answersList(overrides).map(a => ({ key: a.id, answer: a.answer, evidence: a.evidence }));
  }

  it("defers when cap is hit, then approves upon daily cap reset (snapshot/restore)", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 5 };
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

    // Cap hit: 5 approvals today -> deferred with daily_cap
    const capRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 });
    expect(capRes.approved).toBe(false);
    expect(capRes.approval.deferred).toBe("daily_cap");
    expect(capRes.verdict).not.toBeNull();
    expect(capRes.verdict?.score).toBeGreaterThanOrEqual(80);
    expect(capRes.verdict?.items.length).toBeGreaterThan(0);

    // Next day: cap reset (0 approvals today) -> approves cleanly
    const resetRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 0 });
    expect(resetRes.approved).toBe(true);
    expect(resetRes.approval.approve).toBe(true);
    expect(resetRes.approval.deferred).toBeUndefined();
    expect(resetRes.reason).toBeNull();
    expect(resetRes.verdict?.decision).toBe("apply");
    expect(resetRes.verdict?.score).toBeGreaterThanOrEqual(80);
    expect(resetRes.verdict?.practice?.annualBaseMaxUsd).toBe(70000);
  });

  it("approves when autoApply perDay limit is increased", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 5 };

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

    // Blocked at perDay: 5 with approvedToday: 5
    expect(reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 }).approved).toBe(false);

    // Increase limit to 50
    config.autoApply.perDay = 50;
    const unblockedRes = reconsiderAutoApproval(job, { handPicked: false, approvedToday: 5 });
    expect(unblockedRes.approved).toBe(true);
    expect(unblockedRes.approval.approve).toBe(true);
  });

  it("evaluates stored checklist mapping key->id from persisted JSON array", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

    // 1. Array with item.key
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

    // 2. Missing key (only id provided) fails closed
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
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    // Missing checklist
    expect(reconsiderAutoApproval({ ...base, checklist: null }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Bad JSON
    expect(reconsiderAutoApproval({ ...base, checklist: "{ not json" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Empty array
    expect(reconsiderAutoApproval({ ...base, checklist: "[]" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Items without answer
    expect(
      reconsiderAutoApproval({ ...base, checklist: JSON.stringify([{ id: "practice.us_employer" }]) }, { handPicked: false, approvedToday: 0 }).approved,
    ).toBe(false);
  });

  it("fails closed on stale qualifications (missing current rubric items)", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

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
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

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
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    // Required item answered "no"
    const failedRequired = validStoredChecklistArray({ "practice.us_employer": "no" });
    const resReq = reconsiderAutoApproval({ ...base, checklist: JSON.stringify(failedRequired) }, { handPicked: false, approvedToday: 0 });
    expect(resReq.approved).toBe(false);

    // Non-required items answered "no" lowering score below minScore
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
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      practice_assessment: validPracticeJson,
    };

    // 1. Array answer coercion attempt (['yes'])
    const badAnswerList = validStoredChecklistArray();
    const arrayAnswerChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, answer: ["yes"] } : item)));
    const resArrayAnswer = reconsiderAutoApproval({ ...base, checklist: arrayAnswerChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resArrayAnswer.approved).toBe(false);

    // 2. Key array coercion attempt (['practice.us_employer'])
    const arrayKeyChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, key: ["practice.us_employer"] } : item)));
    const resArrayKey = reconsiderAutoApproval({ ...base, checklist: arrayKeyChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resArrayKey.approved).toBe(false);

    // 3. Object evidence coercion attempt ({ quote: "evidence text" })
    const objectEvidenceChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, evidence: { quote: "evidence text" } } : item)));
    const resObjectEvidence = reconsiderAutoApproval({ ...base, checklist: objectEvidenceChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resObjectEvidence.approved).toBe(false);

    // 4. Missing or non-string evidence (e.g. evidence: 123)
    const numberEvidenceChecklist = JSON.stringify(badAnswerList.map((item, idx) => (idx === 0 ? { ...item, evidence: 123 } : item)));
    const resNumberEvidence = reconsiderAutoApproval({ ...base, checklist: numberEvidenceChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resNumberEvidence.approved).toBe(false);

    // 5. Duplicate keys
    const duplicateKeyChecklist = JSON.stringify([...badAnswerList, { key: "practice.us_employer", answer: "yes", evidence: "duplicate item" }]);
    const resDuplicateKey = reconsiderAutoApproval({ ...base, checklist: duplicateKeyChecklist }, { handPicked: false, approvedToday: 0 });
    expect(resDuplicateKey.approved).toBe(false);
  });

  it("fails closed on high salary and invalid practice assessment", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

    const base = {
      status: "awaiting_approval" as const,
      approved_by: null,
      resume_sha: null,
      resume_frozen_at: null,
      submitted_at: null,
      concerns: null,
      checklist: JSON.stringify(validStoredChecklistArray()),
    };

    // Salary > 80k without nonlocal onsite
    const highSalaryObj = { ...validPracticeObj, annualBaseMaxUsd: 150000, salaryEvidence: "$150k" };
    const resHigh = reconsiderAutoApproval({ ...base, practice_assessment: JSON.stringify(highSalaryObj) }, { handPicked: false, approvedToday: 0 });
    expect(resHigh.approved).toBe(false);

    // A version this code does not know
    const badVersion = { ...validPracticeObj, version: 3 };
    const resVer = reconsiderAutoApproval({ ...base, practice_assessment: JSON.stringify(badVersion) }, { handPicked: false, approvedToday: 0 });
    expect(resVer.approved).toBe(false);
  });

  it("protects handpicked, manual approvals, and frozen/submitted states", () => {
    config.phase = "practice";
    config.autoApply = { enabled: true, phases: ["practice"], minScore: 80, perDay: 10 };

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

    // Handpicked via facts
    expect(reconsiderAutoApproval(baseJob, { handPicked: true, approvedToday: 0 }).approved).toBe(false);
    // Already approved manually
    expect(reconsiderAutoApproval({ ...baseJob, approved_by: "user" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Already approved automatically
    expect(reconsiderAutoApproval({ ...baseJob, approved_by: "auto" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Frozen resume
    expect(reconsiderAutoApproval({ ...baseJob, resume_sha: "frozen_sha" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, resume_frozen_at: "2026-10-10" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Submitted status
    expect(reconsiderAutoApproval({ ...baseJob, status: "submitted" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, submitted_at: "2026-10-10" }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    // Other status
    expect(reconsiderAutoApproval({ ...baseJob, status: "held" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
    expect(reconsiderAutoApproval({ ...baseJob, status: "rejected" as const }, { handPicked: false, approvedToday: 0 }).approved).toBe(false);
  });

  it("guards disabled autoApply", () => {
    config.phase = "practice";
    config.autoApply = { enabled: false, phases: ["practice"], minScore: 80, perDay: 10 };

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
