import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const VALID_IMPORTANCE: Record<string, true> = {
  required: true,
  core: true,
  preferred: true,
};

export const VALID_STATUSES: Record<string, true> = {
  supported_omission: true,
  underemphasized: true,
  unconfirmed: true,
  confirmed_mismatch: true,
};
export interface ResumeReviewInput {
  jobId: number;
  company: string;
  title: string;
  postingText: string;
  resumeText: string;
  notesText: string;
}

export type GapStatus = "supported_omission" | "underemphasized" | "unconfirmed" | "confirmed_mismatch";

export interface ResumeGap {
  theme: string;
  importance: "required" | "core" | "preferred";
  status: GapStatus;
  postingQuote: string;
  resumeEvidence: string | null;
  notesEvidence: string | null;
  rationale: string;
  suggestion: string;
}

export interface ApplicationResumeReview {
  jobId: number;
  gaps: ResumeGap[];
}

export const REVIEW_MODEL = "openai-codex/gpt-6-luna";

export const DEFAULT_TIMEOUT_MS = 240_000; // 4 minutes

/**
 * Normalizes all whitespace runs (tabs, newlines, multiple spaces) into a single space and trims.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface SourceExcerpt {
  id: string;
  text: string;
  startIndex: number;
  endIndex: number;
}

export interface JobExcerptMaps {
  jobId: number;
  postingText: string;
  resumeText: string;
  notesText: string;
  posting: Map<string, SourceExcerpt>;
  resume: Map<string, SourceExcerpt>;
  notes: Map<string, SourceExcerpt>;
}

/**
 * Segments source text into stable numbered excerpts without dropping characters.
 * Each excerpt is guaranteed to be an exact substring of the original text.
 */
export function segmentText(text: string, prefix: "P" | "R" | "N"): SourceExcerpt[] {
  const excerpts: SourceExcerpt[] = [];
  const lines = text.split(/\r?\n/);
  let searchPos = 0;
  let counter = 1;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const lineIndex = text.indexOf(line, searchPos);
    const lineStart = lineIndex !== -1 ? lineIndex : searchPos;

    if (line.length <= 180) {
      const lineEnd = lineStart + line.length;
      excerpts.push({
        id: `${prefix}${counter++}`,
        text: line,
        startIndex: lineStart,
        endIndex: lineEnd,
      });
      searchPos = lineEnd;
      continue;
    }

    // Split longer lines into sentences
    const sentenceMatches = line.match(/[^.!?\n]+[.!?]+(?:\s+|$)|[^.!?\n]+$/g);
    if (sentenceMatches && sentenceMatches.length > 1) {
      let sentenceSearchPos = lineStart;
      for (const rawSentence of sentenceMatches) {
        const sentence = rawSentence.trim();
        if (!sentence) continue;
        const sentIdx = text.indexOf(sentence, sentenceSearchPos);
        const sentStart = sentIdx !== -1 ? sentIdx : sentenceSearchPos;
        const sentEnd = sentStart + sentence.length;
        excerpts.push({
          id: `${prefix}${counter++}`,
          text: sentence,
          startIndex: sentStart,
          endIndex: sentEnd,
        });
        sentenceSearchPos = sentEnd;
      }
      searchPos = sentenceSearchPos;
    } else {
      const lineEnd = lineStart + line.length;
      excerpts.push({
        id: `${prefix}${counter++}`,
        text: line,
        startIndex: lineStart,
        endIndex: lineEnd,
      });
      searchPos = lineEnd;
    }
  }

  if (excerpts.length === 0 && text.trim().length > 0) {
    const trimmed = text.trim();
    const idx = text.indexOf(trimmed);
    excerpts.push({
      id: `${prefix}1`,
      text: trimmed,
      startIndex: idx !== -1 ? idx : 0,
      endIndex: idx !== -1 ? idx + trimmed.length : trimmed.length,
    });
  }

  return excerpts;
}

