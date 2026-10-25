# Review queue (gate 1)

Review lists every assessed job waiting for the user's first decision, newest posting first under how long ago it opened. On a desktop the queue and the open job sit side by side and a job is always open; its fit, risks and tailored resume lead, and the decision bar under them asks "Apply to this job?": approve it, change the resume, hold it for later, or reject it (with undo). Deciding opens the next job in its place.

## Sub-features

- `review-list` the queue with each row's employer, fit and age; group segments (Just opened, Today, This week, Older); a Filter menu (Score 80+, Remote, First at employer); Sort (Newest, Best fit, Company); search; the nav badge counts the queue.
- `review-approve` Approve moves the job to Pipeline (Applying) and opens the next one.
- `review-reject` Reject (in ⋯) moves it to Archive, Rejected; the toast offers Undo.
- `review-hold` Hold for later (in ⋯) moves it to Archive, Held; there "Assess now" brings it back to Review.
- `review-redo` Change resume takes a note in a dialog and sends the job back to be assessed (Pipeline, Assessing).
- `review-keys` `J`/`K` walk the queue, `A` approves, `X` rejects, `H` holds, `1`-`5` switch the job's tabs.
- `review-tabs` Overview, Fit, Resume, Posting and Activity for the open job.

## How to get to it (user POV)

- "Review" in the sidebar (its badge is the number waiting), `G` then `R`, or the Overview's "Review" row under Needs you.
- On a phone: the Review tab in the bottom bar; the queue is the page and a job opens full screen over it.
- A job by link: `#review/<id>`, or from the ⌘K palette's Jobs group.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes, viewport 1440×900. Jobs 1-6 are in Review; job 6 is "Support Engineer (reject me)".

- **See the list.** `browser_navigate $B/#review`. The URL becomes `#review/1` (the first job opens by itself). Sidebar `link "Review 6"`; `region "Jobs to review"` with `heading "Review"`, the count `6`, `button "Filter"`, `combobox "Sort"` (Sort Newest), `searchbox "Search the queue"`, `tablist "When the posting opened"` (`tab "All 6"`, `tab "Just opened 6"`), then `table "Queue"`: a heading row `Just opened 6` and six rows, the first `row "Just opened Backend Engineer (straight through) Verify Co A 84 …"`.
- **Filter.** `browser_click` `button "Filter"`, then `menuitemcheckbox "Score 80+ 1"`, `browser_press_key` `Escape`. The URL gains `?filter=top`, one row is left (job 1) and the button now reads `Score 80+`. Click it again and `menuitem "Clear filters"`: six rows.
- **Sort.** `browser_click` `combobox "Sort"`, `option "Best fit"`: `?sort=score`, rows by fit (84, 78, 73, …). `browser_navigate $B/#review` to go back to Newest.
- **Open a job.** `browser_click` `a[data-row="6"]` (or `row "Just opened Support Engineer (reject me) …"`). URL `#review/6`; `region "Open job"` shows `6 of 6`, `heading "Support Engineer (reject me)"` (level 1), the status `To review`, `button "Fit 61, open the Fit tab"`, Details with Practice `Not assessed` (seeded jobs carry no practice assessment), and the bar `[data-decision="Apply to this job?"]`: "The agent fills the form, then asks before sending.", `button "More actions"`, `button "Change resume"`, `button "Approve A"`.
- **Resume tab.** `browser_click` `tab "Resume"`: `img "First page of the tailored resume"` (`curl -s -o /dev/null -w '%{http_code}' $B/api/jobs/6/resume.png` prints `200`). `browser_click` `tab "Overview"`.
- **Reject.** `browser_click` the panel's `button "More actions"`: `menuitem "Hold for later H"`, `menuitem "Reject X"`. Click Reject. A toast `Rejected` with the title and `button "Undo"`; the URL moves to `#review/5`. `curl -s $B/api/jobs/6` has `"status":"rejected"`.
- **Undo.** `browser_click` the toast's `button "Undo"` (`[data-sonner-toast] button`). Toast `Back in the queue`, the URL returns to `#review/6`, and `"status":"awaiting_approval"`.
- **Hold.** On `#review/6`, `browser_press_key` `h`. Toast `Held for later`, URL `#review/5`; `curl` shows `"status":"held"`, `note` `held by you`. `browser_navigate $B/#archive/held/6`: the job opens over the Held table, bar `[data-decision="Held for later"]` reading `Held by you`, `button "Assess now A"`. Click it: toast `Back in the queue`, and job 6 is `awaiting_approval` again.
- **Approve.** `browser_navigate $B/#review/1`, `browser_click` `button "Approve A"` in the panel. Toast `Approved`, the URL moves to `#review/2`, the badge reads `Review 5`. `curl -s $B/api/jobs/1`: `approved_by` `user`, and within 2 s `status` `awaiting_submit` (the straight script goes directly to gate 2; see [fill-gates](./fill-gates.md)).
- **Change resume.** `browser_navigate $B/#review/3`, `browser_click` `button "Change resume"`: `dialog "Change the resume"` with the cursor in `textbox "What should change in the resume?"`. `browser_type` `Lead with the data work`, `browser_click` `button "Redo with this note"`. Toast `Redo requested`; `curl -s $B/api/jobs/3` has `"status":"triaged"`, `note` `redo requested`. `browser_navigate $B/#pipeline/3`: the URL gains `?group=assessing`, the Assessing stage is selected and the job's card reads `Not assessed yet`.
- **Keyboard.** `browser_navigate $B/#review` (opens the first job left), then with focus on the page: `browser_press_key` `j` (the next row opens; URL changes), `2` (`tab "Fit"` selected), `x` (rejects it from the Fit tab: toast `Rejected`, the next job opens).
- **Proof.** Before/after screenshots for each decision, the `curl` body for each job touched, `history` from `/api/jobs/<id>` showing the status sequence, and `/__verify`.

## Gotchas

- The Undo toast disappears after a few seconds. If it is gone, the user path back is Archive (`#archive/rejected/<id>`, `button "Reconsider"`); report which was used.
- "Change resume" disappears once a job's resume is frozen (any job that has started filling); the bar then says so. Use a job that was never approved.
- After redo the job stays "Not assessed yet": re-assessment needs a model, and the seeded profile is incomplete, so prep is not even attempted. Do not claim the new resume was produced.
- Toasts stack (newest first) and outlive the action: read the first `[data-sonner-toast]`, or wait for the earlier ones to go.
- Keys are ignored while focus is in a field or a dialog is open. `browser_navigate` leaves focus on the page; after typing in the search box, press `Escape` or click a blank area first.
- At phone width (390) the queue is the page: `#review` stays `#review`, nothing is open, so `A`/`X`/`H` do nothing until a row is clicked. The job then covers the screen with `button "Close"` (also Back) and the bar's buttons fill its width without the text (`button "Approve"`, no key hint).
- The search box does not filter as you type: it writes `?q=` a moment later, and the server pages the result.
