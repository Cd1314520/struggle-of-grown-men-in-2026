# auto-apply

Local job scanner, resume tailor and application filler with two manual gates. A small Bun app owns state and scheduling; every piece of agent work is an `omp --mode rpc` process that reports back through host tools.

## Run

Runs as a systemd user service (`~/.config/systemd/user/auto-apply.service`, lingering enabled so it survives logout and reboot):

```bash
systemctl --user status auto-apply
systemctl --user restart auto-apply      # after editing config.yml or code
journalctl --user -u auto-apply -f
```

The app itself listens on `127.0.0.1:8787` only. `tailscale serve` publishes it to the tailnet (not the internet):

- App: https://your-machine.your-tailnet.ts.net:8787
- Live browser (noVNC): https://your-machine.your-tailnet.ts.net:6080

There is no login on the app: anyone on the tailnet can approve applications and see stored site passwords. To unpublish: `sudo tailscale serve --https=8787 off` (and `6080`).

## Setup

1. **Profile** (Profile tab, or edit `profile/` directly). Nothing is assessed or applied while a file still contains `TODO-FILL`.
   - `targets.md`: what you want, in plain language; drives triage and discovery.
   - `rubric.yml`: the scoring checklist. The agent answers each statement yes / no / unclear with evidence; the app computes the score from the weights, applies the required items and threshold, and decides apply / hold / skip.
   - `basic-resume/`: the stock resume (Typst). The agent tailors a per-job copy of `main.typ` and never edits the template `resume.typ`.
   - `resume-notes.md`: optional bank of extra bullets/skills/examples the agent may swap in. Empty means reorder and trim only.
   - `personal.yml`, `answers.md`: form details and deliberately maintained standard answers. Inbox answers are application-local by default; they are never automatically appended to `answers.md`.
   - `companies.yml`: company boards to watch (`ats`: greenhouse, lever, ashby, workable, recruitee, smartrecruiters, workday). The discover step adds to it. A Workday slug is `<tenant>.<wdN>/<site>`; an optional `search:` narrows a large employer to matching titles.
2. **Gmail**: in Google Cloud, enable the Gmail API, create a Web OAuth client with redirect URI `https://your-machine.your-tailnet.ts.net:8787/oauth/callback` (`publicUrl` in `config.yml`), save its JSON as `profile/gmail-client.json`, then Settings → Connect Gmail and sign in as the mailbox set in `config.yml`. Scope is `gmail.modify`.
3. **`config.yml`**: phase, models per stage, schedule, daily caps, and `confirmBeforeSubmit` (gate 2).

## Flow

`found → triaged → prepping → awaiting_approval (gate 1) → approved → filling → awaiting_submit (gate 2) → submitted → interview / offer / rejected_by_company`

Side exits: `needs_input` (agent asked a question), `needs_manual` (agent could not get past a CAPTCHA or block), `failed`, `skipped`, `rejected`.

Triage uses **`openai-codex/gpt-6-luna`**, processing up to **50 postings per call** in sequential batches until the found backlog is drained.

| Worker | Built-in omp tools | Host tools |
|---|---|---|
| triage | read, write | `triage_result` |
| discover | + web_search | `add_company`, `save_job` |
| prep | + edit, bash (typst) | `finish_prep` |
| fill | read, write, eval (browser) | `get_account`, `gmail_*`, `ask_user`, `confirm_submit`, `need_manual`, `verify_status`, `report_result` |
| track | read, write | `gmail_*`, `update_application`, `note` |

### Auto apply

The current configuration enables approval and submission for **practice** jobs only: at least **60** interview-fit points, at most **50 auto-approvals/day**, within the **50 application attempts/day** cap. Prep is capped at **1,500 assessments/day**, with five prep workers and five browser slots. Every fill launch, including a resumed, blocked or failed attempt, consumes quota; counters reset at midnight UTC. Browser filling and prep use **`openai-codex/gpt-6.1-sol`**. Practice eligibility is separate from fit and requires at least one evidence-backed reason you would decline:

