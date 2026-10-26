// Where the user is lives in the URL hash: #page/part/part?param=value. Lists keep their group, sort,
// filters and search in the params, so Back returns to the same place and a link can be shared.
import { useSyncExternalStore } from "react";

const PAGES = ["overview", "review", "questions", "pipeline", "applications", "archive", "activity", "resume", "profile", "setup", "settings", "job"] as const;
export type Page = (typeof PAGES)[number];
const isPage = (p: string | undefined): p is Page => PAGES.includes(p as Page);

export interface Route {
  page: Page;
  parts: string[]; // after the page: e.g. ["123"] for #review/123
  params: URLSearchParams;
}

// Links written before the redesign (the daily digest, old bookmarks): #progress/12, #applied/3, #held.
const LEGACY: Record<string, (parts: string[]) => string> = {
  progress: p => `pipeline${p[0] ? `/${p[0]}` : ""}`,
  applied: p => `applications${p[0] ? `/${p[0]}` : ""}`,
  held: p => `archive/held${p[0] ? `/${p[0]}` : ""}`,
  rejected: p => `archive/rejected${p[0] ? `/${p[0]}` : ""}`,
  blockers: () => "activity/blockers",
  more: () => "overview",
};

function parse(hash: string): Route {
  const raw = hash.replace(/^#\/?/, "");
  const [path = "", query = ""] = raw.split("?");
  const [page, ...parts] = path.split("/").filter(Boolean).map(decodeURIComponent);
  if (page && !isPage(page) && LEGACY[page]) {
    history.replaceState(null, "", `#${LEGACY[page](parts)}`);
    return parse(location.hash);
  }
  return { page: isPage(page) ? page : "overview", parts, params: new URLSearchParams(query) };
}

let current = parse(location.hash);
const listeners = new Set<() => void>();
const update = () => {
  current = parse(location.hash);
  for (const l of listeners) l();
};
addEventListener("hashchange", update);

export const useRoute = () =>
  useSyncExternalStore(
    cb => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
  );
export const route = () => current;

// Go to "page/part?param=value" (no leading #).
export function navigate(to: string, opts: { replace?: boolean } = {}) {
  const hash = `#${to.replace(/^#/, "")}`;
  if (hash === location.hash) return;
  if (opts.replace) history.replaceState(null, "", hash);
  else history.pushState(null, "", hash);
  update();
}
export const href = (page: Page, ...parts: (string | number)[]) => `#${[page, ...parts.map(p => encodeURIComponent(String(p)))].join("/")}`;

// Change some params of the current route, keeping the rest. null or "" removes one.
export function setParams(patch: Record<string, string | readonly string[] | null | undefined>, opts: { replace?: boolean; parts?: string[] } = {}) {
  const r = current,
    params = new URLSearchParams(r.params);
  for (const [k, v] of Object.entries(patch)) {
    params.delete(k);
    if (Array.isArray(v)) for (const x of v as readonly string[]) params.append(k, x);
    else if (typeof v === "string" && v) params.set(k, v);
  }
  const q = params.toString(),
    parts = opts.parts ?? r.parts;
  navigate(`${[r.page, ...parts.map(encodeURIComponent)].join("/")}${q ? `?${q}` : ""}`, { replace: opts.replace ?? true });
}
