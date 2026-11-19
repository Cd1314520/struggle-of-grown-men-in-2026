# Early Outreach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Early outreach page whose scout worker finds fresh hiring posts, new listings and seed rounds, picks up to three people per lead, and drafts short emails the owner copies and sends himself.

**Architecture:** Two new tables (migration 13) owned by `src/leads.ts`; pure rules in `src/outreach-plan.ts`; agent work (scout, follow-ups) in `src/outreach-scout.ts` on the discover model's chain; page state and owner actions in `src/outreach-leads-api.ts`; a page under `ui/pages/outreach/`. The scheduler tick starts the scout, the daily follow-up run and the read-only reply check.

**Tech Stack:** Bun, TypeScript, `bun:sqlite`, `bun:test`, the existing worker/host-tool layer (`schema`, `S`, `arg` as in `src/scan.ts`), Preact UI as in `ui/pages/referrals/`.

**Spec:** `docs/superpowers/specs/2026-11-18-early-outreach-design.md`

## Global Constraints

- The app never sends email, never creates Gmail drafts, never opens linkedin.com or x.com, never logs in. Gmail is only searched.
- A person's draft body is five lines or fewer; a follow-up three lines or fewer. Both written under `prompts/humanizer.md`, from `profile/` facts only.
- Lead kinds: `post` (fresh for 1 day, under 100 likes), `listing` (3 days, no likes), `seed` (7 days).
- At most three people per lead. Only `high`/`medium` email confidence enters today's list unless promoted by hand.
- "Today" is the day in `config.questionDigest?.timeZone ?? "America/Chicago"`, as `referral-plan.ts`'s `dayIn` computes it.
- Defaults: `outreach: { minutes: 240, perDay: 20, leadsPerRun: 8, minScore: 60, followUpDays: 5, resuggestDays: 30, hunterPerDay: 3, sendFrom: null, hunterKey: null }`; `hunterKey` and `sendFrom` belong in `config.local.yml` only.
- Model: `models.outreach` when set, else `models.discover`; workers run with `stage: "discover"` so they use that stage's fallback chain.
- SQL only in `src/leads.ts`, values always bound; `bun run check` passes at every commit; never `--no-verify`.
- No personal data in tracked files: examples use "Sam Lee", `example.com`.

## Review Focus

