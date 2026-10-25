# Profile and Settings

Profile lets the user read and edit the files the agents work from (targets, rubric, resume source, resume notes, answers, personal details, companies): a list of the files, each with what it is for and a dot while it still needs filling in, and the file rendered with an editor behind Edit. Until the profile is filled in, the app says so and refuses to scan. Settings reports how the app is configured: phase, limits, auto apply, mailbox and digest, browser, and releasing held jobs.

## Sub-features

- `profile-view` a file per entry in the list; Markdown renders, YAML and Typst show as code; an empty file offers "Write it".
- `profile-edit` Edit (or `E`), change, Save (or Ctrl/⌘+S) writes the file; Cancel drops the draft.
- `profile-unsaved` leaving a file with unsaved edits asks first ("Discard unsaved changes?"); reloading the tab raises the browser's leave prompt.
- `profile-incomplete` empty or placeholder files carry a dot, a "Setup isn't finished" notice heads the page, the sidebar's Profile badge counts them, the Overview lists "Finish your profile", and Scan is refused until targets are filled in.
- `settings-report` Settings shows Phase, Held for the real search, New applications a day, Confirm before submitting, Auto apply status, minimum fit and quota, Gmail, the digest's state and next send, the Browser row, and Release held jobs, from the running configuration. (Its Add a posting row is [add-posting](./add-posting.md).)

## How to get to it (user POV)

- "Profile" (Library) and "Settings" (System) in the sidebar; `G` then `S` for Settings; on a phone, More, then Profile or Settings.
- Routes `#profile`, `#profile/<file>` and `#settings`.
- Scan: the refresh button at the foot of the sidebar (`button "Scan now"`), `button "Run: Scan job boards"` on Activity, the palette's "Scan job boards now", or the Overview's `button "Scan now"`.

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes, viewport 1440×900. The seeded profile directory is empty: `curl -s $B/api/summary` has `profileProblems` `["targets.md","rubric.yml","personal.yml","answers.md"]`, and the sidebar reads `link "Profile 4"`.

- **Scan is refused.** `browser_navigate $B/#activity`, `browser_click` `button "Run: Scan job boards"`. Toast `Fill in profile/targets.md first`. The sidebar's `button "Scan now"` answers the same. `curl -s $B/__verify` still has `"refusedOutbound":[]`.
- **Open a profile file.** `browser_navigate $B/#profile` (it opens Targets, the first to fill in). An `alert` `Setup isn't finished` heads the page; `navigation "Profile files"` lists seven links, `Targets Roles, places and pay you want`, `Rubric …`, `Resume …`, `Resume notes …`, `Answers …`, `Personal …`, `Companies …` (Targets, Rubric, Answers and Personal with a dot). `browser_click` the Targets link: `#profile/targets.md`, `heading "Targets"`, `targets.md`, and the empty state `Targets is empty` / `Nothing is assessed or applied until it's filled in.` with `button "Write it"`.
- **Edit and save.** `browser_click` `button "Write it"`: the cursor is in `textbox "Edit targets.md"`, with `button "Cancel"` and `button "Save Ctrl S"`. `browser_type` `Backend roles, remote or Houston.` (`Unsaved changes` shows), `browser_press_key` `Control+s` (or click Save). Toast `Saved targets.md`; the file renders with `button "Edit E"`.
- **Confirm.** `cat $VERIFY_HOME/state/profile/targets.md` prints the text; `curl -s $B/api/profile/targets.md` returns it; `profileProblems` no longer names `targets.md` and the badge reads `Profile 3`; Activity (`#activity`) lists `You edited targets.md.`
- **Unsaved edits.** `browser_click` the `Personal …` link (`personal.yml`, empty), `button "Write it"`, type into `textbox "Edit personal.yml"`, then `browser_click` the `Targets …` link: `alertdialog "Discard unsaved changes?"` (`Your edits to personal.yml haven't been saved.`) with `button "Cancel"` and `button "Discard"`. Discard: `#profile/targets.md`, and `state/profile/personal.yml` does not exist.
- **Edit key.** On `#profile/targets.md`, `browser_press_key` `e`: the editor opens with the saved text; `button "Cancel"` closes it.
- **Settings.** `browser_navigate $B/#settings`, `browser_snapshot`. `navigation "Settings sections"` (General, Auto apply, Mail & digest, Browser, Danger zone), then the regions: General: Phase `Practice`, Held for the real search `1` with `link "View"` (`#archive/held`), New applications a day `100`, Confirm before submitting `On`, the Add a posting row. Auto apply: Status `Off` (`Every application waits for your approval in Review.`), Minimum fit `80`, Approvals a day `0 of 5 today` (the 5 is the code default, since `serve.ts` replaces `autoApply`), Submits on its own `No`, fold `How auto apply decides`. Mail & digest: Gmail Mailbox `Not connected` with `link "Connect Gmail"`, the OAuth redirect URI `http://localhost:<port>/oauth/callback` with `button "Copy the redirect URI"`; Daily questions digest Status `Mailbox not connected`, Recipient `No verified connected mailbox`, Next send `Daily at 09:00, America/Chicago time.`, `button "Send now"` disabled, `button "Refresh status"`. Browser: `Viewing it from here needs a VNC port in the config.` and no "Open browser". Danger zone: `button "Release held jobs"` (1 held job).
- **Proof.** Snapshot of the profile file before and after saving, the file on disk, `profileProblems` before and after, a snapshot of Settings, and `/__verify`.

## Gotchas

- Do the scan-refusal step before saving `targets.md`. Once targets are filled in, Scan really starts: every source is refused by the network guard, errors land in Activity, and `refusedOutbound` is no longer empty. That is safe but it is not a proof of scanning, and it dirties the isolation check for anything driven afterwards; `ctl.sh reset` first.
- Settings shows the verification instance's configuration (auto apply off, no mailbox, no browser links), not the owner's. A change to how Settings renders real values needs those values; say what could not be shown.
- "Connect Gmail" (`/oauth/start`) answers 400 `profile/gmail-client.json is missing` here. Do not supply a client file: OAuth would leave the machine.
- The Resume file (`main.typ`) edits the stand-in stock source under `state/resume/`, never `basic-resume/`.
- Only a click on a link, or the phone's file picker (`combobox "Profile file"`), asks about unsaved edits. A route typed into the address bar or `browser_navigate` switches files without asking, and the draft waits in memory: going back to that file reopens the editor with it.
- Reloading with unsaved edits raises a `beforeunload` prompt; handle it with `browser_handle_dialog` or save first.
- Release held jobs (Danger zone: `alertdialog "Release 1 held job?"`, `button "Release them"`; or Archive's ⋯) sends held jobs back through triage. Its title screen runs without a model: the seeded "Staff Engineer (held)" comes back `skipped` (`senior-level title ("Staff")`), not to Review. Assessment after the screen needs a model.
