// Small helpers for the DOM and for text. Nothing here knows about jobs.

export const $ = (sel: string, el: ParentNode = document) => el.querySelector<HTMLElement>(sel);
// An element the page's shell always has.
export const shell = (id: "app" | "side" | "list" | "pane" | "offline" | "toast") => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`the page has no #${id}`);
  return el;
};
export type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
export const isField = (el: unknown): el is Field => el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
// A text box by selector, or null when it is not on the page.
export const textBox = (sel: string) => {
  const el = $(sel);
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el : null;
};
export const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);
export const blur = () => focused()?.blur();
export const wide = () => !matchMedia("(max-width: 860px)").matches;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
export const esc = (s: string | number | null | undefined) => String(s ?? "").replace(/[&<>"]/g, c => ESCAPES[c] ?? c);
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// Some boards hand over descriptions with the entities still encoded.
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export const unent = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, e: string) =>
    !e.startsWith("#")
      ? (NAMED[e.toLowerCase()] ?? m)
      : String.fromCodePoint(/^#x/i.test(e) ? parseInt(e.slice(2), 16) : Number(e.slice(1))).replace(/\u00a0/g, " "),
  );
// For already-escaped text: make the URLs in it clickable.
export const linkify = (html: string) => html.replace(/https?:\/\/[^\s<"]*[^\s<".,;:)]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

// A time the server wrote, as ISO or as SQLite's "YYYY-MM-DD HH:MM:SS" in UTC, in ms.
export const parseAt = (iso: string) => Date.parse(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
// "3h ago" for a time the server wrote.
export const when = (iso: string | null | undefined) => {
  if (!iso) return "";
  const m = (Date.now() - parseAt(iso)) / 60000;
  return m < 1 ? "just now" : m < 60 ? `${Math.trunc(m)}m ago` : m < 1440 ? `${Math.trunc(m / 60)}h ago` : `${Math.trunc(m / 1440)}d ago`;
};

// A span of time as a list column shows it: "40m", "5h", "3d", "2w", "4mo".
export const span = (ms: number) => {
  const m = Math.max(1, Math.trunc(ms / 6e4)),
    d = Math.trunc(m / 1440);
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.trunc(m / 60)}h` : d < 14 ? `${d}d` : d < 60 ? `${Math.trunc(d / 7)}w` : `${Math.trunc(d / 30)}mo`;
};
// "14:05" on the local clock, for rows already grouped under their day.
export const clock = (iso: string) => new Date(parseAt(iso)).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
// The local day a time falls on, as a group header: "Today", "Yesterday", "Mon, 12 Oct".
export const dayLabel = (iso: string) => {
  const d = new Date(parseAt(iso)),
    days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};
export const dateTime = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

// What each region currently shows, so an unchanged repaint leaves the DOM (and the user's place in it) alone.
export const painted = new Map<Element, string>();
export const paint = (el: Element, html: string) => {
  const key = html.replace(/\?t=\d+/g, "");
  if (painted.get(el) !== key) {
    painted.set(el, key);
    el.innerHTML = html;
  }
};

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export const toast = (msg: string, undo?: (() => void) | null) => {
  const t = shell("toast");
  t.innerHTML = esc(msg) + (undo ? `<button>Undo</button>` : "");
  $("button", t)?.addEventListener("click", () => {
    t.classList.remove("on");
    undo?.();
  });
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => {
      t.classList.remove("on");
    },
    undo ? 6000 : 3000,
  );
};

// The value of a form's named control, whether it is one box or a set of radio buttons.
export const formValue = (form: HTMLFormElement, name: string) => {
  const el = form.elements.namedItem(name);
  return el instanceof RadioNodeList || isField(el) ? el.value : "";
};
export const setDisabled = (el: Element, disabled: boolean) => {
  if (el instanceof HTMLButtonElement || isField(el)) el.disabled = disabled;
};
