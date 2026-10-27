// What triage turns away before a model reads the titles: a listing abroad, a title above the level
// the candidate applies at, a hardware or embedded title, or an application portal that never lets
// this machine through. Pure text matching; anything it cannot tell goes on to triage.
import { placeOf } from "./location";

// Senior and above, by the words titles use for it. Numbered levels are left to the model: "Software
// Engineer III" is a new graduate's title at some employers and a senior one at others.
const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|vice president|vp|chief|distinguished)\b|\b(svp|evp|cto|cio|ciso)\b/i;

// Hardware, embedded and chip work, which the candidate does not want. Only titles where that work is
// the job: "Data Engineer, Hardware & Consumer Devices" or "Embedded AI Engineer" go on to triage.
const HARDWARE =
  /\b(fpga|asic|rtl|vlsi|pcb|firmware)\b|\bembedded (software|systems?|linux|firmware|engineer|test)\b|\bhardware ((test|design|validation|reliability) )?engineer|\belectrical (hardware )?engineer/i;

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
  const senior = SENIOR.exec(title);
  if (senior) return `senior-level title ("${senior[0]}")`;
  const hardware = HARDWARE.exec(title);
  if (hardware) return `hardware or embedded title ("${hardware[0]}")`;
  return null;
}
