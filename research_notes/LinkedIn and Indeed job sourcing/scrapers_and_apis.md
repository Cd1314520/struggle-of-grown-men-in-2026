# Scrapers and APIs for LinkedIn and Indeed job listings (health as of 2026-10-06)

Method note: repo/package metadata below was pulled directly from the GitHub API, PyPI JSON API and npm registry on 2026-10-06. Vendor pricing was read from the vendor page on the same day (through a page-summarising fetch, so re-check a number before paying for anything). "Stars" = GitHub stargazers on 2026-10-06. npm downloads = week of 2026-09-28 to 2026-10-04.

## JobSpy (speedyapply/JobSpy, PyPI python-jobspy): maintenance, which sites work, LinkedIn and Indeed behaviour

### Takeaway
JobSpy came back from an 18-month release gap with v1.2.0 on 2026-10-02 and is being actively fixed this week; Indeed (mobile GraphQL API, no rate limiting noted) and LinkedIn (logged-out guest endpoints, ~10 pages per IP) both work, Google does not. The one hard loss: `job_url_direct` is permanently empty for LinkedIn because LinkedIn stopped exposing the external apply URL to logged-out visitors; Indeed still supplies it.

### Cited Findings
- Repo: Python, MIT, 4,402 stars, 25 open issues+PRs, not archived, last push 2026-10-06T23:06Z — [GitHub API](https://api.github.com/repos/speedyapply/JobSpy)
- Latest PyPI version 1.2.0 uploaded 2026-10-02; requires Python >=3.10. Previous PyPI uploads: 1.1.82 on 2025-07-28, 1.1.80 on 2025-03-30, 1.1.79 on 2025-03-21 — [PyPI JSON](https://pypi.org/pypi/python-jobspy/json)
- GitHub releases: v1.2.0 2026-10-02; the v1.1.80/v1.1.82 GitHub release entries are dated 2026-09-30 (created retroactively; issue #338 "Lack of github release and misnamed version tag" closed 2026-09-30), v1.1.79 2025-03-21 — [Releases](https://github.com/speedyapply/JobSpy/releases)
- Commit burst after a long quiet period: 2026-09-30 "replace tls-client with curl_cffi" (#395), 2026-10-01 fixes restoring Glassdoor, ZipRecruiter, Bayt, Naukri, BDJobs, 2026-10-06 "fix(linkedin): paging, locations, failed job pages and unsupported filters (#404)" and "fix(indeed): salaries, remote flag, hours_old and job types (#403)". The 10-06 commits are after the 1.2.0 release, so they are on `main` only, not yet on PyPI — [Commits](https://github.com/speedyapply/JobSpy/commits/main)
- v1.2.0 release notes (verbatim highlights): "Glassdoor, ZipRecruiter, Bayt, Naukri and BDJobs return jobs again"; "New `fetch_description` flag ... replaces `linkedin_fetch_description`"; "Indeed: filters combine instead of only one being sent"; "One board failing no longer discards the others' jobs: boards log errors instead of raising"; "One 15 s request timeout and no automatic retries"; "`tls-client` replaced by `curl_cffi`"; "Google returns no jobs: Google Jobs now requires JavaScript (#284)"; "Installs on Python 3.13 and 3.14" — [v1.2.0 release](https://github.com/speedyapply/JobSpy/releases/tag/v1.2.0)
- README "Notes", current wording: "Indeed is the best scraper currently with no rate limiting." / "Indeed filters `hours_old` on when a job was added to Indeed, while `date_posted` is when the employer published it, so it can be older." / "All the job board endpoints are capped at around 1000 jobs on a given search." / "LinkedIn is the most restrictive and usually rate limits around the 10th page with one ip. Proxies are a must basically." / "Glassdoor rate limits after about 30 requests per ip, which `fetch_description` reaches quickly." — [README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- README 429 FAQ: "This indicates that you have been blocked by the job board site for sending too many requests. All of the job board sites are aggressive with blocking. We recommend: Wait some time between scrapes (site-dependent). Try using the proxies param to change your IP address." — [README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- Parameters: `distance` "in miles, default 50"; `hours_old` "filters jobs by the number of hours since the job was posted (Glassdoor rounds up to next day.)"; `fetch_description` "fetches each job's page for the description and other details (e.g. job type). Without it these are empty for those boards. Adds one request per job, so use proxies for larger searches"; `linkedin_fetch_description` "deprecated, use fetch_description (still works; removed in 2.0)"; `proxies` round-robin list; `easy_apply`; `offset`; `description_format` markdown/html — [README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- Output schema: title, company, company_url, job_url, location (country/city/state), is_remote, description, job_type, salary interval/min/max/currency/salary_source, date_posted, emails; LinkedIn-specific job_level; LinkedIn+Indeed company_industry; Indeed-specific company_country, company_addresses, company_employees_label, company_revenue_label, company_description, company_logo — [README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- `job_url_direct` on LinkedIn is gone for good. Maintainer kirkwat, 2026-09-30, closing issue #370 ("job_url_direct missing for linkedin", opened 2026-07-01): "LinkedIn no longer includes the external apply URL for logged-out visitors. The job page has no apply link, and clicking Apply only opens a sign-in prompt. Getting it would require scraping with a logged-in LinkedIn session, which we won't do, so job_url_direct stays empty for LinkedIn; #391 removes the parser that looked for it." The reporter also noted "my fallback on the apify also stopped working. Linkedin changed something about their DOM." — [Issue #370](https://github.com/speedyapply/JobSpy/issues/370)
- LinkedIn descriptions: issue #374 "Job Description is empty for linkedin" (2026-07-21) closed as not reproducible; maintainer: "with `linkedin_fetch_description=True`, descriptions come back populated (it's off by default because it adds a request per job)" — [Issue #374](https://github.com/speedyapply/JobSpy/issues/374)
- LinkedIn changes merged 2026-10-06 (PR #404, unreleased): "`is_remote` and `job_type` warn and are no longer sent. The logged-out search ignores both."; "paging stops at the last page and never goes past 1,000 results"; "An empty or throttled page (HTTP 429) is logged. It used to look like the end of the results."; "A job page that fails is logged and the job is kept: 404, 429, 999, and expired jobs that redirect." — [PR #404](https://github.com/speedyapply/JobSpy/pull/404)
- Indeed changes merged 2026-10-06 (PR #403, unreleased): "`hours_old` no longer returns jobs older than the window. `date_posted` is the UTC date it filters on."; "`job_url_direct` no longer holds an indeed.com link"; "`is_remote` is true for remote jobs only"; "`user_agent` is used when it contains `Indeed App`. Other values warn and the default is used." — [PR #403](https://github.com/speedyapply/JobSpy/pull/403)
- Indeed pagination: issue #385 (2026-09-10) reported the request for page 2 hanging past `timeout=10` on GitHub Actions runners with 1.1.82; a commenter notes "Indeed's GraphQL API requests up to 100 results per page (`limit: 100`)" and reports re-testing on v1.2.0; closed 2026-10-03 — [Issue #385](https://github.com/speedyapply/JobSpy/issues/385)
- Google: pinned issue #284 (open since 2025-06-06). Maintainer 2026-10-01: "`site_name=\"google\"` returns no jobs. Google serves its Jobs results only to browsers that run JavaScript ... proxies and different search terms don't change this." Root-cause write-up (2026-07-23) shows `google.com/search?q=...&udm=8` returning an HTTP-200 "enable JavaScript" shell with a `/httpservice/retry/enablejs` noscript redirect — [Issue #284](https://github.com/speedyapply/JobSpy/issues/284); [Issue #302](https://github.com/speedyapply/JobSpy/issues/302)
- 2026 issue themes: no open issue reporting LinkedIn or Indeed search as broken. Open issues are feature requests (Wellfound, RemoteOK, freehire.me, company career sites, async, LinkedIn applicant count) plus the Google outage. A rate-limiting enhancement request (#324, 2026-01-03) was closed and a thread-safe rate limiter PR (#306) is still open, i.e. JobSpy has no built-in pacing/backoff and 1.2.0 explicitly does no automatic retries — [Issues](https://github.com/speedyapply/JobSpy/issues)
- Login/cookies: none used; the maintainers refuse to add logged-in scraping (quote above) — [Issue #370](https://github.com/speedyapply/JobSpy/issues/370)
- Single live sample from the target machine (home residential IP, 2026-10-06): one plain `curl` GET to `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20engineer&location=Austin%2C%20TX&f_TPR=r86400&start=0` returned HTTP 200, 30.8 KB, 10 job cards, no cookies or proxy — [endpoint](https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=software%20engineer&location=Austin%2C%20TX&f_TPR=r86400&start=0)

### Inferences
- For one metro and a few scans per hour, LinkedIn's "~10th page per IP" limit is workable without proxies only if each scan is small: 10 results per guest page (observed) means a first-page-only scan with `hours_old` set is 1 request, but `fetch_description=True` adds one request per job, so 25 new jobs = ~26 requests. Fetch descriptions only for unseen job IDs and space the detail requests.
- The README's "Proxies are a must basically" is written for bulk scraping; nothing in the tracker contradicts low-volume residential use, but nothing guarantees it either. Treat 429 as "back off for the hour", since 1.2.0 will not retry.
- Pin `python-jobspy==1.2.0` or install from `main` for the 10-06 LinkedIn/Indeed fixes (notably correct `hours_old` on Indeed and 429 logging on LinkedIn); a 1.2.1 is likely soon given the commit cadence.
- Invocation from Bun: subprocess. The target box already has `uv` (`/home/user/.local/bin/uv`), Python 3.12.3 and Bun (`/usr/bin/bun`), so `Bun.spawn(["uv","run","--with","python-jobspy==1.2.0","python","scan.py"])` printing JSON to stdout needs no global install. Alternative: the Dockerised HTTP wrapper `rainmanjam/jobspy-api` (below), which is stale.
- Because the release hiatus ran March 2025 to September 2026 with scrapers silently broken in between (Glassdoor, ZipRecruiter, Google), JobSpy's health is maintainer-availability-dependent; design the caller so a board returning zero is distinguishable from an error.

### Gaps
- No primary source quantifies LinkedIn's guest limit in requests per hour or the cool-down after a 429; "around the 10th page" is the only documented figure and is not dated.
- I did not run JobSpy itself, so Indeed's behaviour from this IP is unverified (only the LinkedIn guest search endpoint was probed, once).
- How reliably Indeed populates `job_url_direct` (share of jobs with an employer URL vs. Indeed-hosted apply) is not documented anywhere I found.
- `distance` semantics on LinkedIn guest search (whether the radius is honoured exactly) are not documented beyond "in miles, default 50".

## JS/TS options: JobSpy ports, MCP servers, LinkedIn/Indeed npm packages

### Takeaway
`ts-jobspy` (v3.0.1, 2026-09-17, MIT) is the only native TypeScript library that is both current and login-free for LinkedIn and Indeed; it publishes its own site status (only Indeed and LinkedIn marked working) and a residential-IP benchmark. Everything else is either stale, a one-person 1-star port, a Python wrapper, or now requires a LinkedIn login (spinlud v19).

### Cited Findings
| Package | Version / last publish | Licence | Stars | Weekly dl | Login | Notes |
|---|---|---|---|---|---|---|
| `ts-jobspy` (alpharomercoma/ts-jobspy) | 3.0.1, 2026-09-17 | MIT | 17 | 1,491 | No | Indeed GraphQL + LinkedIn guest API |
| `jobspy-js` (borgius/jobspy-js) | 1.7.0, 2026-03-02 | MIT (npm) | 1 | 52 | Optional "credential fallback" | SDK + CLI + MCP; wreq-js TLS emulation |
| `linkedin-jobs-scraper` (spinlud) | 19.0.2, 2026-09-12 | MIT (npm) | 188 | 161 | **Required** | Puppeteer, Node >=22 |
| `linkedin-jobs-api` (VishwaGauravIn) | 1.0.7, 2025-07-20 | MIT npm / Apache-2.0 repo | 331 | 3,453 | No | Guest search cards only |
| `@atharvh01/linkedin-jobs-api` | 2.1.0, 2026-09-02 | none declared on npm | n/a | 10 | No | Puppeteer-stealth REST backend + SDKs |
| `indeed-scraper` (rynobax) | 3.1.4, 2021-11-20 | MIT | n/a | 42 | No | Dead |
| `indeed-job-scraper` | 4.0.2, 2023-05-12 | MIT | n/a | 8 | No | Dead |
| borgius/jobspy-mcp-server | not on npm; last push 2026-03-13 | none | 117 | n/a | No | Node MCP wrapper around Python JobSpy |
| rainmanjam/jobspy-api | last push 2025-05-29 | MIT | 380 | n/a | No | Dockerised FastAPI wrapper around JobSpy |
| DaKheera47/jobspy-node | last push 2026-02-25 | MIT | 5 | n/a | No | Minor port |

Sources for the table: [npm registry ts-jobspy](https://registry.npmjs.org/ts-jobspy), [jobspy-js](https://registry.npmjs.org/jobspy-js), [linkedin-jobs-scraper](https://registry.npmjs.org/linkedin-jobs-scraper), [linkedin-jobs-api](https://registry.npmjs.org/linkedin-jobs-api), [@atharvh01/linkedin-jobs-api](https://registry.npmjs.org/@atharvh01%2Flinkedin-jobs-api), [indeed-scraper](https://registry.npmjs.org/indeed-scraper), [indeed-job-scraper](https://registry.npmjs.org/indeed-job-scraper); download counts from [npm downloads API](https://api.npmjs.org/downloads/point/last-week/ts-jobspy); stars/push dates from the GitHub API for [alpharomercoma/ts-jobspy](https://github.com/alpharomercoma/ts-jobspy), [borgius/jobspy-js](https://github.com/borgius/jobspy-js), [spinlud/linkedin-jobs-scraper](https://github.com/spinlud/linkedin-jobs-scraper), [VishwaGauravIn/linkedin-jobs-api](https://github.com/VishwaGauravIn/linkedin-jobs-api), [borgius/jobspy-mcp-server](https://github.com/borgius/jobspy-mcp-server), [rainmanjam/jobspy-api](https://github.com/rainmanjam/jobspy-api), [DaKheera47/jobspy-node](https://github.com/DaKheera47/jobspy-node).

- ts-jobspy: "It began as a TypeScript port of python-jobspy. As of v3 it has diverged into its own project with its own API." Requires "Node.js >= 20.18.1 ... (the floor set by the cheerio/undici dependency chain)". Default sites are "the currently working sites (indeed, linkedin)" — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#readme)
- ts-jobspy site status table: Indeed "Working — GraphQL API; fastest scraper (~30 jobs/sec), minimal rate limiting"; LinkedIn "Working — Guest API; rate limits around the 10th page - use proxies for large scrapes"; Google "Blocked — Serves a JS-required interstitial to non-browser clients"; Glassdoor, ZipRecruiter, Bayt "Blocked — TLS fingerprinting"; "Live status is verified daily by a scheduled scrape-health workflow" — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#site-status)
- ts-jobspy benchmark "from a residential IP (2026-08-31, 15 jobs/site)": concurrent ~1067 jobs/min Indeed, ~157 jobs/min LinkedIn, failure rate 0; "LinkedIn's rate is bounded by its own guest-API politeness delays; Indeed's GraphQL API returns 100 jobs per request" — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#readme)
- ts-jobspy result schema includes `id, site, jobUrl, jobUrlDirect, title, company, location, datePosted, jobTypes[], salary fields, isRemote, jobLevel, description, company*` plus `meta.sites[]` with per-site `status` ('ok' | 'empty' | 'partial' | 'error'), `error`, `unsupportedOptions`; "a 429 or block surfaces as `status: 'error'`/`'partial'` with a `RateLimitException` message ... HTTP status codes are not auto-retried"; LinkedIn requests "including per-job description fetches - are jittered"; option `linkedin: { fetchDescription: true }`; `siteConcurrency: 1` for sequential; `hoursOld`, `distance` (miles, default 50) supported on both Indeed and LinkedIn — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#readme)
- ts-jobspy limitations: "Indeed: only ONE of these filter groups per search: hoursOld / jobType & isRemote / easyApply"; "LinkedIn: rate limits at ~10th page; `isRemote` filter is applied inconsistently by LinkedIn's own guest API"; "All boards cap a given search at ~1000 jobs". Fingerprint caveat: "requests send browser-like headers but Node's TLS stack, which sophisticated anti-bot systems can still fingerprint" — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#readme)
- jobspy-js: "TypeScript port of JobSpy ... Uses wreq-js for browser TLS fingerprint emulation (Chrome/Firefox/Safari)"; "3 interfaces — SDK, CLI, MCP server"; Google Jobs via "Playwright (headless Chrome); requires clean residential IP or proxy"; "Credential fallback — optional per-provider login (env vars or CLI flags) when anonymous scraping is blocked"; exports `scrapeJobs`, `fetchLinkedInJob(id)`, `fetchJobDetails(site,id)` — [jobspy-js on npm](https://www.npmjs.com/package/jobspy-js)
- spinlud/linkedin-jobs-scraper v19 dropped anonymous mode: README says "Before your first scrape you need to authenticate once" and "The scraper needs a LinkedIn session" (Chrome profile, `li_rm`+`bcookie` cookie pair, or `li_at` cookie); the August 2026 rewrite issue is titled "implement auth architecture (... delete AnonymousStrategy)". Fields include `applyLink`, `description`, `descriptionHTML`, `isEasyApply`, `applicantCount`, `salary`. Requires Chrome/Chromium and Node >= 22 — [README](https://github.com/spinlud/linkedin-jobs-scraper#readme); [Issue #67](https://github.com/spinlud/linkedin-jobs-scraper/issues/67)
- linkedin-jobs-api (VishwaGauravIn): `query()` "returns an array of Job objects" with position, company, location, date, agoTime, salary, jobUrl (LinkedIn job page URL); no description or apply URL field is documented. Open issue 2026-04-01 "Outdated Axios Version (<= 0.30.2) Causing Unexpected API Behavior"; last commit 2025-07-20 — [README](https://github.com/VishwaGauravIn/linkedin-jobs-api#readme); [Issues](https://github.com/VishwaGauravIn/linkedin-jobs-api/issues)
- @atharvh01/linkedin-jobs-api 2.x is no longer a small library: "a monorepo containing the backend service and multiple SDKs" built on "`puppeteer-extra-plugin-stealth`", with the disclaimer "Some features (like fetching complete individual job descriptions) may have limited data availability compared to a logged-in session" — [npm](https://www.npmjs.com/package/@atharvh01/linkedin-jobs-api)
- borgius/jobspy-mcp-server prerequisites: "Node.js 16+, Python 3.6+, The JobSpy tool installed and available" (it shells out to a JobSpy script or Docker image) — [README](https://github.com/borgius/jobspy-mcp-server#readme)
- npm packages named `jobspy`, `jobspy-ts`, `jobspy-mcp-server` do not exist (registry 404 on 2026-10-06) — [npm registry](https://registry.npmjs.org/jobspy-mcp-server)

### Inferences
- ts-jobspy inherits the same LinkedIn loss: its schema has `jobUrlDirect`, but since LinkedIn removed the external apply link for logged-out visitors (JobSpy #370), expect it populated for Indeed only.
- Bun compatibility: ts-jobspy is pure JS over undici/cheerio with HTTP/SOCKS proxy support, so `import { scrapeJobs } from "ts-jobspy"` should load under Bun, but nothing in the README mentions Bun and undici-dispatcher behaviour under Bun is the likely friction point. jobspy-js depends on `wreq-js`, a native addon, which is a bigger Bun risk. Both need a 5-minute smoke test.
- ts-jobspy has 17 stars and one maintainer; its commit log references AI-driven "adversarial QA" rounds. It is well-documented and has a daily health check, but bus factor is one. A cheap hedge is to keep the Python JobSpy subprocess as a fallback behind the same interface.
- spinlud is the only OSS route that still yields a LinkedIn `applyLink`, precisely because it is logged in, which violates the "no account at risk" requirement.
- `linkedin-jobs-api` has the highest downloads but returns search-card data only and has not been published since July 2025; it is superseded by ts-jobspy for this use.

### Gaps
- No test of ts-jobspy or jobspy-js under Bun was run or found.
- jobspy-js repo has no licence file detected by GitHub (npm metadata says MIT) and no issue history to judge whether LinkedIn/Indeed work in October 2026 (last publish March 2026, before LinkedIn's apply-URL change reported in July 2026).
- ts-jobspy GitHub licence shows as NOASSERTION in the API although README and npm say MIT.

## Other OSS: JobFunnel, linkedin-api, AIHawk, career-ops, newcomers

### Takeaway
None of the other well-known OSS projects is a usable LinkedIn/Indeed listing source in late 2026: JobFunnel is archived, tomquirk/linkedin-api is gone from GitHub, AIHawk's repo has been repurposed, and career-ops (73k stars) deliberately scans ATS boards rather than LinkedIn/Indeed.

### Cited Findings
- PaulMcInnis/JobFunnel: Python, MIT, 2,192 stars, **archived**, last push 2025-12-10 — [GitHub](https://github.com/PaulMcInnis/JobFunnel)
- tomquirk/linkedin-api: `https://github.com/tomquirk/linkedin-api` returned HTTP 404 on 2026-10-06 and the GitHub API returns Not Found; the PyPI package `linkedin-api` is still listed at 2.3.1, last uploaded 2024-11-07, with its homepage pointing at the missing repo — [GitHub URL](https://github.com/tomquirk/linkedin-api); [PyPI JSON](https://pypi.org/pypi/linkedin-api/json)
- feder-cr/Jobs_Applier_AI_Agent_AIHawk now redirects to `feder-cr/invisible_playwright_mcp` (31,779 stars, pushed 2026-10-06), described as "Playwright MCP server undetected by anti-bots and captchas: AI agent browses the web on anti-detect stealth Firefox" — i.e. the repo was renamed/repurposed and is no longer a job-search project — [GitHub](https://github.com/feder-cr/Jobs_Applier_AI_Agent_AIHawk)
- career-ops (now `career-ops-hq/career-ops`; `santifer/career-ops` redirects): JavaScript, MIT, 73,643 stars, 422 open issues, pushed 2026-10-06. Its scanner covers "100+ companies pre-configured ... + custom queries across Ashby, Greenhouse, Lever, Wellfound"; `node scan.mjs` is "zero-token discovery" over ATS feeds with an optional Playwright liveness check (`--verify`). The README's LinkedIn mention is for contact outreach, not listing scraping — [README](https://github.com/career-ops-hq/career-ops#readme)
- spinlud/py-linkedin-jobs-scraper: Python, MIT, 497 stars, 0 open issues, pushed 2026-09-08 (Python sibling of the Puppeteer scraper) — [GitHub](https://github.com/spinlud/py-linkedin-jobs-scraper)
- Newcomers created since 2025 with "linkedin indeed job scraper" keywords: none above 17 stars apart from JobSpy derivatives (GitHub search sorted by stars, 2026-10-06). JobSpy-based downstream projects active in 2026 include qpwm06/QuickApply (45 stars), t0mer/Applyfy, FrameAutomata/job-search-pipeline (JobSpy scraping bridged into career-ops), votrinhan88/jobspy-cli; ports include freeworld/php-jobspy and alexseif/php-jobspy — [GitHub search](https://github.com/search?q=jobspy&type=repositories&s=stars)

### Inferences
- The ecosystem has consolidated on JobSpy (or its ports) for LinkedIn/Indeed and on direct ATS feeds (Greenhouse/Lever/Ashby JSON) for everything else. career-ops' design choice suggests that the dependable way to get employer apply URLs is the ATS feed, with LinkedIn/Indeed used for discovery.
- Whatever happened to tomquirk/linkedin-api, a logged-in Voyager-API client was already the highest ban-risk option; with the repo gone it should not be considered.
- py-linkedin-jobs-scraper presumably follows the same now-authenticated design as the Node package, since the README of the Node package calls it "an equivalent package in python"; I did not confirm its auth requirement separately.

### Gaps
- Why tomquirk/linkedin-api is 404 (deleted, made private, or taken down) is unknown; searches found no DMCA notice or announcement.
- Scrapy-based projects: found no maintained Scrapy project for LinkedIn/Indeed jobs with traction in 2026 (only tutorial-style blog posts).
- No usable Reddit threads (r/webscraping etc.) from 2026 surfaced in search, so community sentiment is not sourced here.

## Aggregated job APIs with free tiers

### Takeaway
Free tiers are small relative to "a few scans per hour" (roughly 1,500-2,200 calls/month): SerpApi gives 250 searches/month, JSearch 200 requests/month, TheirStack 200 API credits/month, Adzuna 250 hits/day (the only one that covers the cadence, but it is Adzuna's own index and personal-research use). These fit as a low-frequency supplement or as an apply-link resolver, not as the primary polling source.

### Cited Findings
| API | Free quota | Paid entry | Approx cost | Employer apply link? | Source |
|---|---|---|---|---|---|
| SerpApi (Google Jobs engine) | 250 searches/mo, 50/hour | Starter $25/mo for 1,000 | $25 per 1,000 searches (10 jobs each = ~$2.50 per 1,000 jobs) | `apply_options[]` in main response | [pricing](https://serpapi.com/pricing), [docs](https://serpapi.com/google-jobs-api) |
| SearchApi (Google Jobs) | 100 requests one-time trial, no card | Developer $40/mo for 10,000 | $4 per 1,000 searches | `apply_link`, `apply_links[]` | [pricing](https://www.searchapi.io/pricing), [docs](https://www.searchapi.io/docs/google-jobs) |
| Serper | 2,500 free queries (one-time) | $50 for 50,000 credits (third-party figure) | ~$1 per 1,000 (third-party) | No Jobs search type listed | [serper.dev](https://serper.dev/), [third-party pricing explainer](https://apiserpent.com/blog/serper-pricing-credits-explained) |
| JSearch (OpenWeb Ninja / RapidAPI) | 200 requests/mo, no card | Pro $25/mo for 10,000; PAYG $0.005/request | $2.50-$5 per 1,000 requests | `job_apply_link`, `apply_options[]`, `job_apply_is_direct` | [openwebninja.com](https://www.openwebninja.com/api/jsearch) |
| Adzuna API | 25/min, 250/day, 1,000/week, 2,500/month | contact for higher limits | free | redirect via Adzuna (see gaps) | [terms](https://developer.adzuna.com/docs/terms_of_service) |
| Jooble API | key by application form; quota not published | n/a | n/a | not documented on the page | [jooble.org/api/about](https://jooble.org/api/about) |
| The Muse | 500 req/hour without key, 3,600 req/hour with key | free | free | landing page on themuse.com (see gaps) | [API v2](https://www.themuse.com/developers/api/v2) |
| USAJobs | free with API key; up to 500 results/page | free | free | `ApplyURI`, `PositionURI` | [API reference](https://developer.usajobs.gov/api-reference/get-api-search) |
| Fantastic.jobs (direct) | 7-day trial: 500 jobs/week, 50 requests/week | Starter $95/mo for 20,000 jobs / 10,000 requests | $4.75 per 1,000 jobs; overage $0.0025/job | "external apply URLs" | [fantastic.jobs/api](https://fantastic.jobs/api) |
| TheirStack | 200 API credits + 50 company credits per month, "free, forever" | $49/mo for 1,500 credits | ~$32.67 per 1,000 | not confirmed | [plans](https://theirstack.com/en/docs/pricing/plans), [pricing](https://theirstack.com/en/pricing) |
| Coresignal | Free trial 2,000 credits; job posting = 1 credit | Mini $49/mo for 2,500 credits | $19.60 per 1,000 records | not checked | [pricing](https://coresignal.com/pricing/) |
| Mantiks | no free tier listed; 3-month "discovery" option | Starter EUR 99/mo (500 credits); API only on Growth EUR 190/mo (1,000 credits) | EUR 190 per 1,000 credits | not checked | [pricing](https://mantiks.io/pricing) |

- SerpApi: "Only successful searches are counted toward your monthly searches. Cached, errored, and failed searches are not." Google Jobs returns "up to 10 results per page", pagination via `next_page_token`; `start`, `chips`, `ltype` are deprecated — [pricing](https://serpapi.com/pricing); [Google Jobs API docs](https://serpapi.com/google-jobs-api)
- JSearch describes itself as "Real-Time Job Postings and Salary Data from LinkedIn, Indeed, Glassdoor, ZipRecruiter, and All Public Job Sites via Google for Jobs"; free tier rate limit 1,000 req/hr; fields include `job_description`, `job_apply_link`, `apply_options`, `job_apply_is_direct` — [openwebninja.com](https://www.openwebninja.com/api/jsearch)
- Adzuna permitted use: "Publishing Adzuna ad listings; Publishing Jobsworth salary estimates; Personal research"; "Default API access limits 25 hits per minute 250 hits per day 1000 hits per week 2500 hits per month"; other organisational use "is permitted subject to a 14 day trial period" — [Adzuna terms](https://developer.adzuna.com/docs/terms_of_service)
- Fantastic.jobs: ATS Jobs API covers "58 ATS platforms"; Job Board API "indexes 10M+ jobs monthly from LinkedIn, Wellfound, and Y Combinator"; "Every ATS is polled hourly for new jobs" with "95% of new jobs within 3 hours of posting"; descriptions in "clean text & HTML" — [fantastic.jobs/api](https://fantastic.jobs/api)
- TheirStack free plan limits searches to "up to 25 results per page, maximum 5 pages"; coverage "career sites, ATSs and job boards ... 352k sources" — [plans](https://theirstack.com/en/docs/pricing/plans); [pricing](https://theirstack.com/en/pricing)
- The Muse: "registration is required for any use beyond testing"; jobs endpoint `GET https://www.themuse.com/api/public/jobs` filters by category, level, location, company — [API v2](https://www.themuse.com/developers/api/v2)
- USAJobs: `Fields=Full` returns complete details in `UserArea.Details`; `ResultsPerPage` "up to 500" — [API reference](https://developer.usajobs.gov/api-reference/get-api-search)

### Inferences
- Adzuna's weekly cap (1,000) is tighter than its daily cap (250 x 7 = 1,750): the sustainable rate is ~142 calls/day, i.e. about 6 per hour, enough for the stated cadence on one metro with one or two queries.
- Budget arithmetic for 3 scans/hour, 24x7 (~2,160 calls/month): JSearch PAYG ~$10.80/month, JSearch Pro $25, SearchApi Developer $40, SerpApi Developer $75 (5,000). Cutting to waking hours or hourly scans puts JSearch PAYG at ~$2-4/month.
- JSearch and the SERP APIs are all Google-for-Jobs-derived: they reach LinkedIn- and Indeed-hosted postings only insofar as Google indexes them, and they return those boards as entries in the apply-options list next to the employer/ATS link. That makes them the cheapest lawful-feeling way to recover an employer apply URL for a LinkedIn posting now that LinkedIn hides it from guests.
- TheirStack, Coresignal and Mantiks are priced for B2B lead-gen/datasets (2-3 cents per job); only TheirStack's 200 free credits are of marginal use to a single user.
- USAJobs and The Muse are free but niche (federal jobs; a curated employer set) and are not LinkedIn/Indeed substitutes.

### Gaps
- RapidAPI listing prices for Fantastic.jobs' "LinkedIn Job Search API" and for JSearch on RapidAPI could not be read (the RapidAPI pricing page renders client-side); only the vendors' own sites are cited.
- Serper: its homepage lists Search, Images, News, Maps, Places, Videos, Shopping, Scholar, Patents, Autocomplete and no Jobs type; per-1,000 price is from a third-party blog, not Serper's page.
- Adzuna response fields (truncated description, `redirect_url` behaviour) were not confirmed from the docs page fetched; my recollection that descriptions are snippets and links go through an Adzuna redirect is unsourced here.
- Jooble quota, cost and field detail are not published on its API page.
- TheirStack credits-per-job and whether a job record carries the employer `final_url` were not confirmed; the pricing page only says "40+ fields per job".
- Freshness SLAs: only Fantastic.jobs publishes one. For Google-derived APIs freshness depends on Google's crawl; no figure found.

## Apify actors for LinkedIn and Indeed

### Takeaway
Apify's $5/month free credit covers a single user's volume on pay-per-result actors (about 5,000 LinkedIn jobs at $1/1,000, or far more Indeed jobs on the $0.07/1,000 actor), with Apify supplying the proxies, so the user's IP and account are not involved. Store metrics look healthy, but vendor claims of a LinkedIn "direct apply URL" conflict with the JobSpy maintainers' July-September 2026 finding and should be tested before relying on them.

### Cited Findings
| Actor | Price | Rating | Users (total / monthly) | Run success | Notes | Source |
|---|---|---|---|---|---|---|
| curious_coder/linkedin-jobs-scraper | $1.00 / 1,000 results (pay per event) | 4.59 | 168,212 / 17,786 | 99.7% | public logged-out search pages; no apply URL listed in fields | [store page](https://apify.com/curious_coder/linkedin-jobs-scraper) |
| bebity/linkedin-jobs-scraper | $1.00 / 1,000 results | 4.31 | 42,298 / 4,197 | 99.9% | "no cookies, no login"; claims full description + "direct apply URL" | [store page](https://apify.com/bebity/linkedin-jobs-scraper) |
| fantastic-jobs/advanced-linkedin-job-search-api | $1.50 / 1,000 jobs | 2.92 | 15,536 / 1,846 | 100% | pre-indexed DB, 1-2 h delay, windows 1h/24h/7d/6-month, max 5,000 per run | [store page](https://apify.com/fantastic-jobs/advanced-linkedin-job-search-api) |
| misceres/indeed-scraper | $3.00 / 1,000 listings | 3.01 | 31,472 / 2,140 | 100% | "externalApplyLink is now always the employer's own apply URL" | [store page](https://apify.com/misceres/indeed-scraper) |
| valig/indeed-jobs-scraper | $0.07 / 1,000 results | 4.73 | 32,881 / 4,087 | 100% | up to 1,000 results per search | [store page](https://apify.com/valig/indeed-jobs-scraper) |
| borderline/indeed-scraper | $5.00 / 1,000 jobs | 4.63 | 26,348 / 2,568 | 98.4% | description text+HTML, direct apply links, Easy Apply flag; "Last updated September 2025" per page summary | [store page](https://apify.com/borderline/indeed-scraper) |

- Apify Free plan: "$5" of monthly platform usage, "no credit card required", $0.2 per compute unit, 5 max concurrent runs, 16 GB max RAM, and only "Limited (trial only)" access to rented actors. Paid: Starter $19/mo, Scale $199/mo, Business $999/mo, each including the same amount in prepaid usage — [apify.com/pricing](https://apify.com/pricing)
- curious_coder notes that "LinkedIn recently transitioned to AI-powered search, discontinuing filters like experience level and job type as separate URL parameters" and that the actor appends discontinued filters to keywords for backward compatibility — [store page](https://apify.com/curious_coder/linkedin-jobs-scraper)
- A JobSpy user reported on 2026-07-01 that after LinkedIn's change "my fallback on the apify also stopped working" for the direct apply URL (actor not named) — [JobSpy issue #370](https://github.com/speedyapply/JobSpy/issues/370)

### Inferences
- All six are pay-per-result/pay-per-event rather than monthly rental, which matters because the free plan only gets trial access to rented actors.
- Polling cost is driven by results returned per run, not runs: an actor that re-returns the same 25 newest jobs three times an hour bills ~54,000 results/month ($54 at $1/1,000). Poll LinkedIn actors with a tight posted-within filter, or use them only on demand. The $0.07/1,000 Indeed actor makes that a non-issue for Indeed (~$4/month even at that rate, inside the free credit).
- curious_coder's corroborating note about LinkedIn search changes matches JobSpy PR #404 (logged-out search ignores `is_remote`/`job_type`), which suggests guest-search filters are generally degraded in 2026 whatever tool is used.
- bebity's "direct apply URL" either comes from a logged-in/alternate source or is stale marketing; given issue #370 it is unverified.
- Invocation from Bun: plain HTTPS (`POST https://api.apify.com/v2/acts/<actor>/run-sync-get-dataset-items?token=...`) or the `apify-client` npm package; no browser or proxy needed locally.

### Gaps
- I did not read individual 2026 user reviews or actor issue tabs; ratings and success rates are store-page aggregates, and misceres' 3.01 and fantastic-jobs' 2.92 ratings were not investigated.
- Last-modified dates were not exposed in the fetched page content for most actors.
- Whether each actor's small per-run "actor start" event fee applies on top of the per-result price was not checked.

## Google Jobs as a route in 2025-2026

### Takeaway
Direct, browserless scraping of Google Jobs has been dead since mid-2025 (JS-required interstitial), but commercial SERP APIs still return Google Jobs results including `apply_options`; SerpApi logged a "New jobs layout" on 2026-03-31 and a string of intermittent-breakage fixes through September 2026, so the route works but is noticeably less stable than in 2024.

### Cited Findings
- JobSpy's Google scraper has returned zero results since about June 2025; root cause is an HTTP-200 "enable JavaScript" shell for `google.com/search?...&udm=8` to non-JS clients, not a CAPTCHA or consent wall — [JobSpy #284](https://github.com/speedyapply/JobSpy/issues/284); [JobSpy #302](https://github.com/speedyapply/JobSpy/issues/302)
- ts-jobspy independently lists Google as "Blocked — Serves a JS-required interstitial to non-browser clients (the jobs data itself is unchanged)" — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#site-status)
- jobspy-js works around it with "Playwright (headless Chrome); requires clean residential IP or proxy" — [jobspy-js on npm](https://www.npmjs.com/package/jobspy-js)
- SerpApi Google Jobs API release notes, 2026: Mar 05 "Fixed: `apply_options` and `description` intermittently not being scraped"; Mar 31 "Other: New jobs layout"; Apr 02 "Job results missing description sporadically"; Apr 06 "Pagination requests returning empty for valid searches"; Jul 14 "Missing job highlights section"; Jul 20 "Standard Google Results Returned Instead of Jobs Results"; Jul 27 "Valid search returning empty intermittently"; Sep 16 "'Verify request' result incorrectly considered as a successful search"; Sep 21 "Degraded Performance". 2025: Jun 03 "Most Searches Return Empty Results" and "Many timeouts"; May 31 "Deprecate `ltype` parameter" — [SerpApi release notes](https://serpapi.com/google-jobs-api/release-notes)
- SerpApi docs state apply options are included in the main search response as an `apply_options` array; "usage of `start` parameter (results offset) has been discontinued by Google"; up to 10 results per page with `next_page_token` — [SerpApi Google Jobs API](https://serpapi.com/google-jobs-api)
- SearchApi's Google Jobs engine returns `apply_link` and `apply_links[]` plus `description`, `sharing_link`, `detected_extensions`; notes that since 2025-04-15 Google redirects country domains to google.com so localisation must use `gl`/`hl` — [SearchApi docs](https://www.searchapi.io/docs/google-jobs)

### Inferences
- `apply_options` is still the best programmatic source of employer/ATS links for a given title+company, but the 2026 fix log (nine entries in seven months, several of them "empty results" class) means callers must treat an empty Google Jobs response as "unknown", not "no jobs".
- At 10 jobs per billed search, Google Jobs is poor value for broad polling on free tiers (SerpApi free = at most 2,500 jobs/month) and better used for targeted lookups: resolve the apply link for a job already discovered on LinkedIn.

### Gaps
- No Google primary source describing the 2025-2026 Jobs UI changes was found; evidence is from scraper maintainers and SERP vendors.
- Whether the SerpApi date-posted filter (`uds`-based) still works after the March 2026 layout change was not confirmed.
- What share of `apply_options` entries are employer/ATS domains vs. other job boards is not documented.

## Bottom line ranking for a single user (near-zero cost, no account at risk, callable from TypeScript)

### Takeaway
Use login-free guest/GraphQL scraping from the home IP as the primary source (ts-jobspy natively, or Python JobSpy 1.2.0 via `uv` subprocess as the reference implementation), and keep a free-tier hosted API as fallback and as the apply-link resolver for LinkedIn. No option restores LinkedIn external apply URLs without either a login or a Google-Jobs-style lookup.

### Cited Findings
- JobSpy 1.2.0 (2026-10-02): free, MIT, no login, Indeed "no rate limiting", LinkedIn "~10th page with one ip" — [README](https://github.com/speedyapply/JobSpy/blob/main/README.md); [PyPI](https://pypi.org/pypi/python-jobspy/json)
- ts-jobspy 3.0.1 (2026-09-17): free, MIT, no login, native TypeScript, Indeed + LinkedIn marked working, zero-failure residential benchmark dated 2026-08-31 — [ts-jobspy README](https://github.com/alpharomercoma/ts-jobspy#readme)
- LinkedIn external apply URL unavailable to logged-out clients since mid-2026 — [JobSpy #370](https://github.com/speedyapply/JobSpy/issues/370)
- Apify free plan $5/month; LinkedIn actors $1/1,000, Indeed actor $0.07/1,000 — [apify.com/pricing](https://apify.com/pricing); [curious_coder actor](https://apify.com/curious_coder/linkedin-jobs-scraper); [valig actor](https://apify.com/valig/indeed-jobs-scraper)
- JSearch free 200 requests/month, PAYG $0.005/request, returns `apply_options` and `job_apply_is_direct` — [openwebninja.com](https://www.openwebninja.com/api/jsearch)
- SerpApi free 250 searches/month with `apply_options` — [pricing](https://serpapi.com/pricing); [docs](https://serpapi.com/google-jobs-api)
- spinlud v19 and tomquirk-style clients need a LinkedIn session — [spinlud README](https://github.com/spinlud/linkedin-jobs-scraper#authentication)

### Inferences
Ranking (my judgement, built on the findings above):

1. **ts-jobspy (native import) for both LinkedIn and Indeed.** Zero cost, no account, `await scrapeJobs({ sites:['indeed','linkedin'], location, distance, hoursOld, linkedin:{fetchDescription:true}, siteConcurrency:1 })`, and its `meta.sites[].status` distinguishes blocked from empty, which is what a poller needs. Risks: one maintainer, 17 stars, Bun untested. Keep per-scan LinkedIn requests low (first page or two, descriptions only for unseen IDs).
2. **Python JobSpy 1.2.0+ via `uv run` subprocess** as the fallback or the primary if ts-jobspy misbehaves under Bun. Largest user base (4.4k stars) and currently the most actively fixed; uses `curl_cffi` browser TLS impersonation, which ts-jobspy lacks. Costs a Python dependency and a JSON-over-stdout contract; no retries or pacing built in, so the caller owns backoff.
3. **Hosted fallback on free credit: Apify pay-per-result actors (HTTP)** when the home IP is throttled, plus **JSearch (200 free requests/month, then $0.005) or SerpApi (250 free/month) for resolving employer apply links** on shortlisted LinkedIn jobs. All plain `fetch` from Bun, no IP or account exposure, and inside free quotas if used on demand rather than for polling.

Additional points:
- Indeed is the easy half: full description in the search response, 100 results per request, employer URL available as `job_url_direct`/`jobUrlDirect`, no documented rate limit. LinkedIn is the constrained half: 10 cards per page, one extra request per description, no apply URL, degraded filters.
- Not recommended: spinlud/linkedin-jobs-scraper and any `li_at`-cookie tool (account at risk), `linkedin-jobs-api` (stale, cards only), `jobspy-js` (1 star, last publish March 2026, native TLS addon), TheirStack/Coresignal/Mantiks (B2B pricing), direct Google Jobs scraping (JS wall).
- Adzuna (250 hits/day free, personal research permitted) is a reasonable no-risk third source for breadth but is not LinkedIn/Indeed data.
- For employer apply URLs at scale, the pattern career-ops uses (query Greenhouse/Lever/Ashby feeds for target companies directly) avoids the LinkedIn problem entirely and costs nothing.

### Gaps
- The ranking rests on documentation and tracker evidence plus one LinkedIn guest request; no end-to-end run of ts-jobspy or JobSpy from this machine was done, and Bun compatibility of ts-jobspy is the first thing to verify.
- No evidence was found on how LinkedIn treats sustained low-rate guest polling from a single residential IP over weeks (soft blocks, auth-wall redirects); all published guidance is about bulk scraping.
- Terms-of-service exposure: both LinkedIn and Indeed prohibit automated access in their user agreements; this note did not research legal risk for personal-use scraping.
