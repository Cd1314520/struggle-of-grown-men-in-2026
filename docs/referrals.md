# Referral outreach

The Referrals page (`#referrals`) keeps track of the people the owner asks about their applications. Two rules hold everywhere: **the app never sends a message** (the owner copies a draft and sends it from their own browser or mail, then marks where the contact stands), and **the app never opens linkedin.com** (its LinkedIn links are for the owner's own browser, and the network comes from an export file the owner downloaded).

| Module | What |
|---|---|
| `src/referrals.ts` | The `referral_*` tables: contacts and their stages and days, the owner's connections, what the daily list suggested when, each file read |
| `src/referral-plan.ts` | `profile/referral.yml` parsed, each contact's next step, and the daily list. Pure |
| `src/referral-drafts.ts` | The words to send, put together from `referral.yml` only. No model writes them |
| `src/linkedin-export.ts` | Reading LinkedIn's data export (a zip, or `Connections.csv` alone). Pure |
| `src/outreach.ts` | The page's state, the owner's changes, an uploaded export, the mailbox check |
| `ui/pages/referrals/` | The page |
| `scripts/import-internscouter-outreach.ts` | Brings InternScouter's `data/outreach.json` in once (`--dry-run` to preview) |

## The profile

`profile/referral.yml` (copied from `profile.example/referral.yml`) holds who the owner is (`me`), what they are after (`interest`), and per kind of role (`areas`, matched on the job title) one hook for the invite note and one fact for the message. Drafts stay hidden until no `TODO-FILL` is left; the page says what is missing. `daily` sets how many employers and people the list names a day and where (`places`, regular expressions over a job's location), and `watchlist` adds employers worth a message without an opening.

## Stages

`drafted` → `requested` (invite sent; with a note, it uses one of the month's `notesPerMonth`) → `connected` → `messaged` → `followed_up` (once, `followUpDays` later) → `replied` → `referred`, or `declined`, `no_response`, `closed`. The owner moves a contact with the Stage select on its row. A LinkedIn export moves contacts on when it shows an accepted invite or a message (forward only), and every two hours, with Gmail connected, the scheduler searches the mailbox read-only for LinkedIn's notifications about open contacts and for mail with those whose address is known.

## The daily list

"Next steps due" first (contacts whose next step falls today or earlier), then "Who to contact today": connections from the last export who work at an employer the owner is applying to (one per employer a day), then employers worth a cold message (those the owner is interviewing with first, then by place, then by how recent and good the application is), each with search links and an Add contact button. An employer is not named again within `resuggestDays`, nor while a conversation there is open.

## API

| Route | Does |
|---|---|
| `GET /api/referrals` | `ReferralsState`: the day, problems in `referral.yml`, due contacts, today's people and employers, every contact with its next step and drafts, invite notes left, the export's age, the mailbox |
| `GET /api/referrals/jobs?company=` | applications at an employer, to tie a contact to |
| `POST /api/referrals/contacts` | add a contact (`name`, `company`, `relation`, optional `title`, `profileUrl`, `email`, `jobId`, `area`, `notes`) |
| `POST /api/referrals/contacts/:id` | `{ op: "stage", stage, withNote? }`, `{ op: "edit", ... }` or `{ op: "remove" }` |
| `POST /api/referrals/import` | a LinkedIn export as a form with one `file` (and its `modified` time) |
| `POST /api/referrals/mail` | check the mailbox now |
