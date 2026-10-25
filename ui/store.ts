// What the page holds between repaints: the server's state, the open job, and where the user is.
import type { AppState, JobDetail } from "../src/api-types";
import type { ListedBlocker } from "../src/blockers";
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
  blockers: ListedBlocker[] | null; // the Blockers page, fetched when it is shown
  tab: Tab;
  filt: Partial<Record<ViewKey, string>>; // per section: the chosen filter chip (remembered)
  query: Partial<Record<ViewKey, string>>; // per section: the search text
  feedAll: boolean; // Activity shows every agent step instead of the highlights
  profileFile: string | null;
  profileRaw: boolean; // markdown files open rendered; this switches to the editable source
  profileDirty: boolean; // the editor holds changes that have not been saved
  digestBusy: boolean;
  digestResult: string;
  addResult: { ok: boolean; html: string } | null; // what the last Add a posting did, shown under the box
  addDraft: string;
  openHow: Set<string>; // disclosures the owner opened (Settings' "How this works", the job pane's folds), kept open across repaints
  openQuestion: string | null; // the Questions group shown open; null means the oldest, "" means none
  questionDrafts: Map<string, string>; // typed answers by group, kept while another group is open
}
export const ui: Ui = {
  view: "review",
  selected: null,
  shownSel: null,
  job: null,
  blockers: null,
  tab: "summary",
  filt: {},
  query: {},
  feedAll: false,
  profileFile: null,
  profileRaw: false,
  profileDirty: false,
  digestBusy: false,
  digestResult: "",
  addResult: null,
  addDraft: "",
  openHow: new Set(),
  openQuestion: null,
  questionDrafts: new Map(),
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
