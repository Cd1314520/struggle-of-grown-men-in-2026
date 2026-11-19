# Early outreach

Design: `docs/superpowers/specs/2026-11-18-early-outreach-design.md`.

A job posting draws hundreds of applicants. The Early outreach page (`#outreach`) helps the owner write to
the person who hires before the crowd gets there, by email, with drafts the app prepares. Two rules hold
everywhere: **the app never sends anything** (the owner copies each draft into his own mail, sends it, and
marks it sent), and **the app never opens linkedin.com or x.com** (posts there are judged from web search
results only).

## Where leads come from

A scout agent runs every `outreach.minutes` (default 240) while fewer drafts wait than today still has room
for, and looks for three kinds of lead:

| Kind | What | Fresh for |
|---|---|---|
| `post` | a "we're hiring" post on LinkedIn or X, under 100 likes | 1 day |
| `listing` | a new role on YC's Work at a Startup, or a comment in HN's "Who is hiring?" | 3 days |
| `seed` | a startup that announced a seed or pre-seed round | 7 days |

It scores each company's fit against `profile/targets.md` and keeps those at `outreach.minScore` or above.
A company emailed within `outreach.resuggestDays` is not a lead again. For each lead it picks up to three
people (founders first), finds their work address on public pages, or else asks `find_email`, which uses
Hunter.io when `outreach.hunterKey` is set (at most `hunterPerDay` lookups a day) and otherwise returns the
common patterns marked low confidence. Each email is five lines or fewer, written for that company from
`profile/answers.md` only, under the humanizer rules (`prompts/humanizer.md`).

## The page

- **Today's emails**: up to `outreach.perDay` (default 20) drafts, best fit first, then newest. Copy the
  address and the email, send it, then **Mark sent**.
- **Follow-ups due**: people emailed `followUpDays` (default 5) days ago with no reply. Once a day a short
  run drafts one follow-up (three lines or fewer) for each; send it as a reply, then **Mark follow-up sent**.
- **Check this address first**: drafts whose address is only a guess. Check it, then **Address checked**
  puts it on the list.
- **Waiting**, **Replied**, **Done**: everyone else, by stage.

An unsent draft goes away once its lead is no longer fresh. **Drop** removes a company's drafts.

## Replies

With Gmail connected, the app searches the mailbox, read only, every two hours for mail from each person
written to, and marks them Replied. It sees only that mailbox: replies to another address (a school
account, say) are marked by hand, unless the owner forwards them there with his own mail rule.

## Settings

In `config.yml`, overridable in `config.local.yml`:

```yaml
outreach:
  minutes: 240 # 0 turns early outreach off
  perDay: 20
  leadsPerRun: 8
  minScore: 60
  followUpDays: 5
  resuggestDays: 30
  hunterPerDay: 3
  sendFrom: null # config.local.yml: the address you send from
  hunterKey: null # config.local.yml only
```

`models.outreach` picks the model (default: the discover model, with discover's fallbacks).

## Code

| File | Holds |
|---|---|
| `src/leads.ts` | the `outreach_leads` and `outreach_people` tables |
| `src/outreach-plan.ts` | freshness, the daily list, follow-up dates, address guesses. Pure |
| `src/outreach-scout.ts` | the scout and follow-up runs, their host tools, when they run |
| `src/outreach-leads-api.ts` | the page's state, the owner's changes, the reply check |
| `prompts/outreach.md`, `prompts/outreach-followup.md` | the two runs' tasks |
| `ui/pages/outreach/` | the page |

| Route | Does |
|---|---|
| `GET /api/outreach` | `OutreachState`: the day, sent today, and each section's people with their leads |
| `POST /api/outreach/people/:id` | `{ stage }` moves a person; `{ promote: true }` marks a guessed address checked |
| `POST /api/outreach/leads/:id/drop` | drops a lead and its drafts |
| `POST /api/outreach/run` | starts the scout now |
| `POST /api/outreach/mail` | checks the mailbox for replies now |
