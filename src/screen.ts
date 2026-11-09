// What triage turns away before a model reads the titles: a listing abroad, a title outside
// `screen.titles` when the owner sets it, a term that is over or not one of `screen.terms`, a title
// above the level the candidate applies at, a description that asks for 5 or more years, or an
// application portal that never lets this machine through. Pure text matching; anything it cannot
// tell goes on to triage.
import { config } from "./config";
import { termOf } from "./db";
import { placeOf } from "./location";

// `screen.titles`, compiled once per value: the Settings page can change it while the app runs.
let titles: { source: string; pattern: RegExp } | null = null;
function wantedTitles(): RegExp | null {
  const source = config.screen?.titles?.trim();
  if (!source) return null;
  if (titles?.source !== source) titles = { source, pattern: new RegExp(source, "i") };
  return titles.pattern;
}

// Senior and above, by the words titles use for it. Numbered levels are left to the model: "Software
// Engineer III" is a new graduate's title at some employers and a senior one at others.
const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|vice president|vp|chief|distinguished)\b|\b(svp|evp|cto|cio|ciso)\b/i;

// The month (1-12) each season's term is over by. A winter co-op runs January to April.
const TERM_ENDS: Record<string, number> = { winter: 4, spring: 6, summer: 8, fall: 12 };

// Why the term a title names rules it out: it is over, or `screen.terms` names others. Null when the
// title names no term, or one still wanted.
function termOut(title: string, today: Date): string | null {
  const term = termOf(title);
  if (!term) return null;
  const [season = "", yy = ""] = term.split(" ");
  const year = 2000 + Number(yy);
  const end = TERM_ENDS[season] ?? 12;
  if (year < today.getFullYear() || (year === today.getFullYear() && end < today.getMonth() + 1)) return `the ${season} ${year} term is over`;
  const wanted = (config.screen?.terms ?? []).map(termOf).filter(t => t);
  if (wanted.length && !wanted.includes(term)) return `the ${season} ${year} term is not one of screen.terms`;
  return null;
}

// The level a description asks for, in years: "5+ years of experience", "at least 6 years' professional
// software experience". A range counts by its lower end, and a sentence that offers a shorter route
// ("or 3 years with a Master's") by its shortest. Years under a "Preferred" or "Nice to have" heading,
// in a sentence that only prefers them, or about the employer itself ("our 20 years of experience
// serving clients") do not count. Null when no sentence asks.
const YEARS = /(\d{1,2})\s*(?:[-–]|to)\s*\d{1,2}\s*\+?\s*(?:years?|yrs?)\b|(\d{1,2})\s*(?:\+|plus|or more)?\s*(?:years?|yrs?)\b/gi;
const EXPERIENCE = /^['’]?s?\s+(?:of\s+)?(?:[\w/&,-]+\s+){0,5}?(?:experience|exp\b)/i;
const PREFERRED = /\bprefer|\bnice to have\b|\bbonus\b|\bideal(ly)?\b|\bplus\b|\bdesired\b|\bstand out\b/i;
const NOT_THE_CANDIDATE = /\b(we|our|us|company|clients|customers|founded|history)\b/i;
// A short line that opens a section ("Preferred qualifications", "What you'll need:"), not a bullet.
const HEADING = /^\s*[#*]*\s*[a-z][^.\n]{0,60}$/i;
const REQUIRED_HEADING = /\brequire|\bminimum\b|\bbasic\b|\bmust\b|\bqualifications\b|\bwhat you\b|\babout you\b|\byou (have|bring)\b/i;
export const SENIOR_YEARS = 5;
export function yearsAsked(description: string | null | undefined): number | null {
  let asked = null as number | null;
  let preferred = false;
  for (const line of (description ?? "").split("\n")) {
    const heading = HEADING.test(line) && !YEARS.test(line);
    YEARS.lastIndex = 0;
    if (heading && PREFERRED.test(line)) preferred = true;
    else if (heading && REQUIRED_HEADING.test(line)) preferred = false;
    if (preferred) continue;
    for (const sentence of line.split(/[.;•]+(?:\s|$)/)) {
      if (PREFERRED.test(sentence.replace(/\d\s*plus\b/gi, "")) || NOT_THE_CANDIDATE.test(sentence)) continue;
      const mentions = [...sentence.matchAll(YEARS)];
      if (!mentions.some(m => EXPERIENCE.test(sentence.slice(m.index + m[0].length)))) continue;
      const least = Math.min(...mentions.map(m => Number(m[1] ?? m[2])));
      if (least <= 15) asked = Math.max(asked ?? 0, least);
    }
  }
  return asked;
}

// Application portals no application from here has got through, by host. Paycom refuses to create
// the candidate's account after its hCaptcha, every time, and Lever's hCaptcha rejects every submit.
const DEAD_ENDS: [RegExp, string][] = [
  [/(^|\.)paycomonline\.(net|com)$/, "Paycom's applicant portal refuses to create the candidate's account"],
  [/(^|\.)lever\.co$/, "Lever's hCaptcha rejects this machine's submissions"],
];

// Why an application at `url` cannot get through, or null.
export function deadEnd(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return DEAD_ENDS.find(([pattern]) => pattern.test(host))?.[1] ?? null;
}

// What the listing's place and its description rule out, before any model reads the posting: prep
// asks this of jobs that skipped triage, or whose description arrived after it.
export function screenPosting(location: string | null | undefined, description: string | null | undefined): string | null {
  if (placeOf(location) === "abroad") return "the listing is for a position outside the United States";
  const years = yearsAsked(description);
  if (years !== null && years >= SENIOR_YEARS) return `senior level: the posting asks for ${years}+ years of experience`;
  return null;
}

// Why the posting is dropped without a model reading it, or null when triage should see it.
export function screenOut(title: string, location: string | null | undefined, url?: string, description?: string | null, today = new Date()): string | null {
  if (placeOf(location) === "abroad") return "the listing is for a position outside the United States";
  const portal = url === undefined ? null : deadEnd(url);
  if (portal) return portal;
  const wanted = wantedTitles();
  if (wanted && !wanted.test(title)) return "the title does not match screen.titles";
  const term = termOut(title, today);
  if (term) return term;
  const senior = SENIOR.exec(title);
  if (senior) return `senior-level title ("${senior[0]}")`;
  return screenPosting(location, description);
}
