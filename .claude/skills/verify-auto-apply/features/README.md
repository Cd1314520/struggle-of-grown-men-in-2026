# auto-apply verification map

The maintained source for verifying what a user of auto-apply sees. Read this index, then use the matching feature file as the recipe. Everything here runs against the verification instance described in [`../SKILL.md`](../SKILL.md), never the live app on port 8787.

## Baseline preconditions

- `ctl.sh start` printed `ready`, and `ctl.sh doctor` exits 0 with `worth driving`.
- State is the untouched seed (nine jobs, ids 1-9) unless a recipe says otherwise. `ctl.sh reset` restores it; recipes consume seeded jobs, so reset between recipes that name the same id.
- `B=http://127.0.0.1:${VERIFY_PORT:-18787}` in the shell used for `curl`.
- The Playwright MCP browser tools are available. Without them, the `curl` line of each step still proves the stored state but not the UI; report the UI half as not verified.

## Driving conventions

- Open pages by hash route (`$B/#review`, `$B/#progress/2`). Opening a job by route is equivalent to clicking its row.
- Act through the selectors given; they are `data-*` attributes and ids from `ui/index.html`. Read results with `browser_snapshot` (pass `target: "#pane"` for the open job).
- At phone width the list and the job are separate screens; at desktop width (resize to 1280 wide or more) they sit side by side and the first job opens by itself. Recipes work at either width.
- After an action that queues the stand-in worker, wait for the named heading with `browser_wait_for`. Each worker step takes about 0.4 s.
- After Approve, Reject or Retry the UI moves to the next job in the list. Navigate back to the job by route before reading its state.

## Proof and skip reporting

- Capture before and after each action: screenshot plus ARIA snapshot into `$VERIFY_HOME/evidence/<feature>/NN-<what>.{png,aria.yml}`.
- Every mutation is confirmed from a second view: `curl -s $B/api/jobs/<id>` and, where named, files under `$VERIFY_HOME/state/`.
- End every proof with `curl -s $B/__verify` and record `refusedOutbound`.
- Record the feature file, the sub-feature id and the entry point used with each artifact.
- An entry point that could not be driven is reported with the attempted step and the unmet precondition. It is not verified through another path.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behaviour, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright MCP and curl`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with an exact command and the observable result.

## Features

- [Review queue (gate 1)](./review-queue.md): approve, reject and undo, ask for a different resume, keyboard shortcuts.
- [Fill gates](./fill-gates.md): what an approved application stops on: a question, a cover letter, the final-submit confirmation, a manual hand-off, a failure; and how each is cleared.
- [Questions inbox](./questions-inbox.md): open questions grouped across applications, answered from one page.
- [Add a posting](./add-posting.md): hand-picking a job by URL.
- [Profile and Settings](./profile-settings.md): editing profile files, the profile-incomplete notice, and what Settings reports.

## Not in the map (not verifiable in this instance)

Scanning and discovery, triage, scoring and resume tailoring (prep), locating an employer's posting, real form filling and CAPTCHAs, mail tracking, digest delivery, Gmail OAuth, the live browser views, ambiguous-submission recovery (no script produces it yet). Each needs a model, a browser or the network. Their buttons can be shown to exist and to be refused or to fail cleanly, nothing more.
