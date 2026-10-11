// Public job-board feeds. No scraping and no browser: these are documented JSON endpoints.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import { config, PROFILE } from "./config";

export const ATS = ["greenhouse", "lever", "ashby", "workable", "recruitee", "smartrecruiters", "workday"] as const;
export type Ats = (typeof ATS)[number];
export interface Company {
  name: string;
  ats: Ats;
  // Board id as it appears in the board's URL. Workday: "<tenant>.<wdN>/<site>", e.g. "acme.wd5/External".
  slug: string;
  // Workday only: keyword filter, for employers with thousands of openings.
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
    return (YAML.parse(readFileSync(companiesPath, "utf8"))?.companies ?? []) as Company[];
  } catch {
    return [];
  }
}

export function addCompany(c: Company): boolean {
  const all = loadCompanies();
  if (all.some(x => x.ats === c.ats && x.slug.toLowerCase() === c.slug.toLowerCase())) return false;
  all.push(c);
  writeFileSync(companiesPath, YAML.stringify({ companies: all }));
  return true;
}

export const htmlToText = (html: string) =>
  html
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>|<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

// Identify ourselves honestly; these are public endpoints meant for programmatic use.
const HEADERS = { accept: "application/json", "user-agent": "auto-apply/1.0 (personal job search)" };
async function getJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { ...HEADERS, "content-type": "application/json" } : HEADERS,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<any>;
}
// A source's date field as an ISO time; a bare date stays a bare date.
export const posted = (v: unknown): string | null => {
  if (v == null || v === "") return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const t = typeof v === "number" ? v : Date.parse(String(v));
  return Number.isFinite(t) && t > 0 ? new Date(t).toISOString() : null;
};
// Workday only says "Posted Today", "Posted Yesterday", "Posted 3 Days Ago" or "Posted 30+ Days Ago".
const workdayPosted = (s: unknown): string | null => {
  const m = String(s ?? "").match(/today|yesterday|(\d+)\+?\s*days?/i);
  if (!m) return null;
  const days = m[1] ? Number(m[1]) : /yesterday/i.test(m[0]) ? 1 : 0;
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
};
const place = (...parts: (string | null | undefined | false)[]) => [...new Set(parts.filter(Boolean))].join(", ") || null;

const WORKDAY_MAX = 200; // newest postings read per board and scan
function workday(c: Company) {
  const m = c.slug.match(/^([\w-]+)\.(wd\d+)\/([\w-]+)$/i);
  if (!m) throw new Error(`workday slug must look like "tenant.wd5/Site", got "${c.slug}"`);
  const [, tenant, pod, site] = m;
  const host = `https://${tenant}.${pod}.myworkdayjobs.com`;
  return { api: `${host}/wday/cxs/${tenant}/${site}`, page: `${host}/en-US/${site}` };
}

