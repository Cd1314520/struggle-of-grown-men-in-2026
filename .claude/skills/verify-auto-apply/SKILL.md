---
name: verify-auto-apply
description: Launch an isolated verification instance of auto-apply (the local job-application pipeline) and drive its web UI and HTTP API the way the owner does, to prove a change works. Use when asked to verify, demo, screenshot or smoke-test anything a user sees in the app: the review queue, approvals, question/cover-letter/submit/manual gates, the Questions inbox, adding a posting, profile editing, Settings. Never drives the live instance on port 8787.
---

# verify-auto-apply

auto-apply is a Bun server (`src/server.ts`) with a single-page UI (`ui/`: the page, its stylesheet, and TypeScript modules the server bundles on request). A live copy normally runs on this machine as a systemd user service on **port 8787**, holding real site passwords, a connected mailbox and logged-in Chromes on CDP port 9222. It submits real job applications.

**Never drive, restart or point a browser at `:8787`, and never run `bun src/server.ts` or `bun run dev` to verify something.** A second copy of the real entry point shares the live Chrome's CDP port: approving a job there attaches a real agent to the owner's logged-in browser. Verification uses the instance below instead.

## What the verification instance is

`serve.ts` (in this directory) serves the real `createHandler` and runs the real `Scheduler` against a throwaway database, profile and resume directory. Real: every route, status move, gate, stored answer, submit approval, frozen resume, the event log, the SSE stream, and the UI. Replaced, at the boundary the app itself provides (`new Scheduler({ runWorker, browser })`):

| Outside world | In the verification instance |
|---|---|
| omp agents (model calls) | A **stand-in fill worker** that acts out a fixed script through the real host tools in `src/fill-tools.ts`. Prep, triage, locate and track workers end at once with an error: they need a model. |
| Chrome over CDP | Stand-in tabs that exist only as ids. No screenshots (`gate.png` is 404). |
| Network (job boards, LinkedIn/Indeed, Gmail) | Every outbound `fetch` is refused and recorded; `GET /__verify` lists the refused URLs. |
| `config.local.yml` | Not read (`NODE_ENV=test`). `config.yml` only, then: schedules off, auto apply off, `confirmBeforeSubmit` on, one fill slot, no pause between fills, new applications not spread over the day (`limits.applySpreadHours` 0, so each starts as soon as the slot is free), VNC links off. |

So this instance proves the app's own behaviour between a user action and a recorded state. It does **not** prove anything about scanning, triage, scoring, resume tailoring, real form filling, mail tracking, digest delivery or the Chrome/pacing-proxy layer. Say so when a task touches those; `bun test` covers parts of them.

## Launch

```bash
bun install                                      # once per checkout
.claude/skills/verify-auto-apply/ctl.sh start    # prints "ready: http://127.0.0.1:18787 ..."
```

`start` creates the state directory, migrates an empty database, seeds nine jobs (below), and returns only after both `/__verify` and `/api/state` answer. It is idempotent. `ctl.sh reset` stops, wipes state and starts again: do that between journeys that need the seed untouched.

- `VERIFY_PORT` (default `18787`) and `VERIFY_HOME` (default `<repo>/artifacts/verify-auto-apply`, git-ignored) select the instance. Two runs are independent when **both** differ. With the defaults there is one instance per checkout; do not double-drive it.
- State (throwaway): `$VERIFY_HOME/state/{data,profile,resume}`. Evidence (kept): `$VERIFY_HOME/evidence/`.
- The server runs the code of the checkout the skill lives in and does not hot-reload: after editing `src/` or `ui/`, run `ctl.sh reset`. (`ui/` is read, and its script rebundled when a file changed, per request; a page reload is enough for UI-only edits.)

Seeded jobs. Each company is `Verify Co A`..`I`; the word in the posting URL (`https://ats.verify.invalid/<script>/<n>`) picks what the stand-in worker does once the job is approved:

| id | Title | Starts as | Script after Approve |
|---|---|---|---|
| 1 | Backend Engineer (straight through) | To review | `straight`: asks to submit (gate 2), then reports submitted |
| 2 | Platform Engineer (asks a question) | To review | `question`: parks on a question, then as `straight` |
| 3 | Data Engineer (wants a cover letter) | To review | `cover-letter`: parks for a letter, then as `straight` |
| 4 | Site Reliability Engineer (needs browser help) | To review | `manual`: hands off once, then as `straight` |
| 5 | Full Stack Developer (worker fails) | To review | `fail`: reports failure |
| 6 | Support Engineer (reject me) | To review | `straight` |
| 7 | Staff Engineer (held) | Held | `straight` |
| 8 | QA Engineer (failed earlier) | In progress, failed | `straight` |
| 9 | Software Engineer (already sent) | Applied | n/a |

