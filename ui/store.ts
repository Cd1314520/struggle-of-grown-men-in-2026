// What the page holds between repaints: the server's state, the open job, and where the user is.
import type { AppState, JobDetail } from "../src/api-types";
import type { Tab, ViewKey } from "./views";

let loaded: AppState | null = null;
export const hasState = () => loaded !== null;
export const setState = (next: AppState) => {
  loaded = next;
};
// The last /api/state. Nothing is painted before the first one arrives.
export const state = (): AppState => {
  if (!loaded) throw new Error("the app's state was read before it loaded");
  return loaded;
};

interface Ui {
  view: ViewKey;
  selected: number | null; // id of the open job
  shownSel: number | null; // the selection the list last scrolled into view
  job: JobDetail | null; // the open job, once loaded
  tab: Tab;
  filt: Partial<Record<ViewKey, string>>; // per section: the chosen filter chip (remembered)
  query: Partial<Record<ViewKey, string>>; // per section: the search text
  feedAll: boolean; // Activity shows every agent step instead of the highlights
  profileFile: string | null;
  profileRaw: boolean; // markdown files open rendered; this switches to the editable source
  profileDirty: boolean; // the editor holds changes that have not been saved
  digestBusy: boolean;
  digestResult: string;
}
export const ui: Ui = {
  view: "review",
  selected: null,
  shownSel: null,
  job: null,
  tab: "summary",
  filt: {},
  query: {},
  feedAll: false,
  profileFile: null,
  profileRaw: false,
  profileDirty: false,
  digestBusy: false,
  digestResult: "",
};
try {
  ui.filt = JSON.parse(localStorage.getItem("filters") ?? "{}") as Ui["filt"];
} catch {
  // unreadable or blocked storage: start with no filters
}
export const rememberFilters = () => {
  try {
    localStorage.setItem("filters", JSON.stringify(ui.filt));
  } catch {
    // the choice still holds for this visit
  }
};