- The posted **annual USD base salary ceiling is at most $80,000**, inclusive. A $75k–$85k range does not qualify by salary. Unknown pay, open-ended minimums, non-USD pay, and hourly rates without an explicit annual figure do not establish a qualifying ceiling.
- Attendance is **mandatory onsite/hybrid outside the Houston/Austin commute**, with no acceptable remote or local alternative.

A low real-job score, weak stack match, travel, or an uninteresting employer is not practice proof. If neither reason is proven, the job is held; failed qualifications or inadequate interview fit are skipped. The prep worker quotes the posting and stores a versioned `practice_assessment`; Summary and Score show the evidence. Extraction still depends on the worker interpreting the posting correctly—the deterministic gate checks the extracted facts, not the truth of the source.

Gate 1 also requires a freshly passing assessment, an allowed `autoApply.phases` phase, no unclear required rubric answers, and remaining `autoApply.perDay` capacity. Hand-picked jobs and jobs sent back with feedback are not auto-approved. `allowConcerns: true` lets expected salary/location concerns coexist with proven practice eligibility; it does not override required qualifications. Rules live in `src/practice.ts`, `src/rubric.ts`, and `src/auto.ts`; `approved_by` and Activity record auto-approvals.

Jobs blocked **only by the auto-approval daily cap** retain a durable deferred marker. The scheduler rechecks them when capacity becomes available, including after the UTC reset or a configured cap increase. Reconsideration uses the current rubric, stored practice evidence, feedback protection, and the existing tailored PDF; approval and quota consumption happen together. Ordinary manual-review jobs are not swept into automation. A one-time upgrade adopts the earlier exact cap-exhaustion notes, subject to the same protections.

Auto-approved practice jobs are checked again before resume freeze or browser startup: missing, invalid, outdated, or non-qualifying evidence puts them on hold. Automatic submission also requires `autoApply.enabled`, an allowed phase, `autoApply.submit`, and valid practice eligibility. Manually approved jobs follow `confirmBeforeSubmit` (currently true). Application answers remain truthful, including relocation preferences.

To reassess previously scored backlog, stop the service, run `bun run reassess-backlog` for a read-only preview, then `bun run reassess-backlog --apply` and restart it. The command requeues old scored `awaiting_approval`, `held`, and `skipped` jobs for fresh prep; it does not approve or submit them directly. Rejected, active, submitted, manually approved, feedback-marked, frozen-resume, and already-current assessments are preserved. Prep and application daily caps still apply.

Only the fill worker has a browser, and it only starts after an approval, so gate 1 is structural. Every worker is instructed to call `confirm_submit` before the final click. That host tool reads the current job and immediately authorizes eligible automatic submissions; jobs requiring confirmation park for your decision. Manual final approval is application-scoped, exact-summary and one-use; changed answers or a changed summary require review again. The restart-protection marker is set only when final submission is authorized, not when filling begins. The browser itself cannot enforce use of the tool.

### Parked applications and Questions

Unknown required facts, required cover letters and final-review decisions are durable gates, not workers waiting on an in-memory promise. The gate and browser/draft checkpoint are saved before the worker stops; its ordinary browser slot becomes available only after the process exits. Restarting the app preserves the wait rather than replaying the application.

Use **Questions** to handle the backlog in batches. **This application only** is the default. An explicitly approved **standing answer** applies only to the exact employer, prompt, context and ordered options shown, including future exact matches. Different wording, context or choices do not inherit it. Legacy or incomplete questions remain application-only. Saving an answer requeues the resolved applications automatically, subject to daily limits, pacing and availability of their original browser/profile.

Resumption uses the same frozen resume and verifies the exact employer/account/requisition and existing draft. A checkpoint does not prove the ATS saved every field. Missing facts are never guessed, and failure to establish draft identity requires manual inspection rather than starting a duplicate application.

