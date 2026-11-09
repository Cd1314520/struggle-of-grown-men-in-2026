import { existsSync } from "node:fs";
import { errorMessage } from "./errors";

export type Platform =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workable"
  | "recruitee"
  | "smartrecruiters"
  | "workday"
  | "oracle"
  | "adp"
  | "ukg"
  | "icims"
  | "eightfold"
  | "breezy"
  | "jazzhr"
  | "bamboohr"
  | "taleo"
  | "successfactors"
  | "jobvite"
  | "paycom"
  | "paylocity"
  | "unknown";

export const PLATFORMS: readonly Platform[] = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "smartrecruiters",
  "workday",
  "oracle",
  "adp",
  "ukg",
  "icims",
  "eightfold",
  "breezy",
  "jazzhr",
  "bamboohr",
  "taleo",
  "successfactors",
  "jobvite",
  "paycom",
  "paylocity",
  "unknown",
];

export type DimensionId = "extractable" | "glyphs" | "contact" | "sections" | "dates" | "reading_order" | "bullets" | "structure";

export interface Dimension {
  id: DimensionId;
  label: string;
  score: number;
  weight: number;
  findings: string[];
}

export interface Keyword {
  term: string;
  kind: "required" | "preferred" | "general";
  weight: number;
  found: boolean;
}

export interface KeywordMatch {
  score: number;
  titleMatch: number;
  keywords: Keyword[];
}

export interface PlatformProfile {
  platform: Platform;
  label: string;
  tier: "parse-and-prefill" | "search-and-review" | "unknown";
  notes: string[];
}

export interface AtsReport {
  platform: PlatformProfile;
  parse: { score: number; dimensions: Dimension[] };
  match: KeywordMatch | null;
  overall: number;
  verdict: "pass" | "warn" | "fail";
  pages: number | null;
}

export interface ResumeExtraction {
  raw: string;
  layout: string;
  pages: number | null;
  fonts: { name: string; embedded: boolean }[];
}

export interface ScoreInput {
  pdf: string;
  posting: { url: string; title: string; description: string | null };
}

type Posting = ScoreInput["posting"];
type Tier = PlatformProfile["tier"];
type Kind = Keyword["kind"];
interface Part {
  score: number;
  findings: string[];
}

const HOST_RULES: readonly (readonly [Platform, RegExp])[] = [
  ["greenhouse", /(^|\.)greenhouse\.io$|^grnh\.se$/],
  ["lever", /(^|\.)lever\.co$/],
  ["ashby", /(^|\.)ashbyhq\.com$/],
  ["workable", /(^|\.)workable\.com$/],
  ["recruitee", /(^|\.)recruitee\.com$/],
  ["smartrecruiters", /(^|\.)smartrecruiters\.com$/],
  ["workday", /\.(myworkdayjobs|myworkdaysite)\.com$/],
  ["adp", /(^|\.)adp\.com$/],
  ["ukg", /(^|\.)(ultipro\.com|ukg\.net|ukg\.com)$/],
  ["icims", /(^|\.)icims\.com$/],
  ["eightfold", /(^|\.)eightfold\.ai$/],
  ["breezy", /(^|\.)breezy\.hr$/],
  ["jazzhr", /(^|\.)(applytojob|jazzhr)\.com$/],
  ["bamboohr", /(^|\.)bamboohr\.com$/],
  ["taleo", /(^|\.)taleo\.net$/],
  ["successfactors", /(^|\.)(successfactors|sapsf)\.(com|eu|cn)$/],
  ["jobvite", /(^|\.)jobvite\.com$/],
  ["paycom", /(^|\.)paycomonline\.net$/],
  ["paylocity", /(^|\.)paylocity\.com$/],
];

export function platformOf(url: string): Platform {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return "unknown";
  }
  const host = u.hostname.toLowerCase();
  if (host.endsWith(".oraclecloud.com") && (host.includes(".fa.") || /\/hcmUI\/CandidateExperience/i.test(u.pathname))) return "oracle";
  return HOST_RULES.find(([, re]) => re.test(host))?.[0] ?? "unknown";
}

const PROFILE_TABLE: Record<Platform, { label: string; tier: Tier }> = {
  greenhouse: { label: "Greenhouse", tier: "search-and-review" },
  lever: { label: "Lever", tier: "search-and-review" },
  ashby: { label: "Ashby", tier: "search-and-review" },
  workable: { label: "Workable", tier: "search-and-review" },
  recruitee: { label: "Recruitee", tier: "search-and-review" },
  smartrecruiters: { label: "SmartRecruiters", tier: "search-and-review" },
  breezy: { label: "Breezy HR", tier: "search-and-review" },
  jazzhr: { label: "JazzHR", tier: "search-and-review" },
  bamboohr: { label: "BambooHR", tier: "search-and-review" },
  eightfold: { label: "Eightfold", tier: "search-and-review" },
  workday: { label: "Workday", tier: "parse-and-prefill" },
  oracle: { label: "Oracle Recruiting", tier: "parse-and-prefill" },
  adp: { label: "ADP", tier: "parse-and-prefill" },
  ukg: { label: "UKG", tier: "parse-and-prefill" },
  icims: { label: "iCIMS", tier: "parse-and-prefill" },
  taleo: { label: "Taleo", tier: "parse-and-prefill" },
  successfactors: { label: "SAP SuccessFactors", tier: "parse-and-prefill" },
  jobvite: { label: "Jobvite", tier: "parse-and-prefill" },
  paycom: { label: "Paycom", tier: "parse-and-prefill" },
  paylocity: { label: "Paylocity", tier: "parse-and-prefill" },
  unknown: { label: "Unrecognised platform", tier: "unknown" },
};

