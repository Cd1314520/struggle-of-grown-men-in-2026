# Early outreach: reach the people who hire before the crowd does

Status: design, 2026-11-18. Feature idea: the repository owner.

## Intent

Applying through job boards puts the candidate among hundreds of applicants. Two signals let him reach a
decision maker earlier, by email, while the crowd is still small:

1. **Fresh hiring posts.** A "we're hiring" post less than a day old, with fewer than 100 likes. Being
   among the first to write matters more than anything else.
2. **Seed rounds.** A startup that just raised a seed round starts hiring, and its founders still hire
   themselves, so decisions are fast.

For each lead the app learns what the company does and where the candidate would help, picks up to three
people (founders first, else the person who posted), finds their email addresses, and drafts a short email
(five lines or fewer, plain, a little informal, run through the humanizer rules). The owner reads each
draft, sends it from his own mail, and marks it sent. Target: 20 emails a day.

This gets the candidate seen. It does not replace having the skills for the role.

## Goals

- A new **Early outreach** page (`#outreach`), separate from Referrals, with its own tables.
- A scheduled **scout** worker that finds leads from both kinds of signal and from these sources:
  - web search for public hiring posts on LinkedIn and X from the last day (the likes filter applies when
    the search result or the public page shows a count);
  - YC's Work at a Startup new listings and the current Hacker News "Who is hiring?" thread;
  - seed-round news (startup and funding news sites, press releases) from the last few days.
- Each lead screened for fit against the candidate's profile before any people search: hardware, power,
  energy, embedded, robotics, space, automation first; pure software, finance and marketing out. A
  lead outside the US is out. Texas is a plus, as in the rubric.
- Per lead: what the company does, why the candidate fits (one or two sentences from facts on record),
  up to three people with role, source link and email, and one draft per person.
- Email finding: public sources first (company site, team page, press release, personal site, GitHub
  profile, conference pages). Otherwise a guess from the company's domain and the common patterns
  (`first@`, `first.last@`, `flast@`), marked with its confidence. An optional Hunter.io API key in
  `config.local.yml`, when present, is asked first.
- A daily list of 20 emails, best leads first, newest first: the page shows today's 20 drafts ready to
  copy, and the rest wait.
- Stages per person: `drafted` → `sent` → `followed_up` (one follow-up, `followUpDays` later, drafted on
  the day it is due) → `replied`, or `no_response`, `closed`. A Gmail check (read-only, as the
  referrals check does) moves a person to `replied` when mail from their address arrives.
- Drafts written by the model under `prompts/humanizer.md`, from facts in `profile/` only.

## Non-goals

- The app does not send email, create Gmail drafts, or post anything. The owner sends every message.
- The app does not open linkedin.com or x.com in its browser, log in anywhere, or get around LinkedIn's
  rate limit. Public posts are reached only through web search results.
- No paid data source is signed up for. Hunter.io is used only if the owner adds a key himself.
- No change to the Referrals page or the application pipeline.

## Anti-goals (a failure even if it works)

- A draft that claims something about the candidate not on record in `profile/`.
- Long, templated, or obviously AI-written emails. Five lines or fewer, written for that company.
- Emailing someone twice for the same lead, or more than one follow-up.
- Leads that do not fit the candidate (a fintech seed round, a sales role) filling the 20 a day.
- Any personal detail of the owner leaking into tracked files.

## Constraints

- The owner's standing rules: never send a message on his behalf, never log in, never enter passwords,
  no CAPTCHA solving, all application prose through the humanizer, no facts not on record.
- LinkedIn has answered 429 since 2026-11-09; the logged-out search volume stays as it is.
- Model: the scout runs on `models.outreach` (default: the `discover` model, Codex terra low), with the
  usual fallback chain. Token use is the main cost; one run every `outreach.minutes` (default 240).
- A lead is identified by company key plus source URL; a company already contacted in the last
  `outreach.resuggestDays` (default 30) is not a new lead.
- Code layout follows the existing rules: SQL only in the owning module, values bound as parameters,
  `bun run check` passing.

## Approaches

1. **Extend the Referrals page.** Leads become a new kind of referral contact. Least new code, reuses
   stage tracking and the Gmail check, but Referrals is built around jobs already applied to.
2. **A separate Early outreach page with its own tables (chosen by the owner).** Clean model for leads that
   have no job attached, at about twice the work of 1: stage tracking, the daily list, and the reply check
   are written for it (the Gmail search helper is reused).
3. **Approach 1 plus Gmail drafts.** Saves copy and paste but needs a wider Gmail permission than the
   app's read-only search. Left for later.

## Design

### Modules

| File | Holds |
|---|---|
| `src/leads.ts` | The `outreach_leads` and `outreach_people` tables and all their SQL |
| `src/outreach-scout.ts` | The scout worker: prompt, host tools, scheduling hook |
| `src/outreach-plan.ts` | Pure: the daily list, next steps, follow-up due dates |
| `src/outreach-leads-api.ts` | The page's state and the owner's changes (routes in `server.ts`) |
| `prompts/outreach.md` | The scout's task |
| `ui/pages/outreach/` | The page |
| `docs/outreach.md` | How it works, for the owner |