**Manual handoffs and ambiguous submissions also release capacity:** once their worker exits, neither the saved gate nor its queued recovery reserves a browser slot or employer account. Draft tabs, checkpoints, frozen resumes, answers, and submission protection remain intact. Multiple parked applications can share a persistent profile; their drafts stay isolated. **Check status & recover** requests one recovery attempt in the application's original browser/profile without claiming you fixed the problem. Recovery gets priority when runnable, but an unavailable profile or employer cannot block other eligible jobs. A pre-submit manual handoff resumes under the usual approval rules. A potentially submitted application instead gets a **verification-only worker, limited to ten minutes**: it can sign in using saved credentials and check the exact requisition and confirmation mail, but cannot obtain submission authorization.

Verification requires positive, job-specific evidence: a submitted portal status or matching confirmation email; or an explicit unsubmitted/incomplete draft or rejected submission. An empty inbox, login failure, or merely seeing a form is not proof of non-submission. Confirmed drafts resume with a fresh `confirm_submit` check; inconclusive checks preserve the submission protection and return a specific handoff, without looping automatically. Browser access is revoked before handoff and the slot is not reused until the worker exits. Status checks can run even when the new-application daily quota is exhausted; resumed filling still respects that quota. Restarting an unfinished verification returns it to inspection, never blind submission.

The API is `POST /api/jobs/:id/recover` with `{ "gateId": "<current gate id>" }`; stale gates and duplicate/active-worker requests are rejected. The UI retains manual inspection and explicit submitted/not-submitted resolutions. Answering a question cannot clear submission protection. Handoffs display the actual recorded failure, including reasons hidden in older ambiguity records.

For hands-on inspection, choose **Reserve browser for inspection**, then **Inspect reserved browser**. This is the only stopped-job action that reserves capacity, until **Release browser**, recovery, return-control, or resolution. Reservation requires the original slot and employer account to be idle, including worker teardown; it activates only the saved application tab and fails if that tab is missing. Release leaves the blocker, draft, and submission protection unchanged. Explicit reservations survive restart; old unreserved handoffs do not acquire a lease. The API is `POST /api/jobs/:id/browser` with `{ "action": "reserve" | "release", "gateId": "<current gate id>" }`; busy/stale requests return 409.

Recovery workers receive the oldest two and newest four manual/ambiguity handoffs, bounded to six records. These are historical evidence, not binding instructions: an intermediate worker's “original account required” assumption must not override the original record showing an outage before registration. Rejected verification codes trigger inspection for a supported resend flow rather than repeated use of the same stale code; this never authorizes another final-submit click while its outcome is unknown.

### Daily question digest

`questionDigest` in `config.yml` defaults to enabled at **09:00 America/Chicago** (including daylight-saving changes). The scheduler sends new or changed question groups to the verified configured/connected Gmail mailbox. It does not send unchanged unanswered groups again, including when another application joins an already-notified group. There is no email when nothing new needs attention.

The message links to Questions and affected applications. Stored answers, question context values, credentials and sensitive non-question handoff summaries are excluded. **Settings → Send digest now** bypasses the schedule, not deduplication or the enabled setting. Settings also shows delivery errors. Each message carries a persisted delivery-reference footer and matching `X-Auto-Apply-Delivery-ID` header: Gmail can rewrite the RFC Message-ID. An uncertain delivery is reconciled against that exact identity, Sent label and verified self From/To before any retry; a missing confirmation does not trigger a blind resend.

### Observation journal

[`reports/auto-apply-journal.md`](reports/auto-apply-journal.md) records real auto-approved fill attempts, question stalls, cumulative themes, and suggestions for human review. `scripts/journal-stalls.ts` reads SQLite without changing applications or the knowledge base. Discovery, prep-only activity, and manually approved attempts are excluded; practice applications are real and included. Question gates indicate potentially missing or ambiguous guidance, not proof that an answer is absent. Theme classification uses text rules, not semantic knowledge-base validation.

