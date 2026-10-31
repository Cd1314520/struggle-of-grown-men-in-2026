// What a caught value says, whatever was thrown.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// The model provider turned the request away for load or quota, not because of the job: the same
// work can run again once it has capacity.
export const isCapacityError = (message: string | null | undefined): boolean =>
  !!message && /at capacity|rate[ _-]?limit|too many requests|\b429\b|overloaded|usage limit|hit your (?:\w+ )?limit/i.test(message);

// The account ran out of its allowance (Claude Code's "usage limit reached", Codex's "You've hit your
// usage limit"), which lasts hours, unlike a passing overload: worth trying another model at once.
export const isUsageLimit = (message: string | null | undefined): boolean => !!message && /usage limit|hit your (?:\w+ )?limit/i.test(message);

// When a usage limit says it lifts, in ms since the epoch, or null when it does not say in a form
// read here: Claude Code's "resets 2026-10-31T20:00:00.000Z" (src/claude.ts) or Codex's "Try again in
// 2 hours". A clock time ("try again at 3:05 PM") names no time zone, so it is not read.
const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
export function limitResetsAt(message: string | null | undefined, now = Date.now()): number | null {
  if (!message) return null;
  const stamp = /\bresets (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(message)?.[1];
  const at = stamp ? Date.parse(stamp) : NaN;
  if (at > now) return at;
  const wait = /try again in ((?:\s*(?:and\s+)?\d+(?:\.\d+)?\s*(?:second|minute|hour|day)s?,?)+)/i.exec(message)?.[1];
  if (!wait) return null;
  let ms = 0;
  for (const [, n, unit] of wait.matchAll(/(\d+(?:\.\d+)?)\s*(second|minute|hour|day)/gi)) ms += Number(n) * (UNIT_MS[(unit ?? "").toLowerCase()] ?? 0);
  return ms > 0 ? now + ms : null;
}
