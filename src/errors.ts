// What a caught value says, whatever was thrown.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// The model provider turned the request away for load or quota, not because of the job: the same
// work can run again once it has capacity.
export const isCapacityError = (message: string | null | undefined): boolean =>
  !!message && /at capacity|rate[ _-]?limit|too many requests|\b429\b|overloaded|usage limit/i.test(message);