A posting added through the UI gets the script named in its URL path (`question`, `cover-letter`, `manual`, `fail`; anything else is `straight`), but stays "Not assessed yet": assessing needs a model.

## Doctor

```bash
.claude/skills/verify-auto-apply/ctl.sh doctor   # exit 0 and "worth driving: <url>", or the failing line
```

Read-only. Checks that the pid this script started is alive, owns the port, answers `/__verify` (which the live app does not have), uses the expected state directory, was started at the current `HEAD`, and that `/api/state` answers. Run it first, and again whenever something looks off. A `WARN started at another commit` means restart before trusting results.

## Drive

Primary surface: the web UI, driven with the Playwright MCP browser tools (`mcp__plugin_playwright_playwright__browser_*`). Navigate by hash route, act through the handles below, read state with `browser_snapshot`.

Routes: `/#review`, `/#progress`, `/#questions`, `/#applied`, `/#held`, `/#rejected`, `/#activity`, `/#profile`, `/#settings`; a job opens at `/#<view>/<id>` (e.g. `/#progress/2`).

Stable handles (CSS selectors work as the `target` of `browser_click` / `browser_type`):

| What | Handle |
|---|---|
| Section nav | `nav[aria-label="Sections"] [data-view="review"]` (also `progress`, `questions`, `applied`, `more`; the rest are desktop-only or under More) |
| Job row | `[data-job="<id>"]` (role `link`, name starts with the title) |
| Filter chip (To review: `all`, `top`, `near`, `remote`; Held: `all`, `near`, `remote`; no other list has chips) | `[role=toolbar][aria-label="Filter"] [data-filter="<key>"]` |
| List part header that folds (`aria-expanded`) | `[data-part="<view>\|<label>"]`, e.g. `progress\|Waiting to be assessed`, `progress\|Queued to apply`, `applied\|Declined`, `held\|Everything else` (these start collapsed); `[data-cap="<view>\|<label>"]` shows the next 50 rows of a part |
| Release held jobs (Held page, also Settings) | `[data-run="release_held"]` (asks to confirm) |
| Section search (only when a section has more than 8 jobs) | `#q` |
| Job tabs | `[data-tab="summary"]`, `score`, `resume`, `posting`, `log` |
| Gate buttons | `.gate [data-act="approve"]`, `reject` ("Stop & reject" on a queued or running job), `hold` ("Hold for later": every gate except Held, running jobs and ambiguous submissions), `retry` (also "Assess now" on a held job), `mark_submitted`, `recover`, `confirmed_not_submitted`. Each gate has one `.btn.primary`; Hold, Reject, Mark submitted / I submitted it sit in `.acts-end` (on a phone behind `[data-toggle="#gmore"]` "More actions", still in the DOM so clicks and A/X work). Policy text folds into `details.gate-why` ("How this works"); the saved page and checkpoint into one `details[data-how="gate-evidence"]` |
| Job header | `.facts`: a state pill (gate kind for a stuck job: Question, Cover letter, Browser hand-off, Confirm submit, Outcome unknown), `button.score-pill` "Fit N" (opens Score), the practice pill, location, "Found …" or "Applied …" |
| Answer / letter box and its button | `#ans`, then `.gate [data-act="respond"]` |
| Gate 2 | `.gate [data-act="respond"][data-fixed="approve"]`; changes: `[data-toggle="#chgbox"]`, `#chg` |
| Change resume (gate 1) | `[data-toggle="#redo"]`, `#fb`, `.gate [data-act="redo"]` |
| Manual hand-off | `[data-browser-action="reserve"]`, `[data-browser-action="release"]`, `.gate [data-act="respond"][data-fixed="done"]` |
| Questions inbox | Row (expand toggle) `[data-question-row="<group key>"]`; only the open group renders its form, and the one whose posting opened most recently is open by default. Form `[data-question-group] [data-question-form]` (question groups only), fields `[name=job]` (hidden input for one application, `select` for several), `textarea[name=answer]`, `[name=scope]` (hidden `application`, or a `standing` checkbox when standing is allowed), one-click option buttons `[data-question-option="<option>"]` (up to 8 fixed options), button `[data-question-answer]`. Other gates are not listed here: one line `.qelse` counts them ("Also waiting on you: 1 submit to confirm, …") and links to In progress |
| Add a posting (Settings, first on the page) | `#addurl`, `#addbtn` (Enter adds too); the outcome line `#add-result` (role `status`) |
| Profile editor | `[data-pfile="targets.md"]` (`.tab.need` marks a file still to fill in), `#pmode` (Edit, "Write it" on an empty file, Cancel), `#ptext`, `#psave` |
| Activity | Feed `[data-feed="highlights"]` / `[data-feed="all"]` ("Highlights" / "Full log"); filter chips `[role=toolbar][aria-label="Filter"] [data-filter="gate\|user\|error\|system"]`; runs `[data-run="scan"]`, `track`, `discover` |
| Settings | Overview rows `.ovrow` (name links jump to `#settings-mailbox`, `#settings-digest`, `#settings-auto-apply`, `#settings-phase`, `#settings-browser`); explanations fold into `details[data-how]` ("How this works") |
| Toast | `#toast` (role `status`); connection banner `#offline` (role `alert`) |

