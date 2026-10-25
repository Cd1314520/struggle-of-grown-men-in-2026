# Add a posting

The user can hand-pick a job by pasting its URL into the "Add a posting" dialog, opened from anywhere. It enters Pipeline's Assessing stage as "Not assessed yet". A URL the app already tracks is not added again: the dialog says so and links to the job.

## Sub-features

- `add-url` a pasted http(s) URL becomes a job in Pipeline, Assessing; the toast's Open goes to it.
- `add-enter` pressing Enter in the field does the same as the Add posting button.
- `add-duplicate` a URL already known is refused in place ("Already tracked", with Open job) and adds nothing. A posting that looks like the same role at the same employer is refused the same way, but kept as another listing of the existing job.
- `add-invalid` text that is not an http(s) URL is refused with a message in the dialog; an empty field cannot be submitted.

## How to get to it (user POV)

- The `+` button beside the workspace name at the top of the sidebar (`button "Add a posting"`); on a phone, the `+` in the top bar.
- Settings, General: the "Add a posting" row's button.
- ⌘K palette: type `add`, choose `Add a posting`.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes. `curl -s $B/api/summary` has `counts` with nine jobs and no `triaged`.

- **Open the dialog from Settings.** `browser_navigate $B/#settings`, `browser_click` `button "Add a posting"` inside `region "General"`. `dialog "Add a posting"` (`Paste a job posting URL. It is assessed like any posting a scan finds.`) with the cursor in `textbox "Job URL"` (`#addurl`) and `button "Add posting"` disabled.
- **Add.** `browser_type` `textbox "Job URL"` with `https://ats.verify.invalid/question/new-1`, `browser_click` `button "Add posting"`. The dialog closes; toast `Posting added` / `It will be assessed shortly.` with `button "Open"`. Click Open: `#pipeline/10?group=assessing`, the job's card reads `Not assessed yet`. `curl -s $B/api/jobs/10`: `"status":"triaged"`, `"source":"manual"`, `url` as typed, `title` `(untitled posting)`, `company` `ats.verify.invalid`.
- **Enter key.** `browser_click` the sidebar's `button "Add a posting"` (in `complementary`), type `https://other.verify.invalid/straight/new-2` with `submit: true`. Same toast; job 11 exists with company `other.verify.invalid`.
- **Duplicate.** Open the dialog again and add `https://ats.verify.invalid/question/new-1` once more. The dialog stays open, the URL stays in the box, and a `status` reads `Already tracked` / `This posting is already in the app.` with `button "Open job"`; the route answered 409 `{"error":"already known","id":10}`. `browser_click` `button "Open job"`: the dialog closes on `#job/10`.
- **Same role, other URL (API only).** The dialog sends only the URL, so its postings are `(untitled posting)` and never match another job. The route takes a company and title too: `curl -s -X POST $B/api/jobs -H 'content-type: application/json' -d '{"url":"https://jobs.verify.invalid/a/77","company":"Verify Co A","title":"Backend Engineer (straight through)"}'` answers 409 `{"error":"already known","id":1}`, and `curl -s $B/api/jobs/1` lists that URL under `sources`.
- **Invalid, from the palette.** `browser_press_key` `Control+k`, type `add`, `browser_press_key` `Enter` (option `Add a posting` is selected). Type `not a url`, click `button "Add posting"`: an `alert` in the dialog reads `A posting URL is required.`; no toast. Clear the box: `button "Add posting"` is disabled again.
- **Proof.** Screenshot of the dialog before and after each case, the toast or the in-dialog message for each, `curl -s $B/api/jobs/10`, and `counts` from `/api/summary` before and after (`triaged` 2 at the end), plus `/__verify`.

## Gotchas

- The added job never leaves "Not assessed yet" here: assessing it needs a model, and the seeded profile is incomplete so prep is not attempted. The toast's "It will be assessed shortly" cannot be verified.
- Title and company come from the URL's host until a worker reads the posting; `(untitled posting)` is expected, not a bug. Two added URLs on the same host are two jobs.
- Settings' auto-apply fold says hand-picked postings wait in Review, but the add route does not mark a posting as hand-picked (only redo and retry-of-held do). With auto apply on, an added posting may not wait. Not verifiable here (auto apply is off); do not claim it either way.
- A URL on LinkedIn or Indeed takes a different path on retry (looking up the employer's own posting), which needs the network. Use `ats.verify.invalid` URLs.
- Ids continue from the seed (10, 11, …) only on a fresh seed. Read the id from the toast's Open (the URL) or `/api/jobs?view=pipeline&group=assessing` when the state is not fresh.
- The palette matches its own keywords, not the label: `add` and `posting` find the command, `add a posting` finds nothing.
