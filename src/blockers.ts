import { db, type Job } from "./db";

export const BLOCKER_CAUSES = [
  "site_down",
  "blocked",
  "login",
  "captcha",
  "email_code",
  "no_form",
  "needs_you",
  "browser",
  "no_response",
  "unknown",
  "other",
] as const;
export type BlockerCause = (typeof BLOCKER_CAUSES)[number];

export const SITE_BLOCKS: readonly BlockerCause[] = ["blocked", "captcha"];
export const WORKER_CAUSES = BLOCKER_CAUSES.filter(c => c !== "unknown" && c !== "captcha");
export const CAUSE_GUIDE =
  "site_down: the employer's site or ATS is broken for everyone (maintenance page, outage, HTTP 5xx on ordinary pages, 'Something went wrong' that a retry does not clear). " +
  "blocked: the site is refusing this machine rather than failing for everyone: a CAPTCHA or human check that rejects every honest attempt, an anti-bot or firewall page (Access Denied, HTTP 403/406/429, Cloudflare, Akamai, Imperva, 'unusual traffic'), or a final submit the site refuses with no field error to fix while the form is complete. Decide from what you saw; say why in the detail. " +
  "login: cannot sign in, sign back in, or create the account even after a password reset (two-step setup, the reset mail never comes, the site rejects the new password). " +
  "email_code: an emailed verification code is missing, expired, or rejected. " +
  "no_form: the posting is live but there is no way to apply online (email or mail only, no apply control). A missing or dead posting is closed, not this. " +
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
  gate_id: string | null;
}
export type ListedBlocker = Blocker & Pick<Job, "company" | "title" | "url" | "status">;

export function recordBlocker(jobId: number, cause: BlockerCause, detail: string, gateId: string | null) {
  db.query("INSERT INTO blockers (job_id, cause, detail, gate_id) VALUES (?, ?, ?, ?)").run(jobId, cause, detail.trim(), gateId);
}

export const jobBlockers = (jobId: number) => db.query<Blocker, [number]>("SELECT * FROM blockers WHERE job_id = ? ORDER BY id").all(jobId);

export const siteBlockedJobs = () =>
  new Map(
    db
      .query<{ job_id: number; status: Job["status"] }, [string]>(
        `SELECT b.job_id, j.status FROM blockers b JOIN jobs j ON j.id = b.job_id
        WHERE b.id = (SELECT max(id) FROM blockers WHERE job_id = b.job_id)
          AND b.cause IN (SELECT value FROM json_each(?))
          AND (j.status = 'failed' OR (j.status = 'needs_manual' AND b.gate_id IN (SELECT id FROM question_gates WHERE job_id = b.job_id AND state = 'open')))`,
      )
      .all(JSON.stringify(SITE_BLOCKS))
      .map(r => [r.job_id, r.status]),
  );

export const listBlockers = () =>
  db
    .query<ListedBlocker, []>("SELECT b.*, j.company, j.title, j.url, j.status FROM blockers b JOIN jobs j ON j.id = b.job_id ORDER BY b.at DESC, b.id DESC")
    .all();
