// LinkedIn and Indeed job search, read logged out with no account. They are used only to find
// postings: nothing is applied to on either site, and each posting is looked up on the employer's
// own site first (see locate in pipeline.ts). Neither site offers this as a public API, so requests
// are few, spaced out, and stop for hours at the first sign of a block.
import { fetchCompany, htmlToText, posted, type Ats, type Company, type Posting } from "./ats";
import { config } from "./config";
import { companyKey, findTwin, knownUrl, kvGet, kvSet, type Job } from "./db";

export interface Boards {
  location: string;
  distance: number; // miles
  queries: string[];
  initialHours?: number;
  linkedin?: { minutes: number; pages: number };
  indeed?: { minutes: number };
}
const BOARDS = ["linkedin", "indeed"] as const;
type Board = (typeof BOARDS)[number];

export const isBoardUrl = (url: string) => /^https?:\/\/([\w-]+\.)*(linkedin|indeed)\.com\//i.test(url);

// Recruiters and reposting sites that hide the employer: there is no posting of theirs to find.
const NO_EMPLOYER = /^(jobs via |lensa$|jobot|jobgether|talentify|dice$|cybercoders|actalent|teksystems|robert half|insight global|randstad|motion recruitment|hiremefast|get\.?it )/i;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const pause = () => sleep(6000 + Math.random() * 9000);
const BLOCK_HOURS = 6;
class Blocked extends Error {}

// Hours of postings to ask for: since the last successful read plus an overlap, or the initial window.
function windowHours(board: Board, b: Boards) {
  const last = Date.parse(kvGet(`last.board.${board}.ok`) ?? "");
  const initial = b.initialHours ?? 72;
  return Number.isNaN(last) ? initial : Math.min(initial, Math.ceil((Date.now() - last) / 3600_000) + 1);
}

const BROWSER = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
};
const text = (html: string | undefined) => htmlToText(html ?? "").replace(/\s+/g, " ").trim();

const LINKEDIN_PAGE = 10;
async function linkedin(b: Boards): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  const hours = windowHours("linkedin", b);
  const pages = b.linkedin?.pages ?? 2;
  let requests = 0;
  for (const keywords of b.queries) {
    for (let page = 0; page < pages; page++) {
      if (requests++) await pause();
      const params = new URLSearchParams({ keywords, location: b.location, distance: String(b.distance), f_TPR: `r${hours * 3600}`, sortBy: "DD", start: String(page * LINKEDIN_PAGE) });
      const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?${params.toString()}`, { headers: BROWSER, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (res.status !== 200) throw new Blocked(`search answered ${res.status}`);
      const html = await res.text();
      const cards = html.split(/<li>/).slice(1);
      if (!cards.length) {
        if (html.replace(/<!--.*?-->|<!DOCTYPE html>/gs, "").trim()) throw new Blocked("search returned a page with no postings");
        break; // end of the results
      }
      let fresh = 0;
      for (const card of cards) {
        const id = (/jobPosting:(\d+)/.exec(card))?.[1];
        const title = text((/base-search-card__title[^>]*>([\s\S]*?)<\/h3>/.exec(card))?.[1]);
        const company = text((/base-search-card__subtitle[^>]*>([\s\S]*?)<\/h4>/.exec(card))?.[1]);
        if (!id || !title || !company || seen.has(id)) continue;
        seen.add(id);
        const url = `https://www.linkedin.com/jobs/view/${id}`;
        if (knownUrl(url)) continue;
        if (NO_EMPLOYER.test(company)) continue;
        fresh++;
        out.push({ url, source: "linkedin", company, title, location: text((/job-search-card__location[^>]*>([\s\S]*?)<\/span>/.exec(card))?.[1]) || null, description: null, posted: posted((/<time[^>]*datetime="([^"]+)"/.exec(card))?.[1]) });
      }
      // Newest first: a page of postings already seen means the rest are older still.
      if (!fresh || cards.length < LINKEDIN_PAGE) break;
    }
  }
  return out;
}

// The job page's description, for a posting whose employer page gave none. One request.
export async function linkedinDescription(url: string): Promise<string | null> {
  const id = (/linkedin\.com\/jobs\/view\/(?:[^/?]*-)?(\d+)/.exec(url))?.[1];
  if (!id) return null;
  try {
    const res = await fetch(`https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`, { headers: BROWSER, redirect: "manual", signal: AbortSignal.timeout(30_000) });
    if (res.status !== 200) return null;
    const body = (/show-more-less-html__markup[^>]*>([\s\S]*?)<\/div>/.exec((await res.text())))?.[1];
    return body ? htmlToText(body) || null : null;
  } catch {
    return null;
  }
}

