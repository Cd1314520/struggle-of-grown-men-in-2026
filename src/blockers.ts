import { db, type Job } from "./db";

export const BLOCKER_CAUSES = ["site_down", "login", "captcha", "email_code", "no_form", "needs_you", "browser", "no_response", "unknown", "other"] as const;
export type BlockerCause = (typeof BLOCKER_CAUSES)[number];

export const WORKER_CAUSES = BLOCKER_CAUSES.filter(c => c !== "unknown");
export const CAUSE_GUIDE =
  "site_down: the employer's site or ATS is down or erroring (maintenance page, outage, HTTP 4xx/5xx, 'Something went wrong'). " +
  "login: cannot sign in, sign back in, or create the account (password rejected, session expired, two-step setup, no account found). " +
  "captcha: a CAPTCHA or human check keeps failing, or the site rejects the application after it is solved. " +
  "email_code: an emailed verification code is missing, expired, or rejected. " +
  "no_form: no way to apply online (email-only, apply link missing or dead, wrong page). " +
  "needs_you: needs a document, signature, or agreement only the candidate can give. " +
  "browser: the browser or its tools failed (tab lost, clicks not delivered, page froze). " +
  "no_response: final submit was clicked but nothing shows whether it went through. " +
  "other: none of these.";

export interface Blocker {
  id: number;
  job_id: number;
  cause: BlockerCause;
  detail: string;
  at: string;
}
export type ListedBlocker = Blocker & Pick<Job, "company" | "title" | "url" | "status">;

export function recordBlocker(jobId: number, cause: BlockerCause, detail: string) {
  db.query("INSERT INTO blockers (job_id, cause, detail) VALUES (?, ?, ?)").run(jobId, cause, detail.trim());
}

export const jobBlockers = (jobId: number) => db.query<Blocker, [number]>("SELECT * FROM blockers WHERE job_id = ? ORDER BY id").all(jobId);

export const listBlockers = () =>
  db
    .query<ListedBlocker, []>("SELECT b.*, j.company, j.title, j.url, j.status FROM blockers b JOIN jobs j ON j.id = b.job_id ORDER BY b.at DESC, b.id DESC")
    .all();