const TIER_NOTES: Record<Tier, string[]> = {
  "parse-and-prefill": [
    "Heuristic tier: treated as a portal that parses the uploaded resume to prefill application fields, so contact, section, date and reading-order checks weigh more.",
    "The tiering is a heuristic, not vendor-validated.",
  ],
  "search-and-review": [
    "Heuristic tier: treated as a portal where recruiters search and review applications, so keyword coverage of the posting weighs more.",
    "The tiering is a heuristic, not vendor-validated.",
  ],
  unknown: ["The platform was not recognised from the URL, so default weights are used.", "Platform tiering is a heuristic, not vendor-validated."],
};

function profileOf(platform: Platform): PlatformProfile {
  const { label, tier } = PROFILE_TABLE[platform];
  return { platform, label, tier, notes: TIER_NOTES[tier] };
}

const DIMENSION_LABELS: Record<DimensionId, string> = {
  extractable: "Extractable text",
  glyphs: "Glyphs and encoding",
  contact: "Contact details",
  sections: "Section headings",
  dates: "Dates",
  reading_order: "Reading order",
  bullets: "Bullets",
  structure: "Document structure",
};

const DIMENSION_ORDER: readonly DimensionId[] = ["extractable", "glyphs", "contact", "sections", "dates", "reading_order", "bullets", "structure"];

const DIMENSION_WEIGHTS: Record<Tier, Record<DimensionId, number>> = {
  "parse-and-prefill": { extractable: 0.12, glyphs: 0.12, contact: 0.18, sections: 0.18, dates: 0.14, reading_order: 0.18, bullets: 0.03, structure: 0.05 },
  "search-and-review": { extractable: 0.17, glyphs: 0.15, contact: 0.13, sections: 0.13, dates: 0.08, reading_order: 0.15, bullets: 0.07, structure: 0.12 },
  unknown: { extractable: 0.15, glyphs: 0.15, contact: 0.15, sections: 0.15, dates: 0.1, reading_order: 0.15, bullets: 0.05, structure: 0.1 },
};

const OVERALL_WEIGHTS: Record<Tier, { parse: number; match: number }> = {
  "parse-and-prefill": { parse: 0.7, match: 0.3 },
  "search-and-review": { parse: 0.4, match: 0.6 },
  unknown: { parse: 0.55, match: 0.45 },
};

const KEYWORD_SHARE_OF_MATCH = 0.85;
const PASS_AT = 80;
const WARN_AT = 60;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const textLines = (s: string) =>
  s
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

function run(cmd: string[]): { ok: boolean; out: string; err: string } {
  try {
    const r = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
    return { ok: r.exitCode === 0, out: r.stdout.toString(), err: r.stderr.toString().trim() };
  } catch (err) {
    return { ok: false, out: "", err: errorMessage(err) };
  }
}

function parseFonts(out: string): ResumeExtraction["fonts"] {
  const fonts: ResumeExtraction["fonts"] = [];
  for (const line of out.split("\n").slice(2)) {
    const m = /^(\S+)\s+.*?\s(yes|no)\s+(?:yes|no)\s+(?:yes|no)\s+\d+\s+\d+\s*$/.exec(line);
    if (m?.[1]) fonts.push({ name: m[1], embedded: m[2] === "yes" });
  }
  return fonts;
}

export function extractResume(pdf: string): ResumeExtraction {
  if (!existsSync(pdf)) throw new Error(`Resume PDF not found: ${pdf}`);
  const raw = run(["pdftotext", "-raw", "-enc", "UTF-8", pdf, "-"]);
  if (!raw.ok) throw new Error(`Cannot read resume PDF ${pdf}: ${raw.err || "pdftotext failed"}`);
  const layout = run(["pdftotext", "-layout", "-enc", "UTF-8", pdf, "-"]);
  const info = run(["pdfinfo", pdf]);
  const fonts = run(["pdffonts", pdf]);
  const pages = /^Pages:\s+(\d+)/m.exec(info.out);
  return {
    raw: raw.out.replace(/\f/g, "\n"),
    layout: (layout.ok ? layout.out : raw.out).replace(/\f/g, "\n"),
    pages: pages?.[1] ? Number(pages[1]) : null,
    fonts: fonts.ok ? parseFonts(fonts.out) : [],
  };
}

const MONTH =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const YEAR = "(?:19|20)\\d{2}";
const DATE = `(?:${MONTH}\\s*,?\\s*${YEAR}|(?:0?[1-9]|1[0-2])\\s*[/.]\\s*${YEAR}|${YEAR}-(?:0[1-9]|1[0-2])|${YEAR}|present|current|now|ongoing|today)`;
const EDGE_BEFORE = "(?<![A-Za-z0-9])";
const EDGE_AFTER = "(?![A-Za-z0-9])";
const RANGE_RE = new RegExp(`${EDGE_BEFORE}(${DATE})${EDGE_AFTER}\\s*(?:-|–|—|to|until|through)\\s*${EDGE_BEFORE}(${DATE})${EDGE_AFTER}`, "gi");
const DATE_RE = new RegExp(`${EDGE_BEFORE}(?:${DATE})${EDGE_AFTER}`, "gi");

type DateKind = "present" | "month-year" | "numeric" | "year";

function dateKind(token: string): DateKind {
  const t = token.trim().toLowerCase();
  if (/^(present|current|now|ongoing|today)$/.test(t)) return "present";
  if (/^[a-z]/.test(t)) return "month-year";
  if (/^\d{4}$/.test(t)) return "year";
  return "numeric";
}

const DATE_KIND_LABEL: Record<DateKind, string> = { present: "Present", "month-year": "Mon YYYY", numeric: "MM/YYYY", year: "YYYY" };

const flat = (s: string) => s.normalize("NFKC").replace(/\s+/g, " ").trim();

