# Indeed job search: technical limits, anti-bot measures, official access routes and query parameters (as of 2026-10-06)

Method notes for the report writer:
- Desk research only; no requests were sent to indeed.com except one fetch of Indeed's public press-release page. Nothing below was verified by live testing against Indeed.
- JobSpy source and issues were read directly from GitHub on 2026-10-06 (raw files and `gh api`), so those items are primary. Web pages were read through a summarising fetch tool, so wording quoted from vendor pages is the tool's extraction and may be paraphrased; numbers should be re-checked at the URL before being quoted verbatim.
- "Vendor" = a company selling scraping/proxy services (incentive to overstate difficulty). "Practitioner" = an individual reporting their own experience.

## 1. Anti-bot on indeed.com web search (`/jobs`) and job pages (`/viewjob`)

### Takeaway
Indeed's web front end sits behind Cloudflare bot management (Turnstile / "Security Check" 403 pages), and plain HTTP clients are the first thing to fail. I found no dated, first-hand report giving a requests-before-challenge number or cool-down time for a real Chrome on a single residential IP; every concrete number found is a vendor rule of thumb.

### Cited Findings
- Vendor (Thunderbit, "last updated April 22, 2026"): Indeed uses Cloudflare Bot Management plus Turnstile (not DataDome/PerimeterX); detection vectors listed are JA3/JA4 TLS fingerprinting, HTTP/2 header ordering, `navigator.webdriver`, WebGL vendor strings and plugin counts — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)
- Vendor rule of thumb (same page, April 2026): 3-6 seconds between requests per IP, and rotate after about 100 requests per IP per session; datacenter proxies 5-15% success, residential 80-95%. These are unsourced vendor figures, not measurements — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)
- Vendor/skill page (browse.sh, undated): bare datacenter IPs get a 403 page titled "Security Check - Indeed.com" with no data; about 20% of `/jobs?` requests return an HTTP 401 "Authenticating..." redirect even on residential sessions, with a suggested recovery of up to 3 retries then a new session. It also says "Cloudflare + Akamai fingerprinting" — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y); Thunderbit names only Cloudflare — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)
- Vendor (ScrapFly, page dated October 5, 2026): Indeed uses Cloudflare protection; "if you receive response status code 403 here, it's likely you are being blocked"; the page data is embedded JSON so a headless browser is not needed for parsing (blocking is a separate matter) — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom)
- Open-source evidence (reported second-hand by Thunderbit, April 2026): the JobFunnel scraper was archived in December 2025, the maintainer saying users "can scrape some jobs, but quickly hit CAPTCHAs, and scraping fails so no jobs are returned" — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)
- Practitioner (GitHub comment, 2025-10-25): "I've been struggling to develop an indeed job scraper, but ended up with lots of cloudflare checks which made it almost impossible", and switched to a paid Apify actor — [JobSpy issue #287](https://github.com/speedyapply/JobSpy/issues/287)
- JobSpy's original author (2025-03-06) on why JobSpy left the web front end: the front-end endpoint "rate limits... it was much more restrictive tho and you will likely need proxies" — [JobSpy issue #229](https://github.com/speedyapply/JobSpy/issues/229)
- Reddit reports summarised by Thunderbit (not read first-hand): consistent 403s, code that worked for months stopping, and "first page loads normally but subsequent pages fail" — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)
- An Apify actor (undated listing) builds in "a residential proxy that rotates IPs and retries on a fresh one when challenged" and does not bill "Cloudflare-challenged runs", i.e. challenges are routine even on residential pools — [Apify dltik/indeed-jobs-scraper](https://apify.com/dltik/indeed-jobs-scraper)
- robots.txt reportedly disallows URLs with `radius`, `start` and `iafilter` parameters, though they still function — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y)

### Inferences
- A plain `fetch`/curl client from Bun will fail on TLS/JS fingerprint regardless of IP quality; the web route is only plausible through the real Chrome over CDP. The sources agree on that direction but none quantifies it for a home IP.
- Vendor residential-proxy figures describe shared, rotating proxy pools with many users per IP; a single home IP with one human-like Chrome profile is a different population and may fare better or worse. No source measured it.
- The "page 1 works, later pages fail" pattern suggests keeping scans to page 1 of a `sort=date` / `fromage=1` query is lower-risk than deep pagination.