export function buildJobExcerptMaps(inputs: ResumeReviewInput[]): Map<number, JobExcerptMaps> {
  const map = new Map<number, JobExcerptMaps>();
  for (const input of inputs) {
    const postingExcerpts = segmentText(input.postingText, "P");
    const resumeExcerpts = segmentText(input.resumeText, "R");
    const notesExcerpts = segmentText(input.notesText, "N");

    const postingMap = new Map<string, SourceExcerpt>();
    for (const e of postingExcerpts) postingMap.set(e.id, e);

    const resumeMap = new Map<string, SourceExcerpt>();
    for (const e of resumeExcerpts) resumeMap.set(e.id, e);

    const notesMap = new Map<string, SourceExcerpt>();
    for (const e of notesExcerpts) notesMap.set(e.id, e);

    map.set(input.jobId, {
      jobId: input.jobId,
      postingText: input.postingText,
      resumeText: input.resumeText,
      notesText: input.notesText,
      posting: postingMap,
      resume: resumeMap,
      notes: notesMap,
    });
  }
  return map;
}

export function formatExcerptsForPrompt(segments: SourceExcerpt[]): string {
  if (segments.length === 0) return "(Empty)";
  return segments.map((s) => `[${s.id}] ${s.text}`).join("\n");
}

/**
 * Builds the user prompt payload sent to the model via stdin.
 * Numbered excerpts (P1, R1, N1) are clearly separated and identify untrusted text.
 */
export function buildUserPrompt(
  inputs: ResumeReviewInput[],
  knownThemes: string[],
  excerptMaps?: Map<number, JobExcerptMaps>
): string {
  const maps = excerptMaps ?? buildJobExcerptMaps(inputs);
  const sections: string[] = [];

  sections.push("# Known Themes");
  if (knownThemes.length > 0) {
    sections.push(knownThemes.map((t) => `- ${t}`).join("\n"));
  } else {
    sections.push("(None yet)");
  }
  sections.push("");

  sections.push(`# Applications to Review (${inputs.length})`);
  for (const input of inputs) {
    const jobMap = maps.get(input.jobId);
    const postingExcerpts = jobMap ? Array.from(jobMap.posting.values()) : segmentText(input.postingText, "P");
    const resumeExcerpts = jobMap ? Array.from(jobMap.resume.values()) : segmentText(input.resumeText, "R");
    const notesExcerpts = jobMap ? Array.from(jobMap.notes.values()) : segmentText(input.notesText, "N");

    sections.push(`## Application Job ID: ${input.jobId}`);
    sections.push(`Company: ${input.company}`);
    sections.push(`Title: ${input.title}`);
    sections.push("");
    sections.push("### JOB POSTING (Excerpt IDs: P1, P2, ...)");
    sections.push(formatExcerptsForPrompt(postingExcerpts));
    sections.push("");
    sections.push("### RESUME (Excerpt IDs: R1, R2, ...)");
    sections.push(formatExcerptsForPrompt(resumeExcerpts));
    sections.push("");
    sections.push("### CANDIDATE NOTES (Excerpt IDs: N1, N2, ...)");
    sections.push(formatExcerptsForPrompt(notesExcerpts));
    sections.push("");
    sections.push("---");
  }

  sections.push("");
  sections.push(
    "Produce the JSON array analyzing all applications above. Reference exact excerpt IDs (e.g. postingEvidenceId: 'P1', notesEvidenceId: 'N2', resumeEvidenceId: null). Output ONLY the JSON array matching the schema."
  );
  return sections.join("\n");
}

function extractEvidenceIds(single: unknown, multiple: unknown): string[] {
  if (Array.isArray(multiple)) {
    return multiple
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => item.trim());
  }
  if (typeof single === "string" && single.trim().length > 0) {
    return [single.trim()];
  }
  return [];
}

function resolveExcerptQuote(
  ids: string[],
  map: Map<string, SourceExcerpt>,
  sourceText: string,
  jobId: number,
  gapIdx: number,
  field: string
): string {
  if (ids.length === 0) {
    throw new Error(`JobId ${jobId} gap #${gapIdx}: missing ${field}Id`);
  }
  const resolvedExcerpts: SourceExcerpt[] = [];
  for (const id of ids) {
    const excerpt = map.get(id);
    if (!excerpt) {
      throw new Error(`JobId ${jobId} gap #${gapIdx}: invalid ${field}Id "${id}"`);
    }
    resolvedExcerpts.push(excerpt);
  }

  if (resolvedExcerpts.length === 1) {
    return resolvedExcerpts[0].text;
  }

  resolvedExcerpts.sort((a, b) => a.startIndex - b.startIndex);

  let isContiguous = true;
  for (let i = 0; i < resolvedExcerpts.length - 1; i++) {
    const current = resolvedExcerpts[i];
    const next = resolvedExcerpts[i + 1];
    if (next.startIndex < current.endIndex) {
      isContiguous = false;
      break;
    }
    const gap = sourceText.slice(current.endIndex, next.startIndex);
    if (gap.trim().length > 0) {
      isContiguous = false;
      break;
    }
  }

  if (isContiguous) {
    const first = resolvedExcerpts[0];
    const last = resolvedExcerpts[resolvedExcerpts.length - 1];
    return sourceText.slice(first.startIndex, last.endIndex);
  }

  return resolvedExcerpts[0].text;
}