const fetchers: Record<Ats, (c: Company) => Promise<Posting[]>> = {
  async greenhouse(c) {
    const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${c.slug}/jobs?content=true`);
    return (data.jobs ?? []).map((j: any) => ({
      url: j.absolute_url,
      source: "greenhouse",
      company: c.name,
      title: j.title,
      location: j.location?.name ?? null,
      description: j.content ? htmlToText(j.content) : null,
      posted: posted(j.first_published),
    }));
  },
  async lever(c) {
    const data = await getJson(`https://api.lever.co/v0/postings/${c.slug}?mode=json`);
    return (data ?? []).map((j: any) => ({
      url: j.hostedUrl,
      source: "lever",
      company: c.name,
      title: j.text,
      location: j.categories?.location ?? null,
      description: [j.descriptionPlain, ...(j.lists ?? []).map((l: any) => `${l.text}\n${htmlToText(l.content ?? "")}`), j.additionalPlain]
        .filter(Boolean)
        .join("\n\n"),
      posted: posted(j.createdAt),
    }));
  },
  async ashby(c) {
    const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${c.slug}`);
    return (data.jobs ?? [])
      .filter((j: any) => j.isListed !== false)
      .map((j: any) => ({
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
    const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${c.slug}?details=true`);
    return (data.jobs ?? []).map((j: any) => ({
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
    const data = await getJson(`https://${c.slug}.recruitee.com/api/offers/`);
    return (data.offers ?? [])
      .filter((j: any) => !j.status || j.status === "published")
      .map((j: any) => ({
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
      const data = await getJson(`https://api.smartrecruiters.com/v1/companies/${c.slug}/postings?limit=100&offset=${offset}`);
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
      const data = await getJson(`${api}/jobs`, { appliedFacets: {}, limit: 20, offset, searchText: c.search ?? "" });
      for (const j of data.jobPostings ?? [])
        if (j.externalPath) out.push({ url: page + j.externalPath, source: "workday", company: c.name, title: j.title, location: j.locationsText ?? null, description: null, posted: workdayPosted(j.postedOn) });
      if (offset + 20 >= (data.total ?? 0) || !(data.jobPostings ?? []).length) break;
    }
    return out;
  },
};

// Boards that list without the body text: fetch it for one posting.
export async function fetchDescription(url: string): Promise<string | null> {
  try {
    const wd = url.match(/^(https:\/\/([\w-]+)\.wd\d+\.myworkdayjobs\.com)\/(?:[a-z]{2}-[A-Z]{2}\/)?([\w-]+)(\/job\/.+)$/);
    if (wd) {
      const info = (await getJson(`${wd[1]}/wday/cxs/${wd[2]}/${wd[3]}${wd[4]}`)).jobPostingInfo;
      return info?.jobDescription ? htmlToText(info.jobDescription) : null;
    }
    const sr = url.match(/^https:\/\/jobs\.smartrecruiters\.com\/([^/]+)\/(\d+)/);
    if (sr) {
      const sections = (await getJson(`https://api.smartrecruiters.com/v1/companies/${sr[1]}/postings/${sr[2]}`)).jobAd?.sections ?? {};
      const text = ["jobDescription", "qualifications", "additionalInformation"].map(k => (sections[k]?.text ? `${sections[k].title ?? ""}\n${htmlToText(sections[k].text)}` : "")).filter(Boolean).join("\n\n");
      return text || null;
    }
  } catch {}
  return null;
}

// ---- keyword feeds: remote-job aggregators with a public JSON API. They list any employer, so each
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
    for (const category of list(f.categories)) {
      const data = await getJson(`https://remotive.com/api/remote-jobs?category=${encodeURIComponent(category)}`);
      for (const j of data.jobs ?? [])
        if (!j.candidate_required_location || US.test(j.candidate_required_location))
          out.push({ url: j.url, source: "remotive", company: String(j.company_name).trim(), title: j.title, location: `Remote (${j.candidate_required_location || "anywhere"})`, description: htmlToText(j.description ?? "") || null, posted: posted(j.publication_date && !/[Z+]/.test(j.publication_date) ? j.publication_date + "Z" : j.publication_date) });
    }
    return out;
  },
  async jobicy(f) {
    const out: Posting[] = [];
    for (const industry of list(f.industries)) {
      const data = await getJson(`https://jobicy.com/api/v2/remote-jobs?count=${Number(f.count ?? 50)}&geo=${encodeURIComponent(String(f.geo ?? "usa"))}&industry=${encodeURIComponent(industry)}`);
      for (const j of data.jobs ?? [])
        out.push({ url: j.url, source: "jobicy", company: j.companyName, title: j.jobTitle, location: `Remote (${String(j.jobGeo ?? "").replace(/\s+/g, " ")})`, description: htmlToText(j.jobDescription ?? "") || null, posted: posted(j.pubDate) });
    }
    return out;
  },
  async remoteok(f) {
    const out: Posting[] = [];
    for (const tag of list(f.tags)) {
      const data = await getJson(`https://remoteok.com/api?tag=${encodeURIComponent(tag)}`);
      for (const j of Array.isArray(data) ? data : [])
        if (j.position && j.url && (!j.location || US.test(j.location)))
          out.push({ url: j.url, source: "remoteok", company: j.company, title: j.position, location: `Remote (${j.location || "anywhere"})`, description: htmlToText(j.description ?? "") || null, posted: posted(j.date) });
    }
    return out;
  },
};

export const feedNames = () => Object.keys(config.feeds ?? {}).filter(n => n in feeds && Number(config.feeds![n]?.minutes) > 0);
export const fetchFeed = (name: string) => feeds[name](config.feeds![name]);

export const isAts = (s: string): s is Ats => s in fetchers;
export const fetchCompany = (c: Company) => fetchers[c.ats](c);
