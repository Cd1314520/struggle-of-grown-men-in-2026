// The order triaged jobs are assessed in, one at a time under limits.prepPerDay. profile/priority.yml
// (optional) gives each a keyword score, no model: points for the title's tier, for how well the
// posting's skills match the resumes, for the place, the year welcome, a frontier employer, a fresh
// posting and a close deadline, less for skills required but missing and for what rules the candidate
// out, and more for a likely startup. The highest is assessed first; ties, and every job when there
// is no file, the most recently opened.
import YAML from "yaml";
import { companyKey, getJob, logEvent, openedAt, triagedJobs, type Job } from "./db";
import { employerListing, loadEmployers } from "./employers";
import { errorMessage } from "./errors";
import { readProfile } from "./config";

// profile/priority.yml. Every pattern is a case-insensitive regular expression.
interface Rules {
  tiers?: { points: number; title: string }[]; // by title, the first that matches; none: 0
  fit?: {
    weight: number; // points per fit point; fit runs 0 to 100
    perHit: number; // fit per keyword hit: one in the title counts 3, the body 1, the preferred section 0.5
    unknown: number; // fit when the posting has no description
    skills: Record<string, string[]>; // keywords per resume; the resume they fit best counts
  };
  gaps?: { points: number; max: number; skills: string[] }; // per skill the posting requires and the resumes lack
  places?: { points: number; match: string }[]; // by location, the first that matches
  eligible?: { points: number; match: string }; // the posting welcomes the candidate's year
  ineligible?: { points: number; match?: string; required?: string }; // it rules the candidate out
  frontier?: number; // an employer on the frontier list in employers.yml
  // A likely startup: the posting's link is on an application system startups use, or the company is
  // one the candidate listed. Counted once, whichever matches.
  startup?: { points: number; url?: string; companies?: string[] };
  fresh?: { days: number; points: number }; // opened within so many days
  closing?: { days: number; points: number }; // a deadline the posting states, within so many days
}

type Compiled = ReturnType<typeof compile>;

const re = (source: string, where: string) => {
  try {
    return new RegExp(source, "i");
  } catch {
    throw new Error(`profile/priority.yml: ${where} is not a regular expression: ${source}`);
  }
};
const num = (v: unknown, where: string) => {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`profile/priority.yml: ${where} needs a number`);
  return v;
};

export function compile(text: string) {
  const r = (YAML.parse(text) ?? {}) as Rules;
  return {
    tiers: (r.tiers ?? []).map((t, i) => ({ points: num(t.points, `tiers[${i}].points`), title: re(t.title, `tiers[${i}].title`) })),
    fit: r.fit && {
      weight: num(r.fit.weight, "fit.weight"),
      perHit: num(r.fit.perHit, "fit.perHit"),
      unknown: num(r.fit.unknown, "fit.unknown"),
      skills: Object.entries(r.fit.skills).map(([name, list]) => list.map((p, i) => re(p, `fit.skills.${name}[${i}]`))),
    },
    gaps: r.gaps && {
      points: num(r.gaps.points, "gaps.points"),
      max: num(r.gaps.max, "gaps.max"),
      skills: r.gaps.skills.map((p, i) => re(p, `gaps.skills[${i}]`)),
    },
    places: (r.places ?? []).map((p, i) => ({ points: num(p.points, `places[${i}].points`), match: re(p.match, `places[${i}].match`) })),
    eligible: r.eligible && { points: num(r.eligible.points, "eligible.points"), match: re(r.eligible.match, "eligible.match") },
    ineligible: r.ineligible && {
      points: num(r.ineligible.points, "ineligible.points"),
      match: r.ineligible.match ? re(r.ineligible.match, "ineligible.match") : null,
      required: r.ineligible.required ? re(r.ineligible.required, "ineligible.required") : null,
    },
    frontier: r.frontier === undefined ? 0 : num(r.frontier, "frontier"),
    startup: r.startup && {
      points: num(r.startup.points, "startup.points"),
      url: r.startup.url ? re(r.startup.url, "startup.url") : null,
      companies: new Set((r.startup.companies ?? []).map(companyKey).filter(Boolean)),
    },
    fresh: r.fresh && { days: num(r.fresh.days, "fresh.days"), points: num(r.fresh.points, "fresh.points") },
    closing: r.closing && { days: num(r.closing.days, "closing.days"), points: num(r.closing.points, "closing.points") },
  };
}

// Where a posting's preferred / nice-to-have section starts, and the heading after it.
const PREFERRED =
  /(preferred|desired|bonus|nice[ -]to[ -]have|pluses|additional)\s*(qualifications|skills|experience|requirements)?\s*:|nice[ -]to[ -]haves?\b|bonus points|it.?s a plus|would be a plus/i;
const NEXT_HEADING =
  /(required|minimum|basic|what you.ll do|responsibilities|about (us|the)|benefits|compensation|pay range|salary|equal opportunity|who you are)\b[^.\n]{0,40}:/gi;
