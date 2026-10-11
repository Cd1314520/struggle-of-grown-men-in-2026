import { describe, expect, it } from "bun:test";
import {
  validateResumeReviews,
  normalizeWhitespace,
  parseJsonPayload,
  extractAssistantResponseText,
  reviewResumes,
  segmentText,
  buildJobExcerptMaps,
  resolveModelWireReviews,
  type ResumeReviewInput,
} from "../scripts/resume-review-model";

describe("Resume Review Model - Behavioral Validation and Invariant Tests", () => {
  const sampleJob101: ResumeReviewInput = {
    jobId: 101,
    company: "Acme Corp",
    title: "Senior Backend Engineer",
    postingText:
      "Must have 5+ years of experience with PostgreSQL schema design and query optimization.\nCore responsibility: build high-throughput APIs. Experience with Redis caching is a plus.",
    resumeText:
      "Built high-throughput REST APIs handling 10k RPS.\nMaintained backend microservices in production.",
    notesText:
      "Deep PostgreSQL indexing, partitioned tables, and query optimization on production workloads.\nBuilt high-throughput distributed APIs across multiple regions.\nExplicitly no experience with C++ systems programming.",
  };

  const sampleJob102: ResumeReviewInput = {
    jobId: 102,
    company: "Beta Systems",
    title: "Platform Engineer",
    postingText:
      "Mandatory requirements: Kubernetes cluster management, Docker containerization.\nCore: CI/CD automation with GitHub Actions.\nNice to have: experience with Terraform.",
    resumeText:
      "Maintained Docker containers and basic CI/CD scripts.",
    notesText:
      "Managed Kubernetes production clusters with 50+ nodes and Helm charts.\nConfigured GitHub Actions CI/CD pipelines.\nNo experience with Terraform.",
  };

  it("passes validation for valid multi-job reviews with distinct statuses", () => {
    const validReviews = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL Optimization",
            importance: "required",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Posting requires PostgreSQL optimization which is in notes but missing from resume",
            suggestion: "Add the PostgreSQL indexing and partitioned tables bullet from notes",
          },
          {
            theme: "API Development",
            importance: "core",
            status: "underemphasized",
            postingQuote: "build high-throughput APIs",
            resumeEvidence: "Built high-throughput REST APIs handling 10k RPS",
            notesEvidence: "Built high-throughput distributed APIs across multiple regions",
            rationale: "Resume mentions 10k RPS, but notes document multi-region distributed scale",
            suggestion: "Highlight multi-region distributed scope in the API bullet",
          },
          {
            theme: "Redis Caching",
            importance: "preferred",
            status: "unconfirmed",
            postingQuote: "Experience with Redis caching is a plus",
            resumeEvidence: null,
            notesEvidence: null,
            rationale: "Redis is preferred in posting but absent from both resume and candidate notes",
            suggestion: "Ask candidate if they have production Redis caching experience",
          },
        ],
      },
      {
        jobId: 102,
        gaps: [
          {
            theme: "Kubernetes",
            importance: "required",
            status: "supported_omission",
            postingQuote: "Kubernetes cluster management",
            resumeEvidence: null,
            notesEvidence: "Managed Kubernetes production clusters with 50+ nodes",
            rationale: "Kubernetes cluster management required by posting and confirmed in notes, omitted from resume",
            suggestion: "Incorporate the 50+ node Kubernetes production cluster experience into resume",
          },
        ],
      },
    ];

    const result = validateResumeReviews(validReviews, [sampleJob101, sampleJob102]);
    expect(result.length).toBe(2);
    expect(result[0].jobId).toBe(101);
    expect(result[0].gaps.length).toBe(3);
    expect(result[1].jobId).toBe(102);
    expect(result[1].gaps.length).toBe(1);
  });

  it("rejects fabricated postingQuote not present in job posting", () => {
    const invalidReviews = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingQuote: "Must have 10+ years of Rust systems programming experience",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Fabricated quote test",
            suggestion: "Suggest something",
          },
        ],
      },
    ];

    expect(() => validateResumeReviews(invalidReviews, [sampleJob101])).toThrow(
      "postingQuote not found in job posting text"
    );
  });

  it("rejects fabricated notesEvidence not present in candidate notes", () => {
    const invalidReviews = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "Invented non-existent notes statement about PostgreSQL",
            rationale: "Invalid notes quote",
            suggestion: "Suggest something",
          },
        ],
      },
    ];

    expect(() => validateResumeReviews(invalidReviews, [sampleJob101])).toThrow(
      "notesEvidence not found in candidate notes text"
    );
  });

  it("rejects fabricated resumeEvidence not present in tailored resume", () => {
    const invalidReviews = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "API Development",
            importance: "core",
            status: "underemphasized",
            postingQuote: "build high-throughput APIs",
            resumeEvidence: "Architected enterprise banking API gateways",
            notesEvidence: "Built high-throughput distributed APIs across multiple regions",
            rationale: "Invalid resume quote",
            suggestion: "Suggest something",
          },
        ],
      },
    ];

    expect(() => validateResumeReviews(invalidReviews, [sampleJob101])).toThrow(
      "resumeEvidence not found in resume text"
    );
  });

  it("rejects cross-app contamination where evidence from job 102 is used in job 101", () => {
    const contaminatedReviews = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "Kubernetes",
            importance: "required",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            // Quote exists in Job 102 notes, but NOT in Job 101 notes
            notesEvidence: "Managed Kubernetes production clusters with 50+ nodes and Helm charts",
            rationale: "Accidentally cross-pollinated notes quote across different jobs",
            suggestion: "Suggest something",
          },
        ],
      },
      {
        jobId: 102,
        gaps: [],
      },
    ];

    expect(() => validateResumeReviews(contaminatedReviews, [sampleJob101, sampleJob102])).toThrow(
      "JobId 101 gap #0: notesEvidence not found in candidate notes text"
    );
  });

  it("normalizes whitespace so line break and multiple space differences in quotes succeed", () => {
    const postingWithNewlines: ResumeReviewInput = {
      jobId: 201,
      company: "Test Co",
      title: "DevOps Engineer",
      postingText: "Required:\n  - 3+ years experience with Kubernetes\n  - Cloud infrastructure",
      resumeText: "Experience with cloud platforms.",
      notesText: "Led 3-year Kubernetes migration.",
    };

    const review = [
      {
        jobId: 201,
        gaps: [
          {
            theme: "Kubernetes",
            importance: "required",
            status: "supported_omission",
            // Single spaces instead of newline and indentation
            postingQuote: "Required: - 3+ years experience with Kubernetes - Cloud infrastructure",
            resumeEvidence: null,
            notesEvidence: "Led 3-year Kubernetes migration.",
            rationale: "Valid quote under whitespace normalization",
            suggestion: "Add Kubernetes bullet",
          },
        ],
      },
    ];

    const result = validateResumeReviews(review, [postingWithNewlines]);
    expect(result.length).toBe(1);
    expect(result[0].gaps[0].theme).toBe("Kubernetes");
  });

  it("handles confirmed_mismatch correctly and forbids recommending false addition", () => {
    const postingWithCpp: ResumeReviewInput = {
      jobId: 301,
      company: "Systems Inc",
      title: "Low Latency Engineer",
      postingText: "Must have deep knowledge of C++ systems programming.",
      resumeText: "Experienced with Python and Java.",
      notesText: "Explicitly no experience with C++ systems programming.",
    };

    const validMismatchReview = [
      {
        jobId: 301,
        gaps: [
          {
            theme: "C++",
            importance: "required",
            status: "confirmed_mismatch",
            postingQuote: "Must have deep knowledge of C++ systems programming",
            resumeEvidence: null,
            notesEvidence: "Explicitly no experience with C++ systems programming",
            rationale: "Candidate notes explicitly exclude C++ experience",
            suggestion: "Do not add C++ to resume; candidate does not possess this requirement",
          },
        ],
      },
    ];

    const result = validateResumeReviews(validMismatchReview, [postingWithCpp]);
    expect(result[0].gaps[0].status).toBe("confirmed_mismatch");

    // Negative invariant: confirmed_mismatch with resume evidence must throw
    const invalidMismatchWithResumeEvidence = [
      {
        jobId: 301,
        gaps: [
          {
            theme: "C++",
            importance: "required",
            status: "confirmed_mismatch",
            postingQuote: "Must have deep knowledge of C++ systems programming",
            resumeEvidence: "Experienced with Python and Java",
            notesEvidence: "Explicitly no experience with C++ systems programming",
            rationale: "Erroneously provides resume evidence for confirmed mismatch",
            suggestion: "No suggestion",
          },
        ],
      },
    ];

    expect(() => validateResumeReviews(invalidMismatchWithResumeEvidence, [postingWithCpp])).toThrow(
      "confirmed_mismatch requires null resumeEvidence"
    );

    // Negative invariant: confirmed_mismatch with null notesEvidence must throw
    const invalidMismatchWithNullNotes = [
      {
        jobId: 301,
        gaps: [
          {
            theme: "C++",
            importance: "required",
            status: "confirmed_mismatch",
            postingQuote: "Must have deep knowledge of C++ systems programming",
            resumeEvidence: null,
            notesEvidence: null,
            rationale: "Missing notes evidence for confirmed mismatch",
            suggestion: "No suggestion",
          },
        ],
      },
    ];

    expect(() => validateResumeReviews(invalidMismatchWithNullNotes, [postingWithCpp])).toThrow(
      "confirmed_mismatch requires notesEvidence"
    );
  });

  it("enforces status-evidence invariants strictly across all statuses", () => {
    // supported_omission cannot have resumeEvidence
    const badSupportedOmission = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: "Built high-throughput REST APIs handling 10k RPS",
            notesEvidence: "query optimization on production workloads",
            rationale: "Invalid",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(badSupportedOmission, [sampleJob101])).toThrow(
      "supported_omission requires null resumeEvidence"
    );

    // underemphasized requires non-null resumeEvidence
    const badUnderemphasized = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "core",
            status: "underemphasized",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Invalid",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(badUnderemphasized, [sampleJob101])).toThrow(
      "underemphasized requires resumeEvidence"
    );
    // underemphasized allows notesEvidence to be null when grounded solely in existing resume bullet
    const validUnderemphasizedWithoutNotes = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "APIs",
            importance: "core",
            status: "underemphasized",
            postingQuote: "build high-throughput APIs",
            resumeEvidence: "Built high-throughput REST APIs handling 10k RPS",
            notesEvidence: null,
            rationale: "Resume bullet could be framed more prominently against high-throughput API posting requirement",
            suggestion: "Highlight RPS scale and performance optimizations earlier in the bullet",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(validUnderemphasizedWithoutNotes, [sampleJob101])).not.toThrow();

    // unconfirmed cannot have notesEvidence or resumeEvidence
    const badUnconfirmed = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "Redis",
            importance: "preferred",
            status: "unconfirmed",
            postingQuote: "Experience with Redis caching is a plus",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Invalid",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(badUnconfirmed, [sampleJob101])).toThrow(
      "unconfirmed requires null notesEvidence"
    );
  });

  it("rejects coverage violations (missing job, unknown job, duplicate job)", () => {
    // Missing job 102
    const missingJob = [
      {
        jobId: 101,
        gaps: [],
      },
    ];
    expect(() => validateResumeReviews(missingJob, [sampleJob101, sampleJob102])).toThrow(
      "Review missing for jobId 102"
    );

    // Unknown job 999
    const unknownJob = [
      { jobId: 101, gaps: [] },
      { jobId: 102, gaps: [] },
      { jobId: 999, gaps: [] },
    ];
    expect(() => validateResumeReviews(unknownJob, [sampleJob101, sampleJob102])).toThrow(
      "Unexpected jobId 999 not found in review inputs"
    );

    // Duplicate job 101
    const duplicateJob = [
      { jobId: 101, gaps: [] },
      { jobId: 101, gaps: [] },
    ];
    expect(() => validateResumeReviews(duplicateJob, [sampleJob101])).toThrow(
      "Duplicate review for jobId 101"
    );
  });

  it("rejects invalid importance and status enums, and bounds findings to 6 gaps", () => {
    // Invalid importance
    const invalidImportance = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "critical",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Invalid enum",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(invalidImportance, [sampleJob101])).toThrow(
      'invalid importance "critical"'
    );

    // Invalid status
    const invalidStatus = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "missing_skill",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Invalid status enum",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(invalidStatus, [sampleJob101])).toThrow(
      'invalid status "missing_skill"'
    );

    // Object prototype keys as importance enum
    const protoImportance = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "toString",
            status: "supported_omission",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Prototype pollution test",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(protoImportance, [sampleJob101])).toThrow(
      'invalid importance "toString"'
    );

    // Object prototype keys as status enum
    const protoStatus = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "constructor",
            postingQuote: "PostgreSQL schema design and query optimization",
            resumeEvidence: null,
            notesEvidence: "query optimization on production workloads",
            rationale: "Prototype pollution test",
            suggestion: "Invalid",
          },
        ],
      },
    ];
    expect(() => validateResumeReviews(protoStatus, [sampleJob101])).toThrow(
      'invalid status "constructor"'
    );

    // More than 6 gaps
    const sevenGaps = [
      {
        jobId: 101,
        gaps: Array.from({ length: 7 }, (_, i) => ({
          theme: `Theme ${i}`,
          importance: "required",
          status: "unconfirmed",
          postingQuote: "PostgreSQL schema design and query optimization",
          resumeEvidence: null,
          notesEvidence: null,
          rationale: `Rationale ${i}`,
          suggestion: `Suggestion ${i}`,
        })),
      },
    ];
    expect(() => validateResumeReviews(sevenGaps, [sampleJob101])).toThrow(
      "exceeded maximum allowed gaps"
    );
  });

  it("returns empty array immediately for empty inputs without model execution", async () => {
    const result = await reviewResumes([], ["Kubernetes", "PostgreSQL"]);
    expect(result).toEqual([]);

    const validated = validateResumeReviews([], []);
    expect(validated).toEqual([]);
  });

  it("parses model JSON responses from raw markdown blocks or wrapped prose", () => {
    const rawMarkdown = "```json\n[{\"jobId\": 101, \"gaps\": []}]\n```";
    const parsed1 = parseJsonPayload(rawMarkdown);
    expect(Array.isArray(parsed1)).toBe(true);

    const wrappedProse = "Here is the requested analysis:\n[{\"jobId\": 101, \"gaps\": []}]\nHope this helps!";
    const parsed2 = parseJsonPayload(wrappedProse);
    expect(Array.isArray(parsed2)).toBe(true);
  });

  it("extracts assistant response text and propagates assistant stop errors from JSONL events", () => {
    const jsonlEvents = [
      JSON.stringify({ type: "session", id: "abc" }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          provider: "openai-codex",
          model: "gpt-6-luna",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
      JSON.stringify({ type: "turn_end" }),
    ].join("\n");

    const text = extractAssistantResponseText(jsonlEvents);
    expect(text).toBe('[{"jobId": 101, "gaps": []}]');
    const errorEvent = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "error",
          provider: "openai-codex",
          model: "gpt-6-luna",
          errorMessage: "Context length exceeded",
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(errorEvent)).toThrow();
  });

  it("rejects non-complete assistant stopReason such as length or aborted", () => {
    const lengthEvent = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "length",
          model: "gpt-6-luna",
          provider: "openai-codex",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(lengthEvent)).toThrow(
      "Assistant stopped with incomplete stopReason: length"
    );

    const abortedEvent = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "aborted",
          model: "gpt-6-luna",
          provider: "openai-codex",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(abortedEvent)).toThrow(
      "Assistant stopped with incomplete stopReason: aborted"
    );
  });

  it("detects and rejects model substitution and silent fallback", () => {
    // model_change event with fallback flag
    const fallbackEvent = [
      JSON.stringify({
        type: "model_change",
        model: "openai-codex/gpt-5.6-luna",
        resolvedModelIsFallback: true,
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(fallbackEvent)).toThrow(
      "Model fallback detected"
    );

    // model substitution to another model
    const substitutedModelEvent = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          model: "claude-3-5-sonnet",
          provider: "anthropic",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(substitutedModelEvent)).toThrow(
      "Provider substitution detected"
    );
  });

  it("rejects invalid earlier event even if a later valid assistant event exists", () => {
    // Earlier model_change was fallback, followed by valid assistant message
    const earlyFallbackThenValid = [
      JSON.stringify({
        type: "model_change",
        model: "openai-codex/gpt-5.6-luna",
        resolvedModelIsFallback: true,
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          provider: "openai-codex",
          model: "gpt-6-luna",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(earlyFallbackThenValid)).toThrow(
      "Model fallback detected"
    );

    // Earlier assistant event was truncated with length, followed by valid message
    const earlyLengthThenValid = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "length",
          provider: "openai-codex",
          model: "gpt-6-luna",
          content: [{ type: "text", text: "partial" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          provider: "openai-codex",
          model: "gpt-6-luna",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(earlyLengthThenValid)).toThrow(
      "Assistant stopped with incomplete stopReason: length"
    );

    // Earlier assistant event had provider mismatch, followed by valid message
    const earlyProviderMismatchThenValid = [
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          provider: "google-antigravity",
          model: "gemini-3.6-flash",
          content: [{ type: "text", text: "some text" }],
        },
      }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "stop",
          provider: "openai-codex",
          model: "gpt-6-luna",
          content: [{ type: "text", text: '[{"jobId": 101, "gaps": []}]' }],
        },
      }),
    ].join("\n");

    expect(() => extractAssistantResponseText(earlyProviderMismatchThenValid)).toThrow(
      "Provider substitution detected"
    );
  });

  it("segments text into exact substrings without dropping characters and computes offsets", () => {
    const sampleText =
      "First short line.\nSecond very long paragraph that exceeds one hundred and eighty characters in length to trigger sentence boundary segmentation. Here is the second sentence in the paragraph. And a third sentence!\nFinal bullet point.";
    const excerpts = segmentText(sampleText, "P");

    expect(excerpts.length).toBeGreaterThanOrEqual(4);
    expect(excerpts[0].id).toBe("P1");
    expect(excerpts[0].text).toBe("First short line.");

    // Every excerpt must be an exact substring matching its recorded slice
    for (const excerpt of excerpts) {
      expect(sampleText.slice(excerpt.startIndex, excerpt.endIndex)).toBe(excerpt.text);
      expect(sampleText.includes(excerpt.text)).toBe(true);
      expect(normalizeWhitespace(sampleText).includes(normalizeWhitespace(excerpt.text))).toBe(true);
    }
  });

  it("resolves wire model output with excerpt IDs into exact source strings that pass validation", () => {
    const excerptMaps = buildJobExcerptMaps([sampleJob101, sampleJob102]);
    const wireModelOutput = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingEvidenceId: "P1",
            resumeEvidenceId: null,
            notesEvidenceId: "N1",
            rationale: "Required PostgreSQL optimization omitted from resume",
            suggestion: "Add PostgreSQL indexing bullet from notes",
          },
          {
            theme: "APIs",
            importance: "core",
            status: "underemphasized",
            postingEvidenceId: "P2",
            resumeEvidenceId: "R1",
            notesEvidenceId: null,
            rationale: "API experience could be framed more strongly",
            suggestion: "Emphasize RPS throughput",
          },
        ],
      },
      {
        jobId: 102,
        gaps: [
          {
            theme: "Kubernetes",
            importance: "required",
            status: "supported_omission",
            postingEvidenceId: "P1",
            resumeEvidenceId: null,
            notesEvidenceId: "N1",
            rationale: "Kubernetes cluster management in notes but absent from resume",
            suggestion: "Add Kubernetes production cluster bullet",
          },
        ],
      },
    ];

    const resolved = resolveModelWireReviews(wireModelOutput, excerptMaps);
    expect(resolved.length).toBe(2);
    expect(resolved[0].gaps[0].postingQuote).toBeTruthy();
    expect(resolved[0].gaps[0].notesEvidence).toBeTruthy();
    expect(resolved[0].gaps[0].resumeEvidence).toBeNull();
    expect(resolved[0].gaps[1].status).toBe("underemphasized");
    expect(resolved[0].gaps[1].resumeEvidence).toBeTruthy();
    expect(resolved[0].gaps[1].notesEvidence).toBeNull();

    // Resolved reviews pass authoritative validateResumeReviews provenance checks
    const validated = validateResumeReviews(resolved, [sampleJob101, sampleJob102]);
    expect(validated.length).toBe(2);
  });

  it("rejects invalid excerpt IDs not present in source excerpt map", () => {
    const excerptMaps = buildJobExcerptMaps([sampleJob101]);
    const invalidIdWireOutput = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingEvidenceId: "P999",
            resumeEvidenceId: null,
            notesEvidenceId: "N1",
            rationale: "Invalid ID test",
            suggestion: "Suggest",
          },
        ],
      },
    ];

    expect(() => resolveModelWireReviews(invalidIdWireOutput, excerptMaps)).toThrow(
      'invalid postingEvidenceId "P999"'
    );
  });

  it("rejects cross-source excerpt IDs (e.g. resume ID used as notesEvidenceId)", () => {
    const excerptMaps = buildJobExcerptMaps([sampleJob101]);
    const crossSourceWireOutput = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL",
            importance: "required",
            status: "supported_omission",
            postingEvidenceId: "P1",
            resumeEvidenceId: null,
            // R1 is a resume excerpt ID, not a notes ID
            notesEvidenceId: "R1",
            rationale: "Cross-source ID test",
            suggestion: "Suggest",
          },
        ],
      },
    ];

    expect(() => resolveModelWireReviews(crossSourceWireOutput, excerptMaps)).toThrow(
      'invalid notesEvidenceId "R1"'
    );
  });

  it("resolves contiguous multi-ID excerpts by preserving exact source slice", () => {
    const excerptMaps = buildJobExcerptMaps([sampleJob101]);
    // P1 and P2 are adjacent in sampleJob101 postingText
    const multiIdWireOutput = [
      {
        jobId: 101,
        gaps: [
          {
            theme: "PostgreSQL & APIs",
            importance: "required",
            status: "supported_omission",
            postingEvidenceIds: ["P1", "P2"],
            resumeEvidenceId: null,
            notesEvidenceId: "N1",
            rationale: "Multi ID test",
            suggestion: "Suggest",
          },
        ],
      },
    ];

    const resolved = resolveModelWireReviews(multiIdWireOutput, excerptMaps);
    expect(resolved[0].gaps[0].postingQuote).toBeTruthy();
    // Validates against sampleJob101 postingText
    expect(() => validateResumeReviews(resolved, [sampleJob101])).not.toThrow();
  });
});
