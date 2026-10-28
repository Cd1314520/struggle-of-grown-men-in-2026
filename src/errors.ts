export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export const isCapacityError = (message: string | null | undefined): boolean =>
  !!message && /at capacity|rate[ _-]?limit|too many requests|\b429\b|overloaded|usage limit|hit your (?:\w+ )?limit/i.test(message);
