// What a caught value says, whatever was thrown.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Runs a write to a worker's stdin and ignores its failure, thrown or rejected. A worker that dies
// while its prompt is going in fails on its own (its exit is reported); left unhandled, the broken
// pipe would take the whole server down.
export function settled(write: () => unknown): void {
  try {
    void Promise.resolve(write()).catch(() => undefined);
  } catch {
    // the pipe is already closed
  }
}

// The model provider turned the request away for load or quota, not because of the job: the same
// work can run again once it has capacity. A harness that is not installed or not signed in counts
// too, so the work moves to the next model in the stage's chain instead of failing every job, and so
// does agy failing its sign-in check (it says this when the network is down, as just after the
// computer wakes from sleep).
export const isCapacityError = (message: string | null | undefined): boolean =>
  !!message &&
  /at capacity|rate[ _-]?limit|too many requests|\b429\b|overloaded|usage limit|hit your (?:\w+ )?limit|quota (?:exceeded|exhausted)|exceeded (?:your |the )?(?:\w+ )?quota|resource[ _-]?exhausted|\b(?:agy|codex|claude|omp) is not (?:installed|signed in)|authentication failed or timed out/i.test(
    message,
  );

// When a capacity refusal says it lifts, in ms since the epoch, or null when it says no time in a
// form read here or names one already past:
// - Claude Code's "..., resets 2026-10-31T05:00:00.000Z)" (src/claude.ts);
// - Codex's "try again at 11:58 PM." (this machine's local time, the next one to come) or "try again
//   at Nov 3rd, 2026 11:58 PM.";
// - "try again in 2 hours" / "in 1 hour 30 minutes".
const UNIT_MS: Record<string, number> = { second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000 };
export function limitResetsAt(message: string | null | undefined, now = new Date()): number | null {
  if (!message) return null;
  const future = (at: number) => (at > now.getTime() ? at : null);
  const stamp = /\bresets (\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(message)?.[1];
  if (stamp) return future(Date.parse(stamp));
  const codex = /try again at (.+?(?:AM|PM))/i.exec(message)?.[1]?.replace(/(\d)(st|nd|rd|th),/, "$1,");
  if (codex) {
    const clock = /^(\d{1,2}):(\d\d) ?(AM|PM)$/i.exec(codex);
    if (!clock) {
      const dated = Date.parse(codex);
      return Number.isNaN(dated) ? null : future(dated);
    }
    const at = new Date(now);
    at.setHours((Number(clock[1]) % 12) + (clock[3]?.toUpperCase() === "PM" ? 12 : 0), Number(clock[2]), 0, 0);
    if (at.getTime() <= now.getTime()) at.setDate(at.getDate() + 1);
    return at.getTime();
  }
  const wait = /try again in ((?:\s*(?:and\s+)?\d+(?:\.\d+)?\s*(?:second|minute|hour|day)s?,?)+)/i.exec(message)?.[1];
  if (!wait) return null;
  let ms = 0;
  for (const [, n, unit] of wait.matchAll(/(\d+(?:\.\d+)?)\s*(second|minute|hour|day)/gi)) ms += Number(n) * (UNIT_MS[(unit ?? "").toLowerCase()] ?? 0);
  return ms > 0 ? now.getTime() + ms : null;
}
