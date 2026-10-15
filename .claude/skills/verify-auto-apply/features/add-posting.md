# Add a posting

The user can hand-pick a job by pasting its URL in Settings. It enters the pipeline as "Not assessed yet".

## Sub-features

- `add-url` a pasted http(s) URL becomes a job in In progress.
- `add-enter` pressing Enter in the field does the same as the Add button.
- `add-duplicate` a URL already known is refused with a message and adds nothing. A URL that looks like the same role at the same employer is refused the same way, but kept as another listing of the existing job.
- `add-invalid` text that is not an http(s) URL is refused.

## How to get to it (user POV)

- Settings (`#settings`; on a phone: More, then Settings), section "Add a posting": the "Job URL" field and the Add button.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes. `curl -s $B/api/state` counts nine jobs and none `triaged`.

- **Open Settings.** `browser_navigate $B/#settings`. A section labelled `Add a posting` with textbox `Job URL` (`#addurl`) and button `Add` (`#addbtn`).
- **Add.** `browser_type` `#addurl` with `https://ats.verify.invalid/question/new-1`, `browser_click` `#addbtn`. Toast `Added. It will be assessed shortly.`; the field empties.
- **Confirm.** `browser_navigate $B/#progress`: a row `(untitled posting)` for company `ats.verify.invalid`; opening it shows gate heading `Not assessed yet`. `curl -s $B/api/jobs/10`: `"status":"triaged"`, `"source":"manual"`, `url` as typed.
- **Enter key.** Type `https://other.verify.invalid/straight/new-2` into `#addurl` with `submit: true`. Same toast; job 11 exists with company `other.verify.invalid`.
- **Same role, other URL.** Type `https://ats.verify.invalid/straight/new-2` with `submit: true`. Toast `already known`; no new job, and `curl -s $B/api/jobs/10` lists that URL under `sources`.
- **Duplicate.** Add `https://ats.verify.invalid/question/new-1` again. Toast `already known`; `curl -s $B/api/state` still counts two `triaged`.
- **Invalid.** Type `not a url`, click `#addbtn`. Toast `a posting URL is required`; nothing added.
- **Proof.** Screenshot of Settings before and after, the toast text for each case, `curl -s $B/api/jobs/10`, and the `counts` object from `/api/state` before and after.

## Gotchas

- The added job never leaves "Not assessed yet" here: assessing it needs a model, and the seeded profile is incomplete so prep is not attempted. The UI's "It will be assessed shortly" cannot be verified.
- Two added URLs on the same host are the same role to the app: both are `(untitled posting)` at that host, so the second folds into the first ("already known"). Use a different host for each posting that should become its own job.
- Settings' safeguards say hand-picked postings wait in To review, but the add route does not mark a posting as hand-picked (only redo and retry-of-held do). With auto apply on, an added posting may not wait. Not verifiable here (auto apply is off); do not claim it either way.
- Title and company come from the URL's host until a worker reads the posting; `(untitled posting)` is expected, not a bug.
- A URL on LinkedIn or Indeed takes a different path on retry (looking up the employer's own posting), which needs the network. Use `ats.verify.invalid` URLs.
- Ids continue from the seed (10, 11, …) only on a fresh seed. Read the id from `/api/state` instead of assuming it when the state is not fresh.
- An empty field does nothing but focus the field: no toast, no request.
