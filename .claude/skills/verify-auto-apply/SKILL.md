---
name: verify-auto-apply
description: Launch an isolated verification instance of auto-apply (the local job-application pipeline) and drive its web UI and HTTP API the way the owner does, to prove a change works. Use when asked to verify, demo, screenshot or smoke-test anything a user sees in the app: Overview, the Review queue, approvals, question/cover-letter/submit/manual gates, Pipeline, the Questions inbox, Applications and their next steps, Archive, Activity and Blockers, adding a posting, profile editing, Settings. Never drives the live instance on port 8787.
---

# verify-auto-apply

auto-apply is a Bun server (`src/server.ts`) with a React single-page UI (`ui/`, bundled by the server on request; see `docs/ui.md`). A live copy normally runs on this machine as a systemd user service on **port 8787**, holding real site passwords, a connected mailbox and logged-in Chromes on CDP port 9222. It submits real job applications.

**Never drive, restart or point a browser at `:8787`, and never run `bun src/server.ts` or `bun run dev` to verify something.** A second copy of the real entry point shares the live Chrome's CDP port: approving a job there attaches a real agent to the owner's logged-in browser. Verification uses the instance below instead.

## What the verification instance is

`serve.ts` (in this directory) serves the real `createHandler` and runs the real `Scheduler` against a throwaway database, profile and resume directory. Real: every route, status move, gate, stored answer, submit approval, frozen resume, blocker, the event log, the SSE stream, and the UI. Replaced, at the boundary the app itself provides (`new Scheduler({ runWorker, browser })`):