The independent systemd user timer `auto-apply-journal.timer` checks every three hours at 01:00, 04:00, 07:00, 10:00, 13:00, 16:00, 19:00, and 22:00 local time. Persistent scheduling catches up after downtime. Checks without new eligible activity or changed resume-review evidence leave the journal unchanged. The initial entry covers retained eligible history; `data/auto-apply-journal-state.json` checkpoints subsequent stall observations rather than limiting them to a three-hour lookback.

Inspect the next check with `systemctl --user list-timers auto-apply-journal.timer`; run a check with `systemctl --user start auto-apply-journal.service`; stop monitoring with `systemctl --user disable --now auto-apply-journal.timer`. These controls do not restart or stop the application service. The journal includes execution-log commands. For isolated runs, use `bun scripts/journal-stalls.ts --db <path> --journal <path> --state <path>`.

The same service runs `scripts/journal-resumes.ts` afterward via `ExecStartPost`. It asks **`openai-codex/gpt-6-luna`** to compare each actual auto-application's SHA-256-verified frozen PDF (extracted with `pdftotext`) against its stored posting and `profile/resume-notes.md`. It never substitutes the mutable stock resume. Missing or unattributable evidence is reported rather than guessed.

Resume findings separate supported omissions/underemphasized experience, unconfirmed experience worth asking about, and explicitly denied qualifications that must not be claimed. Cumulative rankings count distinct applications and companies, with required/core/preferred importance; quotes are resolved from source excerpt IDs. Classification and suggestions remain model judgments. This practice-biased sample is not a market-wide assessment, and posting text is the current saved description, not an independently frozen submission-time capture.

The reviewer has no tools, uses medium reasoning with no model fallback, and changes neither resumes nor application state. `prompts/resume-review.md` defines its review rules; `scripts/resume-review.yml` supplies its isolated runtime settings. Successful reviews are cached in `data/auto-apply-resume-reviews.json` by posting/resume/notes fingerprint. Unchanged inputs cause no model call or journal churn. Reviews run in batches of five, up to 25 applications per check; remaining work stays queued for the next check. Each model call is bounded to four minutes, and the combined service to 30 minutes. Failed reviews remain uncompleted and surface in the service log without discarding prior successful batches.

Run only the resume review with `bun scripts/journal-resumes.ts`. For isolated evidence, use `--db`, `--journal`, `--state`, `--notes`, and `--jobs-root`; see `--help` for batch controls. Running the systemd service executes both observers.

### Workday recovery

Long waits for answers can outlast a Workday login session. After an interruption or “Something went wrong”, sign in and let Candidate Home finish loading, then match the requisition and choose **Related Actions → Continue Application** on its **Not Submitted** draft. Wait for saved fields to populate and verify them before continuing; do not delete the draft or repeatedly restart Apply Manually/Autofill with Resume. A draft does not count as a submitted application, and the final approval gate still applies.

A frozen resume and local checkpoint do **not** prove that an employer account or draft exists. Maintenance before registration must not trap recovery in “missing original account.” `get_account` looks up the exact employer tenant; `{ register: true }` can create initial stored credentials only outside submission ambiguity. Workers distinguish documented pre-registration failures from existing applications, reuse saved credentials even if signup was interrupted, and stop registering if the employer reports an existing account. Workday credentials are employer-specific, not a global Workday login. Missing local credentials are not proof of no remote account.

The reproduced PwC failure returned HTTP 400 when restarting application creation, followed by HTTP 404 requests with an `undefined` application ID. Resuming the existing draft restored the form and reached a verified **Application Submitted / Application Received** state. This was an application/session recovery failure, not evidence of an anti-bot denial. The recovery instructions are in `prompts/fill.md`; new fill workers read that file at startup, while already-running workers retain their original prompt.

## Sources and scanning

Scans run on their own, every `schedule.scanMinutes` (30 by default). A scan re-reads every board in `companies.yml` plus the remote-job feeds under `feeds:` in `config.yml` (Remotive, Jobicy, RemoteOK; each read no more often than its own `minutes`). Postings already known cost nothing, so agents only run for new ones. A scan also searches LinkedIn and Indeed (`boards:` in `config.yml`: one location, a few queries, newest first), logged out and with no account. Those two only say what is open: a posting that passes triage is looked up on the employer's own site (its public board if the slug can be guessed, otherwise a web-search agent, `models.locate`) and applied to there, and is skipped when the employer has no posting of its own. Discovery (an agent searching the web for more boards) runs every `schedule.discoverMinutes`. Daily caps in `limits` bound what a large scan can trigger.

