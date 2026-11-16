// Public job-board feeds. No browser: these are the public endpoints the boards' own career pages
// call, mostly JSON. iCIMS, JazzHR, Avature, Radancy and older Taleo sections are read from their
// public sitemap or listing pages, Paycor and SuccessFactors from their Atom and RSS feeds.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { config, PROFILE } from "./config";

export const ATS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "recruitee",
  "smartrecruiters",
  "workday",
  "oracle",
  "adp",
  "ukg",
  "icims",
  "eightfold",
  "breezy",
  "jazzhr",
  "bamboohr",
  "clearcompany",
  "paycor",
  "jibe",
  "taleo",
  "avature",
  "coveo",
  "successfactors",
  "radancy",
] as const;
export type Ats = (typeof ATS)[number];
export interface Company {
  name: string;
  ats: Ats;
  // Board id as it appears in the board's URL. Workday: "<tenant>.<wdN>/<site>", e.g. "acme.wd5/External".
  // The others are in the table in prompts/discover.md, and boardOf reads them from a posting's URL.
  slug: string;
  // Keyword filter, for employers with thousands of openings: Workday, Jibe, Taleo (REST), SuccessFactors and Radancy.
  search?: string;
}
export interface Posting {
  url: string;
  source: string;
  company: string;
  title: string;
  location: string | null;
  description: string | null;
  // When the employer opened the posting, where the source says: an ISO time, or "YYYY-MM-DD" when it only gives the day.
  posted?: string | null;
}

const companiesPath = join(PROFILE, "companies.yml");

export function loadCompanies(): Company[] {
  try {
    return (YAML.parse(readFileSync(companiesPath, "utf8")) as { companies?: Company[] } | null)?.companies ?? [];
  } catch {
    return [];
  }
}

// Campus and early-career boards (a Workday `Campus` site, a `universityrecruiting` Greenhouse board)
// are watched like any other: internships and co-ops are what the search is for.
export function addCompany(c: Company): boolean {
  const all = loadCompanies();
  if (all.some(sameBoard(c))) return false;
  all.push(c);
  writeFileSync(companiesPath, YAML.stringify({ companies: all }));
  return true;
}

// Elements a reader never sees, and the attributes that hide one. Postings use hidden text to plant
// instructions for AI applicants. White or tiny text is kept: boards also tuck recruiter tags away
// that way, and the prompts say what to do with instructions in it.
const UNSEEN = new Set(["script", "style", "template"]);
const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const hiddenStyle = (style: string) =>
  style.split(";").some(d => {
    const i = d.indexOf(":");
    const prop = d.slice(0, i).trim().toLowerCase();
    const value = d
      .slice(i + 1)
      .replace(/!important/i, "")
      .trim()
      .toLowerCase();
    if (prop === "display") return value === "none";
    if (prop === "visibility") return value === "hidden" || value === "collapse";
    if (prop === "opacity" || prop === "font-size") return parseFloat(value) === 0;
    return false;
  });
function hides(name: string, attrs: string): boolean {
  if (UNSEEN.has(name)) return true;
  for (const [, key = "", a, b, c] of attrs.matchAll(/([^\s"'=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const k = key.toLowerCase();
    if (k === "hidden" || (k === "style" && hiddenStyle(a ?? b ?? c ?? ""))) return true;
  }
  return false;
}
// Removes hidden elements with everything inside them. One left unclosed loses only its tag.
export function dropHidden(html: string): string {
  const tag = /<(\/?)([a-z][\w-]*)\b([^>]*)>/gi;
  let out = "",
    from = 0;
  for (let m; (m = tag.exec(html));) {
    const name = (m[2] ?? "").toLowerCase(),
      attrs = m[3] ?? "";
    if (m[1] || !hides(name, attrs)) continue;
    out += html.slice(from, m.index);
    from = tag.lastIndex;
    if (VOID.has(name) || attrs.endsWith("/")) continue;
    let depth = 1;
    for (let n; depth && (n = tag.exec(html));) {
      if ((n[2] ?? "").toLowerCase() !== name || (n[3] ?? "").endsWith("/")) continue;
      depth += n[1] ? -1 : 1;
      if (!depth) from = tag.lastIndex;
    }
    if (depth) tag.lastIndex = from;
  }
  return out + html.slice(from);
}

export const htmlToText = (html: string) =>
  dropHidden(
    html
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&"),
  )
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+|x[\da-f]+);/gi, (_, n: string) => String.fromCodePoint(/^x/i.test(n) ? parseInt(n.slice(1), 16) : Number(n)))
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Identify ourselves honestly; these are public endpoints meant for programmatic use.
const HEADERS = { accept: "application/json", "user-agent": "auto-apply/1.0 (personal job search)" };
// A body is sent as JSON, or as a form when it is URLSearchParams.
async function getJson(url: string, body?: unknown, headers: Record<string, string> = {}): Promise<unknown> {
  const form = body instanceof URLSearchParams;
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: { ...HEADERS, ...(body && !form ? { "content-type": "application/json" } : {}), ...headers },
    ...(body ? { body: form ? body : JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}
async function getText(url: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}): Promise<string> {
  return (await getResponse(url, init)).text();
}
async function getResponse(url: string, init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {}): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: { ...HEADERS, accept: "text/html,application/xml;q=0.9,*/*;q=0.8", ...init.headers },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}
// The text of the first <tag>…</tag> in a piece of XML, CDATA unwrapped and entities decoded.
const xmlTag = (xml: string, tag: string) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? htmlToText((m[1] ?? "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")) : "";
};
// A source's date field as an ISO time; a bare date stays a bare date.
export const posted = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
};
// Workday only says "Posted Today", "Posted Yesterday", "Posted 3 Days Ago" or "Posted 30+ Days Ago".
const workdayPosted = (s: string | null | undefined): string | null => {
  const m = /today|yesterday|(\d+)\+?\s*days?/i.exec(s ?? "");
  if (!m) return null;
  const days = m[1] ? Number(m[1]) : /yesterday/i.test(m[0]) ? 1 : 0;
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
};
// "10/29/2026" or "Oct 29, 2026", as Taleo writes the day a posting opened, as "2026-10-29".
const usDay = (s: string | null | undefined): string | null => {
  const t = Date.parse(`${s ?? ""} 12:00 GMT`);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
};
const decodeUri = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
const place = (...parts: (string | null | undefined | false)[]) => [...new Set(parts.filter(Boolean))].join(", ") || null;

