# Task: find the employer's own posting for these jobs

Each job below was found on LinkedIn or Indeed. The candidate does not apply there: for each job, use web search to find the same opening on the employer's own careers site or applicant system (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters, Workable, a careers page on the company's domain, and so on).

- Do not open linkedin.com or indeed.com pages: logged out they do not show the employer's link, and the app keeps its own requests to those sites few. Search for the company's careers page and for the title instead, e.g. `"<company>" careers "<title>"`.
- It is the same job when the employer is the same company (check the site belongs to it, not to a namesake), the title matches or is a clear variant, and the location fits. Where the same title is open in several places, take the one for the listed location.
- Open the posting page and read it. Then call `found_posting` with the job id, the posting's direct URL (the page with the description and the apply button, not a search-results or careers home page) and the full description text from that page.
- Other job sites and reposts (Dice, ZipRecruiter, Glassdoor, Built In, SimplyHired, Lensa, recruiter pages) do not count. If the listing company is itself a staffing agency or recruiter, its own site is the employer's site.
- If the company publishes its jobs on one of the boards in the table, also call `add_company` once so the whole board is watched from now on. Its reply lists any postings on that board whose title matches a job in your list, which helps when the board's own pages will not load; for one of those, a short `description` is enough, since the app reads the full text from the board:

  | `ats` | board URL | `slug` |
  | --- | --- | --- |
  | greenhouse | `boards.greenhouse.io/<slug>` or `job-boards.greenhouse.io/<slug>` | `<slug>` |
  | lever | `jobs.lever.co/<slug>` | `<slug>` |
  | ashby | `jobs.ashbyhq.com/<slug>` | `<slug>` |
  | workable | `apply.workable.com/<slug>` | `<slug>` |
  | recruitee | `<slug>.recruitee.com` | `<slug>` |
  | smartrecruiters | `jobs.smartrecruiters.com/<slug>` or `careers.smartrecruiters.com/<slug>` | `<slug>` |
  | workday | `<tenant>.<wdN>.myworkdayjobs.com/<site>` | `<tenant>.<wdN>/<site>`, e.g. `acme.wd5/External` |

- If after a reasonable search (a handful of queries) the opening is not on the employer's site, or you cannot tell which posting it is, call `no_posting` with the job id and a short reason. Do not guess: a wrong posting means an application to the wrong job.

Report every job with exactly one of `found_posting` or `no_posting`, then call `locate_done` with a one-line summary.

## Jobs (id | company | title | location | found on)

{{jobs}}