### Gaps
- No first-hand 2025-2026 report found with: number of page loads before a Turnstile challenge from one residential IP in real Chrome, how long a challenge/soft-block lasts, or whether solving it manually clears the IP. Searches for these returned only generic Cloudflare articles.
- Reddit and Hacker News threads could not be read directly; Reddit claims above are second-hand via a vendor blog.
- Whether `/viewjob?jk=` pages are challenged at a different rate from `/jobs` search pages: no source.

## 2. Indeed mobile-app GraphQL API (`apis.indeed.com/graphql`, as used by JobSpy)

### Takeaway
It works as of this week: JobSpy's maintainer and a user both confirmed working Indeed runs between 2026-09-29 and 2026-10-03, including from a GitHub Actions datacenter runner, and the Indeed module was patched on 2026-10-06. It returns full descriptions and an external URL in one call at 100 results per request, with a cap of roughly 1,000 per search.

### Cited Findings
- Endpoint and auth: `POST https://apis.indeed.com/graphql` with headers `indeed-api-key` (a key hard-coded in the public source), `indeed-app-info: appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone`, an iPhone "Indeed App 193.1" user agent, and `indeed-co: <country code>`. No account, cookie or login is involved — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py), [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py) (read 2026-10-06)
- JobSpy only accepts a custom user agent if it contains "Indeed App"; otherwise it warns the value "isn't accepted by the site" and uses the default — [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py)
- Page size: `jobs_per_page = 100` (`limit: 100`), cursor pagination via `pageInfo.nextCursor` — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)
- Result cap: "All the job board endpoints are capped at around 1000 jobs on a given search" — [JobSpy README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- Rate limiting: README states "Indeed is the best scraper currently with no rate limiting" (contrast: LinkedIn "usually rate limits around the 10th page with one ip"; Glassdoor "after about 30 requests per ip"). The Indeed module contains no sleep or delay — [JobSpy README](https://github.com/speedyapply/JobSpy/blob/main/README.md), [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py)
- Still working, dated evidence: maintainer 2026-09-30 "Indeed works today" — [issue #287](https://github.com/speedyapply/JobSpy/issues/287); maintainer tested Indeed India 2026-09-29 — [issue #342](https://github.com/speedyapply/JobSpy/issues/342); user on 2026-10-03 fetched "150 results in 2.8 s across two POST /graphql requests" from a GitHub Actions `ubuntu-latest` runner on v1.2.0 — [issue #385](https://github.com/speedyapply/JobSpy/issues/385)
- Repo activity: v1.2.0 prepared 2026-10-02; `fix(indeed): salaries, remote flag, hours_old and job types` merged 2026-10-06 — [PR #403](https://github.com/speedyapply/JobSpy/pull/403)
- Reported failures: a hang on page 2 with v1.1.82 from GitHub Actions (2026-09-10), not reproduced by the maintainer and gone in v1.2.0 — [issue #385](https://github.com/speedyapply/JobSpy/issues/385); a connection error to `apis.indeed.com:443` (2025-06-27), attributed by the maintainer to "proxy, firewall, or Indeed blocking the IP" — [issue #287](https://github.com/speedyapply/JobSpy/issues/287)
- Fields requested by JobSpy's query: `key`, `title`, `sourceEmployerName`, `dateOnIndeed`, `description.html`, `location {countryCode, admin1Code, city}`, `compensation` (employer `baseSalary` and `estimated`, with range min/max, `unitOfWork`, `currencyCode`), `attributes {key, label}` (job type, remote/hybrid), `employer` (name, company page, ratings, dossier with addresses, industry, size, revenue, description, logo, `corporateWebsite`), and `recruit { viewJobUrl }` — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)
- An older version of the query also requested `datePublished`, `source { name }`, `trackingKey`, and fuller location fields (`postalCode`, `streetAddress`, `formatted`) — [issue #221](https://github.com/speedyapply/JobSpy/issues/221) (2024-11)
- Schema discovery is closed: the author said (2024-11-26) the query came "from graphql introspection. they turned it off, so only i have the data cus i saved it" — [issue #221](https://github.com/speedyapply/JobSpy/issues/221)
- Filters available: `date: { field: "dateOnIndeed", start: "<N>h" }` (hours granularity), `location: { where, radius, radiusUnit: MILES }` (default 50), job-type attribute keys (full time `CF3CP`, part time `75GKK`, contract `NJXCK`/`T9BXE`/`T65DZ`, internship `VDTG7`), remote `DSQF7` with hybrid `PAXZC` excluded, and Indeed Apply `indeedApplyScope: ["DESKTOP"]` — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py), [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py)
- Until 2026-09-30 only one filter was actually sent at a time (`hours_old` silently overrode `is_remote` etc.); fixed in [PR #392](https://github.com/speedyapply/JobSpy/pull/392), earlier report in [issue #353](https://github.com/speedyapply/JobSpy/issues/353) (2026-05-05)
- Sort is hard-coded `sort: RELEVANCE` — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)
- Search semantics differ from the website: the API requires every query word to appear in title or description ("its a one to one match"), while the website does fuzzy matching; quotes give exact phrases, `-word` excludes, `OR` groups work — [issue #229](https://github.com/speedyapply/JobSpy/issues/229), [JobSpy README](https://github.com/speedyapply/JobSpy/blob/main/README.md)
- Result counts differ from the website: a user reported the website showing more results than the GraphQL API for the same search (2025-11-26, closed without answer) — [issue #307](https://github.com/speedyapply/JobSpy/issues/307); another saw the API return more than the site — [issue #229](https://github.com/speedyapply/JobSpy/issues/229)
- Conflicting claim: browse.sh says the "`/graphql` endpoint is firewalled (GraphQL API key leaked in HTML is non-functional)" — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y). This refers to a key found in web page HTML, not the mobile-app key JobSpy sends to `apis.indeed.com`, and is contradicted for the app route by the dated JobSpy reports above.

### Inferences
- Because the API call carries no browser fingerprint and JobSpy uses a plain (non-TLS-impersonating) session (`is_tls=False` in the source), this route appears not to be subject to the Cloudflare browser checks that guard the website; it works from a datacenter runner, so a residential IP should be at least as good.
- With 100 results per request and server-side `dateOnIndeed` hour filters, a "last 24h" metro query will usually be a single POST that already contains the description, so no per-job detail fetch is needed.
- The route depends on one shared, hard-coded app key in a public repo; Indeed can revoke it at any time, and it is an unofficial use of a private API. A fallback path should be planned.
- There is no documented date-sorted mode in JobSpy; freshness has to come from the `dateOnIndeed` filter plus client-side sorting.

### Gaps
- No source states a per-IP or per-key request quota for the GraphQL endpoint; "no rate limiting" is the maintainers' experience, not a measured ceiling.
- Whether `recruit.applyUrl` or `directApplyUrl` exist in the schema could not be confirmed; the current JobSpy query uses only `recruit.viewJobUrl`, and introspection is off.
- README says `hours_old` filters on date added to Indeed while `date_posted` is the employer's publish date, but current code sets `date_posted` from `dateOnIndeed` and PR #403 says "`date_posted` is the UTC date it filters on". The README line appears stale; not confirmed by a maintainer statement.

## 3. Official and semi-official routes (Publisher API, RSS, partner APIs, AI-assistant connectors)

### Takeaway
There is no official read API for an individual: the Publisher job-search API is gone, partner APIs are employer/ATS-side only, and the only sanctioned job-seeker route is Indeed's MCP connector for Claude (and its ChatGPT app), which needs an Indeed sign-in and is documented for Claude.ai and Claude Desktop only.

### Cited Findings
- Publisher / Job Search API: described as shut down, with conflicting dates. "Deprecated circa 2020" and "no free public read-only API in 2026" — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python) (April 2026); "Indeed shut down the Publisher API in 2023... keys haven't been minted since 2024", replaced by an iframe-only hosted widget and an NDA-gated enterprise data programme — [jobspipe.dev](https://jobspipe.dev/blog/indeed-publisher-api) (vendor selling an alternative); "`/ita/v1/publisher` deprecated in 2023, returns 404" — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y)
- Job Sync API: "used to create and manage job postings on Indeed"; partners must supply all jobs for all their clients — [docs.indeed.com Job Sync](https://docs.indeed.com/legal-terms/job-sync)
- Disposition Sync API: a GraphQL API that "enables ATS partners to send disposition data" (application status) to Indeed; access is via OAuth credentials issued in the Partner Console after becoming an Indeed partner — [docs.indeed.com Disposition Sync](https://docs.indeed.com/disposition-sync-api), [guide](https://docs.indeed.com/disposition-sync-api/disposition-sync-api-guide)
- Indeed MCP server: a remote MCP server (Streamable HTTP) that lets AI assistants "search and retrieve job listings", get job details and company information, and "provide direct job links"; listed tools are Job Search (title, keywords, location, employment type; returns titles, companies, locations, salaries, application URLs), Job Detail (by job ID), Get Resume (the user's Indeed profile) and Get Company Data; supported clients are Claude.ai and Claude Desktop; an Indeed account sign-in is required; "offered in beta and subject to Indeed's Terms of Service and Privacy Policy"; no rate limits documented — [docs.indeed.com/mcp](https://docs.indeed.com/mcp)
- Claude connector directory listing: server URL `https://mcp.indeed.com/claude/mcp`, tools `search_jobs` and `get_job_details`, sign-in required, launched November 2025, Anthropic-verified — [claude.com/connectors/indeed](https://claude.com/connectors/indeed)
- Indeed App in ChatGPT: announced February 10, 2026; invoked from the Apps menu or `@Indeed`; requires connecting an Indeed profile; "Indeed's website and mobile app remain the primary places to apply" — [Indeed press release](https://www.indeed.com/news/releases/indeed-launches-app-in-chatgpt); later reported as covering more than 50 countries — [IT Brief Australia](https://itbrief.com.au/story/indeed-launches-job-search-app-in-chatgpt-in-australia)

### Inferences
- None of the partner APIs is usable by a job seeker: they push employer data into Indeed and require a partner agreement.
- The MCP server is the only route where Indeed itself hands job data plus "application URLs" to a job seeker's software. Technically it is a standard remote MCP endpoint behind OAuth, so a custom MCP client might connect, but Indeed documents only Claude clients and the endpoint path is Claude-specific (`/claude/mcp`); using it from a headless Bun process is undocumented and may breach the beta terms.
- Search parameters exposed by the MCP tool (title, keywords, location, employment type) do not include a documented recency or radius filter, so it looks weaker than the GraphQL route for a "new in the last 24h" scan.

### Gaps
- RSS (`/rss?q=...&l=...`): no source found, in any year, stating whether the feed still responds. Searches returned only unrelated RSS shutdowns. Status unknown; it was not tested because of the no-automated-requests constraint.
- MCP: rate limits, page size, whether results include full descriptions, whether "application URLs" are external employer links or indeed.com links, country coverage, and whether non-Claude MCP clients are accepted are all undocumented.
- The exact shutdown date of the Publisher API is disputed (2020 vs 2023) and no Indeed-authored statement was found.

## 4. Accounts: is login needed, and does it change limits or risk?

### Takeaway
Search and job pages are readable logged-out according to vendor guides, and the GraphQL route uses no account at all. I found no evidence either way on a forced sign-in after N result pages or on whether a logged-in session is challenged less.

### Cited Findings
- "Login not required for search/job pages" — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom) (page dated October 5, 2026)
- Several commercial scrapers advertise "No Login" operation — [Apify memo23 listing](https://apify.com/memo23/apify-indeed-cheerio)
- About 20% of `/jobs?` requests are reported to return an HTTP 401 "Authenticating..." redirect to a bot-detection login step — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y) (undated, vendor-style source)
- The GraphQL app route sends only an app key and app headers, no user credentials — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)
- The official AI routes do require an Indeed account sign-in — [docs.indeed.com/mcp](https://docs.indeed.com/mcp), [Indeed press release](https://www.indeed.com/news/releases/indeed-launches-app-in-chatgpt)

### Inferences
- The reported 401 "Authenticating..." redirect may be what some users experience as a sign-in wall on deeper pages; this is a guess linking two weakly sourced observations.
- Automating a logged-in session ties scraping to the user's real Indeed account (the one needed for applying), so a block would cost more than a logged-out IP challenge. Keeping scanning logged-out and separate from the account is the lower-risk design; no source quantifies the account-ban risk.

### Gaps
- No source found on: forced sign-in after N pages, whether logged-in sessions get higher limits or fewer challenges, or reports of Indeed accounts being suspended for automated browsing. Two targeted searches returned nothing relevant.

## 5. Search parameters, pagination, dedupe and sponsored duplicates

### Takeaway
The web URL is `https://www.indeed.com/jobs?q=...&l=...` with `radius`, `fromage`, `sort=date`, `start`, `jt`, `explvl` and an encoded `sc` facet string; results page in steps of 10 up to about 1,000, and `jk` (job key) is the dedupe key. Allowed values below come from one undated third-party page and need a manual check in a browser.

### Cited Findings
- Parameter table (third-party, undated) — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y):
  - `q`: free text, boolean operators, quoted phrases, field prefixes such as `title:` and `company:`
  - `l`: city + state, ZIP, "Remote", metro, or blank
  - `radius`: 0, 5, 10, 15, 25, 35, 50, 100 (miles)
  - `fromage`: empty (any), `last`, 1, 3, 7, 14 (days)
  - `jt`: permanent, fulltime, parttime, contract, temporary, new_grad, commission, internship
  - `explvl`: entry_level, mid_level, senior_level
  - `sc`: URL-encoded composite facets (remote, hybrid, education, company, "posted by")
  - `sort`: empty (relevance) or `date`
  - `start`: 0, 10, 20, ... (10 per page)
  - `iafilter=1`: Indeed Apply ("Easily apply") only
- Older Publisher-API documentation (pre-shutdown, historical): `radius` default 25, `fromage` = days back, `jt` in fulltime/parttime/contract/internship/temporary, `sort` relevance or date, `start` from 0, `limit` default 10 — [jobbR docs](https://rdrr.io/github/dashee87/jobbR/man/jobSearch.html)
- Page size and cap: "1,000 results maximum per search (start parameter <= 990)", 10 per page — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python) (April 2026); "15 job listings" per page with `start` offsets of 10 and a 1,000-result cap — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom) (October 2026); "Indeed paginates 10 per page" — [Apify dltik](https://apify.com/dltik/indeed-jobs-scraper)
- Embedded data on search pages: `window.mosaic.providerData["mosaic-provider-jobcards"]` -> `metaData.mosaicProviderJobCardsModel.results[]`, with `jobkey`, `title`, `company`, `formattedLocation`, `pubDate`, `formattedRelativeTime`, `sponsored`, `snippet`, `salarySnippet`, `indeedApplyEnabled`, `thirdPartyApplyUrl` — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom); structure "stable since at least 2023" — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python); alternatively described as `window._initialData` containing `totalJobCount`, `mosaicData` and `dynFiltersViewModel` — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y)
- Job pages: `_initialData` -> `jobInfoWrapperModel.jobInfoModel` with `sanitizedJobDescription` — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom); the same page JSON carries `benefitsModel` and an `expirationDate` key — [JobSpy issue #253](https://github.com/speedyapply/JobSpy/issues/253) (2025-03)
- Dedupe: scrapers dedupe on the job key across pages (JobSpy keeps a `seen` set of `job["key"]`; Apify actor "deduplicated by Indeed's jobkey across all pages") — [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py), [Apify dltik](https://apify.com/dltik/indeed-jobs-scraper)
- Missing job: `/viewjob?jk=` returns 404 with title "Not Found | Indeed" — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y)
- GraphQL equivalents: `what`, `location { where, radius, radiusUnit: MILES }`, `date` filter in hours on `dateOnIndeed`, attribute-key filters, `limit: 100`, cursor — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)

### Inferences
- The 10-versus-15 discrepancy is most likely organic versus displayed cards: `start` advances by 10 organic results while a rendered page shows about 15 cards including sponsored ones. Sponsored cards carry `sponsored: true` in the card JSON and can repeat across pages and queries, so dedupe on `jobkey` and treat the sponsored flag as informational.
- For Houston / Austin, a single centre point with `radius=25` or `35` may cover both; the GraphQL route takes an arbitrary integer radius rather than the fixed web list.
- For a 30-minute scan the GraphQL hour filter (e.g. `start: "24h"` or smaller) is finer than the web's `fromage=1` (whole days) or `fromage=last` (since last visit, cookie-dependent).

### Gaps
- The `sc` encoding for experience level, remote and job type (strings of the form `0kf:attr(...)...;`) was not documented in any source read; values must be captured by applying filters in a browser and copying the URL.
- Whether one posting advertised in several cities gets several job keys (location duplicates), and how often sponsored cards repeat: no source.
- The `radius` and `fromage` allowed-value lists rest on a single undated third-party page.
- Whether `explvl` still works as a standalone parameter in 2026 or has been folded into `sc`: unconfirmed.

## 6. Request volume implied by a sensible scan

### Takeaway
No source gives a safe daily budget for one residential IP; the figures below are arithmetic from the cited page sizes, not reported limits.

### Cited Findings
- GraphQL: 100 results per POST; 150 results took two POSTs and 2.8 s — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py), [issue #385](https://github.com/speedyapply/JobSpy/issues/385)
- GraphQL responses include `description.html`, so no detail request per job is needed — [constant.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/constant.py)
- Web: 10 organic results per `start` step, descriptions only on `/viewjob` pages (search cards carry a `snippet`) — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom)
- Vendor pacing guidance for the web route: 3-6 s between requests, about 100 requests per IP per session — [Thunderbit](https://thunderbit.com/blog/scrape-indeed-with-python)

### Inferences
- GraphQL route: 2-4 keyword queries x 1 POST each (last-24h results for one metro and a junior/mid software query should fit in 100) = 2-4 requests per scan, about 100-200 per day at 48 scans/day, with zero detail fetches. Adding a metro adds another 2-4 per scan.
- Web route: 2-4 queries x 1-2 pages = 2-8 page loads per scan, plus one `/viewjob` load per new posting. At 48 scans/day that is roughly 100-400 search loads per day plus new-posting detail loads (unknown count; likely tens per day for one metro and role family). That is in the range of the vendor's "about 100 requests per IP per session" rule of thumb every day, on a route where practitioners report challenges, so the web route should be the fallback rather than the primary.
- Narrowing the window (e.g. GraphQL `start: "2h"` on each 30-minute scan, with a daily 24h sweep) cuts payload size but not request count.

### Gaps
- Number of new junior/mid software postings per day in Houston / Austin on Indeed: not researched; needed to size detail fetches on the web route.
- No evidence on whether steady low-rate polling every 30 minutes, around the clock, from one IP is itself a flag on either route.

## 7. External "Apply on company site" URL versus Indeed Apply

### Takeaway
The external apply target is available without login in both routes — as `recruit.viewJobUrl` in GraphQL and `thirdPartyApplyUrl` in web card JSON — but on the web it is often an Indeed redirect that needs one more request to resolve. Indeed told investors that fewer than half of jobs are Indeed Apply-enabled; no software-specific share was found.

### Cited Findings
- GraphQL: JobSpy reads `job["recruit"]["viewJobUrl"]` and uses it as `job_url_direct` unless its hostname ends in `.indeed.com`, in which case it is set to `None` — [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py); the indeed.com exclusion was added on 2026-10-06 ("`job_url_direct` no longer holds an indeed.com link") — [PR #403](https://github.com/speedyapply/JobSpy/pull/403)
- GraphQL can filter to Indeed Apply jobs with `indeedApplyScope: ["DESKTOP"]` — [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/indeed/__init__.py)
- Web card JSON exposes `indeedApplyEnabled` and `thirdPartyApplyUrl` — [ScrapFly](https://scrapfly.io/blog/posts/how-to-scrape-indeedcom)
- Commercial scrapers show `thirdPartyApplyUrl` pointing at Indeed's `/applystart` endpoint with a job key, and offer options named `followApplyRedirects` / `resolveApplyUrl` that make an extra request to "follow Indeed's apply redirect and reveal the FINAL external employer/ATS apply URL" — [Apify dltik](https://apify.com/dltik/indeed-jobs-scraper), [Apify memo23](https://apify.com/memo23/apify-indeed)
- Indeed's MCP Job Search tool is documented as returning "application URLs" — [docs.indeed.com/mcp](https://docs.indeed.com/mcp)
- Share of Indeed Apply: "less than 50% of jobs are Indeed Apply-enabled" — [Recruit Holdings FY2023 investor update](https://investorupdate-fy23.recruit-holdings.com/pdf/en/day1/investor_update_fy2023_day1_simplify_hiring_presentation_2_en.pdf) (FY2023, all job categories; taken from a search snippet, PDF not opened)
- Web filter for Indeed Apply only: `iafilter=1` — [browse.sh](https://browse.sh/skills/indeed.com/search-jobs-8yxl6y)

### Inferences
- For a job with a non-Indeed `viewJobUrl`, the GraphQL route gives the employer/ATS URL directly with no redirect hop; when the value is an indeed.com URL the job is either Indeed Apply or Indeed-hosted, and the tool should fall back to `https://www.indeed.com/viewjob?jk=<key>`.
- Resolving `/applystart` or `/rc/clk` redirects means an extra request to indeed.com per job through the Cloudflare-protected front end, which is the costly part of the web route; prefer the GraphQL field.
- Since under half of all Indeed jobs were Indeed Apply in FY2023, a majority of postings should carry an external apply target, but software roles at larger employers (ATS-hosted) probably skew more external than the average. That is a guess.

### Gaps
- No data found on Indeed Apply versus external share specifically for software engineering jobs, or any figure newer than FY2023.
- How often `recruit.viewJobUrl` is a tracking/aggregator link rather than the final ATS URL, and how often it is missing: no source; needs measurement on real results.
- `/rc/clk` behaviour (logged-out redirect, challenge rate) is not described in any source read.
- Existence of `recruit.applyUrl` / `directApplyUrl` fields: unconfirmed (see section 2).
