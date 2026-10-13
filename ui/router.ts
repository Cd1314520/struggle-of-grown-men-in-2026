// Where the user is lives in the URL: #view or #view/jobId.
import { loadJob, loadState } from "./api";
import { ordered } from "./layout";
import { render } from "./render";
import { hasState, setState, ui } from "./store";
import { blur, shell, wide } from "./util";
import { isView, VIEWS, type ViewKey } from "./views";

export const go = (v: ViewKey, id?: number | null, replace?: boolean) => {
  const h = `#${v}${id ? `/${id}` : ""}`;
  if (replace) history.replaceState(null, "", h);
  else if (location.hash !== h) {
    location.hash = h; // hashchange calls route()
    return;
  }
  void route();
};

export async function route() {
  const [v, id] = location.hash.slice(1).split("/");
  const nextView = isView(v) ? v : "review",
    nextJob = Number(id) || null;
  if (nextView !== ui.view) {
    ui.tab = "summary";
    blur();
  }
  ui.view = nextView;
  if (nextJob !== ui.selected && !ui.profileDirty) blur();
  ui.selected = nextJob;
  if (!nextJob && hasState() && wide() && VIEWS[ui.view].statuses) {
    const first = ordered()[0];
    if (first) {
      go(ui.view, first.id, true);
      return;
    }
  }
  if (nextJob && ui.job?.id !== nextJob) {
    ui.tab = "summary";
    ui.job = await loadJob(nextJob);
    if (wide()) shell("pane").scrollTop = 0;
    else scrollTo(0, 0);
  }
  if (!nextJob) ui.job = null;
  render();
}

// Fetch everything again and repaint.
export async function refresh() {
  setState(await loadState());
  if (!ui.selected) {
    await route();
    return;
  }
  ui.job = await loadJob(ui.selected);
  render();
}
