# Fill gates

Once an application is approved, a fill worker works on it and stops whenever it needs the user: to answer a question, to confirm the final submit (gate 2), or to take over the browser. Each stop is a card above the job's tabs in Pipeline, saying what is asked with one primary action; the user clears it there and the application ends up in Applications, or in Pipeline's Failed stage with a Retry. Every hand-off and failure is also listed, by cause, under Activity, Blockers. A form that requires a cover letter or references is not a stop: the worker drops the application to Archive, Skipped.

## Sub-features

- `fill-question` an approved job parks on "The agent needs an answer"; the saved answer is reused when the worker resumes.
- `fill-skip` a job whose form requires a cover letter (or references) is skipped, with the reason as its note; nothing waits on the user.
- `fill-confirm-submit` gate 2: "Submit this application?" with the exact summary; "Approve submission" (a click only, never `A`) lets the worker submit once.
- `fill-manual` "Browser hand-off": reserve the browser, hand control back, the worker resumes.
- `fill-failed` a worker failure shows "This application failed" with Retry (and Mark submitted in ⋯).
- `fill-frozen-resume` the resume is frozen at first fill and can no longer be changed.
- `fill-blockers` the hand-off and the failure each add a row to Activity, Blockers, with its cause.

## How to get to it (user POV)

- Approve a job in Review (see [review-queue](./review-queue.md)), then open Pipeline: the stage tiles count Needs you (confirm submit, browser hand-off), Waiting on answers (questions), Failed, Applying and Assessing; the sidebar's Pipeline badge counts everything but questions, which the Questions badge counts.
- The Overview's Needs you list links each kind ("Confirm submit", "Browser hand-offs", "Failed"; "Cover letters" only for gates parked before cover letters became skips).
- Open the job directly at `#pipeline/<id>` (it opens on its own stage), or at `#job/<id>`.
- Questions are also answered from the Questions page (see [questions-inbox](./questions-inbox.md)), which links the other gates back here.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed (`ctl.sh reset`), doctor passes, viewport 1440×900.
- Jobs 2, 3, 4 and 5 are in Review; job 8 sits in Pipeline, Failed.

- **Approve the question job.** `browser_navigate $B/#review/2`, `browser_click` `button "Approve A"` in `region "Open job"`. Toast `Approved`; the next job opens.
- **See the question gate.** `browser_navigate $B/#pipeline/2`: the URL gains `?group=questions` and `browser_wait_for` text `The agent needs an answer`. The card `[data-decision="The agent needs an answer"]` shows `Asked just now`, `What is your desired annual base salary in USD?` with its context under it, `textbox "Your answer For this application only"`, a link `Answer all matching in Questions`, `button "Save and queue"` with the `Ctrl ↵ to save` hint, `button "More actions"` (Hold for later, Reject), and the folds `How this works` and `Saved checkpoint`. Sidebar: `link "Questions 1"`. `curl -s $B/api/jobs/2` has `"status":"needs_input"` and `gate.kind` `question`.
- **Answer it.** `browser_type` `textbox "Your answer For this application only"` with `95000`, `browser_click` `button "Save and queue"`. Toast `Response saved, queued to resume`. The job leaves Waiting on answers, so the panel closes (URL `#pipeline?group=questions`).
- **Gate 2 appears.** `curl -s $B/api/jobs/2` reaches `"status":"awaiting_submit"`, `gate.kind` `confirm_submit` within 2 s. `browser_navigate $B/#pipeline/2` and `browser_wait_for` text `Submit this application?`: the card reads `Filled in and waiting.` and `Stand-in application for job 2: name, email and resume resume.pdf entered.`, with `button "Approve submission"` and `button "Change something"`. Pressing `a` does nothing here (still `awaiting_submit`).
- **Approve the submission.** `browser_click` `button "Approve submission"`. Toast `Response saved, queued to resume`.
- **Confirm the outcome.** `curl` reaches `"status":"submitted"`. `browser_navigate $B/#applications/2`: the header reads `Applied just now` and the status `Applied`; the card is now `Next steps`. `browser_click` `tab "Activity"`: newest first, `Moved to Applied`, `Application agent` `Final submission authorized after re-observation: …`, `You responded` `Approve`, `Moved to Confirm submit`, `You responded` `95000`, `Moved to Needs answer`, `Stopped to ask you` (the question), `You approved it`. `curl -s $B/api/jobs/2`: `submitted_at` set, `resumeFrozen` true, and `history` statuses in order `awaiting_approval, approved, filling, needs_input, approved, filling, awaiting_submit, approved, filling, submitted`. `ls $VERIFY_HOME/state/data/jobs/2/applied/*/` lists `main.typ manifest.json resume.pdf`. `grep 'worker job 2' $VERIFY_HOME/evidence/server.log` shows the second `ask_user` returning `Exact scoped candidate answer: 95000`.
- **Cover letter means skip.** Approve job 3 the same way; `curl -s $B/api/jobs/3` reaches `"status":"skipped"` with `note` `requires a cover letter: Cover letter (required, plain text, at most 300 words)` and no `gate`. It shows in Archive, not in Pipeline.
- **Browser hand-off.** Approve job 4; open `$B/#pipeline/4`, wait for `Browser hand-off`. The card reads `The agent needs you to take over.` and `Stand-in CAPTCHA: the form asked for a check only a person can pass.`, primary `button "Reserve browser A"`, then `button "Check status and recover"`; ⋯ holds `I submitted it`, `Hold for later`, `Reject`. Click Reserve browser: toast `Browser reserved`, and the primary becomes `button "Hand control back A"`. Click it: toast `Response saved, queued to resume`. `curl` reaches `awaiting_submit` with `note` `Manual control returned: done`; gate 2 follows as above.
- **Failure and retry.** Approve job 5; `curl` reaches `"status":"failed"`. `browser_navigate $B/#pipeline/5` (stage Failed, beside job 8): `This application failed`, `Stand-in worker: scripted failure`, `button "Retry A"`. Click it: toast `Back in the queue`, the next failed job (8) opens, and job 5 is back in Review (`"status":"awaiting_approval"`) with `resumeFrozen` true. On `#review/5` its bar has no Change resume and says `This application already started with its frozen resume, so the resume can no longer be changed.`
- **Blockers.** `browser_navigate $B/#activity/blockers`: under `Today 2`, a row for Verify Co E (`stand-in worker: scripted failure`, cause `Site down`) and one for Verify Co D (`Stand-in CAPTCHA: …`, cause `CAPTCHA`), each linking `#job/<id>`; `tablist "Cause"` has `All 2`, `Site down 1`, `CAPTCHA 1`. `curl -s $B/api/blockers` lists both.
- **Proof.** Screenshot and ARIA-snapshot each gate card before clearing it and Applications after; save `curl -s $B/api/jobs/<id>` for each job driven; finish with `curl -s $B/__verify` showing `"refusedOutbound":[]`.

