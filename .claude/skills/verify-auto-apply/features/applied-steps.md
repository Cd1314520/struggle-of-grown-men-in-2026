# Applied: next steps

A sent application lists, on its Summary, each step the employer asked for (a questionnaire, an assessment, a time to book, an interview) and whose move each one is. The user adds steps that came another way, marks them done with an optional note, books a time, and records an offer, a decline or a withdrawal. The Applied list groups applications by whose move it is.

## Sub-features

- `step-add` "Add a step" opens a form (kind, what, due day, link, notes); the first step moves a submitted application to In process.
- `step-done` "Done" (or "Done, with a note…", then "Save as done") marks a step done: the lead reads "Waiting on <company> since …".
- `step-book` "Booked for…" on a Booking or Interview step saves a time: the step reads "Booked", the lead "Booked: …".
- `step-edit` / `step-cancel` / `step-remove` / `step-todo` correct a step, drop it, delete it (asks to confirm), or put it back to to-do.
- `applied-groups` Applied's parts: Offers, Your move, Upcoming, Waiting on them (a "quiet" tag after 7 days), Awaiting first reply, Declined or withdrawn (collapsed).
- `outcome` "Mark offer", "Mark declined", "Withdraw" (behind ⋯ on a phone) end the application and close its open steps; "Back in process" undoes it.

## How to get to it (user POV)

- Applied (`#applied`), then a sent job: the "Next steps" block heads its Summary tab.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes. Job 9 is the only sent application (`curl -s $B/api/jobs/9` → `status` `submitted`, `steps` `[]`).

Steps:

1. `browser_navigate $B/#applied/9`: heading "Next steps", lead "Sent … No reply yet."
2. `step-add`: `browser_click [data-toggle="#st-add"]`; fill `#st-add [name=title]` "Codility assessment, 90 min", `#st-add [name=due]` a day two days out, `#st-add [name=link]` any https URL; `browser_click #st-add [data-step-op="add"]`. Toast "Step added"; the step shows "To do"; the header pill reads "In process". `curl -s $B/api/jobs/9`: `status` `interview`, one step `todo`, `next.whose` `you`.
3. `step-done`: `browser_click .step [data-toggle$="-note"]`, type into `.step textarea[name=note]`, `browser_click .step .reveal [data-step-op="done"]`. Toast "Marked done · watching for their reply"; the step reads "Done · waiting on them" with "Your note: …". API: step `done`, `done_note` set, `next.whose` `them`.
4. `step-book`: add a step with `#st-add [name=kind]` "Booking"; `browser_click .step:nth-child(2) [data-toggle$="-book"]`, fill `.step:nth-child(2) [name=at]` (a future `YYYY-MM-DDTHH:MM`), `browser_click .step:nth-child(2) [data-step-op="book"]`. The step reads "Booked" with the time in bold; API: `scheduled`, `scheduled_at` set, `next.whose` `upcoming`.
5. `applied-groups`: at 1280 wide, `#applied` shows the job under "Upcoming" with the step's name in its line and "in Nd" on the right.
6. `outcome`: `browser_click [data-act="mark_declined"]`: pill "Declined", both steps "Closed", the row moves to "Declined or withdrawn". `browser_click [data-act="reopen_application"]`: pill "In process". API `history` ends `interview → rejected_by_company → interview`.

## Gotchas

- Steps are only added while an application is submitted, in process or an offer; the form is not shown once it ended.
- Reopening the application leaves its steps closed; reopen a step with its own "Reopen".
- The mailbox agent that adds steps from mail needs a model and Gmail: not verifiable here (`tests/steps.test.ts` checks the brief it is given, `tests/digest.test.ts` the due-soon mail).