Keyboard, with focus outside any field: `J`/`K` move, `A` presses the gate's primary button (Approve, Retry, Assess now, Reserve browser…; never one that needs text first, and never Approve submission, which takes a click), `X` reject, `1`-`5` job tabs, `/` search. On `#questions`: `J`/`K` move the open question, `Enter` on a row focuses its answer, `1`-`8` pick an option, `Ctrl`+`Enter` in the form saves, `Esc` closes. `A` and `X` click the gate's buttons, and the gate is part of the Summary tab: on any other tab they do nothing (press `1` first).

Timing: the stand-in worker takes about 0.4 s per tool call, so a gate appears 1-2 s after the action that queues it. Wait on text (`browser_wait_for` with the gate heading), not on a fixed sleep.

Second surface, for reading stored state and for clients without a browser: the same JSON API the UI uses.

```bash
B=http://127.0.0.1:${VERIFY_PORT:-18787}
curl -s $B/api/state                 # board: jobs, counts, questionGroups, events, profileProblems
curl -s $B/api/jobs/2                # one job: status, gate, checkpoint, history, events, resumeFrozen
curl -s $B/api/questions
curl -s -X POST $B/api/jobs/1/action -H 'content-type: application/json' -d '{"action":"approve"}'
```

Per-feature recipes are in [`features/`](features/README.md). Read the index before driving; a proof that uses one entry point is incomplete when the feature file lists others.

## Evidence

Put artifacts in `$VERIFY_HOME/evidence/<feature>/`, numbered in the order things happened. `server.log` there already holds the stand-in worker's transcript (`[worker job N] tool -> reply`).

Standards:

- Exercise the user path: click the UI (or, for an API-only claim, call the route the UI calls). Do not write the database, call `updateJob`, or add routes to reach a state. The seed is the only state not created through the UI.
- Capture the action and the result: a screenshot or ARIA snapshot before the click, and one after. A final screen alone is not proof.
- Verify the side effect from a second view: `GET /api/jobs/<id>` (`status`, `history`, `gate`, `submitted_at`, `resumeFrozen`), the job's Log tab, files under `state/data/jobs/<id>/` (e.g. `applied/<sha12>/` for a frozen resume), or the edited file under `state/profile/`.
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
| `ctl.sh` | `ctl.sh start \| doctor \| stop \| reset` | Process lifecycle and the read-only health check described above. |
| `serve.ts` | started by `ctl.sh` (`VERIFY_STATE=… VERIFY_PORT=… bun serve.ts`) | The verification instance: isolation, stand-ins, seed, `/__verify`. Typechecked and linted with the app (`bun run check`), so a change to the `Scheduler`, `Browser` or worker interfaces breaks it loudly. |

To add a scripted behaviour (say, a worker that leaves a submission ambiguous), extend `actOut` in `serve.ts` and add a seed row; keep the stand-in calling host tools rather than writing state.

## Keeping this honest

Run `/maintain-verification-skill` after the UI or the routes change: the feature map names selectors and button labels that will drift.
