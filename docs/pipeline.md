# From posting to resume

## Sources and scanning

Scans run on their own, every `schedule.scanMinutes` (30 by default). A scan re-reads every board in `companies.yml` plus the remote-job feeds under `feeds:` in `config.yml` (Remotive, Jobicy, RemoteOK; each read no more often than its own `minutes`). Postings already known cost nothing, so agents only run for new ones. A scan also searches LinkedIn and Indeed (`boards:` in `config.yml`: one location, a few queries, newest first), logged out and with no account. Those two only say what is open: a posting that passes triage is looked up on the employer's own site (its public board if the slug can be guessed, otherwise a web-search agent, `models.locate`) and applied to there, and is skipped when the employer has no posting of its own. Discovery (an agent searching the web for more boards) runs every `schedule.discoverMinutes`. Daily caps in `limits` bound what a large scan can trigger.

## Duplicates and employers

One role is one job, wherever it is listed. A new posting is compared with every job already known for the same employer (legal suffixes like Inc/LLC ignored), in `findTwin` in `src/db.ts`:

- same title once normalised: word order, punctuation, abbreviations (Sr, ML, II) and tags like "(Remote)" or a requisition number are ignored;
- or a close title (at least 80% of the words shared) whose description, when both are available, also mostly matches;
- or a related title with a nearly identical description (the same role posted per city).

Titles that differ in level ("Engineer II" vs "Engineer III", "Senior") never match. A duplicate is folded into the existing job, whatever its state, including ones you skipped or rejected: the extra link is kept under the job's Posting tab, and the location list widens until the job has been assessed. If a role first seen on an aggregator later appears on the employer's own board, the job switches to the employer's link. The job lists group roles by employer and show how many you have already applied to there.

## Freshness

Each job keeps the date its posting opened (`posted_at`), taken from the board where it says (Workday and LinkedIn give only the day; Indeed and hand-added postings give none, so the first sighting stands in). `openedAt` in `src/db.ts` turns that into one estimate, which decides the order jobs are assessed in (newest first) and how the lists are laid out: To review and Held are split into Just opened (6 hours), Today, This week and Older, by score inside each. An employer with more than three roles in one part shows its best two and folds the rest.

## Resumes

Every compiled resume, stock or tailored, carries the one name set in `resume.pdfName`, so uploads never carry a version or company suffix. When an application starts, the exact PDF and Typst sources are frozen to `data/jobs/<id>/applied/<sha-prefix>/`, with a `manifest.json` recording their SHA-256 hashes and the full PDF hash stored on the job. Resumption verifies and uploads that same archive, never a newly generated working copy; the job page shows and serves it. Missing or modified archives fail closed. Legacy archives without a manifest require an audit of the original PDF hash and archived sources before sealing, not regeneration. Tailored copies may not exceed the stock page count or modify the template.
