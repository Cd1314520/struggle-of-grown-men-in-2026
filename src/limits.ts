import { kvDelete, kvGet, kvSet } from "./db";

export const due = (key: string, minutes: number) => minutes > 0 && Date.now() - Date.parse(kvGet(key) ?? "1970-01-01") > minutes * 60_000;

const today = () => new Date().toISOString().slice(0, 10);
export type Counted = "prep" | "fill" | "locate" | "auto";
export const usedToday = (what: Counted) => Number(kvGet(`count.${what}.${today()}`) ?? 0);
export const countOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(usedToday(what) + 1));

const BACKOFF_MAX_MINUTES = 60;
export const backoffUntil = () => Number(kvGet("backoff.until") ?? 0);
export const backedOff = () => Date.now() < backoffUntil();
export function backOff(): number | null {
  if (backedOff()) return null;
  const level = Number(kvGet("backoff.level") ?? 0) + 1;
  const until = Date.now() + Math.min(2 ** level, BACKOFF_MAX_MINUTES) * 60_000;
  kvSet("backoff.level", String(level));
  kvSet("backoff.until", String(until));
  return until;
}
export function clearBackoff() {
  if (kvGet("backoff.level") !== null) kvDelete("backoff.level");
}

export const uncountOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(Math.max(0, usedToday(what) - 1)));