const WORKDAY_MAX = 200; // newest postings read per board and scan
const NEWEST_MAX = 200; // the same for the other boards that page through thousands of postings
const EIGHTFOLD_MAX = 100; // Eightfold answers ten at a time
function workday(c: Company) {
  const m = /^([\w-]+)\.(wd\d+)\/([\w-]+)$/i.exec(c.slug);
  if (!m) throw new Error(`workday slug must look like "tenant.wd5/Site", got "${c.slug}"`);
  const [, tenant, pod, site] = m;
  const host = `https://${tenant}.${pod}.myworkdayjobs.com`;
  return { api: `${host}/wday/cxs/${tenant}/${site}`, page: `${host}/en-US/${site}` };
}

// A slug made of several parts, "<a>/<b>". Throws with the expected shape when one is malformed.
function slugParts(c: Company, count: 2, shape: string): [string, string];
function slugParts(c: Company, count: 3, shape: string): [string, string, string];
function slugParts(c: Company, count: number, shape: string): string[] {
  const parts = c.slug.split("/").map(p => p.trim());
  if (parts.length !== count || parts.some(p => !p)) throw new Error(`${c.ats} slug must look like "${shape}", got "${c.slug}"`);
  return parts;
}
const ADP = "https://workforcenow.adp.com/mascsr/default";
const ADP_CCID = "19000101_000001"; // the career center nearly every ADP client uses
function adp(c: Company) {
  const [cid, ccId = ADP_CCID, ...rest] = c.slug.split("/");
  if (!cid || rest.length) throw new Error(`adp slug must look like "<cid>" or "<cid>/<ccId>", got "${c.slug}"`);
  return { cid, ccId, query: `cid=${cid}&ccId=${ccId}&lang=en_US&locale=en_US` };
}
// "software-developer---ai-focus" -> "Software Developer - Ai Focus": iCIMS's sitemap has the title only in the URL.
function icimsTitle(slug: string) {
  return decodeUri(slug)
    .replace(/---/g, " – ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|[\s(/])([a-z])/g, (_, before: string, letter: string) => before + letter.toUpperCase())
    .replace(/ – /g, " - ");
}

// The fields read from each board's answer.
interface GreenhouseBoard {
  jobs?: { absolute_url: string; title: string; location?: { name?: string } | null; content?: string; first_published?: string }[];
}
type LeverBoard =
  | {
      hostedUrl: string;
      text: string;
      categories?: { location?: string };
      descriptionPlain?: string;
      additionalPlain?: string;
      lists?: { text: string; content?: string }[];
      createdAt?: number;
    }[]
  | null;
interface AshbyBoard {
  jobs?: {
    jobUrl: string;
    title: string;
    isListed?: boolean;
    location?: string | null;
    descriptionPlain?: string | null;
    descriptionHtml?: string;
    publishedAt?: string;
  }[];
}
interface WorkableBoard {
  jobs?: {
    url?: string;
    application_url: string;
    title: string;
    city?: string;
    state?: string;
    country?: string;
    telecommuting?: boolean;
    description?: string;
    published_on?: string;
    created_at?: string;
  }[];
}
interface RecruiteeBoard {
  offers?: {
    careers_url: string;
    title: string;
    status?: string;
    location?: string | null;
    city?: string;
    country?: string;
    remote?: boolean;
    description?: string;
    requirements?: string;
    published_at?: string;
  }[];
}
interface SmartRecruitersPage {
  totalFound?: number;
  content?: { id: string; name: string; releasedDate?: string; location?: { city?: string; region?: string; country?: string; remote?: boolean } }[];
}
interface SmartRecruitersPosting {
  jobAd?: { sections?: Record<string, { title?: string; text?: string } | undefined> };
}
interface WorkdayPage {
  total?: number;
  jobPostings?: { externalPath?: string; title: string; locationsText?: string | null; postedOn?: string }[];
}
interface WorkdayPosting {
  jobPostingInfo?: { jobDescription?: string };
}
interface OraclePage {
  items?: { TotalJobsCount?: number; requisitionList?: { Id: string; Title: string; PrimaryLocation?: string | null; PostedDate?: string | null }[] }[];
}
interface OracleDetails {
  items?: { ExternalDescriptionStr?: string | null; ExternalResponsibilitiesStr?: string | null; ExternalQualificationsStr?: string | null }[];
}
interface AdpRequisition {
  itemID: string;
  requisitionTitle: string;
  postDate?: string;
  requisitionDescription?: string;
  requisitionLocations?: { address?: { cityName?: string; countrySubdivisionLevel1?: { codeValue?: string }; countryCode?: string } }[];
}
interface AdpPage {
  jobRequisitions?: AdpRequisition[];
}
interface UkgPage {
  totalCount?: number;
  opportunities?: {
    Id: string;
    Title: string;
    PostedDate?: string;
    Locations?: { Address?: { City?: string | null; State?: { Code?: string | null } | null; Country?: { Code?: string | null } | null } | null }[];
  }[];
}
interface EightfoldPage {
  data?: { count?: number; positions?: { name: string; standardizedLocations?: string[]; locations?: string[]; positionUrl: string; postedTs?: number }[] };
}
type BreezyBoard = { name: string; url: string; published_date?: string; location?: { name?: string; is_remote?: boolean } | null }[];
interface BambooBoard {
  result?: {
    id: string;
    jobOpeningName: string;
    isRemote?: boolean | null;
    atsLocation?: { city?: string | null; state?: string | null; country?: string | null } | null;
  }[];
}
interface ClearCompanyBoard {
  results?: {
    positionTitle: string;
    applyLink: string;
    description?: string | null;
    location?: string | null;
    postedDate?: string | null;
    locations?: { city?: string | null; subdivision?: string | null; country?: string | null; isRemote?: boolean }[];
  }[];
}
interface JibePage {
  totalCount?: number;
  jobs?: {
    data: {
      slug: string;
      title: string;
      description?: string | null;
      responsibilities?: string | null;
      qualifications?: string | null;
      full_location?: string | null;
      posted_date?: string | null;
    };
  }[];
}
interface TaleoPage {
  requisitionList?: { contestNo: string; column: string[] }[];
  pagingData?: { pageSize?: number; totalCount?: number };
}
interface CoveoResults {
  results?: { clickUri: string; raw: { title?: string; city?: string | string[]; jobposteddate?: number } }[];
}
interface SimplifyListing {
  company_name: string;
  title: string;
  url: string;
  active?: boolean;
  is_visible?: boolean;
  terms?: string[];
  locations?: string[];
  date_posted?: number;
}
interface RemotiveFeed {
  jobs?: { url: string; title: string; company_name?: string | null; candidate_required_location?: string; description?: string; publication_date?: string }[];
}
interface JobicyFeed {
  jobs?: { url: string; jobTitle: string; companyName: string; jobGeo?: string; jobDescription?: string; pubDate?: string }[];
}
interface RemoteOkJob {
  url?: string;
  position?: string;
  company: string;
  location?: string;
  description?: string;
  date?: string;
}

const fetchers: Record<Ats, (c: Company) => Promise<Posting[]>> = {
  async greenhouse(c) {
    const data = (await getJson(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`)) as GreenhouseBoard;
    return (data.jobs ?? []).map(j => ({
      url: j.absolute_url,
      source: "greenhouse",
      company: c.name,
      title: j.title,
      location: j.location?.name ?? null,
      description: j.content ? htmlToText(j.content) : null,
      posted: posted(j.first_published),
    }));
  },
  // Slug: "<slug>", or "eu/<slug>" for a board on Lever's EU site (jobs.eu.lever.co/<slug>).
  async lever(c) {
    const eu = c.slug.startsWith("eu/");
    const data = (await getJson(`https://api${eu ? ".eu" : ""}.lever.co/v0/postings/${eu ? c.slug.slice(3) : c.slug}?mode=json`)) as LeverBoard;
    return (data ?? []).map(j => ({
      url: j.hostedUrl,
      source: "lever",
      company: c.name,
      title: j.text,
      location: j.categories?.location ?? null,
      description: [j.descriptionPlain, ...(j.lists ?? []).map(l => `${l.text}\n${htmlToText(l.content ?? "")}`), j.additionalPlain]
        .filter(Boolean)
        .join("\n\n"),
      posted: posted(j.createdAt),
    }));
  },
  async ashby(c) {
    const data = (await getJson(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`)) as AshbyBoard;
    return (data.jobs ?? [])
      .filter(j => j.isListed !== false)
      .map(j => ({
        url: j.jobUrl,
        source: "ashby",
        company: c.name,
        title: j.title,
        location: j.location ?? null,
        description: j.descriptionPlain ?? (j.descriptionHtml ? htmlToText(j.descriptionHtml) : null),
        posted: posted(j.publishedAt),
      }));
  },
  async workable(c) {
    const data = (await getJson(`https://apply.workable.com/api/v1/widget/accounts/${c.slug}?details=true`)) as WorkableBoard;
    return (data.jobs ?? []).map(j => ({
      url: j.url ?? j.application_url,
      source: "workable",
      company: c.name,
      title: j.title,
      location: place(j.city, j.state, j.country, j.telecommuting && "Remote"),
      description: j.description ? htmlToText(j.description) : null,
      posted: posted(j.published_on ?? j.created_at),
    }));
  },
  async recruitee(c) {
    const data = (await getJson(`https://${c.slug}.recruitee.com/api/offers/`)) as RecruiteeBoard;
    return (data.offers ?? [])
      .filter(j => !j.status || j.status === "published")
      .map(j => ({
        url: j.careers_url,
        source: "recruitee",
        company: c.name,
        title: j.title,
        location: place(j.location ?? place(j.city, j.country), j.remote && "Remote"),
        description: htmlToText([j.description, j.requirements].filter(Boolean).join("\n")) || null,
        posted: posted(j.published_at),
      }));
  },
  async smartrecruiters(c) {
    const out: Posting[] = [];
    for (let offset = 0; offset < 500; offset += 100) {
      const data = (await getJson(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=100&offset=${offset}`)) as SmartRecruitersPage;
      for (const j of data.content ?? [])
        out.push({
          url: `https://jobs.smartrecruiters.com/${c.slug}/${j.id}`,
          source: "smartrecruiters",
          company: c.name,
          title: j.name,
          location: place(j.location?.city, j.location?.region, j.location?.country?.toUpperCase(), j.location?.remote && "Remote"),
          description: null, // one request per posting: fetched by fetchDescription once it survives triage
          posted: posted(j.releasedDate),
        });
      if (offset + 100 >= (data.totalFound ?? 0)) break;
    }
    return out;
  },
  async workday(c) {
    const { api, page } = workday(c);
    const out: Posting[] = [];
    for (let offset = 0; offset < WORKDAY_MAX; offset += 20) {
      const data = (await getJson(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: c.search ?? "" })) as WorkdayPage;
      for (const j of data.jobPostings ?? [])
        if (j.externalPath)
          out.push({
            url: page + j.externalPath,
            source: "workday",
            company: c.name,
            title: j.title,
            location: j.locationsText ?? null,
            description: null,
            posted: workdayPosted(j.postedOn),
          });
      if (offset + 20 >= (data.total ?? 0) || !(data.jobPostings ?? []).length) break;
    }
    return out;
  },
  // Oracle Recruiting Cloud (HCM) candidate sites. Slug: "<host>.oraclecloud.com/<site>", e.g. "egay.fa.us6.oraclecloud.com/CX_4001".
  async oracle(c) {
    const [host, site] = slugParts(c, 2, "<host>.oraclecloud.com/<site>");
    const out: Posting[] = [];
    for (let offset = 0; offset < NEWEST_MAX; offset += 25) {
      const data = (await getJson(
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${site},limit=25,offset=${offset},sortBy=POSTING_DATES_DESC`,
      )) as OraclePage;
      const page = data.items?.[0];
      const list = page?.requisitionList ?? [];
      for (const j of list)
        out.push({
          url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${j.Id}`,
          source: "oracle",
          company: c.name,
          title: j.Title,
          location: j.PrimaryLocation ?? null,
          description: null,
          posted: posted(j.PostedDate),
        });
      if (list.length < 25 || offset + 25 >= (page?.TotalJobsCount ?? 0)) break;
    }
    return out;
  },
  // ADP Workforce Now career centers. Slug: "<cid>", or "<cid>/<ccId>" when the career center is not the usual one.
  async adp(c) {
    const { cid, ccId, query } = adp(c);
    const out: Posting[] = [];
    for (let skip = 0; skip < NEWEST_MAX; skip += 100) {
      const data = (await getJson(`${ADP}/careercenter/public/events/staffing/v1/job-requisitions?${query}&$top=100&$skip=${skip}`)) as AdpPage;
      const list = data.jobRequisitions ?? [];
      for (const j of list) {
        const at = j.requisitionLocations?.[0]?.address;
        out.push({
          url: `${ADP}/mdf/recruitment/recruitment.html?cid=${cid}&ccId=${ccId}&jobId=${j.itemID}&lang=en_US`,
          source: "adp",
          company: c.name,
          title: j.requisitionTitle,
          location: place(at?.cityName, at?.countrySubdivisionLevel1?.codeValue, at?.countryCode),
          description: null,
          posted: posted(j.postDate),
        });
      }
      if (list.length < 100) break;
    }
    return out;
  },
  // UKG Pro (UltiPro) recruiting. Slug: "<host>/<tenant>/<board id>", e.g. "recruiting2.ultipro.com/CRA1009CRWL/755fc3a5-077f-4395-ad9a-01ffdc6dea89".
  async ukg(c) {
    const [host, tenant, board] = slugParts(c, 3, "<host>/<tenant>/<board id>");
    const base = `https://${host}/${tenant}/JobBoard/${board}`;
    const out: Posting[] = [];
    for (let skip = 0; skip < NEWEST_MAX; skip += 50) {
      const data = (await getJson(`${base}/JobBoardView/LoadSearchResults`, {
        opportunitySearch: {
          Top: 50,
          Skip: skip,
          QueryString: "",
          Filters: [],
          OrderBy: [{ Value: "postedDateDesc", PropertyName: "PostedDate", Ascending: false }],
        },
        matchCriteria: { PreferredJobs: [], Educations: [], LicenseAndCertifications: [], Skills: [], hasNoLicenses: false, SkippedSkills: [] },
      })) as UkgPage;
      const list = data.opportunities ?? [];
      for (const j of list) {
        const at = j.Locations?.[0]?.Address;
        out.push({
          url: `${base}/OpportunityDetail?opportunityId=${j.Id}`,
          source: "ukg",
          company: c.name,
          title: j.Title,
          location: place(at?.City, at?.State?.Code, at?.Country?.Code),
          description: null,
          posted: posted(j.PostedDate),
        });
      }
      if (list.length < 50 || skip + 50 >= (data.totalCount ?? 0)) break;
    }
    return out;
  },
  // iCIMS career portals, from their sitemap, which has no location. Slug: the host's first part, e.g. "careers-acme" for careers-acme.icims.com.
  async icims(c) {
    const xml = await getText(`https://${c.slug}.icims.com/sitemap.xml`);
    return [...xml.matchAll(/<loc>(https:\/\/[^<]+\/jobs\/\d+\/([^/<]+)\/job)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g)]
      .map(([, url = "", slug = "", lastmod]) => ({
        url,
        source: "icims",
        company: c.name,
        title: icimsTitle(slug),
        location: null,
        description: null,
        posted: posted(lastmod),
      }))
      .sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""))
      .slice(0, NEWEST_MAX);
  },
  // Eightfold career sites, US postings only (the rest would be dropped as abroad). Slug: "<host>.eightfold.ai/<company domain>".
  async eightfold(c) {
    const [host, domain] = slugParts(c, 2, "<host>.eightfold.ai/<company domain>");
    const out: Posting[] = [];
    for (let start = 0; start < EIGHTFOLD_MAX; start += 10) {
      const data = (await getJson(
        `https://${host}/api/pcsx/search?domain=${encodeURIComponent(domain)}&query=&location=United%20States&start=${start}&sort_by=timestamp`,
      )) as EightfoldPage;
      const list = data.data?.positions ?? [];
      for (const j of list)
        out.push({
          url: `https://${host}${j.positionUrl}?domain=${domain}`,
          source: "eightfold",
          company: c.name,
          title: j.name,
          location: (j.standardizedLocations ?? j.locations ?? []).join("; ") || null,
          description: null,
          posted: posted(j.postedTs ? j.postedTs * 1000 : null),
        });
      if (list.length < 10 || start + 10 >= (data.data?.count ?? 0)) break;
    }
    return out;
  },
  async breezy(c) {
    const data = (await getJson(`https://${c.slug}.breezy.hr/json`)) as BreezyBoard;
    return data.map(j => ({
      url: j.url,
      source: "breezy",
      company: c.name,
      title: j.name,
      location: place(j.location?.name, j.location?.is_remote && "Remote"),
      description: null,
      posted: posted(j.published_date),
    }));
  },
  // JazzHR boards (<slug>.applytojob.com), from the public listing page.
  async jazzhr(c) {
    const html = await getText(`https://${c.slug}.applytojob.com/apply`);
    const out: Posting[] = [];
    for (const [, item = ""] of html.matchAll(/<li class="list-group-item">([\s\S]*?)<\/ul>\s*<\/li>/g)) {
      const link = /<a href="(https:\/\/[^"]+\/apply\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(item);
      if (!link?.[1]) continue;
      out.push({
        url: link[1],
        source: "jazzhr",
        company: c.name,
        title: htmlToText(link[2] ?? ""),
        location: /fa-map-marker[^>]*><\/i>\s*([^<]+)/.exec(item)?.[1]?.trim() || null,
        description: null,
        posted: null,
      });
    }
    return out;
  },
  async bamboohr(c) {
    const data = (await getJson(`https://${c.slug}.bamboohr.com/careers/list`)) as BambooBoard;
    return (data.result ?? []).map(j => ({
      url: `https://${c.slug}.bamboohr.com/careers/${j.id}`,
      source: "bamboohr",
      company: c.name,
      title: j.jobOpeningName,
      location: place(j.atsLocation?.city, j.atsLocation?.state, j.atsLocation?.country, j.isRemote && "Remote"),
      description: null,
      posted: null,
    }));
  },
  // ClearCompany career sites. Slug: the site id, a GUID in the page's careers-content.clearcompany.com script URL (`siteId=`).
  async clearcompany(c) {
    const data = (await getJson(`https://careers-api.clearcompany.com/v1/${c.slug}`)) as ClearCompanyBoard;
    return (data.results ?? []).map(j => {
      const at = j.locations?.[0];
      return {
        url: j.applyLink.replace(/\/apply\/?$/, ""),
        source: "clearcompany",
        company: c.name,
        title: j.positionTitle,
        location: j.location || place(at?.city, at?.subdivision, at?.country, at?.isRemote && "Remote"),
        description: htmlToText(j.description ?? "") || null,
        posted: posted(j.postedDate?.slice(0, 10)), // a day, written as a zoneless midnight
      };
    });
  },
  // Paycor (Newton) recruiting, from its Atom feed. Slug: the `clientId` in a recruitingbypaycor.com URL.
  async paycor(c) {
    const xml = await getText(`https://recruitingbypaycor.com/career/CareerAtomFeed.action?clientId=${encodeURIComponent(c.slug)}`);
    return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].flatMap(([, e = ""]) => {
      const url = /<link[^>]*href="([^"]+)"/.exec(e)?.[1];
      return url
        ? [
            {
              url: htmlToText(url),
              source: "paycor",
              company: c.name,
              title: xmlTag(e, "title"),
              location: xmlTag(e, "name") || null,
              description: null,
              posted: posted(xmlTag(e, "updated")),
            },
          ]
        : [];
    });
  },
  // iCIMS's Jibe career sites (<host>/careers-home/jobs). Slug: the host, e.g. "careers.kindermorgan.com".
  async jibe(c) {
    const out: Posting[] = [];
    for (let page = 1; out.length < NEWEST_MAX; page++) {
      const data = (await getJson(
        `https://${c.slug}/api/jobs?keywords=${encodeURIComponent(c.search ?? "")}&page=${page}&limit=100&internal=false&sortBy=posted_date&descending=true`,
      )) as JibePage;
      const list = data.jobs ?? [];
      for (const { data: j } of list)
        out.push({
          url: `https://${c.slug}/careers-home/jobs/${j.slug}`,
          source: "jibe",
          company: c.name,
          title: j.title,
          location: j.full_location ?? null,
          description: htmlToText([j.description, j.responsibilities, j.qualifications].filter(Boolean).join("\n")) || null,
          posted: posted(j.posted_date),
        });
      if (!list.length || page * 100 >= (data.totalCount ?? 0)) break;
    }
    return out;
  },
  // Taleo career sections. Slug: "<host>/<section>/<portal>" for a faceted section, read through its
  // REST search (the portal number is in the page's searchjobs request), or "<host>/<section>" for an
  // older one, read through its paged listing.
  async taleo(c) {
    const parts = c.slug.split("/");
    if (parts.length === 2) return taleoLegacy(c);
    const [host, section, portal] = slugParts(c, 3, "<host>/<section>/<portal>");
    const out: Posting[] = [];
    for (let page = 1; out.length < NEWEST_MAX; page++) {
      const data = (await getJson(
        `https://${host}/careersection/rest/jobboard/searchjobs?lang=en&portal=${portal}`,
        {
          multilineEnabled: false,
          sortingSelection: { sortBySelectionParam: "3", ascendingSortingOrder: "false" },
          fieldData: { fields: { KEYWORD: c.search ?? "", LOCATION: "", CATEGORY: "" }, valid: true },
          filterSelectionParam: { searchFilterSelections: [] },
          advancedSearchFiltersSelectionParam: { searchFilterSelections: [] },
          pageNo: page,
        },
        { "x-requested-with": "XMLHttpRequest", tz: "GMT-06:00", tzname: "America/Chicago" },
      )) as TaleoPage;
      const list = data.requisitionList ?? [];
      for (const j of list) {
        const [title = "", where = "", day] = j.column;
        let location: string | null = where || null;
        try {
          if (where.startsWith("[")) location = (JSON.parse(where) as string[]).join("; ") || null;
        } catch {
          // left as written
        }
        out.push({
          url: `https://${host}/careersection/${section}/jobdetail.ftl?job=${j.contestNo}&lang=en`,
          source: "taleo",
          company: c.name,
          title,
          location,
          description: null,
          posted: usDay(day),
        });
      }
      if (!list.length || page * (data.pagingData?.pageSize ?? 25) >= (data.pagingData?.totalCount ?? 0)) break;
    }
    return out;
  },
  // Avature career sites. Slug: the search page's address without "https://", e.g.
  // "jobs.siemens-energy.com/en_US/jobs/SearchJobsUS". Its listing has titles only.
  async avature(c) {
    const out: Posting[] = [];
    const seen = new Set<string>();
    for (let offset = 0; offset < NEWEST_MAX; offset += 20) {
      const html = await getText(
        `https://${c.slug.replace(/\/$/, "")}/?jobRecordsPerPage=20&jobOffset=${offset}&folderRecordsPerPage=20&folderOffset=${offset}`,
      );
      let found = 0;
      for (const [, url = "", id = "", title = ""] of html.matchAll(
        /<a[^>]+href="(https:\/\/[^"]+\/(?:Folder|Job)Detail\/[^"]+\/(\d+))"[^>]*>\s*([^<]+?)\s*<\/a>/g,
      )) {
        if (seen.has(id)) continue;
        seen.add(id);
        found++;
        out.push({ url: htmlToText(url), source: "avature", company: c.name, title: htmlToText(title), location: null, description: null, posted: null });
      }
      if (!found) break;
    }
    return out;
  },
  // Coveo for Sitecore career search, as SLB runs it, US postings only. Slug: the host, e.g. "careers.slb.com".
  async coveo(c) {
    const data = (await getJson(
      `https://${c.slug}/coveo/rest/search/v2`,
      new URLSearchParams({
        q: c.search ?? "",
        aq: '@source=="ATS_Jobs_Source - Prod" @country=="United States"',
        numberOfResults: String(NEWEST_MAX),
        sortCriteria: "@jobposteddate descending",
        fieldsToInclude: '["title","city","country","jobposteddate","clickableuri"]',
      }),
    )) as CoveoResults;
    return (data.results ?? []).map(j => ({
      url: j.clickUri.split(" ")[0] ?? j.clickUri,
      source: "coveo",
      company: c.name,
      title: j.raw.title ?? "",
      location: place(...[j.raw.city ?? []].flat(), "US"),
      description: null,
      posted: posted(j.raw.jobposteddate),
    }));
  },
  // SAP SuccessFactors career sites (Career Site Builder), from their RSS feed. Slug: the host, e.g. "careers.phillips66.com".
  async successfactors(c) {
    const xml = await getText(`https://${c.slug}/services/rss/job/?locale=en_US&keywords=${encodeURIComponent(c.search ?? "")}&rows=5000`);
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
      .map(([, item = ""]) => {
        // "Title (City, ST, US, 77001)"
        const raw = xmlTag(item, "title");
        const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(raw);
        return {
          url: (xmlTag(item, "link").split("?")[0] ?? "").replace(/^http:/, "https:"),
          source: "successfactors",
          company: c.name,
          title: m?.[1] ?? raw,
          location: m?.[2] || null,
          description: null,
          posted: posted(xmlTag(item, "pubDate")),
        };
      })
      .filter(p => p.url)
      .sort((a, b) => (b.posted ?? "").localeCompare(a.posted ?? ""))
      .slice(0, NEWEST_MAX);
  },
  // Radancy (TalentBrew) career sites. Slug: the host, e.g. "careers.l3harris.com".
  async radancy(c) {
    const out: Posting[] = [];
    const seen = new Set<string>();
    for (let page = 1, pages = 1; page <= pages && out.length < NEWEST_MAX; page++) {
      const data = (await getJson(
        `https://${c.slug}/search-jobs/results?ActiveFacetID=0&RecordsPerPage=100&Distance=50&RadiusUnitType=0&Keywords=${encodeURIComponent(c.search ?? "")}&Location=&ShowRadius=False&IsPagination=True&FacetFilters=&SearchResultsModuleName=Search+Results&SearchFiltersModuleName=Search+Filters&SortCriteria=0&SortDirection=0&SearchType=5&CurrentPage=${page}`,
        undefined,
        { "x-requested-with": "XMLHttpRequest" },
      )) as { results?: string };
      const html = data.results ?? "";
      pages = Number(/data-total-pages="(\d+)"/.exec(html)?.[1] ?? 1);
      for (const [, li = ""] of html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
        const link = /<a href="([^"]+)"[^>]*data-job-id="(\d+)"/.exec(li);
        const title = /<h2>([\s\S]*?)<\/h2>/.exec(li)?.[1];
        if (!link?.[1] || !link[2] || !title || seen.has(link[2])) continue;
        seen.add(link[2]);
        const where = [...li.matchAll(/class="[^"]*job-location[^"]*">([\s\S]*?)<\/span>/g)].map(([, l = ""]) => htmlToText(l).replace(/\s+/g, " "));
        out.push({
          url: `https://${c.slug}${htmlToText(link[1])}`,
          source: "radancy",
          company: c.name,
          title: htmlToText(title),
          location: where.join("; ") || null,
          description: null,
          posted: null,
        });
      }
    }
    return out;
  },
};