function extractable(x: ResumeExtraction): Part {
  const findings: string[] = [];
  const dense = x.raw.replace(/\s+/g, "");
  if (dense.length < 100)
    return { score: 0, findings: ["Almost no text could be extracted; the PDF looks image-only or empty, so an ATS would read nothing."] };
  const perPage = dense.length / Math.max(1, x.pages ?? 1);
  let score = clamp01(perPage / 700);
  if (score < 1) findings.push(`Only ${Math.round(perPage)} characters of text per page were extracted.`);
  const letters = dense.match(/\p{L}/gu)?.length ?? 0;
  if (letters / dense.length < 0.5) {
    score *= 0.7;
    findings.push("Less than half of the extracted characters are letters; the text may be garbled.");
  }
  const tokens = x.raw.split(/\s+/).filter(Boolean);
  const singles = tokens.filter(t => /^\p{L}$/u.test(t)).length;
  if (tokens.length >= 40 && singles / tokens.length > 0.25) {
    score *= 0.5;
    findings.push("Many single-letter tokens suggest letter-spaced or split text that keyword matching cannot read.");
  }
  return { score: clamp01(score), findings };
}

interface GlyphRule {
  fails: boolean;
  label: string;
  test: (cp: number) => boolean;
}

const GLYPH_RULES: readonly GlyphRule[] = [
  { fails: true, label: "ligature codepoint", test: cp => cp >= 0xfb00 && cp <= 0xfb06 },
  { fails: true, label: "replacement character", test: cp => cp === 0xfffd },
  { fails: true, label: "private-use codepoint (usually a font-subset icon or bullet)", test: cp => (cp >= 0xe000 && cp <= 0xf8ff) || cp >= 0xf0000 },
  { fails: true, label: "zero-width character", test: cp => cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x2060 || cp === 0xfeff },
  { fails: true, label: "control character", test: cp => cp < 32 && cp !== 9 && cp !== 10 && cp !== 13 },
  { fails: false, label: "smart quote", test: cp => cp === 0x2018 || cp === 0x2019 || cp === 0x201c || cp === 0x201d },
  { fails: false, label: "en/em dash outside a date range", test: cp => cp === 0x2013 || cp === 0x2014 },
  { fails: false, label: "ellipsis character", test: cp => cp === 0x2026 },
];

function glyphs(x: ResumeExtraction): Part {
  const text = x.raw.replace(RANGE_RE, " ");
  const hits = new Map<number, number>();
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (GLYPH_RULES.some(r => r.test(cp))) hits.set(cp, (hits.get(cp) ?? 0) + 1);
  }
  const findings: string[] = [];
  let failing = false;
  const warnKinds = new Set<string>();
  for (const [cp, n] of hits) {
    const rule = GLYPH_RULES.find(r => r.test(cp));
    if (!rule) continue;
    const hex = `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`;
    if (rule.fails) {
      failing = true;
      findings.push(`${rule.label} ${hex} appears ${plural(n, "time")}; an ATS may drop or garble it.`);
    } else {
      warnKinds.add(rule.label);
      findings.push(`${rule.label} ${hex} appears ${plural(n, "time")}; some parsers mishandle it.`);
    }
  }
  return { score: failing ? 0 : 1 - Math.min(0.15, warnKinds.size * 0.05), findings };
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /(?:\+?\d{1,2}[\s.-])?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\+\d[\d\s().-]{8,}\d/;
const LOCATION_RE = /\b[A-Z][A-Za-z.]+(?:[ -][A-Z][A-Za-z.]+)*,\s*(?:[A-Z]{2}\b|[A-Z][a-z]+)|\bRemote\b/;

