// Schedules and daily caps. Both are kept in kv, so they hold across restarts.
import { kvDelete, kvGet, kvSet } from "./db";

// Whether the thing last stamped under `key` is due again. A period of 0 means never.
export const due = (key: string, minutes: number) => minutes > 0 && Date.now() - Date.parse(kvGet(key) ?? "1970-01-01") > minutes * 60_000;

// Daily caps keep token spend and application volume bounded whatever a scan turns up.
const today = () => new Date().toISOString().slice(0, 10);
export type Counted = "prep" | "fill" | "locate" | "auto";
export const usedToday = (what: Counted) => Number(kvGet(`count.${what}.${today()}`) ?? 0);
export const countOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(usedToday(what) + 1));

// While the model provider is at capacity no new agent work starts: every worker would fail the same
// way. Each time it is found at capacity again the pause doubles, from 2 minutes up to an hour; one
// worker that completes ends it. When every model and account a stage could move to is out
// (src/providers.ts), the pause lasts until the first of them comes back instead.
const BACKOFF_MAX_MINUTES = 60;
const BACKOFF_FORGET_MS = 6 * 60 * 60_000;
export const backoffUntil = () => Number(kvGet("backoff.until") ?? 0);
export const backedOff = () => Date.now() < backoffUntil();
// Returns when the pause ends, or null when one was already running. `until`: when the first provider
// in the chain takes work again, which is waited for instead of the doubling pause.
export function backOff(until?: number): number | null {
  // Workers that fail together report one capacity refusal, not one each.
  if (backedOff()) return null;
  if (until !== undefined) {
    kvSet("backoff.until", String(until));
    return until;
  }
  const quiet = Date.now() - backoffUntil() > BACKOFF_FORGET_MS;
  const level = (quiet ? 0 : Number(kvGet("backoff.level") ?? 0)) + 1;
  const end = Date.now() + Math.min(2 ** level, BACKOFF_MAX_MINUTES) * 60_000;
  kvSet("backoff.level", String(level));
  kvSet("backoff.until", String(end));
  return end;
}
export function clearBackoff() {
  if (kvGet("backoff.level") !== null) kvDelete("backoff.level");
  if (kvGet("backoff.until") !== null) kvDelete("backoff.until");
}

// Gives back a count for work the provider refused before doing it.
export const uncountOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(Math.max(0, usedToday(what) - 1)));
