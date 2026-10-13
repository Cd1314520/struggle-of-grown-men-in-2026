// Schedules and daily caps. Both are kept in kv, so they hold across restarts.
import { kvGet, kvSet } from "./db";

// Whether the thing last stamped under `key` is due again. A period of 0 means never.
export const due = (key: string, minutes: number) => minutes > 0 && Date.now() - Date.parse(kvGet(key) ?? "1970-01-01") > minutes * 60_000;

// Daily caps keep token spend and application volume bounded whatever a scan turns up.
const today = () => new Date().toISOString().slice(0, 10);
export type Counted = "prep" | "fill" | "locate" | "auto";
export const usedToday = (what: Counted) => Number(kvGet(`count.${what}.${today()}`) ?? 0);
export const countOne = (what: Counted) => kvSet(`count.${what}.${today()}`, String(usedToday(what) + 1));
