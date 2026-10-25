# Applications: next steps

A sent application leads with a "Next steps" card above its tabs: each step the employer asked for (a questionnaire, an assessment, a time to book, an interview) and whose move it is. The user adds steps that came another way, marks them done with an optional note, books a time, and records an offer, a decline or a withdrawal from the card's Outcome menu. The Applications list segments applications by whose move it is.

## Sub-features

- `step-add` "Add a step" opens a form (Kind, What, Due, Link, Notes); the first step moves a submitted application to In process.
- `step-done` "Done" (or "Done, with a note…" in the step's ⋯, then "Save as done") marks a step done: the lead reads "Waiting on <company> since …".
- `step-book` "Booked for…" on a Booking or Interview step saves a time: the step reads "Booked", the lead "Booked for …".
- `step-edit` / `step-cancel` / `step-remove` / `step-todo` correct a step (Edit), drop it (Cancel step), delete it (Remove, asks to confirm), or put it back (Back to to-do; Reopen once closed).
- `applications-segments` Applications' segments: Offers (only when there is one), Your move, Upcoming, Waiting on them, No reply yet, Closed, each with a count; with All and the default sort, a heading row starts each group.
- `outcome` the card's Outcome menu: "Mark offer", "Mark declined", "Withdraw" end the application and close its open steps; "Back in process" undoes it.

## How to get to it (user POV)

- "Applications" in the sidebar (`G` then `A`), then a sent application; or `#applications/<id>`.
- The Overview's "Coming up" lists booked and due steps.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes, viewport 1440×900. Job 9 is the only sent application (`curl -s $B/api/jobs/9` → `status` `submitted`, `steps` `[]`).

1. `browser_navigate $B/#applications/9`: the list narrows to a column (a `combobox "Segments"` replaces the segment tabs) and the job opens beside it. `[data-decision="Next steps"]` reads `Sent 2d ago. No reply yet.`, with `button "Outcome"` and `button "Add a step"`.
2. `step-add`: `browser_click` `button "Add a step"`; the form has `combobox "Kind"` (Assessment), `textbox "What"`, `textbox "Due"`, `textbox "Link"`, `textbox "Notes"`. Fill What `Codility assessment, 90 min`, Due a day two days out (`YYYY-MM-DD`, see Gotchas), Link any https URL; `browser_click` `button "Add step"`. Toast `Step added`; the lead reads `Your move, due <day>`; the step shows `Assessment`, `To do`, `Due <day>`, `Added by you just now`, the link shortened to `host/path`, and `button "Done"`; the header status reads `In process`. `curl -s $B/api/jobs/9`: `status` `interview`, one step `todo` with `due_at`, `next.whose` `you`.
3. `step-done`: `browser_click` the step's `button "More step actions"`: `Done, with a note…`, `Edit`, `Cancel step`, `Remove`. Choose `Done, with a note…`, type into `textbox "How it went, what you sent"`, `browser_click` `button "Save as done"`. Toast `Marked done, watching for their reply`; the step reads `Done, waiting on them`, `Done just now` and `Your note …`; the lead `Waiting on Verify Co I since <date, time>`. API: step `done`, `done_note` set, `next.whose` `them`.
4. `step-book`: `button "Add a step"`, `combobox "Kind"` → `option "Booking"` (options: Questionnaire, Assessment, Booking, Interview, Information request, Step), What `Book a call with the hiring manager`, `button "Add step"`. The lead reads `Your move: Book a call with the hiring manager`. On that step, `browser_click` `button "Booked for…"`, fill `textbox "Booked for"` with a future `YYYY-MM-DDTHH:MM`, `browser_click` `button "Save time"`. Toast `Time saved`; the step reads `Booked <date, time>` with `button "Change time"`; the lead `Booked for <date, time>: Book a call with the hiring manager`. API: second step `schedule`, `scheduled`, `scheduled_at` set, `next.whose` `upcoming`.
5. `applications-segments`: `browser_navigate $B/#applications`: `tablist "Segments"` reads `All 1`, `Your move 0`, `Upcoming 1`, `Waiting on them 0`, `No reply yet 0`, `Closed 0`; the table has a heading row `Upcoming 1` and the row `Software Engineer (already sent) Verify Co I In process Book a call with the hiring manager Booked in 2d …` (columns Role, Status, Next step, Applied, Updated).
6. `outcome`: on `#applications/9`, `browser_click` `button "Outcome"`: `Mark offer`, `Mark declined`, `Withdraw`. Choose `Mark declined`: toast `Marked as declined`, the job stays open, the lead reads `Declined just now: marked by you`, both steps read `Closed` and `Add a step` is gone; the list row moves under `Closed 1` with status `Declined`. `button "Outcome"` now offers only `Back in process`: choose it. API `status` `interview`, `history` ends `interview, rejected_by_company, interview`, both steps still `closed`.

## Gotchas

- Steps are only added while an application is submitted, in process or an offer; the form is not shown once it ended.
- Reopening the application leaves its steps closed; reopen a step with its own `Reopen` (⋯).
- `Due` and `Booked for` are native date and datetime-local inputs. `browser_type` into them is unreliable: use `browser_fill_form` (or Playwright `fill`) with `2026-10-27` / `2026-10-28T09:30`, or check the value in the step afterwards.
- Times read in the browser's time zone; the API stores UTC (`scheduled_at` ends in `Z`).
- At 1440 with a job open the list is a narrow column: segments are a `combobox "Segments"`, not tabs, and rows are compact (title, time, status). Close the job (`button "Close"`) for the full table.
- The mailbox agent that adds steps from mail needs a model and Gmail: not verifiable here (`tests/steps.test.ts` checks the brief it is given, `tests/digest.test.ts` the due-soon mail).