// Indeed's mobile app API: 100 postings a request, with the description and the employer's own link.
const INDEED_HEADERS = {
  "content-type": "application/json",
  accept: "application/json",
  "accept-language": "en-US,en;q=0.9",
  "indeed-api-key": "161092c2017b5bbab13edb12461a62d5a833871e7cad6d9d475304573de67ac8",
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Indeed App 193.1",
  "indeed-app-info": "appv=193.1; appid=com.indeed.jobsearch; osv=16.6.1; os=ios; dtype=phone",
  "indeed-co": "US",
  "indeed-locale": "en-US",
};
interface IndeedJob {
  key?: string;
  title?: string;
  sourceEmployerName?: string | null;
  description?: { html?: string | null } | null;
  location?: { admin1Code?: string | null; city?: string | null } | null;
  employer?: { name?: string | null } | null;
  recruit?: { viewJobUrl?: string | null } | null;
}
interface IndeedResponse {
  data?: { jobSearch?: { results?: { job?: IndeedJob | null }[] | null } | null } | null;
  errors?: unknown;
}
async function indeed(b: Boards): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  const hours = windowHours("indeed", b);
  let requests = 0;
  for (const what of b.queries) {
    if (requests++) await pause();
    const query = `query { jobSearch(what: ${JSON.stringify(what)} location: {where: ${JSON.stringify(b.location)}, radius: ${b.distance}, radiusUnit: MILES} limit: 100 sort: DATE filters: [{ date: { field: "dateOnIndeed", start: "${hours}h" } }]) { results { job { key title sourceEmployerName description { html } location { admin1Code city } employer { name } recruit { viewJobUrl } } } } }`;
    const res = await fetch("https://apis.indeed.com/graphql", { method: "POST", headers: INDEED_HEADERS, body: JSON.stringify({ query }), signal: AbortSignal.timeout(30_000) });
    if (res.status !== 200) throw new Blocked(`search answered ${res.status}`);
    const data = (await res.json()) as IndeedResponse | null;
    if (!data?.data?.jobSearch) throw new Blocked(`search failed: ${JSON.stringify(data?.errors ?? data).slice(0, 200)}`);
    for (const { job: j } of data.data.jobSearch.results ?? []) {
      const company = (j?.employer?.name ?? j?.sourceEmployerName ?? "").trim();
      if (!j?.key || !j.title || !company || seen.has(j.key) || NO_EMPLOYER.test(company)) continue;
      seen.add(j.key);
      // Postings that are not "Easily apply" carry the employer's own link.
      const direct = j.recruit?.viewJobUrl && !isBoardUrl(j.recruit.viewJobUrl) ? j.recruit.viewJobUrl : null;
      out.push({
        url: direct ?? `https://www.indeed.com/viewjob?jk=${j.key}`,
        source: "indeed",
        company,
        title: j.title,
        location: [j.location?.city, j.location?.admin1Code].filter(Boolean).join(", ") || null,
        description: j.description?.html ? htmlToText(j.description.html) : null,
      });
    }
  }
  return out;
}

const readers: Record<Board, (b: Boards) => Promise<Posting[]>> = { linkedin, indeed };

export const boardNames = () => BOARDS.filter(n => Number(config.boards?.[n]?.minutes) > 0);
export const boardMinutes = (name: Board) => {
  const minutes = config.boards?.[name]?.minutes;
  if (minutes === undefined) throw new Error(`board "${name}" is not configured`);
  return minutes;
};

// New postings from one board, newest first. Throws when the board refused; it is then left alone for a while.
export async function fetchBoard(name: Board): Promise<Posting[]> {
  if (Date.now() < Date.parse(kvGet(`board.${name}.blockedUntil`) ?? "1970-01-01")) return [];
  const started = new Date().toISOString();
  try {
    if (!config.boards) throw new Error("no boards are configured");
    const postings = await readers[name](config.boards);
    kvSet(`last.board.${name}.ok`, started);
    return postings;
  } catch (err) {
    if (err instanceof Blocked) {
      kvSet(`board.${name}.blockedUntil`, new Date(Date.now() + BLOCK_HOURS * 3600_000).toISOString());
      throw new Error(`${err.message}; not asking again for ${BLOCK_HOURS}h`, { cause: err });
    }
    throw err;
  }
}

// ---- the employer's own posting, when its board is one of the public ones and the slug is guessable

const PROBE: Ats[] = ["greenhouse", "lever", "ashby"];
const MISS_DAYS = 14;
const words = (s: string | null) => new Set((s ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? []);

export async function probeEmployer(job: Job): Promise<{ company: Company; posting: Posting } | null> {
  const key = companyKey(job.company);
  if (Date.now() - Date.parse(kvGet(`locate.miss.${key}`) ?? "1970-01-01") < MISS_DAYS * 86400_000) return null;
  const hyphenated = job.company.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let boardFound = false;
  for (const slug of new Set([key, hyphenated])) {
    if (slug.length < 3) continue;
    for (const ats of PROBE) {
      const company: Company = { name: job.company, ats, slug };
      const postings = await fetchCompany(company).catch(() => []);
      if (!postings.length) continue;
      boardFound = true;
      const same = postings.filter(p => p.url && findTwin({ company: job.company, title: p.title, description: p.description }, [job]));
      const here = words(job.location);
      // The same title is often open in several places: take the one for this location, else a US one.
      const posting = same.find(p => [...words(p.location)].some(w => here.has(w))) ?? same.find(p => /\b(US|USA|United States)\b/.test(p.location ?? "")) ?? same[0];
      if (posting) return { company, posting };
    }
  }
  // No board under that name: do not ask again for a while. A board without this role is asked again.
  if (!boardFound) kvSet(`locate.miss.${key}`, new Date().toISOString());
  return null;
}
