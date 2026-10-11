# Resolving a LinkedIn/Indeed posting to the employer's own careers site / ATS (as of 2026-10-06)

Reading notes for the report writer:
- Desk research only. No ATS endpoint was called live; "works in 2026" means "described as working in a 2026-dated source", not "tested by me".
- Evidence grades used below: **[fetched]** = I opened the page and the claim is on it; **[snippet]** = the claim comes only from a search-result summary of that URL (page not opened, so wording and attribution are less certain).
- Many of the 2026 sources are vendor pages (Apify actor listings, SERP-API vendor blogs, dev.to posts by scraper authors). They are useful for URL patterns but are self-interested and unaudited; hit-rate figures from them are tiny-sample anecdotes.

## 1. Public, unauthenticated ATS endpoints that list a company's jobs given a slug

### Takeaway
Greenhouse, Lever, Ashby, Workable, Recruitee, Personio, BambooHR, Pinpoint, Teamtailor and Workday all have no-auth list endpoints described as working in 2026-dated sources; Workday needs three identifiers (tenant, shard, site) that cannot be guessed and has a hard page size of 20. SmartRecruiters is the one with a reported 2026 policy problem, and iCIMS/Jobvite/Taleo/SuccessFactors/UKG/Paylocity/ADP have no uniform documented public feed that I could confirm.

### Cited Findings

