# Questions inbox

Questions collects every open question and cover-letter request across applications, grouped when the same employer asks the same thing, so the user can answer from one page instead of opening each job.

## Sub-features

- `inbox-list` groups with the prompt, exact context, and the affected applications; a count badge in the nav.
- `inbox-answer` answering a question group for one application ("This application only") queues it to resume.
- `inbox-cover-letter` a cover-letter group links to its application; it has no inline form.
- `inbox-empty` with nothing open the page says so and the badge is gone.

## How to get to it (user POV)

- Choose "Questions" in the section nav, or open `#questions`.
- Follow the "Questions" link in the hint under a question gate on a job page.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes.
- Jobs 2 and 3 approved through the UI (`#review/2` and `#review/3`, `.gate [data-act="approve"]`) and parked: `curl -s $B/api/questions` lists two groups, kinds `question` and `cover_letter`.

- **See the inbox.** `browser_navigate $B/#questions`, `browser_snapshot` with `target: "#questions-inbox"`. Heading `Questions · 2 groups`; one section headed `What is your desired annual base salary in USD?` listing `Verify Co B · Platform Engineer (asks a question) · #2`; one headed `Cover letter (required, plain text, at most 300 words)`. Nav button reads `Questions 2`.
- **Answer the question.** In the salary group: `browser_type` `[data-question-form] textarea[name=answer]` with `95000`; leave scope on "This application only (default)"; `browser_click` `[data-question-answer]` ("Save answer and queue"). Toast `Answer saved · queued applications: #2`.
- **Confirm.** The group leaves the inbox (`Questions · 1 group`). `curl -s $B/api/jobs/2` reaches `"status":"awaiting_submit"` within 2 s, and Activity (`#activity`, "Every agent step" if it is not among the highlights) lists `Answered question (application); queued applications: 2`.
- **Cover-letter group.** The remaining group has no form; follow its application link to `#progress/3` and clear it there (see [fill-gates](./fill-gates.md)).
- **Empty state.** After both are cleared, `browser_navigate $B/#questions`: heading `Questions · 0 groups` and no nav badge; `curl -s $B/api/questions` is `{"groups":[]}`.
- **Proof.** Snapshot of the inbox before and after the answer, the toast text, `curl -s $B/api/questions` before and after, `curl -s $B/api/jobs/2`.

## Gotchas

- Standing answers ("Explicitly approve a standing answer") appear only when a group allows them and raise a browser `confirm()` dialog; handle it with `browser_handle_dialog`. The seeded question's scope label is "This application only"; check `standingAllowed` in `/api/questions` before claiming the standing path was driven.
- Each seeded company is distinct, so the seed never produces a group with two applications. Grouping across applications is covered by `tests/questions.test.ts`, not by this map.
- The Settings digest shows `Delivery state: not_connected` and a disabled "Send digest now": no mailbox is connected here. Digest delivery is not verifiable.
- Answering from the job page (`#ans`) and from the inbox are two entry points to the same gate; a proof of one does not cover the other.