/**
 * Resolves wire format reviews (which reference excerpt IDs) to full ApplicationResumeReview objects.
 * Falls back to direct quote strings if provided.
 */
export function resolveModelWireReviews(
  raw: unknown,
  excerptMaps: Map<number, JobExcerptMaps>
): ApplicationResumeReview[] {
  if (!Array.isArray(raw)) {
    throw new Error("Model output must be a JSON array");
  }

  const reviews: ApplicationResumeReview[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Review item at index ${i} is not an object`);
    }
    const rawJobId = (item as Record<string, unknown>).jobId;
    if (typeof rawJobId !== "number") {
      throw new Error(`Review item at index ${i} has invalid or missing numeric jobId`);
    }
    const jobId = rawJobId;

    const jobMaps = excerptMaps.get(jobId);
    if (!jobMaps) {
      throw new Error(`Unexpected jobId ${jobId} not found in review inputs`);
    }

    const rawGaps = (item as Record<string, unknown>).gaps;
    if (!Array.isArray(rawGaps)) {
      throw new Error(`Gaps for jobId ${jobId} must be an array`);
    }

    const resolvedGaps: ResumeGap[] = [];
    for (let gIdx = 0; gIdx < rawGaps.length; gIdx++) {
      const g = rawGaps[gIdx];
      if (!g || typeof g !== "object") {
        throw new Error(`Gap at index ${gIdx} for jobId ${jobId} is not an object`);
      }
      const gap = g as Record<string, unknown>;

      // Resolve posting quote
      let postingQuote = "";
      const postingIds = extractEvidenceIds(gap.postingEvidenceId, gap.postingEvidenceIds);
      if (postingIds.length > 0) {
        postingQuote = resolveExcerptQuote(
          postingIds,
          jobMaps.posting,
          jobMaps.postingText,
          jobId,
          gIdx,
          "postingEvidence"
        );
      } else if (typeof gap.postingQuote === "string" && gap.postingQuote.trim().length > 0) {
        postingQuote = gap.postingQuote.trim();
      } else {
        throw new Error(`JobId ${jobId} gap #${gIdx}: missing postingEvidenceId`);
      }

      // Resolve resume evidence
      let resumeEvidence: string | null = null;
      const resumeIds = extractEvidenceIds(gap.resumeEvidenceId, gap.resumeEvidenceIds);
      if (resumeIds.length > 0) {
        resumeEvidence = resolveExcerptQuote(
          resumeIds,
          jobMaps.resume,
          jobMaps.resumeText,
          jobId,
          gIdx,
          "resumeEvidence"
        );
      } else if (typeof gap.resumeEvidence === "string" && gap.resumeEvidence.trim().length > 0) {
        resumeEvidence = gap.resumeEvidence.trim();
      }

      // Resolve notes evidence
      let notesEvidence: string | null = null;
      const notesIds = extractEvidenceIds(gap.notesEvidenceId, gap.notesEvidenceIds);
      if (notesIds.length > 0) {
        notesEvidence = resolveExcerptQuote(
          notesIds,
          jobMaps.notes,
          jobMaps.notesText,
          jobId,
          gIdx,
          "notesEvidence"
        );
      } else if (typeof gap.notesEvidence === "string" && gap.notesEvidence.trim().length > 0) {
        notesEvidence = gap.notesEvidence.trim();
      }

      resolvedGaps.push({
        theme: typeof gap.theme === "string" ? gap.theme.trim() : "",
        importance: gap.importance as ResumeGap["importance"],
        status: gap.status as ResumeGap["status"],
        postingQuote,
        resumeEvidence,
        notesEvidence,
        rationale: typeof gap.rationale === "string" ? gap.rationale.trim() : "",
        suggestion: typeof gap.suggestion === "string" ? gap.suggestion.trim() : "",
      });
    }

    reviews.push({
      jobId,
      gaps: resolvedGaps,
    });
  }

  return reviews;
}