- The same company found again through a different URL, within `resuggestDays` of a send → rejected as already contacted (Task 2 test `rejects a company contacted within resuggestDays`).
- The same address in another case (`Jane@Acme.com` vs `jane@acme.com`) → one person, not two (Task 1 test `dedupes people by lowercased email`).
- A day boundary: a post found at 11 PM Chicago is still today's, and expires a day after `posted_at`, not at UTC midnight (Task 2 test `expires by posted_at in the owner's time zone`).
- Gmail not connected → the reply check does nothing and the page says replies are marked by hand (Task 5 test `skips the mail check without Gmail`).
- Every provider out (`backedOff()`) → the scout and follow-up runs do not start (Task 4 test `does not start while backed off`).

---

### Task 1: Tables and store

**Files:**
- Modify: `src/schema.ts` (add migration 13 `early outreach`)
- Create: `src/leads.ts`
- Test: `tests/leads.test.ts`

**Interfaces:**
- Produces:
  - `type LeadKind = "post" | "listing" | "seed"`, `type LeadStatus = "new" | "active" | "done" | "dropped"`
  - `type PersonStage = "drafted" | "sent" | "followed_up" | "replied" | "no_response" | "closed"`
  - `type EmailSource = "public" | "hunter" | "guess"`, `type Confidence = "high" | "medium" | "low"`
  - `interface Lead { id; kind; company; company_key; domain; source_url; source_title; posted_at; likes: number | null; what_they_do; why_fit; score; status; found_at }`
  - `interface Person { id; lead_id; name; role; profile_url: string | null; email; email_source; email_confidence; promoted: 0 | 1; subject; body; followup_body: string | null; stage; drafted_on; sent_on: string | null; followed_up_on: string | null; replied_on: string | null; updated_at }`
  - `outreachStore(db: Database)` returning `{ addLead(l: NewLead): Lead | null` (null when `source_url` is known), `addPerson(p: NewPerson): Person | null` (null when the lead has 3 or the email is known for that lead), `lead(id)`, `leads(statuses?: LeadStatus[])`, `people(leadId?: number)`, `setStage(id, stage, day)`, `setFollowUp(id, body)`, `promote(id)`, `setLeadStatus(id, status)`, `sentCompanyDays(): Map<string, string>` (company_key → first `sent_on`), `deleteExpiredDrafts(ids: number[])` }`

- [ ] **Step 1: Write the failing tests** in `tests/leads.test.ts` with an in-memory `migrate`d db (as `tests/referrals.test.ts` does): `adds a lead once per source_url`; `caps people at three per lead`; `dedupes people by lowercased email` (`Jane@Acme.com` then `jane@acme.com` → second returns null); `setStage stamps the day column` (`sent` → `sent_on`, `followed_up` → `followed_up_on`, `replied` → `replied_on`); `sentCompanyDays keeps the first send per company`.
- [ ] **Step 2: Run** `bun test tests/leads.test.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** migration 13 in `src/schema.ts` (`outreach_leads`, `outreach_people` with `UNIQUE(lead_id, email COLLATE NOCASE)`, CHECK constraints on the enums, index on `company_key`), then `src/leads.ts` taking the db as `referrals.ts` does. Emails are stored lowercased; `company_key` via `companyKey` from `./company-key`.
- [ ] **Step 4: Run** `bun test tests/leads.test.ts tests/schema.test.ts tests/db.test.ts` — Expected: PASS (db.test's SQL-placement scan included).
- [ ] **Step 5: Commit** `git add src/schema.ts src/leads.ts tests/leads.test.ts && git commit -m "Keep early outreach leads and the people drafted for them"`

### Task 2: Config and the pure rules

**Files:**
- Modify: `src/config.ts` (`Config.outreach`, optional `models.outreach`), `config.yml` (the defaults block, commented), `src/config-check.ts` (shape for `outreach`, `models.outreach` optional)
- Create: `src/outreach-plan.ts`
- Test: `tests/outreach-plan.test.ts`, `tests/config-check.test.ts` (one case)

**Interfaces:**
- Consumes: `Lead`, `Person`, `LeadKind` from Task 1; `dayIn` from `src/referral-plan.ts`.
- Produces:
  - `FRESH_DAYS: Record<LeadKind, number>` = `{ post: 1, listing: 3, seed: 7 }`
  - `leadProblem(l: { kind; posted_at; likes: number | null; score; company_key; source_url }, now: Date, opts: { minScore; resuggestDays; sentCompanyDays: Map<string,string> }): string | null` — the refusal text, or null. Refuses: stale for its kind; `likes >= 100`; `score < minScore`; a company sent to within `resuggestDays`; a `source_url` on linkedin.com or x.com/twitter.com that the worker says it fetched (`fetched: true` flag in the input).
  - `bodyProblem(body: string, maxLines: number): string | null` (counts non-empty lines)
  - `emailGuesses(first: string, last: string, domain: string): string[]` → `[first@, first.last@, flast@]` lowercased
  - `todayList(people: Person[], leads: Lead[], perDay: number, day: string): Person[]` — `drafted` people whose confidence is high/medium or `promoted`, lead not stale, best `score` first then newest `posted_at`, at most `perDay - sentToday`
  - `expiredDrafts(people, leads, now): number[]` — ids of `drafted` people whose lead is past `FRESH_DAYS`
  - `followUpsDue(people, day, followUpDays): Person[]` — `sent`, no `followed_up_on`, `sent_on` + days ≤ day
  - `needsLeads(people, leads, perDay, day): boolean` — fewer than `perDay` sendable drafts waiting

- [ ] **Step 1: Write the failing tests:** `refuses a post older than a day`; `keeps a seed for a week`; `refuses 100 likes or more` (99 passes, 100 fails, null passes); `rejects a company contacted within resuggestDays` (sent 10 days ago, 30 → refused; 31 days ago → ok); `refuses a fetched linkedin or x URL`; `bodyProblem counts lines` (5 ok, 6 refused); `emailGuesses` for `("Jane","Founder","acme.com")` → `["jane@acme.com","jane.founder@acme.com","jfounder@acme.com"]`; `todayList skips low confidence unless promoted`; `todayList orders by score then newest and caps at perDay minus sent today`; `expires by posted_at in the owner's time zone` (post at 2026-11-18T05:30Z = 11:30 PM Chicago on the 17th; still fresh on Chicago day 2026-11-18, stale on 2026-11-19); `followUpsDue after followUpDays`; `config-check accepts an outreach block and rejects perDay: -1`.
- [ ] **Step 2: Run** `bun test tests/outreach-plan.test.ts tests/config-check.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** the config fields (defaults in `config.yml` under a commented `outreach:` block; `sendFrom`/`hunterKey` default null) and `src/outreach-plan.ts` (no I/O).
- [ ] **Step 4: Run** the same tests — Expected: PASS.
- [ ] **Step 5: Commit** `"Rules for which outreach leads are fresh and which drafts go out today"`

### Task 3: The scout worker and its prompt

**Files:**
- Create: `src/outreach-scout.ts`, `prompts/outreach.md`
- Test: `tests/outreach-scout.test.ts`

**Interfaces:**
- Consumes: Task 1 store, Task 2 rules, `render` from `src/worker-tools.ts`, `readProfile`, `RunWorker`.
- Produces:
  - `scoutTools(store, now: () => Date)` → `{ add_lead, add_person, find_email, outreach_done }` host tools. `add_lead` returns `"Lead <id> saved."` or `"ERROR: <leadProblem>"`; `add_person` refuses a body failing `bodyProblem(body, 5)`, a fourth person, an unknown lead; `find_email {first, last, domain}` asks Hunter when `config.outreach.hunterKey` is set, the lead's score ≥ `minScore` and today's `count.hunter.<day>` < `hunterPerDay` (counted with `kvGet/kvSet`), otherwise returns `emailGuesses` marked `low`.
  - `runScout(run: RunWorker): Promise<void>` — `name: "outreach"`, `stage: "discover"`, `model: config.models.outreach ?? config.models.discover`, builtins `["read", "web_search"]`, `maxTime: "25m"`, prompt from `render("outreach", { targets, answers, humanizer, contacted, leadsPerRun, perDay, sendFrom })`. Deletes `expiredDrafts` first.
- Prompt (`prompts/outreach.md`) must say: the three sources and their freshness; use search results only, never open linkedin.com or x.com pages; fit first (hardware, power, energy, embedded, robotics, space, automation; no pure software, finance, marketing; US only; Texas a plus); founders first, else the poster, up to three; email from public pages first, else `find_email`; each draft five lines or fewer, written for that company, signed as `{{sendFrom}}`'s owner, humanizer rules applied, no fact not in the profile text given; stop after `{{leadsPerRun}}` leads; finish with `outreach_done`.

- [ ] **Step 1: Write the failing tests** calling the tool handlers directly with an in-memory store: `add_lead saves a fresh fitting lead`; `add_lead returns the refusal for a stale post`; `add_person refuses six lines`; `add_person refuses a fourth person`; `find_email without a key returns the three guesses as low`; `find_email does not call Hunter past hunterPerDay` (stub `fetch`, count calls); `the rendered prompt contains no TODO and names the humanizer rules`.
- [ ] **Step 2: Run** `bun test tests/outreach-scout.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `src/outreach-scout.ts` and `prompts/outreach.md`. Hunter: `GET https://api.hunter.io/v2/email-finder?domain=&first_name=&last_name=&api_key=` with a 15 s timeout; `data.email` with `data.score ≥ 70` → `high`, else `medium`; any error falls back to the guesses.
- [ ] **Step 4: Run** the tests — Expected: PASS.
- [ ] **Step 5: Commit** `"Scout fresh hiring posts and seed rounds, and draft short emails to the people who hire"`

### Task 4: Follow-ups and the scheduler

**Files:**
- Modify: `src/outreach-scout.ts` (add `runFollowUps`), `src/scheduler.ts` (tick hooks; no scheduler test exists, so the decisions live in `shouldScout`/`shouldFollowUp`)
- Test: `tests/outreach-scout.test.ts`

**Interfaces:**
- Produces: `runFollowUps(run: RunWorker): Promise<void>` — one worker (`name: "outreach-followup"`, `stage: "discover"`, no web search, `maxTime: "10m"`) given every `followUpsDue` person with their first email; tool `set_followup {person_id, body}` refuses `bodyProblem(body, 3)`. `shouldScout(now): boolean` and `shouldFollowUp(now): boolean` (false while `backedOff()` from `src/limits.ts`; otherwise from kv `last.outreach` / `last.outreachFollowUp`, `outreach.minutes`, `needsLeads`, one follow-up run per Chicago day).
- Scheduler: in `tick`, after the referral mail check and behind the existing `if (backedOff()) return;`, `if (config.outreach.minutes && shouldScout(now) && !this.isRunning("outreach")) void this.exclusive("outreach", () => runScout(this.run))`, and the same for follow-ups.

- [ ] **Step 1: Write the failing tests:** `set_followup refuses four lines`; `shouldScout is false while perDay drafts wait`; `shouldScout is false when minutes is 0`; `shouldFollowUp once per day`; `does not start while backed off` (`backOff()` then `shouldScout` and `shouldFollowUp` are false; `clearBackoff()` after, as `tests/limits.test.ts` does).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/outreach-scout.test.ts` and the scheduler tests — Expected: PASS.
- [ ] **Step 5: Commit** `"Draft one follow-up when it falls due, and run the scout when the queue runs short"`

### Task 5: Page state, owner actions, reply check, routes

**Files:**
- Create: `src/outreach-leads-api.ts`
- Modify: `src/api-types.ts` (`OutreachState`), `src/server.ts` (routes), `src/scheduler.ts` (reply check every two hours with the referral one)
- Test: `tests/outreach-api.test.ts`, `tests/server.test.ts` (route cases)

**Interfaces:**
- Produces:
  - `OutreachState { day; sentToday; perDay; sendFrom: string | null; gmail: boolean; today: OutreachItem[]; followUps: OutreachItem[]; waiting: OutreachItem[]; checkFirst: OutreachItem[]; replied: OutreachItem[]; done: OutreachItem[] }`, `OutreachItem { person: Person; lead: Lead }`
  - `outreachState(): OutreachState`; `changePerson(id, { stage?: PersonStage; promote?: true }): Person`; `dropLead(id): void`; `replyBumps(people: Person[], fromAddresses: Set<string>): number[]` (pure: `sent`/`followed_up` people whose email is in the set); `syncOutreachMail(): Promise<{ checked; replied }>` (returns zeros without Gmail; one `gmail.search("from:<email> newer_than:30d", 1)` per open person).
  - Routes: `GET /api/outreach`, `POST /api/outreach/people/:id` `{stage?, promote?}`, `POST /api/outreach/leads/:id/drop`, `POST /api/outreach/run` (starts the scout now).

- [ ] **Step 1: Write the failing tests:** `outreachState sorts people into today, follow-ups, waiting, check first, replied, done`; `changePerson to sent stamps today`; `replyBumps picks sent people whose address wrote`; `skips the mail check without Gmail`; server: `GET /api/outreach returns the state`, `POST an unknown stage is a 400`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test tests/outreach-api.test.ts tests/server.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `"Serve the outreach page's state and the owner's changes, and notice replies in Gmail"`

### Task 6: The page and the docs

**Files:**
- Create: `ui/pages/outreach/index.tsx`, `docs/outreach.md`
- Modify: `ui/pages/index.tsx` (register `outreach: OutreachPage` next to `referrals`, which is also where the nav takes its pages), `README.md` (one row in the docs table), `tests/ui.test.ts` (route exists)

**Interfaces:**
- Consumes: Task 5 routes and `OutreachState`.

- [ ] **Step 1: Write the failing test** in `tests/ui.test.ts`: `the outreach page is routed and named in the nav`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** the page as the spec's sketch: header "Early outreach — Today: N of 20 sent" and the send-from address; sections Today's emails, Follow-ups due, Check this address first, Waiting, Replied, Done; each person row with name, role, email + source/confidence, the lead's kind/age/likes and what it does, Copy (subject + blank line + body to the clipboard), Mark sent, a Stage select, Drop lead on the lead; a "Find leads now" button posting `/api/outreach/run`; when `gmail` is false, the line "Replies to your school address are marked by hand." Styling from `ui/pages/referrals/`. `docs/outreach.md`: what it does, the rules (never sends, never opens LinkedIn/X), settings, stages.
- [ ] **Step 4: Run** `bun run check` — Expected: PASS (typecheck, lint, format, all tests).
- [ ] **Step 5: Commit** `"An Early outreach page to copy today's emails and mark where each one stands"`

### Task 7: Finish

- [ ] **Step 1:** `bun run check` on the branch — PASS.
- [ ] **Step 2:** Squash the branch's commits into one, rebase on `auto-apply`, run `bun run check`, fast-forward `auto-apply` (the owner's working branch; `master` too if it points at the same commit). Do not restart the live app without asking.
