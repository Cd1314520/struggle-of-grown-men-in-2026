# Fill gates

Once an application is approved, a fill worker works on it and stops whenever it needs the user: to answer a question, to supply a cover letter, to confirm the final submit (gate 2), or to take over the browser. The user clears each stop from the job's page in In progress, and the application ends up in Applied or marked failed.

## Sub-features

- `fill-question` an approved job parks on "The agent needs an answer"; the saved answer is reused when the worker resumes.
- `fill-cover-letter` a job parks on "This application requires a cover letter".
- `fill-confirm-submit` gate 2: "Submit this application?" with the exact summary; approving it lets the worker submit once.
- `fill-manual` "The agent needs browser help": reserve the browser, hand back, worker resumes.
- `fill-failed` a worker failure shows "This application failed" with Retry and Mark submitted.
- `fill-frozen-resume` the resume is frozen at first fill and can no longer be changed.

## How to get to it (user POV)

- Approve a job in To review (see [review-queue](./review-queue.md)), then open In progress: the job is listed with a "Needs you" marker when it parks.
- Open the job directly at `#progress/<id>`.
- The In progress badge in the section nav (title "Need you") counts parked and failed applications.
- Questions and cover letters also appear in the Questions inbox (see [questions-inbox](./questions-inbox.md)).

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed (`ctl.sh reset`), doctor passes.
- Jobs 2, 3, 4 and 5 are in To review.

- **Approve the question job.** `browser_navigate $B/#review/2`, then `browser_click` `.gate [data-act="approve"]`. Toast reads `Approved`; the UI moves to the next job.
- **See the question gate.** `browser_navigate $B/#progress/2`, `browser_wait_for` text `The agent needs an answer`. The pane shows `What is your desired annual base salary in USD?`, an "Exact context" block and a "Saved checkpoint" disclosure. `curl -s $B/api/jobs/2` has `"status":"needs_input"` and `gate.kind` `question`.
- **Answer it.** `browser_type` `#ans` with `95000`, `browser_click` `.gate [data-act="respond"]` (button "Save answer and queue"). Toast `Response saved · queued to resume`.
- **Gate 2 appears.** `browser_wait_for` text `Submit this application?`. The pane shows the summary `Stand-in application for job 2: name, email and resume resume.pdf entered.` `curl` shows `"status":"awaiting_submit"`, `gate.kind` `confirm_submit`.
- **Approve the submission.** `browser_click` `.gate [data-act="respond"][data-fixed="approve"]` ("Approve submission").
- **Confirm the outcome.** `browser_navigate $B/#applied/2`: a "Submitted" pill and "Applied just now". `browser_click` `[data-tab="log"]`: newest first, `Final submission authorized after re-observation: …`, `respond: approve`, `confirm_submit: …`, `respond: 95000`, `question: …`, `approve`. `curl -s $B/api/jobs/2`: `status` `submitted`, `submitted_at` set, `resumeFrozen` true, and `history` statuses in order `awaiting_approval, approved, filling, needs_input, approved, filling, awaiting_submit, approved, filling, submitted`. `ls $VERIFY_HOME/state/data/jobs/2/applied/*/` lists `main.typ manifest.json resume.pdf`. `grep 'worker job 2' $VERIFY_HOME/evidence/server.log` shows the second `ask_user` returning `Exact scoped candidate answer: 95000`.
- **Cover letter.** Approve job 3 the same way, open `$B/#progress/3`, wait for `This application requires a cover letter`. Type a letter into `#ans`, click `.gate [data-act="respond"]` ("Save letter and queue"). Gate 2 follows; after approving it, `$VERIFY_HOME/state/data/jobs/3/cover_letter.txt` holds the letter exactly as typed.
- **Manual hand-off.** Approve job 4, open `$B/#progress/4`, wait for `The agent needs browser help` (text `Stand-in CAPTCHA: …`). The hand-back button is absent until the browser is reserved: click `[data-browser-action="reserve"]` (toast `Browser reserved`), then `.gate [data-act="respond"][data-fixed="done"]`. Gate 2 follows; `curl` shows `note` `Manual control returned: done`.
- **Failure and retry.** Approve job 5, open `$B/#progress/5`, wait for `This application failed` (`stand-in worker: scripted failure`). Click `.gate [data-act="retry"]`: toast `Back in the queue`, and the job is back in To review (`"status":"awaiting_approval"`) with `resumeFrozen` true and no "Change resume" button.
- **Proof.** Screenshot and ARIA-snapshot each gate before clearing it and the Applied page after; save `curl -s $B/api/jobs/<id>` for each job driven; finish with `curl -s $B/__verify` showing `"refusedOutbound":[]`.

## Gotchas

- "Submitted" is the stand-in worker's report. This proves the app's gate and status handling, not that a form can be filled.
- The worker restarts its script from the top on every resume; the question is asked again and answered from storage. Seeing `ask_user` twice in `server.log` is correct.
- Gate 2 approval is bound to the exact summary text. A proof of "Change something" (`[data-toggle="#chgbox"]`, `#chg`) ends at a second gate 2, not at submitted.
- Gate screenshots do not exist here: the stand-in browser returns none, so `/api/jobs/<id>/gate.png` is 404 and the gate shows no image.
- The manual script hands off once per server process. After `ctl.sh reset` it hands off again; after hand-back it does not.
- One fill runs at a time (one slot). Approving several jobs at once is fine, but they park one after another; wait on each heading separately.
- Job 5 after Retry goes to To review, not straight to the fill queue, because its resume PDF exists. That is the app's rule for retry, not a stand-in artifact.