interface ContentPart {
  type?: unknown;
  text?: unknown;
}

function isTextContent(part: unknown): part is { type: "text"; text: string } {
  if (!part || typeof part !== "object") return false;
  const p = part as ContentPart;
  return p.type === "text" && typeof p.text === "string";
}

/**
 * Extracts the assistant's text response from omp stdout (JSONL events in --mode json).
 */
export function extractAssistantResponseText(stdout: string): string {
  const lines = stdout.split("\n");
  let lastAssistantText = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Ignore lines that are not JSON events
      continue;
    }

    if (parsed.type === "model_change") {
      if (parsed.resolvedModelIsFallback === true) {
        throw new Error(`Model fallback detected: resolved model is fallback (${String(parsed.model)})`);
      }
      if (parsed.model !== "openai-codex/gpt-6-luna" && parsed.model !== "gpt-6-luna") {
        throw new Error(`Model substitution detected: expected openai-codex/gpt-6-luna, got ${String(parsed.model)}`);
      }
    } else if (parsed.type === "message_end" || parsed.type === "turn_end") {
      const msg = parsed.message as Record<string, unknown> | undefined;
      if (msg && msg.role === "assistant") {
        if (msg.provider !== "openai-codex") {
          throw new Error(`Provider substitution detected: expected openai-codex, got ${String(msg.provider)}`);
        }
        if (msg.model !== "gpt-6-luna" && msg.model !== "openai-codex/gpt-6-luna") {
          throw new Error(`Model substitution detected: expected gpt-6-luna, got ${String(msg.model)}`);
        }
        if (msg.stopReason !== "stop") {
          const errorDetail = typeof msg.errorMessage === "string" ? msg.errorMessage : String(msg.stopReason);
          throw new Error(`Assistant stopped with incomplete stopReason: ${errorDetail}`);
        }
        if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter(isTextContent)
            .map((c) => c.text);
          if (textParts.length > 0) {
            lastAssistantText = textParts.join("\n");
          }
        }
      }
    } else if (parsed.type === "agent_end" && Array.isArray(parsed.messages)) {
      for (const rawMsg of parsed.messages) {
        const msg = rawMsg as Record<string, unknown> | undefined;
        if (msg && msg.role === "assistant") {
          if (msg.provider !== "openai-codex") {
            throw new Error(`Provider substitution detected: expected openai-codex, got ${String(msg.provider)}`);
          }
          if (msg.model !== "gpt-6-luna" && msg.model !== "openai-codex/gpt-6-luna") {
            throw new Error(`Model substitution detected: expected gpt-6-luna, got ${String(msg.model)}`);
          }
          if (msg.stopReason !== "stop") {
            const errorDetail = typeof msg.errorMessage === "string" ? msg.errorMessage : String(msg.stopReason);
            throw new Error(`Assistant stopped with incomplete stopReason: ${errorDetail}`);
          }
          if (Array.isArray(msg.content)) {
            const textParts = msg.content
              .filter(isTextContent)
              .map((c) => c.text);
            if (textParts.length > 0) {
              lastAssistantText = textParts.join("\n");
            }
          }
        }
      }
    }
  }

  if (lastAssistantText.trim().length > 0) {
    return lastAssistantText;
  }

  // Fallback if stdout was raw text or direct JSON
  return stdout.trim();
}

/**
 * Parses JSON array from raw model text output, tolerating markdown code fences.
 */
