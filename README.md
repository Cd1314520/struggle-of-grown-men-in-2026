# InternScouter

InternScouter finds internships and jobs that fit you, tailors your resume to each one, and fills in the
applications for you in a real Chrome window. It runs on your own computer, keeps everything in a local
database, and does the work with AI coding agents you already have (Claude Code, Codex, Google's
Antigravity CLI, or omp).

It is a fork of [auto-apply](https://github.com/TheRatLord/auto-apply) by Doomy. See [Credits](#credits).

## What it does

1. **Finds openings.** It watches about 1,800 company career boards (Greenhouse, Lever, Ashby, Workday,
   iCIMS and many more), the SimplifyJobs internship list, and LinkedIn and Indeed searches.
2. **Throws out what does not fit, cheaply.** Titles, places, seniority and terms are filtered without a
   model. A small model then triages what is left.
3. **Scores each job against your checklist.** You write `profile/rubric.yml` (statements like "the role
   is in Texas" or "it asks for 5+ years"), and an agent answers each one with evidence from the posting.
   The app adds up the score and decides apply, hold or skip.
4. **Tailors your resume.** It rewrites a copy of your Typst resume for each job, using only what is
   already in your resume and notes.
5. **Fills in the application.** An agent fills the form in Chrome, answers the standard questions from
   your profile, and uploads your resume. CAPTCHAs, logins and anything it is unsure of are left for you.
6. **Keeps track afterwards.** With Gmail connected (read only), it notices confirmations, rejections,
   assessments and interview invitations, and prepares interview notes.
7. **Helps you reach people.** The Referrals page tracks who you ask for referrals. The Early outreach
   page finds fresh "we're hiring" posts and startups that just raised money, and drafts short emails to
   the founders for you to send yourself. The app never sends a message for you.

You decide how much it does on its own: in `config.yml`, `approval: gated` makes it wait for your yes
before each application and again before each submit; `approval: auto` lets it apply on its own to jobs
that clear the score you set (`autoApply.minScore`).

## What you need

- Windows 10/11 or Linux (macOS is untested).
- [Bun](https://bun.sh), Google Chrome, Git, Node.js (for `npx`), [Typst](https://typst.app) and
  poppler (`pdftotext`, `pdfinfo`, `pdftoppm`).
- At least one agent command line tool, signed in: [Claude Code](https://claude.com/claude-code)
  (`claude`), Codex (`codex`), Antigravity (`agy`) or omp. A paid plan's usage limits are enough; when one
  runs out, the app moves work to the next one you list.
- Optional: a Gmail account and a Google Cloud OAuth client, so it can read replies.

## Get started

```bash
git clone https://github.com/Cd1314520/struggle-of-grown-men-in-2026.git
cd struggle-of-grown-men-in-2026
bun install
cp config.local.example.yml config.local.yml
bun run start
```

On Windows, install the tools first with `winget install Oven-sh.Bun`, `winget install Typst.Typst` and
`winget install oschwartz10612.Poppler` (plus Chrome, Git and Node), then run the same commands in
PowerShell, with `copy` in place of `cp`. Linux setup, including running it as a service, is in
[docs/setup.md](docs/setup.md).

Open <http://localhost:8787>. The **Setup** page lists what is still missing and checks each step for you:

1. **Your profile.** The first start copies templates into `profile/`. Fill them in on the **Profile**
   page: what you are looking for (`targets.md`), your scoring checklist (`rubric.yml`), the answers forms
   ask for (`personal.yml`, `answers.md`), and the companies to watch (`companies.yml`).
2. **Your resume.** Upload your resume on the **Resume** page; it is turned into the Typst file the app
   tailors.
3. **Models.** On **Settings → Models**, pick which agent runs each stage. Cheap, fast models work well
   for triage; filling forms needs a capable one.
4. **Gmail** (optional). Follow [docs/setup.md](docs/setup.md#profile-gmail-and-config).
5. **Run the browser check** before the first real application:
   `bun run scripts/browser-audit.ts --mode=smoke` (see [docs/browser.md](docs/browser.md)).

Your profile, resume, `config.local.yml` and everything under `data/` stay on your computer and are never
committed (they are in `.gitignore`).

## Using it

| Page | What it is for |
|---|---|
| Overview | today at a glance: what was found, assessed, sent, and what waits for you |
| Review | jobs waiting for your yes, with the score, the evidence and the tailored resume |
| Questions | questions a form asked that your profile does not answer yet |
| Pipeline / Applications | every job by stage, and what happened after you applied |
| Referrals | people you ask for referrals and where each conversation stands |
| Early outreach | today's short emails to founders and hiring managers, for you to send ([docs/outreach.md](docs/outreach.md)) |
| Settings | models, schedules, daily limits; changes are saved to `config.local.yml` |

A few settings worth knowing, all in `config.yml` (override them in `config.local.yml`):

- `limits.prepPerDay` and `limits.applyPerDay`: how many jobs it assesses and applies to each day.
- `screen.titles` and `screen.terms`: which titles and terms (for example `Summer 2027`) it reads at all.
- `outreach.minutes`: how often Early outreach looks for leads; set it to `0` to turn it off.
- `fallback` and `claudeAccounts`: which models and accounts take over when one hits its usage limit.

## Good to know

- **Agents cost tokens.** Every assessment and every filled form is an agent run on your plan. Start with
  low daily limits and raise them once you see what a day costs on your plan.
- **Read what goes out.** Check the first applications and drafts yourself. The writing rules keep the
  agents to facts in your profile, but you are the one applying.
- **Respect the sites.** LinkedIn and Indeed are searched logged out and slowly; the app does not log in
  to them or get around their limits. Some employers do not allow automated applications: follow their
  terms.

## For developers

`bun run check` runs the type check, the linter, the format check and the tests (a pre-commit hook runs
it on every commit). How the app is built is in [docs/architecture.md](docs/architecture.md), with more
in `docs/`.

## Credits

- **Doomy** ([TheRatLord](https://github.com/TheRatLord)) wrote
  [auto-apply](https://github.com/TheRatLord/auto-apply), the app this is built on: the scanner, the
  rubric scoring, resume tailoring, the form-filling agents, the browser setup and the web UI.
- **[Cd1314520](https://github.com/Cd1314520)** turned it into InternScouter: native Windows support;
  Codex and Antigravity as agent harnesses, with fallback across providers and Claude accounts when one
  hits its usage limit; the internship search (title and term screens, the SimplifyJobs feed, many more
  applicant systems, startup priority); the Referrals and Early outreach pages; cover letter drafts,
  interview prep and the humanizer writing rules.

The writing rules in `prompts/humanizer.md` are adapted from the humanizer skill (MIT, see
`prompts/humanizer.LICENSE`).

## License

[PolyForm Noncommercial 1.0.0](LICENSE). You may use, copy and change InternScouter for personal and
other noncommercial purposes. Commercial use, such as selling it or running it as a paid service, is not
allowed without the authors' permission.
