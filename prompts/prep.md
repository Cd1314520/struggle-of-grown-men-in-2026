# Task: assess one job and tailor the resume

Job #{{id}}: **{{title}}** at **{{company}}** ({{location}})
{{url}}
{{otherListings}}
## Step 1: answer the checklist and practice facts

You do not score this job. Answer each statement below about the posting with `yes`, `no` or `unclear`, and give the short quote or fact that decides it. Judge each statement on its own, literally as written. Use `unclear` only when the posting really does not say; do not guess, and do not let one answer colour another. If the description below is missing or thin, read the posting at the URL first. For statements about the candidate, use `{{main}}` in your working directory.

{{checklist}}

In addition, extract practice evaluation evidence from the posting:
- `annualBaseMaxUsd`: The posted annual base salary ceiling in USD as a number (e.g. `75000`), or `null`.
  - A single fixed annual salary counts as the ceiling (e.g. "$75,000/year" -> `75000`).
  - For salary ranges, extract the highest applicable base salary ceiling even when it exceeds any cutoff (e.g. "$65,000 - $78,000" -> `78000`; "$75,000 - $85,000" -> `85000`). The orchestrator, not you, compares that number with the practice cutoffs.
  - Must be `null` if: only a starting-at or minimum salary is stated without an explicit ceiling; salary is unknown or not posted; currency is non-USD; or hourly/daily/contract rate without an explicit annual ceiling stated in the posting.
  - Base salary only: do not guess or include bonus, equity, or total compensation.
- `salaryEvidence`: Exact quote from the posting showing the salary statement, or empty string `""` if no salary is posted.
- `mandatoryNonlocalOnsite`: `"yes"`, `"no"`, or `"unclear"`.
  - `"yes"`: The posting explicitly mandates onsite or hybrid work outside the Houston/Austin, TX commuting area, with NO acceptable remote or Houston-local alternative.
  - `"no"`: The position is remote, allows remote work, or is located within the Houston/Austin area.
  - `"unclear"`: The posting does not clearly specify remote eligibility or office location requirements.
- `locationEvidence`: Exact quote from the posting regarding work location and onsite/remote requirements (must not be empty if mandatoryNonlocalOnsite is "yes").
- `highEndTech`: `"yes"` or `"no"`. Judge the company and the work, not the pay. It decides the job when no salary ceiling is posted, so always answer it.
  - `"yes"`: a technology or tech-adjacent company (software, AI, cloud, developer tools, fintech, autonomy, robotics, aerospace or defense tech and the like) **and** work that is hard engineering: distributed systems, high scale or low latency, infrastructure and platforms, ML systems or research, or products whose core is the software. These are roles the candidate wants to keep for later.
  - `"no"`: everything else. Internal business applications, corporate IT, integrations, reporting, QA, support or consulting delivery; or an employer whose business is not technology (insurance, banking operations, healthcare providers, government, education, manufacturing, retail), even when the role is a real engineering job.
  - A famous or well-funded tech employer with ordinary-sounding duties is still `"yes"`. An ordinary employer using fashionable words (AI, cloud, scale) for routine work is still `"no"`.
- `highEndTechEvidence`: one sentence naming what about the company and the work decides it. Never empty.

Call `submit_checklist` with an answer for every checklist id and the `practice` evidence object. The orchestrator computes the score from fixed weights and replies either CONTINUE or STOP. On STOP you are finished: do not tailor anything.

## Step 2: tailor the resume

Your working directory holds a copy of the stock resume project. `{{main}}` is the content; any other `.typ` file is the layout template.

- Edit `{{main}}` only. Never change the template files, the contact details, or the layout settings at the top of `{{main}}`.
- Reorder and trim bullets so the most relevant evidence comes first.
- Swap in alternative bullets, projects or skills from the resume notes where they fit this job better. If the notes are empty, work only with what the stock resume says.
- Mirror the job's vocabulary only where it is a true description of what the candidate did.
- Everything on the resume must come from the stock resume or the notes. Do not add or inflate anything.
- Keep the same structure and bullet style, and do not exceed the stock resume's page count. Avoid leaving the page visibly emptier than the stock version.

Then run `typst compile {{main}} {{pdfName}}` and fix any errors. The output must have exactly that filename: no suffixes, versions or company names.

## Step 3: report

Call `finish_prep` with:

- `rationale`: at most two short sentences (under 35 words) the candidate reads on a phone: what the role is, then the single strongest reason they fit. No numeric rating, no restating the checklist.
- `concerns`: at most two short lines, each a real gap or risk about this job the candidate should know before applying (a missing required skill, pay, location, seniority). Empty string if none. Do not flag confirmed low salary or nonlocal onsite requirements as surprise risks or concerns. Never mention the tooling, compilation, PDF warnings or your own process.
- `resume_changes`: up to five short bullets, each one change and why. Do not report that it compiled or how many pages it is.
{{feedback}}
## Resume notes (bank of alternative content and guidance)

{{notes}}

## Job description

{{description}}
