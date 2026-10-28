import { placeOf } from "./location";

const SENIOR = /\b(senior|sr|staff|principal|lead|manager|director|head of|vice president|vp|chief|distinguished)\b|\b(svp|evp|cto|cio|ciso)\b/i;

const HARDWARE =
  /\b(fpga|asic|rtl|vlsi|pcb|firmware)\b|\bembedded (software|systems?|linux|firmware|engineer|test)\b|\bhardware ((test|design|validation|reliability) )?engineer|\belectrical (hardware )?engineer/i;

const DEAD_ENDS: [RegExp, string][] = [[/(^|\.)paycomonline\.(net|com)$/, "Paycom's applicant portal refuses to create the candidate's account"]];

export function deadEnd(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  return DEAD_ENDS.find(([pattern]) => pattern.test(host))?.[1] ?? null;
}

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