function looksLikeName(line: string): boolean {
  const head = (line.split(/\s[|•·–—-]\s|\||,/)[0] ?? "").trim();
  if (!head || head.length > 50 || /[\d@]/.test(head)) return false;
  const words = head.split(/\s+/);
  return words.length >= 2 && words.length <= 5 && words.every(w => /^[\p{Lu}][\p{L}.'’-]*$/u.test(w));
}

function contact(x: ResumeExtraction): Part {
  const lines = textLines(x.raw);
  const head = lines.slice(0, 10).join("\n");
  const findings: string[] = [];
  const name = looksLikeName(lines[0] ?? "");
  const email = EMAIL_RE.test(x.raw);
  const phone = PHONE_RE.test(x.raw);
  const location = LOCATION_RE.test(lines.slice(0, 8).join("\n"));
  if (!name) findings.push("The first line does not look like a candidate name.");
  if (!email) findings.push("No email address found.");
  if (!phone) findings.push("No phone number found.");
  if (!location) findings.push("No city/state location found in the header.");
  let score = (name ? 0.3 : 0) + (email ? 0.3 : 0) + (phone ? 0.25 : 0) + (location ? 0.15 : 0);
  if ((email && !EMAIL_RE.test(head)) || (phone && !PHONE_RE.test(head))) {
    score *= 0.9;
    findings.push("Email or phone sits below the header block, where parsers may not look.");
  }
  if (/linkedin/i.test(x.raw) && !/linkedin\.com\/in\//i.test(x.raw))
    findings.push("LinkedIn appears as a label without a readable URL; the link target is not in the text layer.");
  return { score: clamp01(score), findings };
}

type SectionKey = "summary" | "experience" | "education" | "skills" | "projects" | "certifications" | "awards" | "publications" | "volunteer" | "languages";

const SECTION_ALIASES: Record<SectionKey, string[]> = {
  summary: [
    "summary",
    "professional summary",
    "executive summary",
    "career summary",
    "profile",
    "professional profile",
    "about me",
    "about",
    "objective",
    "career objective",
    "overview",
    "personal statement",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "work history",
    "employment",
    "employment history",
    "career history",
    "relevant experience",
    "professional background",
    "industry experience",
    "research experience",
    "technical experience",
    "internships",
  ],
  education: ["education", "academic background", "academics", "academic history", "education and training", "academic qualifications"],
  skills: [
    "skills",
    "technical skills",
    "core skills",
    "key skills",
    "core competencies",
    "competencies",
    "technologies",
    "tech stack",
    "technical proficiencies",
    "tools",
    "skills and tools",
    "areas of expertise",
    "expertise",
    "technical expertise",
  ],
  projects: [
    "projects",
    "personal projects",
    "selected projects",
    "side projects",
    "technical projects",
    "academic projects",
    "key projects",
    "open source",
    "open source contributions",
  ],
  certifications: ["certifications", "certificates", "licenses", "licenses and certifications", "certifications and licenses", "licensure", "training"],
  awards: ["awards", "honors", "honors and awards", "awards and honors", "achievements", "accomplishments", "recognition"],
  publications: ["publications", "papers", "research"],
  volunteer: ["volunteer", "volunteering", "volunteer experience", "community", "leadership", "extracurricular", "activities"],
  languages: ["languages"],
};

const SECTION_BY_ALIAS = new Map<string, SectionKey>(
  Object.entries(SECTION_ALIASES).flatMap(([key, aliases]) => aliases.map(a => [a, key as SectionKey] as const)),
);

function headingKeys(line: string): SectionKey[] {
  const h = line
    .toLowerCase()
    .replace(/^[^a-z]+|[^a-z]+$/g, "")
    .replace(/\s+/g, " ");
  if (!h || h.length > 40) return [];
  const whole = SECTION_BY_ALIAS.get(h.replace(/&/g, "and"));
  if (whole) return [whole];
  const parts = h.split(/\s*(?:&|\/|,|\band\b|\|)\s*/).filter(Boolean);
  const keys = parts.map(p => SECTION_BY_ALIAS.get(p));
  return parts.length > 1 && keys.every(Boolean) ? (keys as SectionKey[]) : [];
}

function layoutSegments(layout: string): string[] {
  return textLines(layout).flatMap(l => l.split(/\s{2,}/).filter(Boolean));
}

function sections(x: ResumeExtraction): Part {
  const found = new Set<SectionKey>();
  const candidates = [...textLines(x.raw), ...layoutSegments(x.layout)];
  for (const line of candidates) for (const k of headingKeys(line)) found.add(k);
  const findings: string[] = [];
  const experience = found.has("experience") || found.has("projects");
  const core = [experience, found.has("education"), found.has("skills")];
  if (!experience) findings.push("No Experience (or Projects) heading recognised; use a standard heading such as 'Work Experience'.");
  if (!found.has("education")) findings.push("No Education heading recognised.");
  if (!found.has("skills")) findings.push("No Skills heading recognised.");
  let score = core.filter(Boolean).length / core.length;
  const lines = textLines(x.raw).slice(2);
  const odd = lines.filter(l => /^[A-Z][A-Z &/]{3,38}$/.test(l) && headingKeys(l).length === 0 && !SECTION_BY_ALIAS.has(l.toLowerCase()));
  if (odd.length) {
    score = Math.max(0, score - Math.min(0.1, odd.length * 0.05));
    findings.push(`Non-standard heading${odd.length === 1 ? "" : "s"} may not be recognised: ${odd.slice(0, 3).join(", ")}.`);
  }
  return { score, findings };
}

function dates(x: ResumeExtraction, strict: boolean): Part {
  const text = flat(x.raw);
  const findings: string[] = [];
  const ranges = [...text.matchAll(RANGE_RE)];
  const lone = (text.replace(RANGE_RE, " ").match(DATE_RE) ?? []).filter(d => dateKind(d) !== "present");
  if (!ranges.length) {
    if (lone.length) {
      findings.push("Dates appear but no start–end ranges were recognised for jobs.");
      return { score: 0.5, findings };
    }
    findings.push("No dates were recognised; experience entries need start and end dates.");
    return { score: 0.2, findings };
  }
  const kinds = new Set<DateKind>();
  for (const m of ranges) for (const tok of [m[1], m[2]]) if (tok && dateKind(tok) !== "present") kinds.add(dateKind(tok));
  let score = 1;
  if (kinds.size > 1) {
    score -= 0.2;
    findings.push(`Date formats are mixed (${[...kinds].map(k => DATE_KIND_LABEL[k]).join(", ")}); use one format throughout.`);
  }
  if (kinds.size === 1 && kinds.has("year")) {
    score -= strict ? 0.25 : 0.1;
    findings.push("Date ranges use years only; Mon YYYY or MM/YYYY is easier to parse.");
  }
  return { score: clamp01(score), findings };
}

function readingOrder(x: ResumeExtraction): Part {
  const findings: string[] = [];
  let score = 1;
  const rawFlat = flat(x.raw).toLowerCase();
  const keys = layoutSegments(x.layout)
    .map(s => flat(s).toLowerCase())
    .filter(s => s.split(" ").length >= 4)
    .map(s => s.split(" ").slice(0, 5).join(" "));
  const positions: number[] = [];
  let missing = 0;
  for (const key of keys) {
    const at = rawFlat.indexOf(key);
    if (at < 0) missing++;
    else if (rawFlat.lastIndexOf(key) === at) positions.push(at);
  }
  if (keys.length >= 8 && missing / keys.length > 0.25) {
    score = 0.6;
    findings.push("Text extracted in layout mode does not line up with content-stream extraction; the page structure may be scrambled.");
  }
  if (positions.length >= 8) {
    let ordered = 0;
    for (let i = 1; i < positions.length; i++) if ((positions[i] ?? 0) > (positions[i - 1] ?? 0)) ordered++;
    const ratio = ordered / (positions.length - 1);
    if (ratio < 0.95) {
      score = Math.min(score, clamp01((ratio - 0.5) / 0.45));
      findings.push(`Only ${Math.round(ratio * 100)}% of the text blocks read in visual order; columns or floating boxes may interleave.`);
    }
  }
  const wide = textLines(x.layout).filter(l => {
    const parts = l.split(/\s{4,}/);
    return parts.length === 2 && (parts[0]?.length ?? 0) >= 25 && (parts[1]?.length ?? 0) >= 25 && !/^[•●◦▪]/.test(l);
  });
  if (wide.length >= 5) {
    score = Math.min(score, 0.7);
    findings.push("Side-by-side columns detected; many parsers read columns in the wrong order.");
  }
  return { score, findings };
}

const STANDARD_BULLETS = new Set("•●◦▪▫‣⁃∙·*");
const ODD_BULLETS = new Set("➢➤►▶■□◆◇❖✓✔✦★☆➔→»");

function bullets(x: ResumeExtraction): Part {
  let standard = 0;
  let odd = 0;
  let broken = 0;
  let stranded = 0;
  for (const line of textLines(x.raw)) {
    const first = line.codePointAt(0) ?? 0;
    const ch = String.fromCodePoint(first);
    const rest = line.slice(ch.length);
    const bulletLike = rest === "" || /^\s/.test(rest);
    if (!bulletLike) continue;
    if (STANDARD_BULLETS.has(ch) || (/^[-–—]$/.test(ch) && rest !== "")) standard++;
    else if ((first >= 0xe000 && first <= 0xf8ff) || first === 0xfffd) broken++;
    else if (ODD_BULLETS.has(ch) || (/^\p{S}$/u.test(ch) && rest !== "")) odd++;
    else continue;
    if (rest.trim() === "") stranded++;
  }
  const total = standard + odd + broken;
  const findings: string[] = [];
  if (!total) return { score: 0.85, findings: ["No bullet markers found; paragraph-style entries parse but are harder to scan."] };
  let score = (standard + odd * 0.5) / total;
  if (odd) findings.push(`${plural(odd, "bullet")} use uncommon symbols; stick to • or -.`);
  if (broken) findings.push(`${plural(broken, "bullet")} use private-use or unreadable glyphs.`);
  if (stranded) {
    score *= 0.8;
    findings.push(`${plural(stranded, "bullet marker")} sit on a line of their own, detached from their text.`);
  }
  return { score: clamp01(score), findings };
}

function structure(x: ResumeExtraction): Part {
  const findings: string[] = [];
  let pageScore = 1;
  if (x.pages === null) findings.push("Page count could not be read.");
  else if (x.pages === 3) {
    pageScore = 0.7;
    findings.push("The resume runs to 3 pages.");
  } else if (x.pages >= 4) {
    pageScore = 0.4;
    findings.push(`The resume runs to ${x.pages} pages.`);
  }
  let fontScore = 1;
  if (!x.fonts.length) {
    fontScore = 0.9;
    findings.push("Font information could not be read from the PDF.");
  } else {
    const loose = x.fonts.filter(f => !f.embedded);
    if (loose.length) {
      fontScore = 1 - 0.5 * (loose.length / x.fonts.length);
      findings.push(
        `${plural(loose.length, "font")} not embedded: ${loose
          .slice(0, 3)
          .map(f => f.name)
          .join(", ")}.`,
      );
    }
  }
  return { score: clamp01(pageScore * fontScore), findings };
}

interface Variant {
  text: string;
  cs: boolean;
}

interface Group {
  display: string;
  detect: Variant[];
  match: Variant[];
}

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[-\u2010-\u2015_/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const regexCache = new Map<string, RegExp>();

function variantRegex({ text, cs }: Variant): RegExp {
  const key = `${cs ? "=" : ""}${text}`;
  const cached = regexCache.get(key);
  if (cached) return cached;
  const body = escapeRe(norm(text));
  let pattern = body;
  if (/[A-Za-z]$/.test(body)) pattern = /[^aeiou]y$/i.test(body) ? `(?:${body.slice(0, -1)}ies|${body}(?:s|es)?)` : `${body}(?:s|es)?`;
  const re = new RegExp(`(?<![A-Za-z0-9+#.])${pattern}(?![A-Za-z0-9+#]|\\.[A-Za-z0-9])`, cs ? "" : "i");
  regexCache.set(key, re);
  return re;
}

const globalRegex = (re: RegExp) => new RegExp(re.source, `${re.flags}g`);

const hasAny = (text: string, variants: Variant[]) => variants.some(v => variantRegex(v).test(text));

function parseGroup(spec: string): Group {
  const parts = spec.split("|").map(p => p.trim());
  const toVariant = (p: string): Variant => (p.startsWith("=") ? { text: p.slice(1), cs: true } : { text: p, cs: false });
  const display = (parts[0] ?? "").replace(/^[=~]/, "");
  const matchOnly = (p: string) => p.startsWith("~");
  return {
    display,
    detect: parts.filter(p => !matchOnly(p)).map(toVariant),
    match: parts.map(p => toVariant(p.replace(/^~/, ""))),
  };
}

const LEXICON_SPECS = [
  "JavaScript|js|ecmascript",
  "TypeScript|~ts",
  "Python",
  "Java",
  "C++|cpp",
  "C#|csharp|c sharp",
  "=Go|golang",
  "Rust",
  "Ruby",
  "PHP",
  "=Swift",
  "Kotlin",
  "Scala",
  "Objective-C",
  "Perl",
  "Bash|shell scripting|shell script",
  "SQL",
  "PL/SQL|plsql",
  "T-SQL|tsql",
  "MATLAB",
  "Elixir",
  "Erlang",
  "Haskell",
  "Clojure",
  "Lua",
  "Dart",
  "Groovy",
  "PowerShell",
  "VBA",
  "COBOL",
  "Fortran",
  "Verilog",
  "VHDL",
  "HTML|html5",
  "CSS|css3",
  "Sass|scss",
  "GraphQL",
  "=REST|restful|rest api",
  "gRPC",
  "=React|react.js|reactjs",
  "React Native",
  "Next.js|nextjs",
  "Vue|vue.js|vuejs",
  "Angular|angularjs",
  "Svelte|sveltekit",
  "Node.js|nodejs|~node",
  "Express|express.js|expressjs",
  "Django",
  "Flask",
  "FastAPI",
  "Spring|spring boot|springboot",
  ".NET|dotnet|asp.net|.net core",
  "Rails|ruby on rails",
  "Laravel",
  "jQuery",
  "Redux",
  "Tailwind|tailwindcss",
  "Bootstrap",
  "Flutter",
  "Electron",
  "PyTorch",
  "TensorFlow",
  "Keras",
  "scikit-learn|sklearn",
  "pandas",
  "NumPy",
  "SciPy",
  "=Spark|apache spark|pyspark",
  "Hadoop",
  "Kafka",
  "Airflow",
  "dbt",
  "Snowflake",
  "Databricks",
  "Redshift",
  "BigQuery",
  "Elasticsearch|opensearch",
  "Redis",
  "MongoDB|mongo",
  "PostgreSQL|postgres|psql",
  "MySQL",
  "SQL Server|mssql|microsoft sql server",
  "SQLite",
  "DynamoDB",
  "Cassandra",
  "NoSQL",
  "Kubernetes|k8s",
  "Docker",
  "Terraform",
  "Ansible",
  "CI/CD|cicd|continuous integration|continuous delivery|continuous deployment",
  "Jenkins",
  "GitHub Actions",
  "GitLab",
  "Git",
  "GitHub",
  "AWS|amazon web services",
  "Azure|microsoft azure",
  "GCP|google cloud|google cloud platform",
  "EC2",
  "S3",
  "Linux",
  "Unix",
  "=ROS|ros2|ros 2",
  "Jira",
  "Confluence",
  "Figma",
  "Tableau",
  "Power BI|powerbi",
  "Excel",
  "Salesforce",
  "SAP",
  "ServiceNow",
  "Splunk",
  "Datadog",
  "Grafana",
  "Prometheus",
  "Kibana",
  "Machine Learning|=ML",
  "Deep Learning",
  "NLP|natural language processing",
  "Computer Vision",
  "LLM|large language model",
  "Generative AI|genai|gen ai",
  "=AI|artificial intelligence",
  "Computer Science|=CS",
  "Data Science",
  "Data Engineering",
  "Data Analysis|data analytics",
  "ETL|elt",
  "Data Pipeline",
  "Data Warehouse|data warehousing",
  "Microservice|microservices architecture",
  "Distributed Systems",
  "API",
  "OOP|object oriented|object oriented programming",
  "Data Structures",
  "Algorithms",
  "System Design",
  "Unit Testing|unit test",
  "Test Automation|automated testing",
  "TDD|test driven development",
  "Agile",
  "Scrum",
  "Kanban",
  "DevOps",
  "SRE|site reliability",
  "OAuth",
  "SAML",
  "LDAP",
  "TCP/IP",
  "Embedded Systems|embedded software",
  "Firmware",
  "RTOS",
  "Frontend|front end",
  "Backend|back end",
  "Full Stack|fullstack",
  "iOS",
  "Android",
  "Accessibility|wcag|a11y",
  "Project Management",
  "Product Management",
  "Stakeholder Management",
  "SaaS|software as a service",
  "CRM",
  "ERP",
  "SEO",
];

const LEXICON: readonly Group[] = LEXICON_SPECS.map(parseGroup);

const VARIANT_CONTEXT: Record<string, RegExp> = {
  Go: /[,/(]\s*Go\b(?![\s-]*(?:to|beyond))|\bGo\s*[,/)]|\bGo\s+(?:programming|language|lang)\b|\b(?:in|with|using|and)\s+Go\b/,
};

const GROUP_BY_VARIANT = new Map<string, Group>(LEXICON.flatMap(g => g.match.map(v => [norm(v.text).toLowerCase(), g] as const)));

const ROLE_SYNONYMS = [["engineer", "developer", "programmer"]];

const TITLE_NOISE = new Set([
  "senior",
  "sr",
  "jr",
  "junior",
  "lead",
  "staff",
  "principal",
  "ii",
  "iii",
  "iv",
  "i",
  "remote",
  "hybrid",
  "and",
  "of",
  "the",
  "for",
  "a",
  "in",
  "at",
  "to",
  "or",
]);

const IGNORED_WORDS = new Set(
  (
    "we you our your the this that these those join will must should can may and or with for from into about all any are is be been have has having not but also including such other more most " +
    "experience knowledge skills skill ability abilities strong excellent proven solid good great deep extensive relevant prior demonstrated hands-on years year plus bonus preferred required " +
    "minimum degree bachelor bachelors master masters phd doctorate associate diploma equivalent field related areas area tools tool technologies technology methodologies methodology " +
    "principles practices concepts frameworks framework systems team teams company role roles position job candidate candidates employee employees employer opportunity opportunities " +
    "benefits insurance health medical dental vision vacation holidays salary compensation pay bonus equity stock remote hybrid onsite location locations united states usa us uk eu " +
    "english spanish french german monday tuesday wednesday thursday friday saturday sunday january february march april june july august september october november december " +
    "inc llc ltd corp ceo cto cfo vp hr pto eeo faq ok mr ms mrs dr new york city san francisco los angeles"
  ).split(" "),
);

const SECTION_PATTERNS = {
  preferred: /\b(nice[- ]to[- ]haves?|preferred|bonus|a plus|desirable|desired|good to have|ideal(?:ly)?|extra credit|great to have|pluses)\b/i,
  required:
    /\b(requirements?|qualifications?|must[- ]haves?|minimum|what you(?:'|’)?ll (?:bring|need)|what we(?:'|’)?re looking for|who you are|you have|about you|your (?:skills|profile|background)|required|mandatory|key skills|essential|you bring|what you bring)\b/i,
  general:
    /\b(responsibilit\w*|what you(?:'|’)?ll do|about (?:us|the (?:company|role|team|job))|benefits?|perks|what we offer|we offer|total rewards|compensation|salary|pay|how to apply|equal opportunity|the role|overview|your role|day[- ]to[- ]day|why join|who we are|our (?:mission|culture|team)|diversity|culture)\b/i,
};

const INLINE_PREFERRED =
  /\b(nice[- ]to[- ]have|preferred|bonus|(?:is|are|would be) (?:a|an) (?:big |huge )?(?:plus|bonus|advantage)|a plus|desirable|desired|ideally)\b/i;
const INLINE_REQUIRED = /(?<!not\s)(?<!no\s)\b(required|must[- ]have|mandatory|minimum of|at least \d+|\d+\+?\s+years)/i;
const BOILERPLATE =
  /equal opportunity|\beeo\b|reasonable accommodation|protected (?:veteran|class)|e-verify|privacy (?:policy|notice)|\b(?:medical|dental|vision|401\(?k\)?|hsa|fsa|pto)\b|paid (?:time off|group|holidays?|leave|parental)|health (?:insurance|savings)|life insurance/i;

const CUE_RE =
  /\b(?:experience (?:with|in|using|of)|proficien(?:t|cy) (?:in|with)|knowledge of|familiar(?:ity)? with|expertise in|such as|e\.g\.,?|including|like|hands-on experience (?:with|in)|working with|skills? in|background in|exposure to|understanding of)\s+([^.;:]*)/gi;

const KIND_RANK: Record<Kind, number> = { general: 0, preferred: 1, required: 2 };
const KIND_WEIGHT: Record<Kind, number> = { required: 3, preferred: 1.5, general: 1 };
const MAX_KEYWORDS = 40;
const MIN_KEYWORDS = 3;

interface Candidate {
  key: string;
  term: string;
  kind: Kind;
  shape: number;
  count: number;
  order: number;
  variants: Variant[];
}

function headingKind(line: string): Kind | null {
  if (SECTION_PATTERNS.preferred.test(line)) return "preferred";
  if (SECTION_PATTERNS.required.test(line)) return "required";
  if (SECTION_PATTERNS.general.test(line)) return "general";
  return null;
}

const wordsOf = (term: string) => term.split(/\s+/).filter(Boolean);
const isIgnored = (word: string) => IGNORED_WORDS.has(word.toLowerCase().replace(/[^a-z-]/g, ""));

function trimIgnored(words: string[]): string[] {
  let from = 0;
  let to = words.length;
  while (from < to && isIgnored(words[from] ?? "")) from++;
  while (to > from && isIgnored(words[to - 1] ?? "")) to--;
  return words.slice(from, to);
}

function extractKeywords(description: string, title: string): { term: string; kind: Kind; weight: number; variants: Variant[] }[] {
  const candidates = new Map<string, Candidate>();
  const titleNorm = norm(title);
  let order = 0;

  const add = (key: string, term: string, kind: Kind, shape: number, variants: Variant[]) => {
    const existing = candidates.get(key);
    if (existing) {
      existing.count++;
      if (KIND_RANK[kind] > KIND_RANK[existing.kind]) existing.kind = kind;
      existing.shape = Math.max(existing.shape, shape);
      return;
    }
    candidates.set(key, { key, term, kind, shape, count: 1, order: order++, variants });
  };

  const addHeuristic = (rawTerm: string, kind: Kind, shape: number) => {
    const words = trimIgnored(wordsOf(rawTerm.replace(/^[^\w.#+]+|[^\w.#+]+$/g, "")));
    const term = words.join(" ");
    if (term.length < 2 || term.length > 40 || /^\d+$/.test(term)) return;
    if (/^(?:i{1,3}|iv|v)$/i.test(term)) return;
    const key = norm(term).toLowerCase();
    if (GROUP_BY_VARIANT.has(key)) return;
    const singular = /[A-Z0-9]s$/.test(term) ? term.slice(0, -1) : term;
    add(`h:${key.replace(/([A-Z0-9])s$/i, "$1")}`, term, kind, shape, [{ text: singular, cs: false }]);
  };

  let section: Kind = "general";
  for (const original of description.split(/\r?\n/)) {
    let plain = original
      .replace(/^[\s>#*•\-–—·▪●◦]+/, "")
      .replace(/[*_`]+/g, "")
      .trim();
    if (!plain || BOILERPLATE.test(plain)) continue;
    let kind = section;
    const colon = plain.indexOf(":");
    const prefix = colon > 0 ? plain.slice(0, colon) : "";
    const prefixKind = prefix && prefix.length <= 50 ? headingKind(prefix) : null;
    if (prefixKind) {
      section = prefixKind;
      kind = prefixKind;
      plain = plain.slice(colon + 1).trim();
      if (!plain) continue;
    } else if (plain.length <= 80 && plain.split(/\s+/).length <= 10 && !plain.endsWith(".")) {
      const k = headingKind(plain);
      if (k) {
        section = k;
        continue;
      }
    }
    if (INLINE_PREFERRED.test(plain)) kind = "preferred";
    else if (INLINE_REQUIRED.test(plain)) kind = "required";

    const lineNorm = norm(plain);
    for (const group of LEXICON) {
      let count = 0;
      for (const v of group.detect) {
        const ctx = v.cs ? VARIANT_CONTEXT[v.text] : undefined;
        if (ctx && !ctx.test(plain)) continue;
        count += lineNorm.match(globalRegex(variantRegex(v)))?.length ?? 0;
      }
      for (let i = 0; i < count; i++) add(`g:${group.display}`, group.display, kind, 1.5, group.match);
    }
    if (kind === "general") continue;

    for (const m of plain.matchAll(/(?<![\w])[A-Za-z][A-Za-z0-9]*(?:\+\+|#)(?![A-Za-z0-9])|\b[A-Za-z][A-Za-z0-9]*\.(?:js|io|py|ai)\b/g))
      addHeuristic(m[0], kind, 1.3);
    for (const m of plain.matchAll(/\b[a-z]*[A-Z]?[a-z]+[A-Z][A-Za-z]*\b/g)) if (/[a-z][A-Z]/.test(m[0])) addHeuristic(m[0], kind, 1.2);
    if (/[a-z]/.test(plain)) for (const m of plain.matchAll(/\b[A-Z]{3,6}s?\b/g)) if (!isIgnored(m[0])) addHeuristic(m[0], kind, 1.2);

    for (const cue of plain.replace(/[()]/g, ",").matchAll(CUE_RE)) {
      for (const item of (cue[1] ?? "").split(/,|\/|\band\b|\bor\b|&|\+/)) {
        const words = trimIgnored(wordsOf(item.replace(/^(?:with|using|in|the|a|an)\s+/i, "")));
        if (!words.length || words.length > 3 || !words.every(w => /^[A-Z]/.test(w))) continue;
        addHeuristic(words.join(" "), kind, 1.1);
      }
    }

    for (const m of plain.matchAll(/(?<![\w-])[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){1,3}\b/g)) {
      const words = wordsOf(m[0]);
      const before = plain.slice(0, m.index).trimEnd();
      if (!before || /[.!?:;]$/.test(before)) words.shift();
      const kept = trimIgnored(words);
      if (kept.length >= 2) addHeuristic(kept.join(" "), kind, 1);
    }
  }

  const heuristic = [...candidates.values()].filter(c => c.key.startsWith("h:"));
  const phrase = (c: Candidate) => ` ${norm(c.term).toLowerCase()} `;
  const redundant = new Set(
    heuristic
      .filter(
        c =>
          LEXICON.some(g => g.detect.some(v => variantRegex(v).test(norm(c.term)))) ||
          heuristic.some(o => o !== c && phrase(o).length > phrase(c).length && phrase(o).includes(phrase(c))),
      )
      .map(c => c.key),
  );
  const scored = [...candidates.values()]
    .filter(c => !redundant.has(c.key))
    .map(c => {
      const inTitle = hasAny(titleNorm, c.variants);
      const weight = KIND_WEIGHT[c.kind] * c.shape * (1 + 0.2 * Math.min(c.count - 1, 4)) * (inTitle ? 1.5 : 1);
      return { c, weight };
    });
  scored.sort((a, b) => b.weight - a.weight || a.c.order - b.c.order);
  const top = scored.slice(0, MAX_KEYWORDS);
  const sum = top.reduce((s, t) => s + t.weight, 0);
  return top.map(({ c, weight }) => ({ term: c.term, kind: c.kind, weight: weight / sum, variants: c.variants }));
}

function titleTokens(title: string): string[] {
  return (
    norm(title)
      .toLowerCase()
      .match(/[a-z0-9+#.]+/g)
      ?.filter(t => !TITLE_NOISE.has(t) && t.length > 1) ?? []
  );
}

function titleMatch(title: string, resumeNorm: string): number {
  const tokens = titleTokens(title);
  if (!tokens.length) return 1;
  if (resumeNorm.toLowerCase().includes(norm(title).toLowerCase())) return 1;
  const hits = tokens.filter(t => {
    const synonyms = ROLE_SYNONYMS.find(g => g.includes(t)) ?? [t];
    const group = GROUP_BY_VARIANT.get(t);
    return hasAny(resumeNorm, [...synonyms.map(text => ({ text, cs: false })), ...(group?.match ?? [])]);
  });
  return hits.length / tokens.length;
}

function matchKeywords(x: ResumeExtraction, posting: Posting): KeywordMatch | null {
  const description = posting.description?.trim();
  if (!description) return null;
  const extracted = extractKeywords(description, posting.title);
  if (extracted.length < MIN_KEYWORDS) return null;
  const resumeNorm = norm(x.raw);
  const keywords: Keyword[] = extracted.map(k => ({
    term: k.term,
    kind: k.kind,
    weight: Math.round(k.weight * 10000) / 10000,
    found: hasAny(resumeNorm, k.variants),
  }));
  const total = extracted.reduce((s, k) => s + k.weight, 0);
  const hit = extracted.reduce((s, k, i) => s + (keywords[i]?.found ? k.weight : 0), 0);
  return { score: clamp01(hit / total), titleMatch: titleMatch(posting.title, resumeNorm), keywords };
}

function normalisedWeights(tier: Tier): Record<DimensionId, number> {
  const base = DIMENSION_WEIGHTS[tier];
  const sum = DIMENSION_ORDER.reduce((s, id) => s + base[id], 0);
  return Object.fromEntries(DIMENSION_ORDER.map(id => [id, base[id] / sum])) as Record<DimensionId, number>;
}

export function scoreText(extraction: ResumeExtraction, posting: Posting): AtsReport {
  const platform = profileOf(platformOf(posting.url));
  const parts: Record<DimensionId, Part> = {
    extractable: extractable(extraction),
    glyphs: glyphs(extraction),
    contact: contact(extraction),
    sections: sections(extraction),
    dates: dates(extraction, platform.tier === "parse-and-prefill"),
    reading_order: readingOrder(extraction),
    bullets: bullets(extraction),
    structure: structure(extraction),
  };
  const weights = normalisedWeights(platform.tier);
  const dimensions: Dimension[] = DIMENSION_ORDER.map(id => ({
    id,
    label: DIMENSION_LABELS[id],
    score: parts[id].score,
    weight: weights[id],
    findings: parts[id].findings,
  }));
  const parseScore = dimensions.reduce((s, d) => s + d.score * d.weight, 0);
  const match = matchKeywords(extraction, posting);
  const blend = OVERALL_WEIGHTS[platform.tier];
  const combined = match
    ? blend.parse * parseScore + blend.match * (KEYWORD_SHARE_OF_MATCH * match.score + (1 - KEYWORD_SHARE_OF_MATCH) * match.titleMatch)
    : parseScore;
  const overall = Math.round(100 * clamp01(combined));
  const broken = parts.glyphs.score === 0 || parts.extractable.score === 0;
  const verdict = broken || overall < WARN_AT ? "fail" : overall >= PASS_AT ? "pass" : "warn";
  return { platform, parse: { score: parseScore, dimensions }, match, overall, verdict, pages: extraction.pages };
}

export function scoreResume(input: ScoreInput): AtsReport {
  return scoreText(extractResume(input.pdf), input.posting);
}