## Duplicates and employers

One role is one job, wherever it is listed. A new posting is compared with every job already known for the same employer (legal suffixes like Inc/LLC ignored), in `findTwin` in `src/db.ts`:

- same title once normalised: word order, punctuation, abbreviations (Sr, ML, II) and tags like "(Remote)" or a requisition number are ignored;
- or a close title (at least 80% of the words shared) whose description, when both are available, also mostly matches;
- or a related title with a nearly identical description (the same role posted per city).

Titles that differ in level ("Engineer II" vs "Engineer III", "Senior") never match. A duplicate is folded into the existing job, whatever its state, including ones you skipped or rejected: the extra link is kept under the job's Posting tab, and the location list widens until the job has been assessed. If a role first seen on an aggregator later appears on the employer's own board, the job switches to the employer's link. The job lists group roles by employer and show how many you have already applied to there.

## Freshness

Each job keeps the date its posting opened (`posted_at`), taken from the board where it says (Workday and LinkedIn give only the day; Indeed and hand-added postings give none, so the first sighting stands in). `openedAt` in `src/db.ts` turns that into one estimate, which decides the order jobs are assessed in (newest first) and how the lists are laid out: To review and Held are split into Just opened (6 hours), Today, This week and Older, by score inside each. An employer with more than three roles in one part shows its best two and folds the rest.

## Resumes

Every compiled resume, stock or tailored, is named `resume.pdf` (`resume.pdfName` in `config.yml`), so uploads never carry a version or company suffix. When an application starts, the exact PDF and Typst sources are frozen to `data/jobs/<id>/applied/<sha-prefix>/`, with a `manifest.json` recording their SHA-256 hashes and the full PDF hash stored on the job. Resumption verifies and uploads that same archive, never a newly generated working copy; the job page shows and serves it. Missing or modified archives fail closed. Legacy archives without a manifest require an audit of the original PDF hash and archived sources before sealing, not regeneration. Tailored copies may not exceed the stock page count or modify the template.

## Browser

Real Chrome, headed on Xvfb display `:99`, persistent profile in `data/chrome-profile`, CDP on `127.0.0.1:9222`. `concurrency.fill` controls the browser-slot pool, not the number of parked applications: browser N (from 0) uses display `:99+N`, profile `data/chrome-profile-<N+1>`, CDP port `9222+2N`, pacing port `9223+2N` and noVNC port `6080+N`, and starts the first time it is needed. The extra profiles start empty, so their first visit to a site logs in again with the stored account. To reach an extra live view over the tailnet, publish its port the same way: `sudo tailscale serve --bg --https=6081 http://127.0.0.1:6081`. Agents connect through a pacing layer on port 9223 (`src/cdp-proxy.ts`) that turns their clicks into curved pointer paths and spaces keystrokes like a person's; Chrome is started with the machine's real GPU for WebGL. Live browser links use x11vnc + noVNC, started with Chrome and published on the tailnet at port 6080. Watch an active worker without interacting; to take over a stopped application, explicitly reserve its browser first. Unreserved parked applications do not expose a live link to a browser that another job may be using.

The running systemd user service uses `KillMode=process`, so restarting the Bun app leaves Chrome and its unsaved tabs alive. Killing Chrome, its display, or the machine is different: the worker must recover and verify an ATS-saved draft; a database checkpoint alone cannot restore unsaved page state.

## Layout

- `src/pipeline.ts`: workers, host tools, scheduler. `src/omp.ts`: RPC client. `prompts/`: one prompt per worker.
- `data/`: SQLite DB, per-job resume copies, omp sessions, Chrome profile (git-ignored; holds site passwords and Gmail tokens).
