// Formatting for text and times. Nothing here knows about jobs.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, c => ESCAPES[c] ?? c);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, word: string, many = `${word}s`) => `${n.toLocaleString()} ${n === 1 ? word : many}`;
export const num = (n: number) => n.toLocaleString();

// Some boards hand over descriptions with the entities still encoded.
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

// A time the server wrote, as ISO, as SQLite's "YYYY-MM-DD HH:MM:SS" in UTC, or as a bare day, in ms.
export const parseAt = (s: string | null | undefined) => (s ? Date.parse(s.length === 10 || s.includes("T") ? s : s.replace(" ", "T") + "Z") : 0);

// "3h ago", "just now".
export const ago = (at: string | number | null | undefined) => {
  if (!at) return "";
  const ms = Date.now() - (typeof at === "number" ? at : parseAt(at));
  return ms < MINUTE ? "just now" : `${span(ms)} ago`;
};
// "in 3h", or "3h ago" for a past time.
export const relative = (at: string | number) => {
  const ms = (typeof at === "number" ? at : parseAt(at)) - Date.now();
  return ms >= 0 ? `in ${span(ms)}` : ago(at);
};
// A span of time, compact: "40m", "5h", "3d", "2w", "4mo", then years past two: "5y".
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

// Agents write a little markdown into their notes: "[resume.pdf](./resume.pdf)", "**Approved**", "`resume.pdf`",
// and quotes still escaped from JSON (\"Yes\"). As plain text, a link reads as its label and the marks go.
export const MD_LINK = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
export const unmark = (s: string) =>
  s
    .replace(MD_LINK, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\\"/g, '"');

// A bare web or mail address in agent text, without the punctuation that ends the sentence around it.
export const BARE_URL = /(?:https?:\/\/|mailto:)[^\s<"]*[^\s<".,;:)]/g;
// An address short enough to sit in a sentence: the host and the start of the path, "gx.gallup.com/pa2-insight…",
// or a mail link's address. Tokens and tracking in the rest say nothing to a reader; the link keeps them.
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
  // A first segment too long for the budget is cut rather than dropped, so the link still says where it goes.
  if (!taken && segs[0]) path = `/${safeDecode(segs[0]).slice(0, 20)}`;
  const cut = taken < segs.length || !!u.search || !!u.hash;
  // "pa2-insight.gx" reads as "pa2-insight": the extension is plumbing.
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
// Agent text as one plain string: marks gone, addresses short. For places a link cannot go (inside a row's link).
export const plain = (s: string) => unmark(s).replace(BARE_URL, shortUrl);

// The mailbox agent often opens a step with the employer's name ("Pyramid: …"). Shown beside the company,
// that only repeats it, so the name goes when every word of it is in the company's.
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

// The first clause of an agent's summary, for a row with room for one line: up to a semicolon, a spaced
// dash, a line break or the end of a sentence, never inside a quotation. A clause that is all quotation
// reads without its marks.
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

// A step or note as a row shows it: one plain line, without the employer's name when the row shows it.
export const brief = (text: string, company = "") => firstClause(withoutCompany(plain(text), company));

// "Oct 24, 2:05 PM"
export const dateTime = (at: string | number) =>
  new Date(typeof at === "number" ? at : parseAt(at)).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
// "Oct 24" (with the year when it is not this one)
export const date = (at: string | number) => {
  const d = new Date(typeof at === "number" ? at : parseAt(at));
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: "numeric" }) });
};
// "14:05" on the local clock.
export const clock = (at: string | number) =>
  new Date(typeof at === "number" ? at : parseAt(at)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
// The local day a time falls on, as a group header: "Today", "Yesterday", "Mon, Oct 12".
export const dayLabel = (at: string | number) => {
  const d = new Date(typeof at === "number" ? at : parseAt(at)),
    days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / DAY);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
};
// A posting's place on one short line. Boards list several as "A | B", "A • B" or "A; B": the first, and
// how many more ("San Francisco, CA +2"); callers put the whole string on hover.
export const place = (location: string | null | undefined) => {
  const [first, ...more] = (location ?? "")
    .split(/\s*[|•;]\s*/)
    .map(s => s.trim())
    .filter(Boolean);
  return !first ? "No location given" : more.length ? `${first} +${more.length}` : first;
};
// The host of a URL, without "www.".
export const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};