export function parseJsonPayload(text: string): unknown {
  const trimmed = text.trim();
  let clean = trimmed;

  if (clean.startsWith("```")) {
    const firstNewline = clean.indexOf("\n");
    if (firstNewline !== -1) {
      clean = clean.slice(firstNewline + 1);
    }
    const lastFence = clean.lastIndexOf("```");
    if (lastFence !== -1) {
      clean = clean.slice(0, lastFence);
    }
    clean = clean.trim();
  }

  try {
    return JSON.parse(clean);
  } catch {
    const startIdx = clean.indexOf("[");
    const endIdx = clean.lastIndexOf("]");
    if (startIdx !== -1 && endIdx > startIdx) {
      const candidate = clean.slice(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch (e) {
        throw new Error(`Failed to parse extracted JSON candidate from model output: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    throw new Error("Model output did not contain a valid JSON array");
  }
}

/**
 * Validates the model output against the inputs:
 * - Unique 1:1 coverage of every input jobId
 * - Bounded findings (max 6 gaps per job)
 * - Strict enum validation (importance, status)
 * - Verbatim quote provenance in source texts (whitespace normalized)
 * - Evidence invariants per status
 * - Never includes raw input text in error messages
 */
export function validateResumeReviews(raw: unknown, inputs: ResumeReviewInput[]): ApplicationResumeReview[] {
  if (!Array.isArray(raw)) {
    throw new Error("Model output must be a JSON array");
  }

  const inputMap = new Map<number, ResumeReviewInput>();
  for (const input of inputs) {
    if (inputMap.has(input.jobId)) {
      throw new Error(`Duplicate jobId ${input.jobId} in review inputs`);
    }
    inputMap.set(input.jobId, input);
  }

  const seenJobIds = new Set<number>();
  const reviews: ApplicationResumeReview[] = [];

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") {
      throw new Error(`Review item at index ${i} is not an object`);
    }

    const { jobId, gaps } = item as Record<string, unknown>;
    if (typeof jobId !== "number") {
      throw new Error(`Review item at index ${i} has invalid or missing numeric jobId`);
    }
    if (seenJobIds.has(jobId)) {
      throw new Error(`Duplicate review for jobId ${jobId}`);
    }
    seenJobIds.add(jobId);

    const input = inputMap.get(jobId);
    if (!input) {
      throw new Error(`Unexpected jobId ${jobId} not found in review inputs`);
    }

    if (!Array.isArray(gaps)) {
      throw new Error(`Gaps for jobId ${jobId} must be an array`);
    }
    if (gaps.length > 6) {
      throw new Error(`JobId ${jobId} exceeded maximum allowed gaps (found ${gaps.length}, maximum is 6)`);
    }

    const validatedGaps: ResumeGap[] = [];
    for (let gIdx = 0; gIdx < gaps.length; gIdx++) {
      const gap = gaps[gIdx];
      if (!gap || typeof gap !== "object") {
        throw new Error(`Gap at index ${gIdx} for jobId ${jobId} is not an object`);
      }

      const g = gap as Record<string, unknown>;

      // theme
      if (typeof g.theme !== "string" || g.theme.trim().length === 0) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: theme must be a non-empty string`);
      }

      // importance
      if (typeof g.importance !== "string" || !Object.hasOwn(VALID_IMPORTANCE, g.importance)) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: invalid importance "${String(g.importance)}"`);
      }

      // status
      if (typeof g.status !== "string" || !Object.hasOwn(VALID_STATUSES, g.status)) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: invalid status "${String(g.status)}"`);
      }

      // postingQuote
      if (typeof g.postingQuote !== "string" || g.postingQuote.trim().length === 0) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: postingQuote must be a non-empty string`);
      }
      if (!normalizeWhitespace(input.postingText).includes(normalizeWhitespace(g.postingQuote))) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: postingQuote not found in job posting text`);
      }

      // resumeEvidence
      if (g.resumeEvidence !== null && g.resumeEvidence !== undefined) {
        if (typeof g.resumeEvidence !== "string" || g.resumeEvidence.trim().length === 0) {
          throw new Error(`JobId ${jobId} gap #${gIdx}: resumeEvidence must be null or non-empty string`);
        }
        if (!normalizeWhitespace(input.resumeText).includes(normalizeWhitespace(g.resumeEvidence))) {
          throw new Error(`JobId ${jobId} gap #${gIdx}: resumeEvidence not found in resume text`);
        }
      }

      // notesEvidence
      if (g.notesEvidence !== null && g.notesEvidence !== undefined) {
        if (typeof g.notesEvidence !== "string" || g.notesEvidence.trim().length === 0) {
          throw new Error(`JobId ${jobId} gap #${gIdx}: notesEvidence must be null or non-empty string`);
        }
        if (!normalizeWhitespace(input.notesText).includes(normalizeWhitespace(g.notesEvidence))) {
          throw new Error(`JobId ${jobId} gap #${gIdx}: notesEvidence not found in candidate notes text`);
        }
      }

      const resumeEvidence = (g.resumeEvidence ?? null) as string | null;
      const notesEvidence = (g.notesEvidence ?? null) as string | null;

      // Status invariants
      switch (g.status) {
        case "supported_omission":
          if (notesEvidence === null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: supported_omission requires notesEvidence`);
          }
          if (resumeEvidence !== null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: supported_omission requires null resumeEvidence`);
          }
          break;
        case "underemphasized":
          if (resumeEvidence === null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: underemphasized requires resumeEvidence`);
          }
          break;
        case "unconfirmed":
          if (notesEvidence !== null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: unconfirmed requires null notesEvidence`);
          }
          if (resumeEvidence !== null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: unconfirmed requires null resumeEvidence`);
          }
          break;
        case "confirmed_mismatch":
          if (notesEvidence === null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: confirmed_mismatch requires notesEvidence`);
          }
          if (resumeEvidence !== null) {
            throw new Error(`JobId ${jobId} gap #${gIdx}: confirmed_mismatch requires null resumeEvidence`);
          }
          break;
      }

      // rationale
      if (typeof g.rationale !== "string" || g.rationale.trim().length === 0) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: rationale must be a non-empty string`);
      }

      // suggestion
      if (typeof g.suggestion !== "string" || g.suggestion.trim().length === 0) {
        throw new Error(`JobId ${jobId} gap #${gIdx}: suggestion must be a non-empty string`);
      }

      validatedGaps.push({
        theme: g.theme.trim(),
        importance: g.importance as ResumeGap["importance"],
        status: g.status as ResumeGap["status"],
        postingQuote: g.postingQuote,
        resumeEvidence,
        notesEvidence,
        rationale: g.rationale.trim(),
        suggestion: g.suggestion.trim(),
      });
    }

    reviews.push({
      jobId,
      gaps: validatedGaps,
    });
  }

  // Ensure every input job was reviewed
  for (const input of inputs) {
    if (!seenJobIds.has(input.jobId)) {
      throw new Error(`Review missing for jobId ${input.jobId}`);
    }
  }

  return reviews;
}