| Outside world | In the verification instance |
|---|---|
| Agents (model calls, on omp or Claude Code) | A **stand-in fill worker** that acts out a fixed script through the real host tools in `src/fill-tools.ts`, and a **stand-in import worker** that writes the example resume as the draft, adds a line to the notes and calls the real `finish_import` (which compiles with this machine's `typst`); a note containing "fail" makes it end without a draft. Prep, triage, locate and track workers end at once with an error: they need a model. |
| Chrome over CDP | Stand-in tabs that exist only as ids. No screenshots (`gate.png` is 404). |
| Network (job boards, LinkedIn/Indeed, Gmail) | Every outbound `fetch` is refused and recorded; `GET /__verify` lists the refused URLs. |
| `config.local.yml` | Not read (`NODE_ENV=test`); Settings → Models writes `state/config.local.yml` instead (`AUTO_APPLY_LOCAL_CONFIG`). The profile starts as the examples (`profile.example/`), as a fresh install's does. `config.yml` only, then: schedules off, `approval` gated (in memory: Settings still reads `auto` from the file until you pick one), one fill slot, no pause between fills, new applications not spread over the day (`limits.applySpreadHours` 0, so each starts as soon as the slot is free), VNC links off. |

So this instance proves the app's own behaviour between a user action and a recorded state. It does **not** prove anything about scanning, triage, scoring, resume tailoring, real form filling, mail tracking, digest delivery or the Chrome/pacing-proxy layer. Say so when a task touches those; `bun test` covers parts of them.

## Launch

```bash
bun install                                      # once per checkout
.claude/skills/verify-auto-apply/ctl.sh start    # prints "ready: http://127.0.0.1:18787 ..."
```

`start` creates the state directory, migrates an empty database, seeds nine jobs (below), and returns only after both `/__verify` and `/api/state` answer. It is idempotent. `ctl.sh reset` stops, wipes state and starts again: do that between journeys that need the seed untouched.

- `VERIFY_PORT` (default `18787`) and `VERIFY_HOME` (default `<repo>/artifacts/verify-auto-apply`, git-ignored) select the instance. Two runs are independent when **both** differ. With the defaults there is one instance per checkout; do not double-drive it.
- State (throwaway): `$VERIFY_HOME/state/{data,profile,resume}`. Evidence (kept): `$VERIFY_HOME/evidence/`.
- The server runs the code of the checkout the skill lives in and does not hot-reload `src/`: after editing it, run `ctl.sh reset`. `ui/` is rebundled per request when a file changed, so a page reload is enough for UI-only edits.
- `VERIFY_SNAPSHOT=<dir>`: start from real-looking data instead of the seed. `<dir>` holds `data/`, `profile/` and `resume/` (for example a scrubbed copy of the live state); `start` copies them into `state/` when it has no database yet, so the snapshot itself is never written. The seed adds nothing to a database that already has jobs, so the nine jobs below do not exist then. `reset` copies again only if `VERIFY_SNAPSHOT` is still set. The instance names every compiled resume `resume.pdf` (`config.yml`'s `resume.pdfName`); a snapshot of the live state names them after the owner's `config.local.yml`, so an approved job parks at once on a "Browser hand-off" whose text is an `ENOENT … resume.pdf`. Before approving, give each job folder the file it looks for: `for d in $VERIFY_HOME/state/data/jobs/*/; do [ -e "$d/resume.pdf" ] || cp tests/fixtures/sample-resume.pdf "$d/resume.pdf"; done`.

Seeded jobs (no snapshot). Each company is `Verify Co A`..`I`; the word in the posting URL (`https://ats.verify.invalid/<script>/<n>`) picks what the stand-in worker does once the job is approved:

| id | Title | Starts as | Script after Approve |
|---|---|---|---|
| 1 | Backend Engineer (straight through) | Review | `straight`: asks to submit (gate 2), then reports submitted |
| 2 | Platform Engineer (asks a question) | Review | `question`: parks on a question, then as `straight` |
| 3 | Data Engineer (requires a cover letter) | Review | `cover-letter`: drops the application (Archive, Skipped: `requires a cover letter: …`) |
| 4 | Site Reliability Engineer (needs browser help) | Review | `manual`: hands off once (blocker cause CAPTCHA), then as `straight` |
| 5 | Full Stack Developer (worker fails) | Review | `fail`: reports failure (blocker cause Site down) |
| 6 | Support Engineer (reject me) | Review | `straight` |
| 7 | Staff Engineer (held) | Archive, Held | `straight` |
| 8 | QA Engineer (failed earlier) | Pipeline, Failed | `straight` |
| 9 | Software Engineer (already sent) | Applications, No reply yet | n/a |

All nine were opened just now, so Review lists them under "Just opened". A posting added through the UI gets the script named in its URL path (`question`, `cover-letter`, `manual`, `fail`; anything else is `straight`), but stays "Not assessed yet": assessing needs a model.

## Doctor

```bash
.claude/skills/verify-auto-apply/ctl.sh doctor   # exit 0 and "worth driving: <url>", or the failing line
```

Read-only. Checks that the pid this script started is alive, owns the port, answers `/__verify` (which the live app does not have), uses the expected state directory, was started at the current `HEAD`, and that `/api/state` answers. Run it first, and again whenever something looks off. A `WARN started at another commit` means restart before trusting results.

## Drive

Primary surface: the web UI, driven with the Playwright MCP browser tools (`mcp__plugin_playwright_playwright__browser_*`): navigate by hash route, read with `browser_snapshot`, act on the refs it gives (or a CSS selector as `target`). Without the MCP tools, a small `playwright-core` script does the same with `page.getByRole(role, { name })` and the CSS handles below. Work at 1440×900 unless a recipe says otherwise: from 1024 px a list and its open job sit side by side; narrower, the job opens full screen over the list.

### Routes

`#page/part?param=value` (`ui/lib/router.ts`). `/` opens Overview.

| Route | Shows |
|---|---|
| `#overview` | What needs you, what employers wait on you for (Your move), this week's numbers, charts, recent activity, system health |
| `#review`, `#review/<id>` | The approval queue. On a desktop a job is always open: `#review` becomes `#review/<first id>` |
| `#questions`, `#questions/<group key>` | One question at a time beside the queue (the first opens by itself on a desktop) |
| `#pipeline?group=<stage>`, `#pipeline/<id>` | Applications past review, by stage: `needs_you`, `failed`, `questions`, `applying`, `assessing`. Without `group` it opens on the first stage holding anything; a linked job opens on its own stage |
| `#applications?group=<g>`, `#applications/<id>` | Sent applications: `offer`, `your_move`, `upcoming`, `waiting`, `quiet`, `no_reply`, `closed` |
| `#archive/held`, `#archive/rejected`, `#archive/<held\|rejected>/<id>` | Jobs set aside; the job opens in a panel over the table (`#archive` is Held) |
| `#activity?kind=<k>`, `#activity/blockers?cause=<c>`, `#activity/log?kind=<k>` | Highlights (`gate`, `user`, `error`, `system`, `mail`), every stop by cause, the raw event log |
| `#profile/<file>` | A profile file (`targets.md`, `rubric.yml`, `main.typ`, `resume-notes.md`, `answers.md`, `personal.yml`, `companies.yml`); bare `#profile` opens the first still to fill in |
| `#settings`, `#settings/<section>` | Configuration, models, mailbox, digest, browser, release held; a section (`models`, `mail`, ...) opens scrolled to it |
| `#setup` | The setup checklist, each step checked live (`GET /api/setup`) |
| `#resume` | The stock resume, the import (upload, draft, ask for changes, accept), the notes |
| `#job/<id>` | Any job on a page of its own, with a breadcrumb back to its list |

List params: `q` (search), `filter` (repeatable: `top`, `remote`, `near`, `first`), `sort`, `group`, `page` (50 a page). Old links redirect (`history.replaceState`): `#progress/<id>` → `#pipeline/<id>`, `#applied/<id>` → `#applications/<id>`, `#held` → `#archive/held`, `#rejected` → `#archive/rejected`, `#blockers` → `#activity/blockers`, `#more` → `#overview`. A route can open a job its list does not hold (`#pipeline/2` while job 2 is still in Review opens it beside the Failed stage, with no "N of M"); use the route of the list that holds it, or `#job/<id>`, whose breadcrumb names that list.

### Handles

Role and accessible name as `browser_snapshot` prints them, verified against the running UI; CSS where a name is long, counted or repeated. A button's name includes the key hint printed on it (`button "Approve A"`): match on the start.

| What | Handle |
|---|---|
| Sidebar (desktop) | `navigation "Sections"` (Overview, Review, Questions, Pipeline, Applications), `"Library"` (Archive, Activity, Resume, Profile), `"System"` (Setup, Settings). A link's name carries its badge (`link "Review 6"`), and a badged link has an `aria-description` saying what it counts; CSS `[data-nav="<page>"]`. Also, in its head, `button "Search"` and `button "Add a posting"` (icon buttons); `button "Scan now"` (foot, beside the first problem: "Digest failing", "Mail not connected", "N setup steps left", "Scans are behind" link to Settings, Setup or Activity; otherwise "Last scan …"), `button "Auto Apply"` (theme, Keyboard shortcuts) |
| Phone shell | Top bar `button "Search"`, `button "Add a posting"`; bottom `navigation "Sections"` with Overview, Review, Questions, Pipeline (`[data-nav]` too) and `button "More"` (a warning count of the badges behind it), which opens `dialog "Navigation"` holding the sidebar without those four pages and without Search and Add a posting |
| Command palette | Ctrl/⌘K or the Search button: `dialog "Search and commands"`, `combobox "Search and commands"`; `option`s in groups Jobs (after two letters), Actions ("Add a posting", "Scan job boards now", "Check mail for replies", "Find new companies to watch"), Go to (each with its badge count), Theme (once something is typed). With nothing typed "Add a posting" is selected; Enter opens the selected one |
| List row | `row` whose name starts with the title: `row "Support Engineer (reject me) Verify Co F Fit 61"` (Review adds the age, and `Just opened` before Fit on new postings, when the list is not grouped by age). CSS `a[data-row="<id>"]` (Questions: `a[data-question="<group key>"]`). Group headings are rows too (`row "Just opened 6"`), without `data-row` |
| List controls | `searchbox`: "Search the queue" (Review), "Search this stage", "Search applications", "Search held jobs by title, company, place or reason", "Filter questions", "Search blockers". `combobox "Sort"` (then `option` by name). `button "Filter"` → `menu "Filter"`: `menuitemcheckbox "Score 80+ 1"`, `"Remote 6"`, `"First at employer 6"`, then `menuitem "Clear filters"`; the button takes the filter's name while one is on. Groups are a `tablist` of `tab "<label> <count>"`: Review "When the posting opened" (New, Today, Week, Older), Archive "Fit", Applications "Segments", Blockers "Show" ("Still stuck", the default, "Resolved", "All"; `show=`) then "Cause" (first "Any cause"), Activity "Show"; CSS `[data-segment="<key>"]`. Pipeline stages: `tablist "Stages"` (Needs you, Failed, Questions, Applying, Assessing), CSS `[data-stage="<stage>"]` (the tab name grows a caption at wide widths). Over 50 rows: `button "Previous page"`, `button "Next page"`, `textbox "Page, of N"` |
| Open job | `region "Open job"` beside a list (absent on `#job/<id>`, where it is `main`); CSS `[data-job="<id>"]`. Its bar: `button "Previous job"`, `button "Next job"`, text `3 of 6`, `link "Open as a page"`, `button "Close"` (not on desktop Review). Header: link to the posting named after the company, `heading` level 1 (title), the status word (only on sent, held, rejected and skipped jobs, or with no decision), `button "Fit 84, open the Fit tab"`. Tabs: `tab "Overview"`, `"Fit"`, `"Resume"` (`img "First page of the tailored resume"`), `"Posting"`, `"Activity"` |
| The decision | CSS `[data-decision="<title>"]`. A bar under the tabs for a judgement on the fit: "Apply to this job?", the set-aside label for a held job (e.g. "Held at triage"; "Held for later" when it has none), "Rejected", "Skipped by the assessment". A card above the tabs when the agent stopped or is working: "The agent needs an answer", "This application needs a cover letter", "Submit this application?", "Browser hand-off", "This application failed", "Submission outcome unknown", "Queued to apply", "Applying", "Not assessed yet", "Assessing"; and "Next steps" on a sent application. One primary button: "Approve A" (or "Approve and send A" when approval is auto), "Assess now A", "Retry A", "Reserve browser A", "Hand control back A" (the A means the key presses it), "Save and queue Ctrl ↵", "Save letter and queue Ctrl ↵", "Approve submission". The rest: `button "Reject X"` (Review), `"Change something"`, `"Check status and recover"`, `"Reconsider"`, and `button "More actions"` → `menuitem`s "Change resume" (Review), "Hold for later H", "Reject X", "I submitted it", "Mark submitted", "Release browser", "Check status and recover", "Stop and reject". Folds: `button "Saved checkpoint"` (or "Saved page"), `"Previous run note"`, `"Agent's notes"` (unclear submission) |
| Gate fields | `textbox "Your answer For this application only. …"` (then "Answer in Questions" or "Answer all N that ask this in Questions"), `textbox "Cover letter Entered exactly as you write it"` (Ctrl+Enter saves either); a question's fixed options are `radiogroup "Options"` `radio`s that fill the box; gate 2's `button "Change something"` → `textbox "Changes for this application"`, `button "Save changes and queue"` |
| Change resume | `button "More actions"` → `menuitem "Change resume"` → `dialog "Change the resume"`, `textbox "What should change in the resume?"`, `button "Redo with this note"` |
| Questions | `region "Open question"`: `heading` level 2 (the question), `textbox "Your answer"`, option cards CSS `[data-option="<n>"]` (a click saves), `button "Save and next Ctrl ↵"`, `button "Skip"`, `checkbox "Save to my answers"` above the options (questions only; unticked at first for agreements, ID numbers and options naming the employer; "Answer all N (employers) and save to my answers" for a group), `button "Previous question"`/`"Next question"`, `combobox "Answer for"` ("Company — Title") and `link "Open in Pipeline"` (`#pipeline/<id>`). Other gates: `alert` "N more wait on you:" then the breakdown ("1 cover letter", "15 hand‑offs", "5 to check"), with `link "Pipeline"` |
| Next steps | In `[data-decision="Next steps"]`: `button "Outcome"` (beside `button "Add a step"` in the heading row) → `menuitem` "Mark offer", "Mark declined", "Withdraw", or "Back in process"; `button "Add a step"` → `combobox "Kind"`, `textbox "What"`, `"Due"` (a date input), `"Link"`, `"Notes"`, `button "Add step"`. Each step is a `listitem`: `button "Done"`, `"Booked for…"`/`"Change time"` (Booking and Interview), `button "More step actions"` → "Done, with a note…", "Back to to-do", "Edit", "Cancel step", "Reopen", "Remove" (`alertdialog "Remove this step?"`). Inline forms: `textbox "How it went, what you sent"` + `button "Save as done"`; `textbox "Booked for"` (datetime-local) + `button "Save time"` |
| Add a posting | `dialog "Add a posting"`: `textbox "Job URL"` (`#addurl`), `button "Add posting"` (disabled while empty; Enter adds). A known URL keeps the dialog open with `status` "Already tracked" and `button "Open job"`; a refusal is an `alert` |
| Archive | `tab "Held 1"`, `tab "Rejected"`; header `button "More actions"` → `menuitem "Release all held jobs…"` → `alertdialog "Release all held jobs?"`. With a job open there are two "More actions": scope to `region "Open job"` |
| Activity | `button "Run: Scan job boards"`, `"Run: Check mail"`, `"Run: Find companies"`; `tab "Highlights"`, `"Blockers"`, `"Full log"`; the log's `combobox "Kind"`; a blocker row links its job (`#job/<id>`) and `link "Open the <Company> posting"` |
| Profile | `navigation "Profile files"`: `link "Targets"` and so on; `searchbox "Search <file>"` ("Search answers") on Markdown files with more than 3 headings; `rubric.yml` reads as a list `"Rubric criteria"`; Companies has `searchbox "Search companies"` and `button "Filter"` (by ATS); `button "Write it"` (empty file) or `button "Edit E"`; `textbox "Edit <file>"`; `button "Save Ctrl S"`, `button "Cancel"`; leaving with edits: `alertdialog "Discard unsaved changes?"`, `button "Discard"` |
| Settings | `navigation "Settings sections"` (buttons that scroll); `region`s "General", "Auto-apply", "Mail & digest", "Browser", "Danger zone"; `link "Connect Gmail"`, `button "Send now"` and `button "Refresh status"` (icon) on the digest Status row, `button "Release held jobs"` |
| Setup and Resume | Setup: `button "Check again"`, one card per step with a `"Details"` fold; the current step shows `section "How to do it"` open, the others a `button "How to do it"` fold; the current step's primary action ("Choose models", "Set mailbox", "Open Resume", "Open Profile", "Connect Gmail", "Scan now"). Models: `button "<Stage> model"` (e.g. "Triage model") opens a searchable list (`[cmdk-input]`, `[cmdk-item]`). Resume: the drop zone's text "Drop files here, or choose them" opens the file chooser, `button "Convert to a resume"` (no resume yet) or, behind `button "Import from files"`, `"Convert"`; a compile error has `button "Edit source"`; a draft has `link "Download draft"` in the bar, `button "Use this resume"`/`"Replace my resume"`, `"Discard"`, `textbox "Ask for changes"` + `button "Ask for these changes"`; a failed one `button "Try again"`, `"Discard"`; a running import `button "Cancel"` |
| Feedback | Toasts: CSS `[data-sonner-toast]` in `region "Notifications alt+T"` (Reject's carries `button "Undo"`, Add's `button "Open"`); they stack, newest first. Connection lost: `#offline` (`alert`) |

### Keyboard

With focus outside a text field and no dialog open (`ui/lib/hotkeys.ts`; `?` lists them):

- Anywhere: Ctrl/⌘K the palette (also from a field), `?` the shortcuts dialog, `G` then (within a second) `O` Overview, `R` Review, `Q` Questions, `P` Pipeline, `A` Applications, `H` Archive, `L` Activity, `S` Settings.
- A list: `J`/`K` next and previous job (across pages), `/` focuses its search, `Esc` closes the open job (not on desktop Review, where one is always open).
- An open job: `A` presses the primary button when it carries the A hint (never one that needs text first, never Approve submission), `X` rejects and `H` holds when the decision's ⋯ menu offers them, `1`-`5` switch tabs. They work on every tab.
- Questions: `J`/`K` move, `1`-`8` pick an option (and save it), `Enter` puts the cursor in the answer box, Ctrl/⌘+Enter saves, `Esc` leaves the box (on a phone, closes the question), `/` filters the queue.
- Profile: `E` edits the file, Ctrl/⌘+S saves, `Esc` in an unchanged editor cancels.

A held key repeats only `J`/`K`. Keys typed into a search box or the palette go there.

### Timing and moving on

The stand-in worker takes about 0.4 s per tool call, so a gate appears 1-2 s after the action that queues it. Wait on text or a `[data-decision]` (`browser_wait_for`), not a fixed sleep; the page refetches on its own from `/api/stream`.

After an action that takes the job out of its list (Approve, Reject, Hold, Retry, answering a gate in Pipeline), the next job in the list opens in its place, or the panel closes when none is left. Navigate back to the job's route before reading its state. Applications keeps the job open after an outcome.

### API

The JSON the UI reads, for stored state and for clients without a browser (`docs/ui.md`):

```bash
B=http://127.0.0.1:${VERIFY_PORT:-18787}
curl -s $B/api/summary                                    # counts, attention (what waits, by kind), profileProblems, settings
curl -s "$B/api/jobs?view=review&sort=score&limit=50"     # one page of a view: review|pipeline|applications|held|rejected
curl -s "$B/api/jobs?view=pipeline&group=needs_you"       # rows carry group, gate, reason, next; groups and filters with counts
curl -s "$B/api/jobs?view=pipeline&focus=8"               # the page holding job 8: focusIndex, focusGroup
curl -s $B/api/jobs/2                                     # one job: status, gate, checkpoint, history, events, blockers, steps, next, resumeFrozen
curl -s $B/api/questions                                  # open gate groups, every kind
curl -s "$B/api/activity?feed=all&kind=user"              # the event log, a page at a time (feed=highlights for the folded feed)
curl -s $B/api/blockers                                   # every stop, newest first
curl -s $B/api/stats                                      # Overview aggregates
curl -s -X POST $B/api/jobs/1/action -H 'content-type: application/json' -d '{"action":"approve"}'
```

`/api/state` (the whole board) still answers and `ctl.sh` waits on it, but the UI no longer reads it.

Per-feature recipes are in [`features/`](features/README.md). Read the index before driving; a proof that uses one entry point is incomplete when the feature file lists others.

## Evidence

Put artifacts in `$VERIFY_HOME/evidence/<feature>/`, numbered in the order things happened. `server.log` there already holds the stand-in worker's transcript (`[worker job N] tool -> reply`, or `tool threw: …` when a host tool refused the script's arguments).

Standards:

- Exercise the user path: click the UI (or, for an API-only claim, call the route the UI calls). Do not write the database, call `updateJob`, or add routes to reach a state. The seed (or the snapshot) is the only state not created through the UI.
- Capture the action and the result: a screenshot or ARIA snapshot before the click, and one after. A final screen alone is not proof.
- Verify the side effect from a second view: `GET /api/jobs/<id>` (`status`, `history`, `gate`, `submitted_at`, `resumeFrozen`, `blockers`), the job's Activity tab, files under `state/data/jobs/<id>/` (e.g. `applied/<sha12>/` for a frozen resume), or the edited file under `state/profile/`.
- Confirm isolation in every proof: `curl -s $B/__verify` and record `refusedOutbound`. For journeys that do not start a scan it must be `[]`.
- Name what the stand-ins covered. "Submitted" here means the app recorded an outcome reported by the stand-in worker; no form was filled and nothing was sent.

Playwright MCP can only write inside the workspace root of the session that owns it. Give `browser_take_screenshot` and `browser_snapshot` a `filename` under that root (the default `$VERIFY_HOME` qualifies when the session runs in this checkout; from a git worktree, set `VERIFY_HOME` to a directory under the session's root before `ctl.sh start`).

## Cleanup

```bash
.claude/skills/verify-auto-apply/ctl.sh stop     # kills only the pid it started, removes state/, keeps evidence/
```

Then close the Playwright page (`browser_close`). `stop` never matches by process name: it reads `state/server.pid`, checks that pid's command line is this `serve.ts`, and signals that pid alone. If `doctor` reports the port held by a pid this script did not start, do not kill it; pick another `VERIFY_PORT`. Run `stop` after a failed attempt too.

## Helpers

| File | Invocation | Does |
|---|---|---|
| `ctl.sh` | `ctl.sh start \| doctor \| stop \| reset` | Process lifecycle, the snapshot copy, and the read-only health check described above. Runs on Linux and in Git Bash on Windows (where it finds the process with PowerShell, `tasklist` and `netstat`, and stops it with `taskkill`). |
| `serve.ts` | started by `ctl.sh` (`VERIFY_STATE=… VERIFY_PORT=… bun serve.ts`) | The verification instance: isolation, stand-ins, seed, `/__verify`. Typechecked and linted with the app (`bun run check`), so a change to the `Scheduler`, `Browser` or worker interfaces breaks it loudly; a host tool that starts requiring an argument shows as `threw:` in `server.log`. |

To add a scripted behaviour (say, a worker that leaves a submission ambiguous), extend `actOut` in `serve.ts` and add a seed row; keep the stand-in calling host tools rather than writing state.

## Keeping this honest

Run `/maintain-verification-skill` after the UI or the routes change: the feature map names roles, accessible names and button labels that will drift.