## Gotchas

- "Submitted" is the stand-in worker's report. This proves the app's gate and status handling, not that a form can be filled.
- Clearing a gate takes the job out of its stage, so Pipeline opens the next job in that stage or closes the panel. Re-open the job by route before waiting on its next gate.
- Every gate but Held, running jobs and ambiguous submissions has `Hold for later` (and `Reject`) in its ⋯ menu; snapshots list the menu items only while it is open. Once a hand-off's browser is reserved, ⋯ holds `Release browser`, `Check status and recover`, `I submitted it`, `Hold for later`, `Reject`. The ambiguous gate leads with `Check status and recover`, with `Verified submitted` / `Verified not submitted` under "I checked it myself". Those paths (recovery, ambiguous submission) are not scripted here.
- The worker restarts its script from the top on every resume; the question is asked again and answered from storage. Seeing `ask_user` twice in `server.log` is correct.
- Gate 2 approval is bound to the exact summary text. A proof of `Change something` (`textbox "Changes for this application"`, `button "Save changes and queue"`) ends at a second gate 2, not at submitted.
- Gate screenshots do not exist here: the stand-in browser returns none, so `/api/jobs/<id>/gate.png` is 404 and the evidence fold is `Saved checkpoint` only.
- The manual script hands off once per server process. After `ctl.sh reset` it hands off again; after hand-back it does not.
- One fill runs at a time (one slot). Approving several jobs at once is fine, but they park one after another; wait on each separately. If a second approved job sits in Applying ("Queued to apply") while the slot is idle, check that `serve.ts` still sets `config.limits.applySpreadHours = 0`.
- A real worker can ask several questions on one page and park once, on the first unanswered one (`ask_user` with `more: true`); answering it parks the next instead of resuming. The stand-in asks one question, so this map never drives that; `bun test` covers it.
- Job 5 after Retry goes to Review, not straight to the fill queue, because its resume PDF exists. That is the app's rule for retry, not a stand-in artifact.
- If a gate shows `Worker ended without a verified outcome (cause must be one of …)` or `ENOENT … resume.pdf`, the stand-in no longer matches the host tools or the resume file is missing (a snapshot): read `server.log` for `threw:` and see SKILL.md's Launch.
