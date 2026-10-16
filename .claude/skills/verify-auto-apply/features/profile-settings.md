# Profile and Settings

Profile lets the user read and edit the files the agents work from (targets, rubric, resume source, resume notes, answers, personal details, companies). Settings reports how the app is configured: mailbox, digest, phase, auto apply and browsers. Until the profile is filled in, the app says so and refuses to scan.

## Sub-features

- `profile-view` a tab per profile file; Markdown files render, others open in the editor.
- `profile-edit` Edit, change, Save writes the file; Ctrl+S saves too.
- `profile-unsaved` leaving with unsaved edits asks first.
- `profile-incomplete` empty or placeholder profile files are named in a notice, and Scan is refused until targets are filled in.
- `settings-report` Settings shows mailbox status, digest state, phase, and auto-apply status, practice gate, caps and safeguards from the running configuration. (Its Add a posting section is [add-posting](./add-posting.md).)

## How to get to it (user POV)

- "Profile" and "Settings" in the section nav at desktop width; on a phone, More, then Profile or Settings.
- Routes `#profile` and `#settings`.
- "Scan now" at the foot of the desktop nav, and "Scan now" in the Runs box on the Activity page (`#activity`).

## Driving it with Playwright MCP and curl

Preconditions:

- Fresh seed, doctor passes. The seeded profile directory is empty: `curl -s $B/api/state` has `profileProblems` naming `targets.md`, `rubric.yml`, `personal.yml` and `answers.md`.

- **Scan is refused.** `browser_navigate $B/#activity`, `browser_click` `.runs [data-run="scan"]` (at desktop width the nav's "Scan now" is a second `[data-run="scan"]`). Toast `fill in profile/targets.md first`. `curl -s $B/__verify` still has `"refusedOutbound":[]`.
- **Open a profile file.** `browser_navigate $B/#profile`: seven tabs, Targets, Rubric, Resume, Resume notes, Answers, Personal, Companies; Targets, Rubric, Answers and Personal carry a warn dot (`.tab.need`), explained by a line above the tabs. (Activity and Settings show the notice `Setup isn't finished: Targets, Rubric, Personal, Answers. …` with a `Finish setup →` link instead.) `browser_click` `[data-pfile="targets.md"]`. The file is empty: an empty state `Targets is empty.` with its purpose and a `Write it` button (`#pmode`).
- **Edit and save.** `browser_click` `#pmode`, `browser_type` `#ptext` with `Backend roles, remote or Houston.`, `browser_click` `#psave`. Toast `Saved targets.md`; the rendered view returns.
- **Confirm.** `cat $VERIFY_HOME/state/profile/targets.md` prints the text; `curl -s $B/api/profile/targets.md` returns it; `profileProblems` in `/api/state` no longer names `targets.md`; Activity (`#activity`) lists `edited profile/targets.md`.
- **Non-Markdown file.** `browser_click` `[data-pfile="personal.yml"]`: opens directly in the editor (`#ptext`) with `Save`, no rendered view.
- **Unsaved edits.** Type into `#ptext` (`slowly: true`, so input events fire), then `browser_click` `[data-pfile="targets.md"]`: a `confirm` dialog `Discard your unsaved changes to personal.yml?`. `browser_handle_dialog` with `accept: true`.
- **Settings.** `browser_navigate $B/#settings`, `browser_snapshot`. Add a posting comes first, then an Overview: Gmail `Not connected` with a `Connect Gmail` button, Daily digest `Mailbox not connected`, Auto apply `Off`, Phase `Practice`, Browser `None`. `[data-digest-state]` (on the overview row) reads `Mailbox not connected` and `#digest-send` is disabled; Phase `Practice`; `#settings-auto-apply` reads `Off. Every application waits for your approval in To review.`, and its Caps line (Practice gate and Safeguards are inside its "How this works" fold) `5 auto-approvals/day (0 so far today); 100 new applications/day …` (the 5 is the code default, since `serve.ts` replaces `autoApply`); no "Open browser" buttons.
- **Proof.** Snapshot of the profile tab before and after saving, the file on disk, `profileProblems` before and after, a snapshot of Settings, and `/__verify`.

## Gotchas

- Do the scan-refusal step before saving `targets.md`. Once targets are filled in, Scan really starts: every source is refused by the network guard, errors land in Activity, and `refusedOutbound` is no longer empty. That is safe but it is not a proof of scanning, and it dirties the isolation check for anything driven afterwards; `ctl.sh reset` first.
- Settings shows the verification instance's configuration (auto apply off, no mailbox, no browser links), not the owner's. A change to how Settings renders real values needs those values; say what could not be shown.
- "Connect Gmail" (`/oauth/start`) answers 400 `profile/gmail-client.json is missing` here. Do not supply a client file: OAuth would leave the machine.
- The Resume tab (`main.typ`) edits the stand-in stock source under `state/resume/`, never `basic-resume/`.
- The editor is not repainted while open, by design. To see a file changed from outside, switch tabs and back.
- Unsaved edits raise a `confirm()` on navigation and a `beforeunload` prompt on reload; handle them with `browser_handle_dialog` or save first.
