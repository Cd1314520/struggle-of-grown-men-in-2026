# Review queue (gate 1)

To review lists every assessed job waiting for the user's first decision. Opening one shows its score, rationale and tailored resume under "Apply to this job?", where the user approves it, rejects it (with undo), holds it for later, or sends it back with feedback for a different resume.

## Sub-features

- `review-list` jobs awaiting approval with company, location, age and score; filter chips; count badge in the nav.
- `review-approve` Approve moves the job to In progress and selects the next one.
- `review-reject` Reject moves it to Rejected; the toast offers Undo, and Rejected offers a way back.
- `review-hold` "Hold for later" moves it to Held; Held's "Assess now" brings it back.
- `review-redo` "Change resume" takes feedback text and sends the job back to be assessed again.
- `review-keys` `J`/`K` move through the list, `A` approves, `X` rejects, `1`-`5` switch job tabs.
- `review-tabs` Summary, Score, Resume, Posting and Log for the open job.

## How to get to it (user POV)

- The app opens on To review (`/` or `#review`).
- Choose "To review" in the section nav; its badge is the number waiting.
- Open a job by clicking its row, or with `J`/`K` at desktop width.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes. Jobs 1-6 are in To review; job 6 is "Support Engineer (reject me)".

- **See the list.** `browser_navigate $B/#review`, `browser_snapshot`. Nav button `To review 6`; six rows (role `link`), the first `Backend Engineer (straight through) … 84 Verify Co A · Remote (US)`; filter toolbar with `All6` and `80+1`.
- **Filter.** `browser_click` `[data-filter="top"]`. Only job 1 remains. Click `[data-filter="all"]` to restore.
- **Open a job.** `browser_click` `[data-job="6"]`. URL becomes `#review/6`; the pane shows heading `Support Engineer (reject me)`, a `Practice not assessed` pill (seeded jobs carry no practice assessment), gate heading `Apply to this job?` and buttons `Approve`, `Change resume`, `Hold for later`, `Reject`.
- **Resume tab.** `browser_click` `[data-tab="resume"]`. An image of the resume's first page loads from `/api/jobs/6/resume.png` (`curl -s -o /dev/null -w '%{http_code}' $B/api/jobs/6/resume.png` prints `200`).
- **Reject.** `browser_click` `[data-tab="summary"]`, then `.gate [data-act="reject"]`. Toast `Rejected · next: …` with an `Undo` button. `curl -s $B/api/jobs/6` has `"status":"rejected"`.
- **Undo.** `browser_click` `#toast button`. Job 6 is back in To review (`"status":"awaiting_approval"`).
- **Hold.** `browser_click` `.gate [data-act="hold"]`. The UI moves to the next job; `curl -s $B/api/jobs/6` has `"status":"held"`, `note` `held by you`. `browser_navigate $B/#held/6`: gate heading `Held for later`, text `Held by you`. `browser_click` `.gate [data-act="retry"]` ("Assess now"): toast `Back in the queue · next: …`, and job 6 is `awaiting_approval` again.
- **Approve.** `browser_navigate $B/#review/1`, `browser_click` `.gate [data-act="approve"]`. Toast `Approved · next: …`; nav badge drops by one. `curl -s $B/api/jobs/1`: `approved_by` `user`, and within 2 s `status` `awaiting_submit` (the straight script goes directly to gate 2; see [fill-gates](./fill-gates.md)).
- **Change resume.** `browser_navigate $B/#review/3`, `browser_click` `[data-toggle="#redo"]`, `browser_type` `#fb` with `Lead with the data work`, `browser_click` `.gate [data-act="redo"]` ("Redo with this note"). Toast `Redo requested · next: …`; `curl -s $B/api/jobs/3` has `"status":"triaged"` and `note` `redo requested`; the job shows in In progress as "Not assessed yet".
- **Keyboard.** At 1280 px width, `browser_navigate $B/#review`, `browser_press_key` `j` (selection and URL move to the next job), `2` (Score tab), `1` (back to Summary), `x` (rejects it; same result as the Reject step).
- **Proof.** Before/after screenshots for each decision, the `curl` body for each job touched, `history` from `/api/jobs/<id>` showing the status sequence.

## Gotchas

- The Undo toast disappears after a few seconds. If it is gone, the user path back is Rejected (`#rejected/<id>`) and its reconsider button; report which was used.
- "Change resume" disappears once a job's resume is frozen (any job that has started filling). Use a job that was never approved.
- After redo the job stays "Not assessed yet": re-assessment needs a model, and the seeded profile is incomplete, so prep is not even attempted. Do not claim the new resume was produced.
- `A` and `X` click the gate's buttons, which only exist on the Summary tab. After `2`-`5` they do nothing; press `1` first.
- The Hold toast reads `· next: …` with no action word and no Undo (the UI has no done-text for `hold`; a product gap, not a harness one). Confirm the hold with `curl`, not the toast.
- Keyboard shortcuts are ignored while focus is in a field or on a button. Click a blank part of the page or reload first.
- At phone width nothing is selected until a row is clicked, so `A`/`X` do nothing on the list screen.
- The search box `#q` only exists when a section holds more than eight jobs; the seed has six in To review.
