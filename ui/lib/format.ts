const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, c => ESCAPES[c] ?? c);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
export const num = (n: number) => n.toLocaleString();

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const unent = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) =>
    !e.startsWith("#")
      ? (NAMED[e.toLowerCase()] ?? m)
      : String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))).replace(/\u00a0/g, " "),
  );

export const MINUTE = 6e4;
export const HOUR = 36e5;
export const DAY = 864e5;

export const parseAt = (s: string | null | undefined) => (s ? Date.parse(s.length === 10 || s.includes("T") ? s : s.replace(" ", "T") + "Z") : 0);

export const ago = (at: string | number | null | undefined) => {
  if (!at) return "";
  const ms = Date.now() - (typeof at === "number" ? at : parseAt(at));
  return ms < MINUTE ? "just now" : `${span(ms)} ago`;
};
export const agoShort = (at: string | number | null | undefined) => {
  if (!at) return "";
  const ms = Date.now() - (typeof at === "number" ? at : parseAt(at));
  return ms < MINUTE ? "now" : span(ms);
};
export const relative = (at: string | number) => {
  const ms = (typeof at === "number" ? at : parseAt(at)) - Date.now();
  return ms >= 0 ? `in ${span(ms)}` : ago(at);
};
export const span = (ms: number) => {
  const m = Math.max(1, Math.trunc(Math.abs(ms) / MINUTE)),
    d = Math.trunc(m / 1440),
    months = Math.trunc(d / 30.44);
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.trunc(m / 60)}h`;
  if (d < 14) return `${d}d`;
  if (d < 60) return `${Math.trunc(d / 7)}w`;
  return months < 24 ? `${months}mo` : `${Math.trunc(d / 365)}y`;
};

export const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
export const unmark = (s: string) =>
  s
    .replace(MD_LINK, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\\"/g, '"');

export const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<"]*[^\s<".,;:)]/g;
export const shortUrl = (url: string) => {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.protocol === "mailto:") return safeDecode(u.pathname);
  const segs = u.pathname.split("/").filter(Boolean);
  let path = "",
    taken = 0;
  for (const s of segs) {
    const next = `${path}/${safeDecode(s)}`;
    if (next.length > 24) break;
    path = next;
    taken++;
  }
  if (!taken && segs[0]) path = `/${safeDecode(segs[0]).slice(0, 20)}`;
  const cut = taken < segs.length || !!u.search || !!u.hash;
  path = path.replace(/(?<=\/[^/]+)\.[a-z]{2,5}$/i, "");
  return `${u.hostname.replace(/^www\./, "")}${path || (cut ? "/" : "")}${cut ? "…" : ""}`;
};
const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};
export const plain = (s: string) => unmark(s).replace(BARE_URL, shortUrl);

export const withoutCompany = (text: string, company: string) => {
  const m = /^([^:"“\n]{2,40}):\s+/.exec(text);
  if (!m?.[1]) return text;
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const of = new Set(words(company)),
    lead = words(m[1]);
  return lead.length && lead.every(w => of.has(w)) ? cap(text.slice(m[0].length)) : text;
};

export const firstClause = (text: string) => {
  const t = text.trim();
  let quoted = false,
    end = t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t[i] ?? "",
      after = t[i + 1] ?? "";
    if (c === '"') quoted = !quoted;
    else if (c === "“" || c === "”") quoted = c === "“";
    else if (quoted) continue;
    else if (c === ";" || c === "\n" || (/[.!?]/.test(c) && /\s/.test(after)) || (/[—–]/.test(c) && t[i - 1] === " " && after === " ")) {
      end = c === "!" || c === "?" ? i + 1 : i;
      break;
    }
  }
  const clause = t
    .slice(0, end)
    .trim()
    .replace(/[.,:]$/, "");
  const q = /^["“]([^"“”]+)["”]$/.exec(clause);
  return q?.[1] ? cap(q[1]) : clause;
};

export const brief = (text: string, company = "") => firstClause(withoutCompany(plain(text), company));

export const dateTime = (at: string | number) =>
  new Date(typeof at === "number" ? at : parseAt(at)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const date = (at: string | number) => {
  const d = new Date(typeof at === "number" ? at : parseAt(at));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};
export const clock = (at: string | number) =>
  new Date(typeof at === "number" ? at : parseAt(at)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
export const dayLabel = (at: string | number) => {
  const d = new Date(typeof at === "number" ? at : parseAt(at)),
    days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
export const place = (location: string | null | undefined) => {
  const [first, ...more] = (location ?? "")
    .split(/\s*[|•;]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  return !first ? "No location given" : more.length ? `${first} +${more.length}` : first;
};
export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