**Greenhouse**
- Official base URL is `https://boards-api.greenhouse.io/v1/boards/{board_token}`; list = `GET /v1/boards/{board_token}/jobs`, single = `GET /v1/boards/{board_token}/jobs/{job_id}`; "Job Board data is publicly available, so authentication is not required for any GET endpoints." `?content=true` adds description, departments, offices. [fetched] — [Greenhouse Job Board API docs](https://docs.greenhouse.io/job-board.html) (note: `developers.greenhouse.io/job-board.html` now 301-redirects to `docs.greenhouse.io`)
- Fields per job include `id` (job post id), `internal_job_id`, `requisition_id`, `updated_at`, `first_published`, `location`, `absolute_url`, `title`, `company_name`, `metadata`. No rate limit is stated in the docs. [fetched] — [Greenhouse Job Board API docs](https://docs.greenhouse.io/job-board.html)
- Greenhouse returns all results in a single response (no pagination); `updated_at` changes whenever the post is edited, so it is not a posting date. [fetched] — [dev.to "Every major ATS has a public job feed", 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)
- Conflict: Fantastic.jobs lists the Greenhouse endpoint as `https://api.greenhouse.io/v1/boards/{clientname}/jobs?content=true` (no `boards-` prefix). The official docs say `boards-api.greenhouse.io`; prefer the official host. [fetched] — [Fantastic.jobs "6 ATS Platforms with Public Job Posting APIs" (undated)](https://fantastic.jobs/article/ats-with-api); contradicted by [Greenhouse docs](https://docs.greenhouse.io/job-board.html)

**Lever**
- `GET https://api.lever.co/v0/postings/{slug}?mode=json`; supports `team`, `department`, `location`, `commitment`, `level`, `skip`, `limit`. [fetched] — [Fantastic.jobs](https://fantastic.jobs/article/ats-with-api)
- Lever dates are epoch milliseconds. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

**Ashby**
- `GET https://api.ashbyhq.com/posting-api/job-board/{clientname}?includeCompensation=true`; no filtering/search; Ashby is the only one of these with structured opt-in salary data. [fetched] — [Fantastic.jobs](https://fantastic.jobs/article/ats-with-api); [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

**Workable**
- Public widget endpoint `GET https://apply.workable.com/api/v1/widget/accounts/{clientname}`; "v3 API available for customers". [fetched] — [Fantastic.jobs](https://fantastic.jobs/article/ats-with-api)
- "Workable's newer endpoint uses an opaque continuation token" for paging (the article does not print the v3 URL). [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

**SmartRecruiters**
- `GET https://api.smartrecruiters.com/v1/companies/{id}/postings`, paged with `limit` and `offset`. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)
- One Apify ATS-feed vendor is reported as stating: "SmartRecruiters was supported until 2026-09-26 and has been removed: SmartRecruiters' API policy limits its public Posting API to customers' own career sites, and its API's robots.txt disallows other crawlers." [snippet — the search summary did not say which of the listed actors this was; I opened `ctriolab/ats-jobs-feed` and it still lists SmartRecruiters as supported, so the statement is from a different listing, most likely one of the others returned] — candidates: [apify.com/bigdavidson/ats-jobs-api](https://apify.com/bigdavidson/ats-jobs-api), [apify.com/tidyfetch/ats-jobs-api](https://apify.com/tidyfetch/ats-jobs-api), [apify.com/plainfeed/ats-job-feed](https://apify.com/plainfeed/ats-job-feed/api); still-supported counterexample [apify.com/ctriolab/ats-jobs-feed](https://apify.com/ctriolab/ats-jobs-feed/api)

**Recruitee / Personio**
- Recruitee: `GET https://{clientname}.recruitee.com/api/offers`. Personio: `GET https://{company}.jobs.personio.de/xml?language=en` (XML; may be `.com` instead of `.de`). [fetched] — [Fantastic.jobs](https://fantastic.jobs/article/ats-with-api)

**BambooHR**
- `GET https://{company}.bamboohr.com/careers/list` returns JSON. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

**Workday**
- List: `POST https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` with body `{"appliedFacets": {}, "limit": 20, "offset": 0, "searchText": ""}` and `Content-Type: application/json`. Detail: `GET https://{tenant}.wd{N}.myworkdayjobs.com/wday/cxs/{tenant}/{site}{externalPath}` with `Accept: application/json`. [fetched] — [dev.to "Workday job boards have a JSON API too", 11 Aug 2026, edited 24 Aug 2026](https://dev.to/udaninn/workday-job-boards-have-a-json-api-too-its-just-better-hidden-23fl)
- `limit` above 20 returns zero rows with no error; `postedOn` is a display string ("Posted Today"), real date is `startDate` on the detail endpoint; detail also returns `jobReqId`, `jobDescription` (HTML), `timeType`, `country`, `additionalLocations`; list returns `title`, `externalPath`, `locationsText`, `postedOn`, `bulletFields`. [fetched] — [dev.to Workday, Aug 2026](https://dev.to/udaninn/workday-job-boards-have-a-json-api-too-its-just-better-hidden-23fl)
- Conflict on over-limit behaviour: another source says "Ask for 50 and you get a 400, not a truncated page." [snippet] — [fetchsmith.com Workday article](https://fetchsmith.com/blog/workday-career-site-json-api) vs. the empty-array account above and in [dev.to "Ask Workday's public API for 100 jobs and you get zero"](https://dev.to/juancarlosguti/ask-workdays-public-api-for-100-jobs-and-you-get-zero-with-no-error-54b2). Either way: always send `limit: 20`.
- Deep paging has a ceiling: reported as a 2,000-job cap on what the board reports/returns, and on large tenants results stop after offset ~10,000. [snippet] — [dev.to "the 2,000-job ceiling"](https://dev.to/dododata/scraping-workday-career-sites-without-a-browser-and-the-2000-job-ceiling-h2e); [dev.to "Target has 12,525"](https://dev.to/glitchbound/workday-says-the-board-has-2000-jobs-target-has-12525-reading-the-rest-7c9). Irrelevant when using `searchText` to look for one title.
- Rate limiting: "Workday's edge appears to rate-limit by source IP across all tenants combined, not per tenant"; a 429 on one tenant reflects total volume across tenants. [snippet] — one of [fetchsmith.com](https://fetchsmith.com/blog/workday-career-site-json-api) / [cleanjobdata.com](https://cleanjobdata.com/articles/how-to-scrape-workday-job-listings) (exact page not confirmed)
- The three URL parts "cannot be guessed"; "every Workday job link contains all three", e.g. `https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/...`. [fetched] — [dev.to Workday, Aug 2026](https://dev.to/udaninn/workday-job-boards-have-a-json-api-too-its-just-better-hidden-23fl)

**Pinpoint, Teamtailor, Rippling, Breezy, JazzHR, iCIMS, Jobvite** (all [snippet] unless noted)
- Pinpoint: documented `https://{company-subdomain}.pinpointhq.com/postings.json` with filters `department_id`, `location_id`, `division_id`, `location_city_state_name`. — [Pinpoint developer docs](https://developers.pinpointhq.com/docs/jobs-json-endpoint)
- Teamtailor: append `.rss` to the careers site jobs page, e.g. `https://career.teamtailor.com/jobs.rss`; first 100 jobs by default, `offset` / `per_page` parameters. — [Teamtailor support: RSS feed how-to](https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide)
- Rippling: board pages at `https://ats.rippling.com/{slug}/jobs`; vendors describe public board endpoints but the search summary did not give an exact JSON API path. — [Apify Rippling scraper](https://apify.com/automation-lab/rippling-ats-jobs-scraper); board URL form also on [apify.com/ctriolab/ats-jobs-feed](https://apify.com/ctriolab/ats-jobs-feed/api) [fetched]
- Breezy: "does not have a public API to retrieve jobs" (official API needs a token: `GET v3/company/{company_id}/positions`), but a board-level JSON endpoint with `verbose=true` is described as returning all active jobs; board host form is `{company}.breezy.hr`. Exact JSON path not captured. — [fantastic.jobs/ats/breezy](https://fantastic.jobs/ats/breezy); [jobo.world/ats/breezy](https://jobo.world/ats/breezy)
- JazzHR: hosted careers pages at `https://{company}.applytojob.com`; only HTML scraping described. — [JazzHR help](https://help.jazzhr.com/s/article/Integrate-JazzHR-with-your-Career-Page-Website)
- iCIMS: "Many iCIMS and Jibe career sites expose a public /api/jobs endpoint that powers the search page" (many, not all; per-site). — [Apify iCIMS scraper](https://apify.com/jupri/icims-scraper)
- Jobvite: scrapers target the standard `jobs.jobvite.com/{company}/search` HTML layout. — [Apify Jobvite scraper](https://apify.com/benthepythondev/jobvite-jobs-scraper)

**Cross-cutting**
- An open-source aggregator runs per-platform concurrency "tuned per platform to respect each one's rate limits": Workday 50 workers, Greenhouse/Lever/iCIMS 30, BambooHR 10, Ashby and Paylocity 5. This implies Ashby, Paylocity and BambooHR are the touchiest at bulk volume. [fetched] — [Feashliaa/job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator)
- Location fields are largely unstructured across ATSs ("Remote - US", "EMEA", empty strings); compensation mostly lives in description text. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

### Inferences
- At tens to low hundreds of single-company lookups per day from one home IP, none of the reported limits (Workday cross-tenant 429s, the low Ashby/Paylocity concurrency) should bind; the reported problems are from bulk crawlers.
- For Workday, use `searchText` = job title with `limit: 20` rather than paging the whole board; then call the detail endpoint to get `jobReqId` and `startDate`.
- SmartRecruiters should be treated as "works technically, terms unfavourable": for a single-user tool the practical approach is to link to `jobs.smartrecruiters.com/{Company}/...` found via search rather than depend on the API.

### Gaps
- Not verified live: any endpoint. In particular I did not confirm the user-supplied `apply.workable.com/api/v3/accounts/{slug}/jobs` (sources only confirm the `v1/widget` path and say v3 exists), the Rippling JSON path, the Breezy JSON path, or `job-boards.greenhouse.io` behaviour (no source found discussing it).
- No documented uniform public list endpoint found for Taleo/Oracle Recruiting Cloud, SuccessFactors, UKG, Paylocity, ADP, Gem, Jobvite or iCIMS; Paylocity and iCIMS are scraped by the Feashliaa project but its README does not print URL patterns.
- No vendor-published numeric rate limits found for any of these public endpoints.
- The SmartRecruiters "removed 2026-09-26" statement is second-hand and from a single vendor; I did not read SmartRecruiters' own API policy.

## 2. Slug discovery from a company name / domain

### Takeaway
The documented working recipe is a cascade: guess slugs from the domain label and probe each ATS, then fall back to parsing the homepage and `/careers` / `/jobs` pages for ATS links, and verify that the board actually belongs to the company. Published hit rates are anecdotal (one vendor: 10 of 13 domains), and Workday cannot be guessed at all, only extracted from a job URL.

### Cited Findings
- One actor's resolution pathways: (1) parse homepage for ATS links, (2) follow homepage links to the careers page, (3) probe `/careers` and `/jobs`, (4) infer careers subdomains (e.g. `jobs.channable.com`), (5) derive the slug from the domain label, (6) accept user-supplied slug or board URL. Probe order: Greenhouse, Lever, Ashby, Recruitee, SmartRecruiters, Personio. [fetched] — [Apify fayoussef/company-domain-to-job-postings](https://apify.com/fayoussef/company-domain-to-job-postings)
- Wrong-company collisions are handled by ownership verification: the board must mention the company's own domain ("Correct boards mentioned the domain between 32 and 840 times, and wrong boards mentioned it zero times") or the board's company name must contain the domain label; otherwise the result is flagged `-unconfirmed`. [fetched] — [same](https://apify.com/fayoussef/company-domain-to-job-postings)
- Reported result: "Testing across 13 domains spanning all six platforms yielded: 10 resolved and every one was correct"; the three unresolved had no supported board. Vendor self-report, n=13. [fetched] — [same](https://apify.com/fayoussef/company-domain-to-job-postings)
- Limitation: "A careers page that renders its board purely in JavaScript will not resolve" with HTTP-only fetching. [fetched] — [same](https://apify.com/fayoussef/company-domain-to-job-postings)
- Other detectors add browser network signals (Greenhouse/Lever client-side API calls fired by the page) and embedded links to the hosted board; "Many companies fully proxy their ATS server-side with no client-visible signal", so `platform: null` is a legitimate outcome; "a company whose board slug is unrelated to its name and whose website does not link to the board will not be found." [snippet] — [Apify vellumlabs/ats-job-board-finder](https://apify.com/vellumlabs/ats-job-board-finder); [Apify qualifyops/ats-board-detector](https://apify.com/qualifyops/ats-board-detector)
- Tenant discovery in practice: observe career page URLs (e.g. `boards.greenhouse.io/{token}`), crawl sitemaps, and monitor ATS migrations. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)
- Workday tenant/shard/site must be lifted from an existing job link. [fetched] — [dev.to Workday, Aug 2026](https://dev.to/udaninn/workday-job-boards-have-a-json-api-too-its-just-better-hidden-23fl)
- SerpApi notes that the ordinary Google Search API with a `site:` operator can return direct links to pages where you can apply. [snippet] — [SerpApi blog: Google Jobs search query operators](https://serpapi.com/blog/google-jobs-search-query-operators/)

### Inferences
- Because the tool already has an LLM agent with web search, the cheapest robust order is: (a) local slug cache / open slug list lookup, (b) normalised-name probes on Greenhouse/Lever/Ashby (three GETs), (c) fetch company `/careers` and regex for known ATS hostnames, (d) search query `"Company" "Job Title" (site:greenhouse.io OR site:lever.co OR site:ashbyhq.com OR site:myworkdayjobs.com ...)`, (e) headless browser on the careers page watching network requests. Step (d) is the only one that yields Workday identifiers without rendering.
- Always run an ownership check after a slug probe (company name on board vs. LinkedIn company name, or the board's apply URLs/description mentioning the company domain); short generic slugs are the collision risk.
- Cache every resolved (company → ATS, slug/tenant/site) permanently; resolution cost is per company, not per job.

### Gaps
- No independent, large-sample hit-rate study for name-to-slug guessing or `site:` search resolution was found; the only number is a vendor's 10/13.
- No source gave a tested list of slug normalisation variants (lowercase, strip punctuation/legal suffix, hyphen vs. none, `inc`/`hq`/`labs` suffixes); that is practitioner folklore I could not cite.
- No data on how often `site:` queries on Brave/Serper actually index a given fresh ATS posting.

## 3. Open datasets and projects mapping companies to ATS boards / aggregating ATS postings

### Takeaway
There are open slug lists large enough to seed a local company→ATS cache (about 95,000 identifiers in one Common Crawl-derived repo, non-commercial licence), plus paid ATS-direct feeds (Fantastic.jobs from $95/month; TheirStack with a small free tier). These could replace LinkedIn/Indeed discovery for companies on mainstream ATSs.

### Cited Findings
- **Feashliaa/job-board-aggregator**: indexes "1,000,000+ active positions from 20,000+ companies" across Greenhouse, Lever, Ashby, Workday and others with daily refresh via GitHub Actions; a separate harvester "scans CDX archives for URLs matching 20+ ATS domain patterns, extracts company slugs via regex, and deduplicates across multiple crawl snapshots", yielding about 95,000 unique company identifiers. Platforms scraped: Workday, Greenhouse, Lever, iCIMS, BambooHR, Ashby, Paylocity. Company lists in `data/` are CC BY-NC 4.0; code is MIT; job data chunks (`*.json.gz`) are force-pushed to a separate data repo. [fetched; headline numbers from repo description] — [github.com/Feashliaa/job-board-aggregator](https://github.com/Feashliaa/job-board-aggregator)
- **ConorsCode/open-jobs-data**: described as "a free, daily-updated dataset of open engineering jobs across nine ATS platforms". [snippet; repo not opened, URL inferred from owner/name] — [github.com/ConorsCode/open-jobs-data](https://github.com/ConorsCode/open-jobs-data)
- **Manojkaipu/job-poller**: polls 171 companies' boards across 18 ATSs (including Workday, Oracle, Eightfold) every 4 hours; a small curated company→ATS mapping with adapters for the harder ATSs. [snippet] — [github.com/Manojkaipu/job-poller](https://github.com/Manojkaipu/job-poller)
- Other open adapters to read for endpoint code: [udaninn/career-page-job-monitor](https://github.com/udaninn/career-page-job-monitor) (Greenhouse, Lever, Ashby, Workable, Recruitee, SmartRecruiters; "no proxy, no API key"), [clearfetch/ats-jobs-scraper](https://github.com/clearfetch/ats-jobs-scraper) (adds Workday, Personio). [snippet]
- **Hiring.cafe**: third-party scraper listings describe it as aggregating "2.8M+ postings from 46 ATS platforms" (Greenhouse, Lever, Workable, Workday, BambooHR, SuccessFactors, company career pages); records expose the original apply URL "when exposed" and a source-ATS field. Access by third parties is via its internal (undocumented) API; at least one such scraper is marked DEPRECATED. [snippet; figures are from scraper vendors, not Hiring.cafe] — [Apify blackfalcondata/hiringcafe-scraper](https://apify.com/blackfalcondata/hiringcafe-scraper); [Apify automation-lab (deprecated)](https://apify.com/automation-lab/hiring-cafe-jobs-scraper)
- **Fantastic.jobs** (career-site/ATS feed): 7-day free trial (500 jobs/week, 50 API requests/week), then $95/month for 20,000 jobs, $175 for 50,000, $250 for 100,000, $500 for 250,000, $900 for 500,000; marketed as "over 14 million jobs per month". [snippet; the summary also said "$95 to $750", an internal inconsistency on the top tier] — [fantastic.jobs/api](https://fantastic.jobs/api); [Apify fantastic-jobs/career-site-job-listing-api](https://apify.com/fantastic-jobs/career-site-job-listing-api)
- **TheirStack**: free plan with 50 company credits and 200 API credits per month. [snippet] — [theirstack.com pricing](https://theirstack.com/en/pricing)
- **SimplifyJobs/New-Grad-Positions** (and the Summer internships repo): community/Simplify-maintained lists of new-grad SWE/quant/PM roles, updated daily. [snippet; my fetch of the repo page returned no README content] — [github.com/SimplifyJobs/New-Grad-Positions](https://github.com/SimplifyJobs/New-Grad-Positions)
- Aggregator freshness caveat: "An indexed job is not an open job"; mirrors served three-week-old closed positions. [fetched] — [dev.to dedup article, 6 Oct 2026](https://dev.to/imapphelp/my-job-search-api-returned-the-same-job-five-times-the-apply-url-gave-away-the-dedup-key-1fj2)

### Inferences
- For a personal tool, CC BY-NC slug lists are usable as a lookup table; the Feashliaa list is the best single seed found for company→(ATS, slug), including Workday tenants that cannot be guessed.
- A Common Crawl CDX query for `boards.greenhouse.io/*`, `jobs.lever.co/*`, `jobs.ashbyhq.com/*`, `*.myworkdayjobs.com/*` is reproducible by the user if the licence or staleness of a third-party list is a concern.
- Hiring.cafe has no supported public API; depending on its internal API is fragile (one scraper already deprecated).

### Gaps
- Not researched within budget: Levels.fyi jobs, Jobright sourcing, HN "Who is hiring" parsers, any official `jobs.ashbyhq.com` directory. No findings to report.
- SimplifyJobs data file location/fields/licence (commonly cited as `.github/scripts/listings.json`) not confirmed.
- Per-ATS slug counts and last-refresh date of the Feashliaa lists were not on the README.
- Fantastic.jobs top-tier price is inconsistent in the summary I saw; check the pricing page.

## 4. Search APIs for the "google the job" step (2026)

### Takeaway
Google's own Custom Search JSON API is closed to new customers and ends 1 January 2027, and Bing's Search APIs were retired 11 August 2025, so the practical choices are Brave (about 1,000 free queries/month, card and attribution required), Serper.dev (2,500 free then $1/1k), SerpApi (250 free/month, also has Google Jobs), Tavily and Exa. At this tool's volume all are effectively free or a few dollars a month.

### Cited Findings
- Google: "The Custom Search JSON API is closed to new customers." "Existing Custom Search JSON API customers have until January 1, 2027 to transition to an alternative solution." 100 free queries/day, then $5 per 1,000 up to 10k/day; "Vertex AI Search is a favorable alternative for searching up to 50 domains." [fetched] — [Google Custom Search JSON API overview](https://developers.google.com/custom-search/v1/overview)
- Bing: Microsoft retired the Bing Search APIs on 11 August 2025; the official replacement, Grounding with Bing Search inside Azure AI Agent Service, returns grounded model output with citations rather than a parsed SERP, so it is not a drop-in. [snippet] — [ppc.land](https://ppc.land/microsoft-ends-bing-search-apis-on-august-11-alternative-costs-40-483-more/)
- Brave: from 12 February 2026 the free plan of 2,000 queries/month was replaced by $5 of free credit per month; Search is $5 per 1,000 requests (so about 1,000 free); credit card required; attribution on the project's website required to use the free credit; unused credit does not roll over; storing API results is prohibited by terms; stated rate limit 50 queries/second. [fetched, third-party tracker, not Brave's own page] — [agentdeals.dev Brave Search API](https://agentdeals.dev/vendor/brave-search-api)
- Serper.dev: 2,500 free queries without a card; credit packs from $50 for 50,000 ($1.00/1k) down to $0.30/1k at the largest pack. [snippet] — [serp.fast Serper pricing](https://serp.fast/tools/serper-dev); [apiserpent.com on Serper credit expiry](https://apiserpent.com/blog/serper-pricing-credits-explained)
- SerpApi: free 250 searches/month; $25/month for 1,000; $75 for 5,000; $150 for 15,000; $275 for 30,000. [snippet] — [scrappa.co SerpApi pricing 2026](https://scrappa.co/post/serpapi-alternative-2026); [apiserpent.com](https://apiserpent.com/blog/serpapi-pricing-explained)
- Tavily: 1,000 free credits/month; $30/month for 4,000; pay-as-you-go $0.008/credit. [snippet] — [Tavily docs: credits & pricing](https://docs.tavily.com/documentation/api-credits)
- Exa: about $7 per 1,000 searches; new accounts get $20 credit and the free tier adds $10/month. [snippet; the same summary also claimed "up to 20,000 requests a month" free, which does not reconcile with $10 at $7/1k; treat as unresolved] — [tinyfish.ai Exa pricing](https://www.tinyfish.ai/blog/exa-pricing); [keirolabs Exa pricing](https://keirolabs.cloud/blog/exa-api-pricing-2026)

### Inferences
- Serper.dev and SerpApi return actual Google results, so Google's `site:`/`OR`/quoted-phrase operators behave as in the browser; Brave uses its own index (operator support exists but coverage of fresh ATS pages is the unknown); Tavily and Exa are LLM-oriented retrieval APIs where exact operator semantics are weaker. This ranking is my reasoning, not a sourced test.
- At 100 resolutions/day with one query each (about 3,000/month): Serper costs roughly $3/month after the free 2,500; Brave roughly $10/month after credit; SerpApi needs the $75 tier. Since most resolutions should be served from the slug cache without search, the free tiers probably suffice.
- Do not build on Google CSE (unavailable to new customers) or anything Bing.
- Brave's no-storage term conflicts with caching search results; caching only the resolved ATS URL is the conservative reading.

### Gaps
- No source found comparing how well each API honours `site:` with multi-domain `OR` on ATS hosts.
- DuckDuckGo HTML endpoint status and blocking behaviour in 2026 not researched.
- Brave, Serper, SerpApi and Exa prices are from third-party trackers, not the vendors' own pricing pages; confirm before committing.

## 5. Google for Jobs results and `apply_options`

### Takeaway
SERP APIs expose Google Jobs listings with an `apply_options` array of (title, link) pairs that often includes the employer's own site or ATS alongside LinkedIn/Indeed, which makes it a one-call resolver. Direct scraping of Google Jobs is unreliable (JobSpy lists it as unavailable), so this depends on a paid SERP provider.

### Cited Findings
- SerpApi `engine=google_jobs`: required `q`, `api_key`; `location` or `uule`, `gl`, `hl`, `google_domain`, `lrad` (radius km); "up to 10 results are returned per page", paged by `next_page_token`; the `start` parameter was "discontinued by Google", `chips` and `ltype` "deprecated by Google". [fetched] — [SerpApi Google Jobs API](https://serpapi.com/google-jobs-api)
- `apply_options` is returned inside each job in the main results, as objects with `title` (e.g. "Indeed") and `link`; jobs also carry `detected_extensions` (posted date, salary, schedule type). [fetched] — [SerpApi Google Jobs API](https://serpapi.com/google-jobs-api)
- Third-party Google Jobs actors state that apply links come back as direct URLs (LinkedIn, Indeed, ZipRecruiter, the company's careers page) rather than Google redirects, and that the `via` field names the board Google took the advert from, "often the company's own careers site rather than an aggregator". [snippet, vendor claim] — [Apify diopside/google-jobs](https://apify.com/diopside/google-jobs); [Apify s-r/google-jobs-scraper](https://apify.com/s-r/google-jobs-scraper.md)
- JobSpy README FAQ: "Q: No results when using 'google'? A: Google Jobs is currently unavailable." [fetched] — [speedyapply/JobSpy](https://github.com/speedyapply/JobSpy)
- DataForSEO also offers Google Jobs SERP data. [snippet] — [DataForSEO help](https://dataforseo.com/help-center/get-serp-data-from-google-jobs)

### Inferences
- Query form `"{title}" {company} {city}` against Google Jobs, then pick the `apply_options` entry whose host is a known ATS domain or the company domain, is likely the highest-yield single step for companies on ATSs without guessable slugs (Workday, iCIMS, Taleo, SuccessFactors), because Google indexes employer `JobPosting` markup directly.
- At 250 free SerpApi searches/month this is a fallback step, not the first step.

### Gaps
- No measured rate for how often `apply_options` includes the employer/ATS link, nor 2026 reliability data for the Google Jobs engine across providers.
- Whether Serper.dev exposes a Google Jobs endpoint with apply options was not checked.

## 6. How often the job exists on the employer's own board; agency and ghost listings

### Takeaway
I found no reliable data on the Easy Apply vs. offsite split for software-engineering postings or on the agency share; the only figures are unsourced blog estimates that contradict each other (about 40% vs. about 10% Easy Apply). Ghost-listing figures exist but rest on weak definitions.

### Cited Findings
- Conflicting Easy Apply share estimates surfaced in search summaries: "Easy Apply covers roughly 40% of US corporate postings" (the rest require the company careers page) versus "only available for about 10% of job postings". [snippet; attribution to a specific page not confirmed, both from marketing blogs] — candidates: [blog.fastapply.co Easy Apply vs direct, 2026](https://blog.fastapply.co/linkedin-easy-apply-vs-direct-company-applications-2026); [unanswered.io](https://unanswered.io/guide/percentage-of-real-jobs-on-linkedin); [amraandelma.com LinkedIn job posting statistics](https://www.amraandelma.com/top-linkedin-job-posting-statistics-2025/)
- The same sources claim Easy Apply callback rates of 1-2% vs. 3-5% for direct applications. [snippet, marketing blog, unverified] — [blog.fastapply.co](https://blog.fastapply.co/linkedin-easy-apply-vs-direct-company-applications-2026)
- Ghost jobs: ResumeUp.AI classed 27.4% of US LinkedIn listings as likely ghost jobs, defining any job posted more than 30 days ago as likely ghost (a crude age-only definition). [snippet] — [Entrepreneur](https://www.entrepreneur.com/business-news/millions-of-job-postings-are-for-ghost-jobs-study/499415)
- A hiring platform found around 20% of its postings were ghost jobs (reported January 2025). [snippet, from headline] — [MarketBeat](https://www.marketbeat.com/articles/more-soul-crushing-than-ever-popular-hiring-platform-finds-around-20-of-its-postings-were-ghost-jobs-2025-01-13)
- LinkedIn reports more than half its listings are now tagged "verified". [snippet; source page among the ghost-job articles, not pinned down] — [The Interview Guys](https://blog.theinterviewguys.com/ghost-jobs-exposed/)
- Greenhouse supports a "LinkedIn Apply Connect" integration, i.e. a LinkedIn in-platform apply that feeds the employer's Greenhouse; so an Easy-Apply-style LinkedIn posting does not imply the job is absent from the employer's ATS board. [snippet, from page title] — [Greenhouse support](https://support.greenhouse.io/hc/en-us/articles/17073067102747-LinkedIn-Apply-Connect-integration)
- Scraper schemas expose the split directly: LinkedIn scrapers return `is_easy_apply` and an external apply URL (`jobUrlDirect`) "when available". [snippet] — [Apify LinkedIn Easy Apply dataset example](https://apify.com/chronometrica/linkedin-jobs-scraper/examples/linkedin-easy-apply)

### Inferences
- The tool can measure the split itself cheaply: log `is_easy_apply` / presence of a direct URL and the resolution outcome per posting for a few weeks; that will be better than any published figure for the user's own search.
- Skip heuristics (my reasoning, no source found): maintain a blocklist of aggregator/reposter "companies" (e.g. Jobs via Dice, Lensa, Jobot and similar) and staffing firms; treat a posting whose LinkedIn company name differs from the hiring company named in the description, or that says "our client", as agency; if no board for the named company contains a matching title, mark unresolvable rather than applying via the reposter.
- Verification against the employer's ATS feed is itself the ghost filter: a job that is absent from the live board is closed or never existed there.

### Gaps
- No dataset or study found giving the share of LinkedIn/Indeed SWE postings that are Easy Apply / Indeed Apply only, nor the share from staffing agencies with no direct employer posting. This is the largest unanswered question in the assignment.
- No sourced list of reposter account names or documented detection rules for Dice/Lensa/Jobot reposts.
- Nothing found on Indeed Apply share specifically.

## 7. Matching: confirming the ATS posting is the same job

### Takeaway
Practitioner guidance is hierarchical: prefer an ATS job/requisition ID taken from an apply URL; otherwise match on normalised company + normalised title + location, with fuzzy description similarity as a tie-breaker. Exact title matching fails badly, and aggregators lag the ATS by weeks.

### Cited Findings
- Recommended hierarchy: primary = match requisition IDs embedded in apply links (e.g. the trailing ID in `boards.greenhouse.io/company/jobs/1234567`); fallback = normalised company name + token-sorted fuzzy title matching. Exact title matching "caught nothing" ("Sr. Python Dev" vs. "Senior Python Developer (m/f/d)"). One demo query returned the same role four times across three aggregators plus the company board. [fetched] — [dev.to dedup article, 6 Oct 2026](https://dev.to/imapphelp/my-job-search-api-returned-the-same-job-five-times-the-apply-url-gave-away-the-dedup-key-1fj2)
- Layered approach: exact URL match first, then title + company + location, then fuzzy description similarity for edge cases. [snippet] — [dev.to "The same job is posted on three boards"](https://dev.to/get_anything/the-same-job-is-posted-on-three-boards-heres-how-to-deduplicate-job-listings-properly-2862)
- Normalisation used in one implementation: lowercase, strip punctuation, collapse whitespace, drop trailing legal suffixes from company names, expand Sr/Jr/Mgr in titles; a posting joins an existing job when normalised company, title and location match exactly. [snippet] — [WorkPilot PR #9](https://github.com/mali-anjum/WorkPilot/pull/9)
- ATS identifiers in URLs: Greenhouse uses `?gh_jid=` on employer-hosted pages, Lever uses path-based IDs, Workday embeds requisition numbers; trust the listing whose apply URL points at the company's own ATS over an aggregator mirror. [snippet; not present in the article I fetched, so attribution among the result set is uncertain] — result set incl. [dev.to dedup, Oct 2026](https://dev.to/imapphelp/my-job-search-api-returned-the-same-job-five-times-the-apply-url-gave-away-the-dedup-key-1fj2), [jobhunter-agent issue #41](https://github.com/PeteBoucher/jobhunter-agent/issues/41)
- ID fields available for matching: Greenhouse `id`, `internal_job_id`, `requisition_id`, `first_published`, `location`, `absolute_url` — [Greenhouse docs](https://docs.greenhouse.io/job-board.html) [fetched]; Workday `jobReqId`, `startDate`, `additionalLocations` on the detail endpoint — [dev.to Workday, Aug 2026](https://dev.to/udaninn/workday-job-boards-have-a-json-api-too-its-just-better-hidden-23fl) [fetched]
- Date pitfalls: Greenhouse `updated_at` moves on edit; Workday list dates are relative strings; Lever uses epoch ms. [fetched] — [dev.to, 13 Jul 2026](https://dev.to/agenticemail/every-major-ats-has-a-public-job-feed-here-is-how-to-read-them-all-3k10)

### Inferences
- Greenhouse distinguishes job post `id` from `internal_job_id`: one internal job posted in several locations yields several posts sharing an `internal_job_id`. Group by it to detect the "same title, multiple locations" case and pick the post whose location matches the LinkedIn location (my reading of the field definitions; the docs do not spell out this use).
- Suggested scoring (reasoning, not sourced): require company ownership check; title token-set similarity above a high threshold after seniority/abbreviation normalisation; location compatible (same metro, or both remote); posting date within a tolerance of `first_published`/`startDate`; then description similarity (e.g. on the LinkedIn snippet vs. ATS description) to break ties. If several ATS posts tie, hand candidates to the LLM with both descriptions or ask the user.
- Evergreen/pipeline reqs ("General Application", "Future Opportunities", very old `first_published`) should be excluded from candidates; no source found for a detection rule.
- Since the LinkedIn/Indeed side rarely exposes the requisition ID, the ID-first rule mainly applies when a direct apply URL or Google `apply_options` link is available; otherwise it is fuzzy matching.

### Gaps
- No published precision/recall figures for any matching scheme.
- No sourced guidance on evergreen requisitions or on multi-location collapse specifically.
- Tracking-parameter stripping (`gh_src`, `utm_*`, `lever-source`) not covered by any source I read.

## 8. How existing tools do it

### Takeaway
JobSpy exposes the employer link when the board gives one (`job_url_direct`, at the cost of one extra LinkedIn request per job and quick rate limiting); career-ops skips LinkedIn and reads Greenhouse/Ashby/Lever APIs directly; commercial resolvers probe slugs then parse careers pages. No tool I found documents a LinkedIn-posting-to-ATS matching algorithm.

### Cited Findings
- JobSpy: `linkedin_fetch_description` is now "deprecated, use fetch_description (still works; removed in 2.0)". Rate limits: "LinkedIn is the most restrictive and usually rate limits around the 10th page with one ip. Proxies are a must basically."; "Indeed is the best scraper currently with no rate limiting."; Glassdoor limits after about 30 requests per IP. Google Jobs "currently unavailable". [fetched] — [speedyapply/JobSpy README](https://github.com/speedyapply/JobSpy)
- JobSpy docs (third-party mirrors/forks): with description fetching enabled, LinkedIn costs one extra request per job and returns the full description plus `job_url_direct` ("direct application URL if available"), job level, industry, function. [snippet] — [mintlify.wiki speedyapply/JobSpy LinkedIn](https://mintlify.wiki/speedyapply/JobSpy/job-boards/linkedin); [PyPI python-jobspy](https://pypi.org/project/python-jobspy/1.1.54)
- The current upstream README text I fetched did not mention `job_url_direct` at all, and lists no such field under Indeed. [fetched] — [speedyapply/JobSpy](https://github.com/speedyapply/JobSpy). Treat field availability on current versions as needing a quick local check.
- career-ops: "scans these applicant tracking systems through their public job-board APIs, so the scan itself consumes no AI tokens"; supports Greenhouse, Ashby, Lever. An open issue proposes an optional Apify LinkedIn scanner as "Level 4" of the scan, implying LinkedIn is not a default source. [fetched for the docs quote; issue title from snippet] — [career-ops portals reference](https://career-ops.org/docs/reference/portals); [career-ops issue #791](https://github.com/santifer/career-ops/issues/791)
- Commercial domain→board resolvers: slug candidates from domain label, six-ATS probe, careers-page fallback, ownership verification (see section 2). [fetched] — [Apify fayoussef/company-domain-to-job-postings](https://apify.com/fayoussef/company-domain-to-job-postings)
- Hiring.cafe records carry the original apply URL and source ATS, i.e. it indexes ATSs directly rather than job boards. [snippet] — [Apify blackfalcondata/hiringcafe-scraper](https://apify.com/blackfalcondata/hiringcafe-scraper)

### Inferences
- The cheapest first resolver is the discovery scrape itself: when LinkedIn/Indeed provides an offsite apply URL, follow redirects and classify the final host; only postings without one need slug probing or search.
- From a single home IP, per-job LinkedIn detail fetches should be throttled hard given JobSpy's "around the 10th page" warning; Indeed is the lower-risk discovery source by JobSpy's own account.

### Gaps
- Not researched within budget: Simplify's and Jobright's internal approach, AIHawk forks. No documented approach found in what I read.
- career-ops scan levels, `portals.yml` format and any `site:` query templates are in a separate "Scan job portals" guide I did not open.
- Whether JobSpy currently populates `job_url_direct` for Indeed was not confirmed (older versions are commonly said to; the README I fetched does not say).
