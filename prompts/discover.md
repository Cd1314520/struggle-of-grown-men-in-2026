# Task: find new places to look

Use web search to widen the candidate's job search. Look for the employers and roles the targets below describe: the real targets, and, in the practice phase, employers the real search rules out where the candidate is still a credible engineer. Two outputs:

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
   | oracle | `<host>.oraclecloud.com/hcmUI/CandidateExperience/en/sites/<site>` | `<host>.oraclecloud.com/<site>`, e.g. `egay.fa.us6.oraclecloud.com/CX_4001` |
   | adp | `workforcenow.adp.com/...recruitment.html?cid=<cid>&ccId=<ccId>` | `<cid>`, or `<cid>/<ccId>` when ccId is not `19000101_000001` |
   | ukg | `<host>/<tenant>/JobBoard/<board id>` (ultipro.com) | `<host>/<tenant>/<board id>` |
   | icims | `<slug>.icims.com/jobs/...` | `<slug>`, e.g. `careers-acme` |
   | eightfold | `<host>.eightfold.ai/careers?domain=<domain>` | `<host>.eightfold.ai/<domain>` |
   | breezy | `<slug>.breezy.hr` | `<slug>` |
   | jazzhr | `<slug>.applytojob.com` | `<slug>` |
   | bamboohr | `<slug>.bamboohr.com/careers` | `<slug>` |
   | lever (EU) | `jobs.eu.lever.co/<slug>` | `eu/<slug>` |
   | clearcompany | `<company>.clearcompany.com/careers` | the site id: the GUID after `siteId=` in the page's careers-content.clearcompany.com script |
   | paycor | `recruitingbypaycor.com/career/...?clientId=<id>` | `<id>` |
   | jibe | `<host>/careers-home/jobs` | `<host>`, e.g. `careers.kindermorgan.com` |
   | taleo | `<host>.taleo.net/careersection/<section>/jobsearch.ftl` | `<host>.taleo.net/<section>/<portal>` when the page searches through `rest/jobboard/searchjobs?portal=<portal>`, otherwise `<host>.taleo.net/<section>` |
   | avature | an Avature search page, e.g. `jobs.siemens-energy.com/en_US/jobs/SearchJobsUS` | that address without `https://` |
   | coveo | `careers.slb.com` (Coveo for Sitecore search) | the host |
   | successfactors | a Career Site Builder site with `/services/rss/job/`, e.g. `careers.phillips66.com` | the host |
   | radancy | a TalentBrew site with `/search-jobs`, e.g. `careers.l3harris.com` | the host |

   The tool checks the board exists; if it reports a failure, correct the slug or move on. Their postings are then scanned automatically, so do not save them one by one.
2. Individual, currently open postings that match well and live anywhere else (company career sites and other applicant systems). Read the posting page, then call `save_job` with the direct application URL and the full description text. A posting saved from one of the boards above puts its board on the watch list too. Skip LinkedIn, Indeed and other aggregators: find the original posting instead.

Aim for about {{companyGoal}} new companies and up to {{jobGoal}} individual postings. Prefer quality of fit over volume.

## What the candidate is looking for

{{targets}}

## Employers the candidate settled by hand

{{employers}}

## Already watched (do not re-add)

{{companies}}

When done, call `discover_done` with a one-line summary.
