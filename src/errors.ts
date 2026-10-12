// What a caught value says, whatever was thrown.
export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err));
