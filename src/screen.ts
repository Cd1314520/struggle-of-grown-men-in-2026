// What triage turns away before a model reads the titles: a listing abroad, a title outside
// `screen.titles` when the owner sets it, a title above the level the candidate applies at, or an
// application portal that never lets this machine through. Pure text matching; anything it cannot
// tell goes on to triage.
import { config } from "./config";
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

// Application portals no application from here has got through, by host. Paycom refuses to create
// the candidate's account after its hCaptcha, every time.
const DEAD_ENDS: [RegExp, string][] = [[/(^|\.)paycomonline\.(net|com)$/, "Paycom's applicant portal refuses to create the candidate's account"]];

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

// Why the posting is dropped without a model reading it, or null when triage should see it.
export function screenOut(title: string, location: string | null | undefined, url?: string): string | null {
  if (placeOf(location) === "abroad") return "the listing is for a position outside the United States";
  const portal = url === undefined ? null : deadEnd(url);
  if (portal) return portal;
  const wanted = wantedTitles();
  if (wanted && !wanted.test(title)) return "the title does not match screen.titles";
  const senior = SENIOR.exec(title);
  if (senior) return `senior-level title ("${senior[0]}")`;
  return null;
}
