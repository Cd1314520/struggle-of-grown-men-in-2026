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
// worker that completes ends it.
const BACKOFF_MAX_MINUTES = 60;
export const backoffUntil = () => Number(kvGet("backoff.until") ?? 0);
export const backedOff = () => Date.now() < backoffUntil();
// Returns when the pause ends, or null when one was already running. `until`: when the provider said
// it can take work again (a usage limit's reset), which is waited for instead of the doubling pause.
export function backOff(until?: number): number | null {
  // Workers that fail together report one capacity refusal, not one each.
  if (backedOff()) return null;
  if (until !== undefined) {
    kvSet("backoff.until", String(until));
    return until;
  }
  const level = Number(kvGet("backoff.level") ?? 0) + 1;
  const end = Date.now() + Math.min(2 ** level, BACKOFF_MAX_MINUTES) * 60_000;
  kvSet("backoff.level", String(level));
  kvSet("backoff.until", String(end));
  return end;
}

// Models whose account hit its usage limit, until it resets. New work skips them for the next model
// in its stage's chain (src/worker.ts). A limit that does not say when it lifts is taken to last an
// hour; the model is tried again after that.
const LIMIT_GUESS_MS = 60 * 60_000;
const limitKey = (model: string | null) => `limited.${model ?? ""}`;
export const limitedUntil = (model: string | null) => Number(kvGet(limitKey(model)) ?? 0);
export const isLimited = (model: string | null) => Date.now() < limitedUntil(model);
export function limitModel(model: string | null, resetsAt: number | null): number {
  const until = resetsAt ?? Date.now() + LIMIT_GUESS_MS;
  kvSet(limitKey(model), String(until));
  return until;
}
export function clearBackoff() {
  if (kvGet("backoff.level") !== null) kvDelete("backoff.level");
}

// Gives back a count for work the provider refused before doing it.
export const uncountOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(Math.max(0, usedToday(what) - 1)));