/**
 * Executes review of submitted applications with GPT-6 Luna via bounded /usr/bin/omp CLI.
 * All input supplied; tool-free, session-free, strictly validated structured result.
 */
export async function reviewResumes(
  inputs: ResumeReviewInput[],
  knownThemes: string[]
): Promise<ApplicationResumeReview[]> {
  if (inputs.length === 0) {
    return [];
  }
  const excerptMaps = buildJobExcerptMaps(inputs);
  const promptFilePath = join(REPO_ROOT, "prompts", "resume-review.md");
  const overlayPath = join(REPO_ROOT, "scripts", "resume-review.yml");
  const payload = buildUserPrompt(inputs, knownThemes, excerptMaps);
  const args = [
    "/usr/bin/omp",
    "-p",
    "--mode", "json",
    "--no-tools",
    "--no-session",
    "--no-extensions",
    "--no-rules",
    "--no-skills",
    "--no-lsp",
    "--no-title",
    "--config", overlayPath,
    "--system-prompt", promptFilePath,
    "--model", REVIEW_MODEL,
    "--thinking", "medium",
    "--max-time", "4m",
  ];
  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    cwd: REPO_ROOT,
    env: { ...process.env },
  });

  // Write payload to stdin and close stdin
  if (proc.stdin) {
    try {
      proc.stdin.write(payload);
      proc.stdin.flush();
      proc.stdin.end();
    } catch {
      // If process exited immediately, handle on await
    }
  }

  let timer: NodeJS.Timeout | undefined;
  let didTimeout = false;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      didTimeout = true;
      try {
        proc.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          proc.kill("SIGKILL");
        } catch {}
      }, 2000).unref();
      reject(new Error(`Resume review timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);
  });

  const runPromise = (async () => {
    try {
      const [stdoutText, stderrText] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);

      const exitCode = await proc.exited;

      if (exitCode !== 0) {
        const stderrFirstLine = stderrText.trim().split("\n")[0]?.slice(0, 200) || "unknown error";
        throw new Error(`Resume review subprocess exited with code ${exitCode}: ${stderrFirstLine}`);
      }

      const assistantText = extractAssistantResponseText(stdoutText);
      const wireReviews = parseJsonPayload(assistantText);
      const resolvedReviews = resolveModelWireReviews(wireReviews, excerptMaps);
      return validateResumeReviews(resolvedReviews, inputs);
    } finally {
      // Ensure process cleanup on any exit
      if (proc.exitCode === null && !didTimeout) {
        try {
          proc.kill("SIGTERM");
        } catch {}
      }
    }
  })();

  try {
    return await Promise.race([runPromise, timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