// An older Taleo career section (no REST search): the listing page carries a form whose fields the
// paged listing wants back, with the session cookie it set. Rows come as "!|!"-separated fields.
async function taleoLegacy(c: Company): Promise<Posting[]> {
  const [host, section] = slugParts(c, 2, "<host>/<section>");
  const page = `https://${host}/careersection/${section}/jobsearch.ftl?lang=en`;
  const first = await getResponse(page);
  const cookie = first.headers
    .getSetCookie()
    .map(s => s.split(";")[0])
    .join("; ");
  const html = await first.text();
  const form = new URLSearchParams();
  for (const [, name = "", value = ""] of html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g))
    form.set(htmlToText(name), htmlToText(value));
  const total = Number(form.get("listRequisition.nbElements") ?? 0);
  for (const [k, v] of Object.entries({
    ftlinterfaceid: "requisitionListInterface",
    ftlcompid: "rlPager",
    jsfCmdId: "rlPager",
    ftlcompclass: "PagerComponent",
    ftlcallback: "ftlPager_processResponse",
    ftlajaxid: "ftlx1",
  }))
    form.set(k, v);
  const rows = new Map<string, Posting>();
  // Page 1 too: the page itself lists its first rows in another order than the pager.
  for (let n = 1; n <= 40 && rows.size < Math.min(total, NEWEST_MAX); n++) {
    form.set("rlPager.currentPage", String(n));
    const blob = await getText(`https://${host}/careersection/${section}/jobsearch.ajax`, {
      method: "POST",
      body: form,
      headers: { referer: page, "x-requested-with": "XMLHttpRequest", ...(cookie ? { cookie } : {}) },
    });
    let found = 0;
    for (const [, id = "", no = "", title = "", where = "", day = ""] of blob.matchAll(TALEO_ROW)) {
      found++;
      rows.set(id, {
        url: `https://${host}/careersection/${section}/jobdetail.ftl?job=${no}&lang=en`,
        source: "taleo",
        company: c.name,
        title: decodeUri(title.replace(/%5C/g, "")),
        location: decodeUri(where) || null,
        description: null,
        posted: usDay(day),
      });
    }
    if (!found) break;
  }
  return [...rows.values()];
}
const TALEO_ROW = /!\|!(\d+)!\|!([0-9A-Za-z]+)!\|!([^!]+)!\|!\1!\|!\3!\|!\1!\|!([^!]*)!\|!(?:[^!]*!\|!){5}([^!]*)!\|!Apply/g;

