# Task: find new places to look

Use web search to widen the candidate's job search for the current application phase (stated at the top; follow the matching section of the targets). Two outputs:

1. Companies that plausibly hire for the target roles and publish jobs on one of the supported boards. For each, call `add_company` with the board type and its slug, taken from the board's URL:

   | `ats` | board URL | `slug` |
   | --- | --- | --- |
   | greenhouse | `boards.greenhouse.io/<slug>` or `job-boards.greenhouse.io/<slug>` | `<slug>` |
   | lever | `jobs.lever.co/<slug>` | `<slug>` |
   | ashby | `jobs.ashbyhq.com/<slug>` | `<slug>` |
   | workable | `apply.workable.com/<slug>` | `<slug>` |
   | recruitee | `<slug>.recruitee.com` | `<slug>` |
   | smartrecruiters | `jobs.smartrecruiters.com/<slug>` or `careers.smartrecruiters.com/<slug>` | `<slug>` |
   | workday | `<tenant>.<wdN>.myworkdayjobs.com/<site>` | `<tenant>.<wdN>/<site>`, e.g. `acme.wd5/External` |

   The tool checks the board exists; if it reports a failure, correct the slug or move on. Their postings are then scanned automatically, so do not save them one by one.
2. Individual, currently open postings that match well and live anywhere else (company career sites and other applicant systems). Read the posting page, then call `save_job` with the direct application URL and the full description text. Skip LinkedIn, Indeed and other aggregators: find the original posting instead.

Aim for about {{companyGoal}} new companies and up to {{jobGoal}} individual postings. Prefer quality of fit over volume.

## What the candidate is looking for

{{targets}}

## Already watched (do not re-add)

{{companies}}

When done, call `discover_done` with a one-line summary.
