# Questions inbox

Questions is the inbox of everything the pipeline parked on the user, worked down oldest first. Questions (grouped when the same employer asks the same thing) are answered here, one expanded at a time; cover letters, submit confirmations, browser hand-offs and unclear submissions are listed as links to their application.

## Sub-features

- `inbox-list` a summary line (`N to answer · oldest asked Xd ago`), a `.qelse` line counting the other gates with a link to In progress (they are listed only there), then question rows under age headings (Older than a week / This week / Today) with an age chip (warn-coloured past a day) and `Employer · Title` (or `· N applications`, `· N more after this`), and Nav badge counts the questions to answer, warn-coloured when one is over a day old.
- `inbox-answer` answering a question for one application (the default; the standing checkbox is unticked) queues it to resume, then the next question opens (the same application's next one first). Fixed options of up to 8 are one-click buttons.
- `inbox-cover-letter` a cover-letter gate is only counted in the `.qelse` line ("1 cover letter"), which links to In progress; it has no inline form.
- `inbox-empty` with nothing open the page says so and the badge is gone.

## How to get to it (user POV)

- Choose "Questions" in the section nav, or open `#questions`.
- Follow the "Questions" link in the hint under a question gate on a job page.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes.
- Jobs 2 and 3 approved through the UI (`#review/2` and `#review/3`, `.gate [data-act="approve"]`) and parked: `curl -s $B/api/questions` lists two groups, kinds `question` and `cover_letter`.

- **See the inbox.** `browser_navigate $B/#questions`, `browser_snapshot` with `target: "#questions-inbox"`. Heading `Questions`, summary `1 to answer · oldest asked <age>`, then `Also waiting on you: 1 cover letter. Open In progress ›`. Under the age heading the row `What is your desired annual base salary in USD?` / `Verify Co B · Platform Engineer (asks a question)` is open (oldest open by default); Nav button reads `Questions 1`.
- **Answer the question.** In the open salary group (click `[data-question-row]` first if it is closed): `browser_type` `[data-question-form] textarea[name=answer]` with `95000`; leave the standing checkbox unticked; `browser_click` `[data-question-answer]` ("Save and queue"). Toast `Answered · nothing left to answer`.
- **Confirm.** The row leaves the inbox, which then reads "No questions to answer." `curl -s $B/api/jobs/2` reaches `"status":"awaiting_submit"` within 2 s, and Activity (`#activity`, "Full log" (`[data-feed="all"]`) if it is not among the highlights) lists `Answered question (application); queued applications: 2`.
- **Cover-letter gate.** It has no form; follow its row to `#progress/3` and clear it there (see [fill-gates](./fill-gates.md)).
- **Empty state.** After both are cleared, `browser_navigate $B/#questions`: no summary line, `No open questions or decisions.` and no nav badge; `curl -s $B/api/questions` is `{"groups":[]}`.
- **Proof.** Snapshot of the inbox before and after the answer, the toast text, `curl -s $B/api/questions` before and after, `curl -s $B/api/jobs/2`.

## Gotchas

- The seeded salary question allows a standing answer (`standingAllowed` true in `/api/questions`): its form offers a checkbox, "Also use for future Verify Co B applications asking exactly this" (`input[type=checkbox][name=scope]`). Choosing it raises a browser `confirm()` dialog; handle it with `browser_handle_dialog`. The cover-letter gate never allows one. The recipe above drives the application-only path; say so if the standing path was not driven.
- Each seeded company is distinct, so the seed never produces a group with two applications. Grouping across applications is covered by `tests/questions.test.ts`, not by this map.
- The Settings overview Daily digest row shows `Mailbox not connected` (`[data-digest-state]`) and a disabled "Send digest now": no mailbox is connected here. Digest delivery is not verifiable.
- Answering from the job page (`#ans`) and from the inbox are two entry points to the same gate; a proof of one does not cover the other.