(The existing `src/outreach.ts` is the Referrals page's module and keeps its name.)

### Data

`outreach_leads`: id, kind (`post`, `listing` or `seed`), company, company_key, domain, source_url, source_title,
posted_at, likes (nullable), what_they_do, why_fit, score, status (`new`, `active`, `done`, `dropped`),
found_at.

`outreach_people`: id, lead_id, name, role, profile_url, email, email_source (`public`, `hunter`,
`guess`), email_confidence (`high`, `medium`, `low`), subject, body, followup_body, stage, sent_at,
followed_up_at, replied_at, updated_at. Unique on (lead_id, email).

### The scout worker

Runs on the scheduler every `outreach.minutes`. Tools:

- `add_lead {kind, company, domain, source_url, source_title, posted_at, likes?, what_they_do, why_fit, score}`:
  refuses a lead seen before, one older than a day (`post`) or a week (`seed`), one with 100 or more likes,
  and one below `outreach.minScore`.
- `add_person {lead_id, name, role, profile_url, email, email_source, email_confidence, subject, body}`:
  at most three per lead; the body must be five lines or fewer.
- `find_email {name, domain}`: Hunter.io when a key is set, otherwise returns the pattern guesses.
- `outreach_done {summary}`.

The prompt gives the candidate's targets, `profile/answers.md` facts, the humanizer rules, and the
companies already contacted. Each run stops after `outreach.leadsPerRun` (default 8) leads.

### The page

```
Early outreach                         Today: 7 of 20 sent
────────────────────────────────────────────────────────────
Today's emails
  ▸ Ampere Power (seed, 2 days ago) · "builds DC fast chargers…"
      Jane Founder · CEO · jane@amperepower.com (public)   [Copy] [Mark sent]
      ┌ Subject: EE intern, power side
      │ Hi Jane, saw the seed round. I'm an EE student at Example University…
  ▸ Bright Robotics (post, 6 h, 41 likes) …
Follow-ups due (2)
Waiting (12)   Replied (1)   Done
```

Copy puts subject and body on the clipboard; Mark sent moves the person to `sent`; a Stage select fixes
anything by hand; Drop removes a lead.

### Settings (`config.yml`, overridable)

```yaml
outreach:
  minutes: 240
  perDay: 20
  leadsPerRun: 8
  minScore: 60
  followUpDays: 5
  resuggestDays: 30
  hunterPerDay: 3
  sendFrom: null    # config.local.yml: the address drafts are signed from
  hunterKey: null   # config.local.yml only
```

## Decisions after review

- **Sending mailbox (the owner):** the school `.edu` address when that works, otherwise his personal one.
  The app never connects to either to send: the owner copies the draft into his own mail, so no school
  IT approval is needed. The signature line and the "from" address shown on the page come from
  `outreach.sendFrom` in `config.local.yml`. The reply check searches the connected Gmail mailbox for
  mail from each person's address. It finds replies only when they reach that mailbox (sent from it, or
  forwarded there by the owner's own mail rule); otherwise the owner marks `replied` by hand.
- **No backlog (builder's call):** the scout runs only when fewer than `perDay` unsent drafts are waiting,
  and stops a run once the queue holds `perDay`. An unsent draft expires after a day for a `post` lead,
  three days for a `listing`, a week for a `seed`, and its lead goes back to `new` only if still fresh.
  Order: score, then newest. Follow-ups do not count toward the 20.
- **"Already contacted" counts sends (builder's call):** `resuggestDays` starts at the first `sent`, so
  an expired draft does not block the company.
- **No fetching of linkedin.com or x.com pages (builder's call):** posts are judged from search results
  only. `add_lead` rejects those URLs as a fetched source. When a result shows no likes, the lead is
  kept and marked "likes unknown"; when it shows no date, it is kept only if the search was limited
  to the past day.
- **A third kind, `listing` (builder's call):** YC Work at a Startup postings and HN "Who is hiring?"
  comments, kept for up to three days after posting. Neither has likes.
- **Follow-ups (builder's call):** once a day, one small model run drafts all follow-ups due that day
  under the humanizer rules (three lines or fewer, written for that thread). No templates.
- **Guessed addresses (builder's call):** only `high` and `medium` confidence addresses enter today's
  20. A `low` guess is shown under the lead as "check this address first" and can be promoted by hand.
  Hunter, when a key is set, is asked only for leads that already passed `minScore`, at most
  `outreach.hunterPerDay` (default 3) lookups a day.

## Left to the builder

- The exact fit score the scout reports and how it uses the rubric text.
- Page styling, following the existing pages.
- The Gmail query for replies, following `src/outreach.ts`.

## Publishing (separate task, after this feature)

Push the branch to the owner's own GitHub repository with no personal data (`profile/`, `data/`,
`config.local.yml`, `basic-resume/main.typ` stay untracked; tracked files scanned for his name, email,
phone and LinkedIn first). Rewrite the README so a new user can install and run it, credit Doomy
(TheRatLord) as the original author, and license it under PolyForm Noncommercial 1.0.0 (personal and
other noncommercial use only). Doomy has agreed.