// A sentence that asks for a skill only as a plus.
const SOFT_ASK = /\bplus\b|prefer|nice to have|bonus|desired|ideally|helpful/i;
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DEADLINE = new RegExp(
  String.raw`(?:deadline|apply by|applications? (?:are )?(?:due|close|will close|accepted until|must be (?:received|submitted) by)|closing date|posting (?:end|close|closes)|open until|accept(?:ing)? applications (?:until|through))[^.;\n]{0,40}?((?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+20\d\d|\d{1,2}/\d{1,2}/20\d\d|20\d\d-\d\d-\d\d)`,
  "i",
);

// The posting's text outside the preferred section, and the section itself.
function splitPreferred(text: string): [string, string] {
  const m = PREFERRED.exec(text);
  if (!m) return [text, ""];
  NEXT_HEADING.lastIndex = m.index + m[0].length;
  const stop = NEXT_HEADING.exec(text)?.index ?? text.length;
  return [`${text.slice(0, m.index)} ${text.slice(stop)}`, text.slice(m.index, stop)];
}

// Whether the pattern appears in a sentence that does not ask for it only as a plus.
function required(pattern: RegExp, text: string) {
  for (const m of text.matchAll(new RegExp(pattern.source, "gi"))) {
    const start = text.lastIndexOf(".", m.index) + 1;
    const end = text.indexOf(".", m.index + m[0].length);
    if (!SOFT_ASK.test(text.slice(start, end < 0 ? text.length : end + 1))) return true;
  }
  return false;
}

type Scored = Pick<Job, "title" | "location" | "company" | "description" | "posted_at" | "found_at"> & { url?: string };

export function priorityOf(job: Scored, rules: Compiled, frontier: boolean, now = Date.now()): number {
  const text = (job.description ?? "").replace(/\s+/g, " ");
  const [req, pref] = splitPreferred(text.slice(0, 8000));
  let score = rules.tiers.find(t => t.title.test(job.title))?.points ?? 0;
  if (rules.fit) {
    const { weight, perHit, unknown, skills } = rules.fit;
    const hits = (list: RegExp[]) => list.reduce((n, p) => n + (p.test(job.title) ? 3 : p.test(req) ? 1 : p.test(pref) ? 0.5 : 0), 0);
    score += (text ? Math.min(100, Math.round(Math.max(0, ...skills.map(hits)) * perHit)) : unknown) * weight;
  }
  score += rules.places.find(p => p.match.test(job.location ?? ""))?.points ?? 0;
  if (frontier) score += rules.frontier;
  const { startup } = rules;
  if (startup && (!!startup.url?.test(job.url ?? "") || startup.companies.has(companyKey(job.company)))) score += startup.points;
  if (rules.fresh && now - openedAt(job) <= rules.fresh.days * 86_400_000) score += rules.fresh.points;
  if (!text) return score;
  if (rules.gaps) score += rules.gaps.points * Math.min(rules.gaps.max, rules.gaps.skills.filter(p => required(p, req)).length);
  const { match: ruling, required: mustHave } = rules.ineligible ?? {};
  const ruledOut = !!ruling?.test(text) || (!!mustHave && required(mustHave, req));
  const deadline = DEADLINE.exec(text.slice(0, 12000))?.[1];
  const daysLeft = deadline ? (Date.parse(deadline.replace(/(\d)(st|nd|rd|th)/, "$1")) - now) / 86_400_000 : NaN;
  if (ruledOut || daysLeft < -1) return score + (rules.ineligible?.points ?? 0);
  if (rules.eligible?.match.test(text)) score += rules.eligible.points;
  if (rules.closing && daysLeft >= -1 && daysLeft <= rules.closing.days) score += rules.closing.points;
  return score;
}

// Scores last until priority.yml, the frontier list or the day changes.
let cache: { key: string; rules: Compiled | null; lists: ReturnType<typeof loadEmployers>; scores: Map<number, number> } | null = null;
let lastError: string | null = null;

function current() {
  const text = readProfile("priority.yml");
  const lists = loadEmployers();
  const key = `${new Date().toISOString().slice(0, 10)}\n${lists.frontier.join("\n")}\n${text}`;
  if (cache?.key === key) return cache;
  let rules: Compiled | null = null;
  try {
    rules = text.trim() ? compile(text) : null;
    lastError = null;
  } catch (err) {
    // A broken file assesses newest first rather than stopping prep; say so once.
    if (errorMessage(err) !== lastError) logEvent("error", errorMessage(err));
    lastError = errorMessage(err);
  }
  return (cache = { key, rules, lists, scores: new Map<number, number>() });
}

export function nextToPrep(): Job | null {
  const { rules, lists, scores } = current();
  const score = (id: number) => {
    if (!rules) return 0;
    let s = scores.get(id);
    if (s === undefined) {
      const job = getJob(id);
      s = job ? priorityOf(job, rules, employerListing(job.company, lists) === "frontier") : 0;
      scores.set(id, s);
    }
    return s;
  };
  const best = triagedJobs()
    .map(j => ({ id: j.id, score: score(j.id), opened: openedAt(j) }))
    .sort((a, b) => b.score - a.score || b.opened - a.opened)[0];
  return best ? getJob(best.id) : null;
}