// The board a posting's URL is on, as a company to watch, when it is one of the boards above.
export function boardOf(url: string, name: string): Company | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase(),
    path = u.pathname;
  const first = path.split("/")[1] ?? "";
  const at = (ats: Ats, slug: string | null | undefined): Company | null => (slug ? { name, ats, slug } : null);
  if (/^(boards|job-boards)\.greenhouse\.io$/.test(host) && /^\/[\w-]+\/jobs\//.test(path) && first !== "embed") return at("greenhouse", first);
  if (host === "jobs.lever.co") return at("lever", first);
  if (host === "jobs.eu.lever.co") return at("lever", first && `eu/${first}`);
  if (host === "jobs.ashbyhq.com") return at("ashby", first);
  if (host === "apply.workable.com" && first !== "api" && first !== "j") return at("workable", first); // /j/<id> is a short link
  if (host.endsWith(".recruitee.com")) return at("recruitee", host.split(".")[0]);
  if (host === "jobs.smartrecruiters.com") return at("smartrecruiters", first);
  const wd = /^([\w-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(host);
  if (wd) return at("workday", `${wd[1]}.${wd[2]}/${/^[a-z]{2}-[A-Z]{2}$/.test(first) ? path.split("/")[2] : first}`);
  const oracle = /\/hcmUI\/CandidateExperience\/[\w-]+\/sites\/([\w-]+)/.exec(path);
  if (host.endsWith(".oraclecloud.com") && oracle) return at("oracle", `${host}/${oracle[1]}`);
  if (host === "workforcenow.adp.com") {
    const cid = u.searchParams.get("cid"),
      ccId = u.searchParams.get("ccId");
    return at("adp", cid && (ccId && ccId !== ADP_CCID ? `${cid}/${ccId}` : cid));
  }
  const ukg = /^\/([\w-]+)\/JobBoard\/([\w-]+)/.exec(path);
  if (/(^|\.)(ultipro\.com|ukg\.net)$/.test(host) && ukg) return at("ukg", `${host}/${ukg[1]}/${ukg[2]}`);
  if (host.endsWith(".icims.com") && path.startsWith("/jobs/")) return at("icims", host.slice(0, -".icims.com".length));
  if (host.endsWith(".eightfold.ai") && u.searchParams.get("domain")) return at("eightfold", `${host}/${u.searchParams.get("domain")}`);
  if (host.endsWith(".breezy.hr")) return at("breezy", host.split(".")[0]);
  if (host.endsWith(".applytojob.com")) return at("jazzhr", host.split(".")[0]);
  if (host.endsWith(".bamboohr.com") && first === "careers") return at("bamboohr", host.split(".")[0]);
  if (host === "recruitingbypaycor.com") return at("paycor", u.searchParams.get("clientId"));
  if (path.startsWith("/careers-home/jobs/")) return at("jibe", host);
  return null;
}

// Two boards are one when they are the same kind with the same slug.
const sameBoard = (a: Company) => (b: Company) => a.ats === b.ats && a.slug.toLowerCase() === b.slug.toLowerCase();

// Watches the board a posting was found on, when boardOf knows it and it is not watched yet, so the
// employer's later postings arrive with each scan rather than through a search. A board that lists
// nothing is left alone. Returns the board when it was added.
export async function watchBoardOf(url: string, name: string): Promise<Company | null> {
  const company = boardOf(url, name);
  if (!company || loadCompanies().some(sameBoard(company))) return null;
  const postings = await fetchCompany(company).catch(() => []);
  return postings.length && addCompany(company) ? company : null;
}

// What a board is read from, so that boards on one host are read one at a time.
export function boardHost(c: Company): string {
  if (c.ats === "workday") return c.slug.split("/")[0] ?? c.slug;
  if (["oracle", "ukg", "eightfold", "taleo", "avature"].includes(c.ats)) return c.slug.split("/")[0] ?? c.slug;
  if (["jibe", "coveo", "successfactors", "radancy"].includes(c.ats)) return c.slug;
  if (["icims", "breezy", "jazzhr", "bamboohr", "recruitee"].includes(c.ats)) return `${c.ats}:${c.slug}`;
  return c.ats; // one shared API: Greenhouse, Lever, Ashby, Workable, SmartRecruiters, ADP, ClearCompany, Paycor
}

// Boards that list without the body text: fetch it for one posting.
export async function fetchDescription(url: string): Promise<string | null> {
  try {
    const wd = /^(https:\/\/([\w-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)(\/job\/.+)$/.exec(url);
    if (wd) {
      const info = ((await getJson(`${wd[1]}/wday/cxs/${wd[2]}/${wd[3]}${wd[4]}`)) as WorkdayPosting).jobPostingInfo;
      return info?.jobDescription ? htmlToText(info.jobDescription) : null;
    }
    const sr = /^https:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/(\d+)/.exec(url);
    if (sr) {
      const sections =
        ((await getJson(`https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings/${sr[2]}`)) as SmartRecruitersPosting).jobAd?.sections ?? {};
      const text = ["jobDescription", "qualifications", "additionalInformation"]
        .map(k => sections[k])
        .map(s => (s?.text ? `${s.title ?? ""}\n${htmlToText(s.text)}` : ""))
        .filter(Boolean)
        .join("\n\n");
      return text || null;
    }
    const oracle = /^https:\/\/([\w.-]+\.oraclecloud\.com)\/hcmUI\/CandidateExperience\/[\w-]+\/sites\/([\w-]+)\/job\/(\d+)/.exec(url);
    if (oracle) {
      const data = (await getJson(
        `https://${oracle[1]}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${oracle[3]}%22,siteNumber=${oracle[2]}`,
      )) as OracleDetails;
      const it = data.items?.[0];
      const text = [it?.ExternalDescriptionStr, it?.ExternalResponsibilitiesStr, it?.ExternalQualificationsStr]
        .filter(Boolean)
        .map(h => htmlToText(h ?? ""))
        .join("\n\n");
      return text || null;
    }
    if (url.startsWith(`${ADP}/mdf/recruitment/recruitment.html?`)) {
      const q = new URL(url).searchParams;
      const [cid, ccId, jobId] = [q.get("cid"), q.get("ccId") ?? ADP_CCID, q.get("jobId")];
      if (!cid || !jobId) return null;
      const j = (await getJson(
        `${ADP}/careercenter/public/events/staffing/v1/job-requisitions/${jobId}?cid=${cid}&ccId=${ccId}&lang=en_US&locale=en_US`,
      )) as AdpRequisition;
      return j.requisitionDescription ? htmlToText(j.requisitionDescription) || null : null;
    }
    const eightfold = /^https:\/\/([\w.-]+\.eightfold\.ai)\/careers\/job\/(\d+)\?domain=([^&#]+)/.exec(url);
    if (eightfold) {
      const data = (await getJson(`https://${eightfold[1]}/api/pcsx/position_details?position_id=${eightfold[2]}&domain=${eightfold[3]}&hl=en`)) as {
        data?: { jobDescription?: string };
      };
      return data.data?.jobDescription ? htmlToText(data.data.jobDescription) || null : null;
    }
    const bamboo = /^https:\/\/([\w-]+)\.bamboohr\.com\/careers\/(\d+)/.exec(url);
    if (bamboo) {
      const data = (await getJson(`https://${bamboo[1]}.bamboohr.com/careers/${bamboo[2]}/detail`)) as { result?: { jobOpening?: { description?: string } } };
      const html = data.result?.jobOpening?.description;
      return html ? htmlToText(html) || null : null;
    }
    // Any other career page: UKG's carries the posting as JSON in a script, most others as schema.org JobPosting.
    if (AGGREGATOR.test(url)) return null;
    const page = await getText(url.includes(".icims.com/") ? `${url}${url.includes("?") ? "&" : "?"}in_iframe=1` : url);
    const ukg = /CandidateOpportunityDetail\(\{[\s\S]*?"Description":("(?:[^"\\]|\\.)*")/.exec(page);
    if (ukg?.[1]) return htmlToText(JSON.parse(ukg[1]) as string) || null;
    return jsonLdDescription(page);
  } catch {
    return null;
  }
}

// Job sites whose pages are read another way, if at all.
const AGGREGATOR = /^https?:\/\/([\w-]+\.)*(linkedin|indeed)\.com\//i;

// The description in a page's schema.org JobPosting, which most career sites publish for search engines.
export function jsonLdDescription(html: string): string | null {
  for (const [, body = ""] of html.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(body.trim());
    } catch {
      continue;
    }
    const graph = data && typeof data === "object" && "@graph" in data ? data["@graph"] : data;
    for (const node of Array.isArray(graph) ? graph : [graph]) {
      if (!node || typeof node !== "object") continue;
      const { "@type": type, description } = node as Record<string, unknown>;
      if ((type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) && typeof description === "string")
        return htmlToText(description) || null;
    }
  }
  return null;
}

// ---- keyword feeds: remote-job aggregators and internship lists with a public JSON file. They list any employer, so each
// posting is matched against jobs already known (see findTwin in db.ts) and folded in when it is the
// same role. Each has its own minimum interval, since they ask for a handful of requests a day.

export interface Feed {
  minutes: number;
  [param: string]: unknown;
}
const list = (v: unknown) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
const US = /\b(usa?|united states|u\.s\.|north america|americas|worldwide|anywhere|global)\b/i;

const feeds: Record<string, (f: Feed) => Promise<Posting[]>> = {
  async remotive(f) {
    const out: Posting[] = [];
    for (const category of list(f["categories"])) {
      const data = (await getJson(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}`)) as RemotiveFeed;
      for (const j of data.jobs ?? []) {
        const where = j.candidate_required_location ?? "";
        if (!where || US.test(where))
          out.push({
            url: j.url,
            source: "remotive",
            company: String(j.company_name).trim(),
            title: j.title,
            location: `Remote (${where || "anywhere"})`,
            description: htmlToText(j.description ?? "") || null,
            posted: posted(j.publication_date && !/[Z+]/.test(j.publication_date) ? j.publication_date + "Z" : j.publication_date),
          });
      }
    }
    return out;
  },
  async jobicy(f) {
    const out: Posting[] = [];
    const geo = typeof f["geo"] === "string" || typeof f["geo"] === "number" ? String(f["geo"]) : "usa";
    for (const industry of list(f["industries"])) {
      const data = (await getJson(
        `https://jobicy.com/api/v2/remote-jobs?count=${Number(f["count"] ?? 50)}&geo=${encodeURIComponent(geo)}&industry=${encodeURIComponent(industry)}`,
      )) as JobicyFeed;
      for (const j of data.jobs ?? [])
        out.push({
          url: j.url,
          source: "jobicy",
          company: j.companyName,
          title: j.jobTitle,
          location: `Remote (${(j.jobGeo ?? "").replace(/\s+/g, " ")})`,
          description: htmlToText(j.jobDescription ?? "") || null,
          posted: posted(j.pubDate),
        });
    }
    return out;
  },
  async remoteok(f) {
    const out: Posting[] = [];
    for (const tag of list(f["tags"])) {
      const data = await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
      for (const j of (Array.isArray(data) ? data : []) as RemoteOkJob[]) {
        const where = j.location ?? "";
        if (j.position && j.url && (!where || US.test(where)))
          out.push({
            url: j.url,
            source: "remoteok",
            company: j.company,
            title: j.position,
            location: `Remote (${where || "anywhere"})`,
            description: htmlToText(j.description ?? "") || null,
            posted: posted(j.date),
          });
      }
    }
    return out;
  },
};

// The Simplify internship list (SimplifyJobs/Summer2027-Internships on GitHub, the `url` option for
// another year's), its open and listed roles only; `terms` keeps those for the named terms ("Summer
// 2027"). Its links carry Simplify's own tracking, which is dropped.
const SIMPLIFY = "https://raw.githubusercontent.com/SimplifyJobs/Summer2027-Internships/dev/.github/scripts/listings.json";
export function simplifyUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const key of [...u.searchParams.keys()])
      if ((/^utm_/i.test(key) || key === "ref") && /simplify/i.test(u.searchParams.get(key) ?? "")) u.searchParams.delete(key);
    return u.toString();
  } catch {
    return url;
  }
}
feeds["simplify"] = async f => {
  const terms = new Set(list(f["terms"]).map(t => t.toLowerCase()));
  const data = (await getJson(typeof f["url"] === "string" ? f["url"] : SIMPLIFY)) as SimplifyListing[];
  return (Array.isArray(data) ? data : [])
    .filter(j => j.active && j.is_visible !== false && j.url && (!terms.size || (j.terms ?? []).some(t => terms.has(t.toLowerCase()))))
    .map(j => ({
      url: simplifyUrl(j.url),
      source: "simplify",
      company: j.company_name.trim(),
      title: j.title,
      location: (j.locations ?? []).join("; ") || null,
      description: null,
      posted: posted(j.date_posted ? j.date_posted * 1000 : null),
    }));
};

export const feedNames = () => {
  const all = config.feeds ?? {};
  return Object.keys(all).filter(n => n in feeds && Number(all[n]?.minutes) > 0);
};
export const fetchFeed = (name: string) => {
  const read = feeds[name],
    feed = config.feeds?.[name];
  if (!read || !feed) throw new Error(`feed "${name}" is not configured`);
  return read(feed);
};

export const isAts = (s: string): s is Ats => s in fetchers;
export const fetchCompany = (c: Company) => fetchers[c.ats](c);
