# Questions inbox

Questions holds every question a filling agent could not answer from the profile, grouped when the same employer asks the same thing, newest posting first under how long ago it opened. One question is open at a time beside the queue: answer it by picking an option or typing, for this application only or, when allowed, as a standing answer for that employer; saving opens the next. Submit confirmations and browser hand-offs are not answered here: a line counts them and links to Pipeline.

## Sub-features

- `inbox-list` the queue (`Opened today`, `This week`, `Older` headings, each row the question, the employer and when it was asked, a count when several applications ask it); the header count; a filter box; the Questions badge in the sidebar.
- `inbox-answer` an answer for one application (the default) queues it to resume; the next question opens (the same application's next one first). Up to 8 fixed options are one-click cards with number keys.
- `inbox-standing` ticking "Also use for future <Company> applications asking exactly this" asks for confirmation, then saves a standing answer for that exact employer and prompt.
- `inbox-elsewhere` other gates are only counted ("1 more waits on you", the kinds named in its tooltip: "1 browser hand-off") with a link to Pipeline's Needs you.
- `inbox-empty` with no question open the page says "All caught up" and the badge is gone.

## How to get to it (user POV)

- "Questions" in the sidebar or the phone's bottom bar, `G` then `Q`, or the Overview's Questions row.
- "Answer all matching in Questions" under a question gate on a job (opens that question).
- `#questions/<group key>` opens one question (the key is `groups[].key` in `/api/questions`).

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes, viewport 1440×900.
- Jobs 2 and 4 approved through the UI (`#review/2` and `#review/4`, `button "Approve A"`) and parked: `curl -s $B/api/questions` lists two groups, kinds `question` (`standingAllowed` true) and `manual`.

- **See the inbox.** `browser_navigate $B/#questions`, `browser_snapshot`. In `main`: `heading "Questions"` with the count `1`, an `alert` `1 more waits on you` (tooltip `1 browser hand-off`) with `link "Pipeline"` (`#pipeline?group=needs_you`), `searchbox "Filter questions"`, then `navigation "Questions to answer"`: heading row `Opened today 1` and `row "What is your desired annual base salary in USD? Verify Co B just now"`. Beside it `region "Open question"` (the first is open on a desktop; the URL stays `#questions`): a link to the application (`#pipeline/2`), `1 of 1`, `heading "What is your desired annual base salary in USD?"`, `Asked just now`, `On the form` with the context, `textbox "Your answer"`, `button "Skip"` (disabled with one question), `button "Save and next Ctrl ↵"` (disabled while empty), `checkbox "Also use for future Verify Co B applications asking exactly this"`, the fold `How answers are reused` and the key strip `J K Move ↵ Type Ctrl ↵ Save Esc Leave the box`. Sidebar `link "Questions 1"`.
- **Answer it (keyboard).** `browser_press_key` `Enter`: the cursor is in `textbox "Your answer"`. `browser_type` `95000`, `browser_press_key` `Control+Enter`. Toast `Saved, application queued`. With nothing left, the page reads `All caught up` (`Nothing is waiting on an answer. …`) and keeps the hand-off alert; the Questions badge is gone.
- **Answer it (mouse).** On a fresh pair, instead: `browser_type` `textbox "Your answer"` in `region "Open question"`, `browser_click` `button "Save and next Ctrl ↵"`. Same toast and result.
- **Confirm.** `curl -s $B/api/jobs/2` reaches `"status":"awaiting_submit"` within 2 s; `curl -s $B/api/questions` holds only the `manual` group. `#activity/log` lists `Answered question (application); queued applications: 2`; Highlights (`#activity`) reads `You answered a question.`
- **Standing answer.** (Fresh seed, job 2 approved.) Type `120000`, `browser_click` the checkbox, then `button "Save and next Ctrl ↵"`: `alertdialog "Approve a standing answer?"` with `Answer 120000` and `Scope Only Verify Co B; exact prompt, context, and choices, including future applications`. `browser_click` `button "Approve and save"`: toast `Saved, application queued`, job 2 reaches `awaiting_submit`.
- **Browser hand-off.** It has no form here; follow the alert's `link "Pipeline"` to Needs you and clear it on `#pipeline/4` (see [fill-gates](./fill-gates.md)).
- **Empty state.** Once both are cleared they wait at gate 2, and the alert reads `2 submits to confirm also wait on you`. Approve both submissions (`#pipeline/2`, `#pipeline/4`, `button "Approve submission"`), then `browser_navigate $B/#questions`: `All caught up`, no alert, no badge; `curl -s $B/api/questions` is `{"groups":[]}`.
- **Proof.** Snapshot of the inbox before and after the answer, the toast text, `curl -s $B/api/questions` before and after, `curl -s $B/api/jobs/2`.

## Gotchas

- Option cards save on click (or on their number key): there is no second step. The seeded question has no options, so `[data-option]` and `1`-`8` are not drivable here; `bun test` covers the option paths.
- Each seeded company is distinct, so the seed never produces a group with two applications (`combobox "Answer for"` and "2 applications ask this" never show). Grouping across applications is covered by `tests/questions.test.ts`, not by this map.
- `Enter` focuses the answer box only when focus is not on a link or button (there it activates that control). After a click elsewhere, press `Enter` from the page body or click the box.
- On a phone the queue is the page; a row opens the question full screen with `link "Back to all questions"`, and `Esc` (outside the box) closes it too.
- Answering from the job's gate card and from this page are two entry points to the same gate; a proof of one does not cover the other.
- The Daily digest that mails these questions cannot be sent here (no mailbox): Settings shows `Mailbox not connected` and a disabled `Send now`.
