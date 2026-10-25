# auto-apply verification map

The maintained source for verifying what a user of auto-apply sees. Read this index, then use the matching feature file as the recipe. Everything here runs against the verification instance described in [`../SKILL.md`](../SKILL.md), never the live app on port 8787.

## Baseline preconditions

- `ctl.sh start` printed `ready`, and `ctl.sh doctor` exits 0 with `worth driving`.
- State is the untouched seed (nine jobs, ids 1-9, no `VERIFY_SNAPSHOT`) unless a recipe says otherwise. `ctl.sh reset` restores it; recipes consume seeded jobs, so reset between recipes.
- `B=http://127.0.0.1:${VERIFY_PORT:-18787}` in the shell used for `curl`.
- The Playwright MCP browser tools (or a `playwright-core` script) are available. Without a browser, the `curl` line of each step still proves the stored state but not the UI; report the UI half as not verified.

## Driving conventions

- Viewport 1440×900 (`browser_resize`), where a list and its open job sit side by side. Recipes name the phone (390 wide) where it differs.
- Open pages by hash route (`$B/#review/6`). Opening a job by route is the same as clicking its row, as long as the job is in that list's view (a job outside it opens too, without its place in the list).
- Act through role and accessible name as `browser_snapshot` prints them (`button "Approve A"`, `tab "Resume"`), scoped to `region "Open job"` when the list's header has a button of the same name. CSS handles (`[data-decision="…"]`, `a[data-row="<id>"]`, `[data-stage]`, `[data-segment]`, `[data-nav]`) are for waiting and for names that carry counts. The table in SKILL.md lists them.
- After an action that queues the stand-in worker, wait for the decision it leads to (`browser_wait_for` its title, or `[data-decision="<title>"]`). Each worker step takes about 0.4 s.
- An action that moves the job out of its list opens the next one in its place. Navigate back to the job by route before reading its state.

## Proof and skip reporting

- Capture before and after each action: screenshot plus ARIA snapshot into `$VERIFY_HOME/evidence/<feature>/NN-<what>.{png,aria.yml}`.
- Every mutation is confirmed from a second view: `curl -s $B/api/jobs/<id>` and, where named, files under `$VERIFY_HOME/state/`.
- End every proof with `curl -s $B/__verify` and record `refusedOutbound`.
- Record the feature file, the sub-feature id and the entry point used with each artifact.
- An entry point that could not be driven is reported with the attempted step and the unmet precondition. It is not verified through another path.

## Feature entry contract

Each feature file has an H1, one paragraph on the user-visible behaviour, then exactly four H2 sections in this order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright MCP and curl`, `Gotchas`. The driving section starts with `Preconditions:` and pairs each user action with an exact command and the observable result.

## Features

- [Review queue (gate 1)](./review-queue.md): the queue, its filters and sort, approve, reject and undo, hold and Archive, ask for a different resume, keyboard.
- [Fill gates](./fill-gates.md): what an approved application stops on in Pipeline: a question, a cover letter, the final-submit confirmation, a browser hand-off, a failure; how each is cleared; Blockers.
- [Questions inbox](./questions-inbox.md): open questions one at a time beside their queue, answered for one application or as a standing answer.
- [Add a posting](./add-posting.md): hand-picking a job by URL from the sidebar, Settings or the palette.
- [Applications: next steps](./applied-steps.md): the steps an employer asked for after an application was sent, marking them done or booked, the Applications segments, and recording an outcome.
- [Profile and Settings](./profile-settings.md): editing profile files, the setup notice, the refused scan, and what Settings reports.

## Not in the map (not verifiable in this instance)

Scanning and discovery, triage, scoring and resume tailoring (prep), locating an employer's posting, real form filling and CAPTCHAs, mail tracking, digest delivery, Gmail OAuth, the live browser views, ambiguous-submission recovery (no script produces it yet), and the Overview's charts beyond the seed's handful of numbers. Each needs a model, a browser, the network or history. Their buttons can be shown to exist and to be refused or to fail cleanly, nothing more.
