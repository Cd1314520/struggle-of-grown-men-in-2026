// What triage turns away before a model reads the titles: a listing abroad, or a title above the
// level the candidate applies at. Pure text matching; anything it cannot tell goes on to triage.
import { placeOf } from "./location";

// Senior and above, by the words titles use for it. Numbered levels are left to the model: "Software
// Engineer III" is a new graduate's title at some employers and a senior one at others.
const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|vice president|vp|chief|distinguished)\b|\b(svp|evp|cto|cio|ciso)\b/i;

// Why the posting is dropped without a model reading it, or null when triage should see it.
export function screenOut(title: string, location: string | null | undefined): string | null {
  if (placeOf(location) === "abroad") return "the listing is for a position outside the United States";
  const senior = SENIOR.exec(title);
  if (senior) return `senior-level title ("${senior[0]}")`;
  return null;
}
