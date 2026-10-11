# LinkedIn job search: technical limits, anti-bot measures and query parameters (desk research, 2026-10-06)

Reader notes:
- No requests were sent to LinkedIn job endpoints; everything below is from third-party code, docs and guides, plus one LinkedIn Help page and one Microsoft Learn page.
- Source quality is uneven. "Practitioner" = open-source scraper code/README. "Vendor" = a company selling a scraping API or proxy (incentive to overstate how hard DIY is). Each finding is labelled.
- Several pages were read through an automated summariser, so quoted fragments are short and should be treated as close paraphrase unless they are code constants.
- The single most repeated number in this whole topic ("429 at about the 10th page from one IP") traces back to one origin, the JobSpy README, and is echoed by vendors. It is not independently measured by any source I found.

## 1. Do the logged-out guest endpoints still work in 2026, what do they return, page size, result cap

### Takeaway
Yes: guides published/updated mid-to-late 2026 and actively maintained scrapers still build on `jobs-guest/jobs/api/seeMoreJobPostings/search` (HTML job cards) and a per-job guest detail fetch. Result cap is ~1000 per query; page size is disputed between sources (10 in JobSpy's constants vs "25" in vendor guides) and must be measured on first run.

### Cited Findings
- JobSpy (practitioner, Python, most widely used OSS scraper) uses base URL `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search` on current `main`, with a loop `while len(job_list) < results_wanted and start < max_results` and `start += jobs_per_page`. — [JobSpy linkedin/__init__.py, main branch, fetched 2026-10-06](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- JobSpy constants: `jobs_per_page = 10`, `max_results = 1000`; it also defines an `empty_page` sentinel (`"<!DOCTYPE html>\n\n<!---->"`) used to recognise a blank response, logged as "LinkedIn: unexpected page with no jobs (blocked?)". — [JobSpy linkedin/constant.py, fetched 2026-10-06](https://raw.githubusercontent.com/speedyapply/JobSpy/main/jobspy/linkedin/constant.py); [__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- JobSpy README: "All the job board endpoints are capped at around 1000 jobs on a given search." — [JobSpy README, fetched 2026-10-06](https://github.com/speedyapply/JobSpy)
- Vendor guide (JobsPipe, published 2026-06-28, modified 2026-09-26) describes the same search endpoint as working with `keywords`, `location`, `start`, no account and no cookies, and says "The `start` parameter pages in increments of 25". Cards yield title, company, location, URL and job ID (from the `data-entity-urn` attribute). — [JobsPipe blog](https://jobspipe.dev/blog/linkedin-job-scraper-python)
- Vendor guide (Linked API, titled "2026", no exact date) gives both endpoints: search `.../jobs-guest/jobs/api/seeMoreJobPostings/search` and detail `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/{jobId}`, says "paginate in steps of 25", and warns fields "silently drop out" and "salary and applicant counts are inconsistent". — [Linked API guide](https://linkedapi.io/guides/linkedin-jobs-scraper.md)
- Conflict on detail URL: JobsPipe writes the detail endpoint as `https://www.linkedin.com/jobs-guest/jobPosting/{job_id}` (no `/jobs/api/`), and says it yields "description, seniority, and employment type". This differs from the Linked API form and is probably a typo in the JobsPipe article, but is unverified. — [JobsPipe blog](https://jobspipe.dev/blog/linkedin-job-scraper-python); contradicted by [Linked API guide](https://linkedapi.io/guides/linkedin-jobs-scraper.md)
- JobSpy does not use the guest `jobPosting` endpoint for details; it fetches the public page `https://www.linkedin.com/jobs/view/{job_id}` and reads the description from `div.show-more-less-html__markup`. — [JobSpy linkedin/__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- jobspy-js (practitioner TypeScript port) lists default search-card fields as: id, title, company_name, company_url, location, date_posted, job_url, compensation, is_remote; a per-job detail fetch adds description, job_level, job_type, company_industry, job_function, job_url_direct, company_logo, emails. — [jobspy-js LinkedIn docs, fetched 2026-10-06](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- ~1000 cap corroborated by a browser-based scraper ("LinkedIn serves up to ~1000"; 25 jobs per page in the regular search UI) and by Apify actor listings ("LinkedIn serves at most 1,000 results per search"; workaround is splitting queries by city/date/job type). — [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper); [Apify actor listing (vendor)](https://apify.com/datalayer/linkedin-jobs-scraper)

### Inferences
- Page-size conflict is likely explained by two different surfaces: the guest `seeMoreJobPostings` fragment (JobSpy steps by 10) versus the logged-in/regular `/jobs/search` UI (25 per page, as in py-linkedin-jobs-scraper). The vendor guides saying "25" for the guest endpoint may be copying the UI number. Implementation should not hard-code either: count the cards returned on the first page and advance `start` by that count.
- For a one-metro, last-24h, junior/mid software query the 1000 cap is very unlikely to bind; it matters only for nationwide or unfiltered queries.
- A blank-but-200 response (JobSpy's `empty_page`) is a distinct outcome from 429 and from "no more results"; the tool should treat it as a possible soft block rather than end-of-results when it occurs at `start=0`.

### Gaps
- I did not verify the endpoints live (by instruction). "Still works" rests on code on JobSpy `main` and on guides dated June-September 2026.
- The exact field list of the guest `jobPosting/{id}` HTML fragment (criteria list: seniority, employment type, job function, industries; applicant count; posted-time text) is not documented by any primary source I fetched; only the partial lists above.
- No source states whether the guest search returns promoted/duplicate cards across pages, although scrapers generally dedupe by job ID.

## 2. Rate limits on the guest endpoints from a single residential IP

### Takeaway
The only concrete number in circulation is "rate-limited (429) around the 10th page from one IP" in a single burst; no source gives requests-per-hour/day thresholds, block duration, or a delay proven to avoid blocks. Treat all thresholds as unknown and discover them empirically with conservative pacing and backoff.

### Cited Findings
- JobSpy README FAQ (practitioner): "LinkedIn is the most restrictive and usually rate limits around the 10th page with one ip. Proxies are a must basically." With JobSpy's page size of 10 this is ~100 results / ~10 search requests per burst. Undated README text, present on `main` 2026-10-06; this wording has been in the README for a long time, so it is not a fresh 2026 measurement. — [JobSpy README](https://github.com/speedyapply/JobSpy)
- JobSpy's built-in pacing between search pages: `delay = 3`, `band_delay = 4`, i.e. `sleep(random.uniform(3, 7))` seconds. The "10th page" block is reported with this pacing in place, so 3-7 s delays alone do not prevent it. — [JobSpy linkedin/__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- jobspy-js docs (practitioner): "LinkedIn typically allows ~10 pages (100 jobs) before blocking"; recommends "Keep `results_wanted` moderate (≤50 per run)"; built-in "3-7 seconds between pages". — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- Vendor echo (Linked API, 2026): you "hit `429 Too Many Requests` after roughly ten pages from one IP". No block duration given. — [Linked API guide](https://linkedapi.io/guides/linkedin-jobs-scraper.md)
- Vendor (JobsPipe, 2026-06-28 / mod. 2026-09-26): "The guest endpoint tolerates a trickle of traffic. Push it and you get `429` responses, then IP blocks." No numbers. Their sample code sends only a `User-Agent` header (`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36`), implying no cookies are needed at low volume. — [JobsPipe blog](https://jobspipe.dev/blog/linkedin-job-scraper-python)
- JobSpy sends a fixed header set (accept, accept-language, Chrome user-agent) via a plain HTTP session; non-200 is reported as "LinkedIn response status code {code}". — [JobSpy linkedin/__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py); [constant.py](https://raw.githubusercontent.com/speedyapply/JobSpy/main/jobspy/linkedin/constant.py)
- Browser-based scraper py-linkedin-jobs-scraper (practitioner) documents its 429 handling: default 0.8 s between jobs (`slow_mo`, minimum 0.2); "on every 429, the delay between jobs doubles, up to `min(10, slow_mo * 10)` seconds"; "After 20 jobs in a row without a 429, the delay shrinks back"; page-level waits escalate "first 5s, then 15s, then 45s". This implies 429s there are short-lived throttles that clear within seconds to under a minute, at least for per-job detail loads. — [py-linkedin-jobs-scraper README, fetched 2026-10-06](https://github.com/spinlud/py-linkedin-jobs-scraper)
- HTTP 999 "Request Denied" is LinkedIn's non-standard catch-all block status; reference sites describe it as a temporary IP block for unusual traffic or "too many HTTP requests in a single day", "sometimes only returned for a limited time", with no duration stated. — [http.dev/999](https://http.dev/999); [Scrapingdog (vendor)](https://www.scrapingdog.com/webscraping-problems/web-scraping-blocked/999-response-when-scraping-linkedin-profile)
- Vendor (Apify actor listings, 2026) treat three signals as block events: 429 (rate limit), 999 (soft ban) and CAPTCHA/challenge pages. One listing suggests `maxRequestsPerMinute` 60-100 across a rotating proxy pool, which says nothing about a single IP. — [Apify actor listing](https://apify.com/exotic_integrity/linkedin-jobs-residential-ips)

### Inferences
- The "~10 pages" figure describes a burst (10 requests in roughly 30-70 s at JobSpy's pacing). It does not tell us the sustained budget. A scan of 3-10 requests every 30 minutes is a far lower rate than the burst that triggers 429 and plausibly sits inside "a trickle", but this is an inference, not a reported result.
- Since 3-7 s delays did not prevent the 10th-page 429, the limiter is probably a sliding-window count per IP rather than a pure spacing check; spreading requests more widely (e.g. 10-30 s apart, with jitter) and capping pages per query is the lever available without proxies.
- Detection tiers to code for, in rising severity: 200 with empty body; 429; 999; redirect to a login/authwall or challenge page. Sensible handling for a single IP is to stop the whole scan on the first 429/999, back off exponentially (starting at minutes, since page-level throttles in one tool clear in 5-45 s but IP-level blocks are of unknown length), and skip the next cycle rather than retry.
- Issuing the requests from the real Chrome over CDP (same TLS/HTTP2 fingerprint and cookies as a human logged-out visitor) removes the header/TLS mismatch that plain HTTP clients have; no fetched source quantifies how much this helps on the guest endpoints.

### Gaps
- No source gives requests per minute/hour/day before 429 or 999 for one residential IP, and none gives a block duration (minutes vs hours vs days). I found no reliable 2025-2026 Reddit/HN thread with measured numbers; searches returned vendor pages instead.
- No source isolates the effect of cookies (e.g. `JSESSIONID`/`bcookie` from a first page load), specific headers, or TLS fingerprint on guest-endpoint blocking. Claims that "TLS fingerprint matters" for LinkedIn guest pages are unverified here.
- Whether detail fetches (`jobPosting/{id}` or `/jobs/view/{id}`) share the same rate bucket as search pages is not stated anywhere I found.
- I could not open individual JobSpy GitHub issues about 429/999; only the README/FAQ statements were retrievable.

## 3. Logged-in job search: commercial use limit, automation detection, safe volumes

### Takeaway
LinkedIn's commercial use limit explicitly does not count job searches, so it is not the constraint; the real risk with a logged-in session is account restriction for automation, for which sources give alarming generalities but no job-search-specific safe volume. A logged-out approach risks only the IP; a logged-in approach risks the account.

### Cited Findings
- LinkedIn Help, "Commercial use limit": counts toward the limit are "Searching for LinkedIn profiles on LinkedIn.com and mobile", "Browsing LinkedIn profiles using the People Also Viewed section", "Viewing member profiles on the People tab of LinkedIn Pages". Explicitly not counted: "Searching profiles by name using the search box", "Browsing your 1st-degree connections", and "Searching for jobs on the Jobs page". "Your free monthly usage resets at midnight PST on the 1st of each calendar month." Page shows last updated "2 years ago" (primary source; older but still the live page on 2026-10-06). — [LinkedIn Help a564226](https://www.linkedin.com/help/linkedin/answer/a564226)
- LinkedIn does not publish the numeric threshold of the commercial use limit on that page. — [LinkedIn Help a564226](https://www.linkedin.com/help/linkedin/answer/a564226)
- Automated extraction violates LinkedIn's User Agreement and tools that automate a logged-in account warn that restriction/ban is possible regardless of safety features. — [auto-li package description (practitioner)](https://pypi.org/project/auto-li/)
- Vendor claim (Zeliq blog, 2026, citing a "Northlight.ai analysis"): "roughly 40% of accounts using non-compliant automation tools received some form of restriction in Q1 2026". This is secondary, about outreach-automation tools (connection requests/messages), not read-only job search; treat as low-confidence marketing. — [Zeliq blog](https://www.zeliq.com/blog/linkedin-automation-2026)
- Vendor description of the risk signals (MindStudio blog): high request rates from one IP, unusual session durations, missing or inconsistent cookies, and headers that do not match a real browser feed a risk score that leads to a challenge or block. Generic, no numbers. — [MindStudio blog](https://www.mindstudio.ai/blog/bypass-browser-automation-blocks-claude-computer-use/)
- Practitioner tooling that does use a logged-in session for jobs: py-linkedin-jobs-scraper supports a signed-in Chrome profile (recommended), a `li_rm` + `bcookie` cookie pair, or the `li_at` session cookie; with a Chrome profile it forces `max_workers` to 1 (single session, serial). — [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)
- jobspy-js uses credentials only as a fallback: "Credentials are only used when anonymous scraping fails" (e.g. on 429). — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)

### Inferences
- Because job search is exempt from the commercial use limit, a person manually running many job searches is normal behaviour; what distinguishes the tool is cadence regularity (every 30 min, 24x7), not volume. If a logged-in session is ever used, irregular intervals and quiet hours would reduce the behavioural signal; this is reasoning, not a sourced threshold.
- The asymmetric downside argues for guest endpoints first and logged-in only for fields unavailable logged-out, mirroring jobspy-js's "anonymous first, credentials as fallback" design.

### Gaps
- No reliable source on whether LinkedIn specifically detects CDP attachment to a real Chrome (e.g. `Runtime.enable` side effects, `navigator.webdriver`) on jobs pages, or what it does when it does. Vendor posts assert sophisticated detection without technical evidence.
- No reported "safe" number of logged-in job searches or job-detail views per day from automation. The numeric "daily limits" published by outreach-tool vendors concern connection requests, messages and profile views, not job search.
- LinkedIn Help's page on prohibited software/automated activity was not fetched; its wording is not quoted here.

## 4. Search parameters and which work on the guest endpoint

### Takeaway
`keywords`, `location`, `distance`, `f_TPR`, `f_AL`, `f_C` and `start` are confirmed in use against the guest endpoint by current scraper code; `f_E`, `f_JT`, `f_WT`, `sortBy` and `geoId` are well documented for the regular jobs URL but their guest-endpoint behaviour is only partly evidenced. `f_TPR` takes arbitrary seconds (`r<seconds>`).

### Cited Findings
- Confirmed sent to the guest endpoint by JobSpy `main`: `keywords`, `location`, `distance`, `start`, and conditionally `f_AL` (`"true"`, Easy Apply), `f_C` (comma-joined numeric company IDs), `f_TPR` computed as `f"r{hours_old * 3600}"`. — [JobSpy linkedin/__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py)
- Current JobSpy explicitly ignores remote and job-type filters for LinkedIn: `for name in ("is_remote", "job_type"): ... log.warning(f"LinkedIn: {name} isn't supported, ignoring it")`. — [JobSpy linkedin/__init__.py, fetched 2026-10-06](https://raw.githubusercontent.com/speedyapply/JobSpy/main/jobspy/linkedin/__init__.py); contradicted by jobspy-js docs, which list `is_remote` and `job_type` (fulltime, parttime, contract, internship, temporary) as supported for LinkedIn on the same guest endpoint — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- `distance`: radius in miles; jobspy-js default is 50. — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- `f_TPR`: seconds with `r` prefix. `r3600` = 1 h, `r7200` = 2 h, `r86400` = 24 h, `r604800` = 7 d, `r2592000` = 30 d; UI offers only 24h/week/month, shorter windows are set by editing the URL. Guides state `r1800` (30 minutes) works. "This URL behavior isn't officially documented by LinkedIn and could change without notice." — [Kondo blog, 2025-10-20](https://www.trykondo.com/blog/linkedin-url-job-hack); [Kaashiv Infotech blog](https://www.kaashivinfotech.com/blog/?p=5759)
- `sortBy`: `DD` = most recent (date descending), `R` = relevance (default). — [Kondo blog, 2025-10-20](https://www.trykondo.com/blog/linkedin-url-job-hack)
- `f_E` experience level: 1 Internship, 2 Entry level, 3 Associate, 4 Mid-Senior, 5 Director, 6 Executive (multi-select by comma). — [mcp-jobsearch scraping guide (practitioner, via search snippet)](https://glama.ai/mcp/servers/@adamd9/mcp-jobsearch/blob/2c861f861b5788f814153ef3ebfbe6f7c1ba6ef6/linkedin_job_search_scraping_guide.md); category names corroborated by [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)
- `f_WT` workplace type: 1 On-site, 2 Remote, 3 Hybrid. — [mcp-jobsearch scraping guide (via search snippet)](https://glama.ai/mcp/servers/@adamd9/mcp-jobsearch/blob/2c861f861b5788f814153ef3ebfbe6f7c1ba6ef6/linkedin_job_search_scraping_guide.md); contradicted by [Kondo blog](https://www.trykondo.com/blog/linkedin-url-job-hack), which labels `f_WT=3` as "Remote" (the 1/2/3 = on-site/remote/hybrid mapping is the commonly cited one; verify in the UI)
- `f_JT` job type: `F` = full-time; categories available are Full-time, Part-time, Temporary, Contract, Internship, Volunteer, Other. — [Kondo blog](https://www.trykondo.com/blog/linkedin-url-job-hack); [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)
- Easy Apply flag conflict: JobSpy sends `f_AL=true` for Easy Apply on the guest endpoint; the Kondo blog instead labels `f_EA=true` as Easy Apply and `f_AL=true` as "Companies actively hiring", and also lists `f_VJ=true` (verified jobs) and `f_JIYN=true` (jobs where you have connections, inherently logged-in). — [JobSpy linkedin/__init__.py](https://github.com/speedyapply/JobSpy/blob/main/jobspy/linkedin/__init__.py); contradicted by [Kondo blog](https://www.trykondo.com/blog/linkedin-url-job-hack)
- `geoId`: numeric LinkedIn geography ID that disambiguates the free-text `location` (example given: `geoId=102026833`). Third-party tools resolve location text through LinkedIn's geo typeahead and match it to a geo ID. — [mcp-jobsearch scraping guide (via search snippet)](https://glama.ai/mcp/servers/@adamd9/mcp-jobsearch/blob/2c861f861b5788f814153ef3ebfbe6f7c1ba6ef6/linkedin_job_search_scraping_guide.md); [HarvestAPI geo-ID search docs (vendor)](https://deepline.com/docs/providers/harvestapi/harvestapi-search-geo-ids.md)
- Other filters visible in scraper docs: salary tiers 40K-200K in 20K steps, and industry via `f_I` (codes obtained by inspecting the URL after applying the filter in the UI). — [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)

### Inferences
- Practical way to get the Houston (or any metro) geoId without an API: run the search once by hand in a browser with the location typed and selected from the dropdown, then read `geoId=` from the resulting URL; store it in config per metro. Both a city-level ID ("Houston, Texas, United States") and a metro-area ID ("Greater Houston") are likely to exist; with `distance=25` or `50` around the city ID, the suburbs would be covered. This procedure is standard practice but is my inference; no fetched source spells it out.
- JobSpy drives the guest endpoint with free-text `location` only (no `geoId`), so `location=Houston, TX` plus `distance` is sufficient to start; `geoId` is an optional precision improvement.
- Since `f_TPR` is confirmed on the guest endpoint and accepts any hour multiple in JobSpy, a 30-minute scan can use `f_TPR=r3600` (or `r7200` for overlap safety) with `sortBy=DD` and dedupe by job ID, keeping each query to 1-2 pages.
- Given the JobSpy vs jobspy-js disagreement on `f_WT`/`f_JT`, and no source confirming `f_E` on the guest endpoint, filter by experience level/job type/workplace client-side as a fallback (the detail fetch exposes seniority and employment type) and test whether the guest endpoint honours the parameters.

### Gaps
- The geoId for Houston, TX (and for Greater Houston / Austin) was not found in any source; a search for a candidate value returned nothing usable. It must be read from the browser URL.
- Allowed `distance` values: the LinkedIn UI offers a fixed set of radii, but no fetched source lists them or says whether arbitrary values are accepted or snapped.
- No source confirms that sub-hour `f_TPR` values (e.g. `r1800`) are honoured on the guest endpoint specifically (the guides describe the logged-in UI URL), nor how accurate the window is for reposted jobs.
- No fetched source directly tests `f_E`, `f_WT`, `f_JT`, `sortBy=DD` or `geoId` on `seeMoreJobPostings`. The mcp-jobsearch guide page itself could not be retrieved in full; its values above come from the search-result snippet.

## 5. How many requests a sensible scan implies; volume of new postings

### Takeaway
No source gives posting volume for junior/mid software roles in Houston, so the request budget can only be bounded by design: a few queries limited to the last 1-2 hours need about one search request each per scan, plus one detail request per new job ID. That is on the order of low hundreds of requests per day, well under the reported ~10-requests-per-burst trigger if spread out, but the sustainable daily ceiling is unmeasured.

### Cited Findings
- Guest search returns 10 cards per request in JobSpy's implementation (25 per vendor guides), so one request covers 10-25 postings. — [JobSpy constant.py](https://raw.githubusercontent.com/speedyapply/JobSpy/main/jobspy/linkedin/constant.py); [Linked API guide](https://linkedapi.io/guides/linkedin-jobs-scraper.md)
- Full description and direct apply URL each require one extra request per job in every scraper examined (JobSpy `fetch_description`; jobspy-js `linkedin_fetch_description`; py-linkedin-jobs-scraper `apply_link`: "scraping is slower because an additional page must be navigated"). — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin); [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)
- Recommended per-run size from a practitioner port: "Keep `results_wanted` moderate (≤50 per run)". — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- Reported burst threshold: ~10 pages from one IP before 429 (see section 2). — [JobSpy README](https://github.com/speedyapply/JobSpy)

### Inferences
- Illustrative budget (assumptions mine, not sourced): 3 keyword queries x 1 page each with `f_TPR=r3600..r7200`, `sortBy=DD` = 3 search requests per scan; 48 scans/day = ~144 search requests/day. If new matching postings are in the tens per day, detail fetches add a similar or smaller number. Total roughly 150-300 requests/day, averaging one request every 5-10 minutes.
- First run / backfill is the risky moment: 3 queries x last 24h x several pages plus dozens of detail fetches could exceed 10 requests in a minute. Backfill should be spread over hours (e.g. one page per scan cycle), and detail fetches queued and drip-fed.
- Adding metros multiplies search requests linearly (queries x metros x 48). At around 5 metros x 3 queries the tool reaches ~15 search requests per scan, i.e. the size of the burst reported to trigger 429, so scans must then be staggered across the 30-minute window rather than run back-to-back.
- Detail fetch count can be cut by filtering on the card first (title keyword/seniority exclusion such as "Senior", "Staff", "Principal") and only fetching details for survivors.

### Gaps
- No source found for the number of new junior/mid backend or full-stack postings per day in Houston on LinkedIn. This should be measured in the first week (count distinct new job IDs per day per query).
- No evidence on whether ~150-300 guest requests/day from one residential IP, sustained for weeks, draws a block.

## 6. External "Apply on company website" URL when logged out

### Takeaway
Sources indicate an offsite apply URL is obtainable from the logged-out per-job page for at least some postings, at the cost of one extra request per job, and it is explicitly "if available" rather than guaranteed. The exact markup and its 2026 reliability are not confirmed by the code I could read.

### Cited Findings
- jobspy-js: `job_url_direct` is returned only when `linkedin_fetch_description: true` and is the "direct application URL, if available"; this is obtained in anonymous (logged-out) mode via a separate fetch per job. — [jobspy-js LinkedIn docs](https://mintlify.wiki/borgius/jobspy-js/job-boards/linkedin)
- py-linkedin-jobs-scraper: optional `apply_link` extraction; "If set to True, scraping is slower because an additional page must be navigated." — [py-linkedin-jobs-scraper README](https://github.com/spinlud/py-linkedin-jobs-scraper)
- Linked API (vendor, 2026) shows `applyUrl` and an `easyApply` boolean in its example job-detail JSON, but that JSON is the output of their account-based product, not the raw guest HTML, so it does not prove the guest endpoint exposes the URL. — [Linked API guide](https://linkedapi.io/guides/linkedin-jobs-scraper.md)
- Current Python JobSpy `main` (as read on 2026-10-06 through a summariser): the LinkedIn module contains no occurrences of `applyUrl`, `job_url_direct` or `?url=`; `job_url` is just `https://www.linkedin.com/jobs/view/{job_id}`. Earlier JobSpy versions advertised `job_url_direct` for LinkedIn, so the direct-URL extraction appears to have been removed or relocated in a refactor. — [JobSpy linkedin/__init__.py](https://raw.githubusercontent.com/speedyapply/JobSpy/main/jobspy/linkedin/__init__.py)
- JobsPipe's 2026 walkthrough of the guest endpoints does not list an apply URL among fields obtainable from guest detail (only description, seniority, employment type). — [JobsPipe blog](https://jobspipe.dev/blog/linkedin-job-scraper-python)
- Some Apify actors advertise "direct apply links" obtained by fetching "the original posting from the company's public job board" (i.e. resolving the job on the employer's ATS rather than reading it from LinkedIn). — [Apify actor listing (vendor)](https://apify.com/dev_web_col/company-jobs)

### Inferences
- The likely mechanism (from my prior knowledge of older JobSpy versions, not verified in today's sources): the logged-out job page embeds a `<code id="applyUrl">` block containing a LinkedIn redirect link whose `url=` query parameter is the URL-encoded external destination; scrapers regex it out and URL-decode it. Easy Apply jobs have no such block. The removal of this code from current JobSpy `main` may mean LinkedIn stopped serving it logged-out, or may be an artefact of the refactor/summariser. This needs a manual check on 3-5 known offsite-apply postings before designing around it.
- Fallbacks if the logged-out page no longer exposes it: (a) open the job in the logged-in real Chrome only for postings the user has shortlisted and capture the Apply button's target (small, human-paced volume); (b) search the employer's ATS/careers site for the same title, as the Apify actor above does.
- The extracted URL usually carries tracking parameters and may be an ATS landing page rather than the application form; expect to follow redirects.

### Gaps
- No 2025-2026 source confirms the precise element/regex for the offsite apply URL on the guest page, nor gives a hit rate (share of non-Easy-Apply postings where it is present).
- Unknown whether the guest `jobPosting/{id}` fragment contains the apply link, or only the full `/jobs/view/{id}` page does.

## 7. Official LinkedIn API or feed for individual job search

### Takeaway
None. LinkedIn's job-related APIs are partner-only Talent Solutions products for posting jobs and handling applications, restricted to approved companies; there is no self-serve job search API or feed for individuals.

### Cited Findings
- Microsoft Learn, Job Posting API overview (ms.date 2025-06-09, page updated 2026-06-03, current version li-lts-2026-04): the API "enables authorized third parties such as clients, ATS systems, and job distributors to post jobs directly to LinkedIn on behalf of customers"; "The use of these APIs is restricted to those developers approved by LinkedIn... you will need to meet certain criteria and sign an API agreement with data restrictions"; and "We are currently not accepting new partnerships for LinkedIn's Job Posting API." It is a posting API; nothing in it searches or reads job listings. — [Microsoft Learn](https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview)
- Secondary summary (vendor): "There is no public, self-serve API that searches or returns LinkedIn's job listings"; talent programs are the Job Posting API, Apply Connect, Apply with LinkedIn, Recruiter System Connect and CRM Connect; partner applications are open only to incorporated companies, not individual developers. — [JobsPipe answer page](https://jobspipe.dev/answers/does-linkedin-have-a-jobs-api)
- A `geoTypeahead` endpoint exists on `api.linkedin.com/v2` (`/v2/geoTypeahead?q=search&query=San`) returning geo URNs, but it sits behind the same OAuth/partner access as other v2 APIs. — [withone.ai LinkedIn connector notes (third-party)](https://www.withone.ai/knowledge/linked-in/conn_mod_def%3A%3AGKRUNvc6TD0%3A%3AkUcn52nSRkqoCXWuK62bpA/md)

### Inferences
- The only first-party, sanctioned "feed" for an individual is LinkedIn's own job alerts (email/app notifications), which are not an API. Parsing alert emails would be a ToS-neutral complement to scraping, but I did not research its latency or coverage.

### Gaps
- I did not fetch the LinkedIn User Agreement or the Help page on prohibited automation to quote the exact clauses; the prohibition on scraping is reported here via secondary sources only (section 3).
