// Repaints the page from the store. Cheap to call: a region whose HTML has not changed is left alone.
import { hasState, state, ui } from "./store";
import { $, focused, formValue, isField, paint, shell, textBox } from "./util";
import { ARCHIVE, STUCK, VIEWS } from "./views";
import { activityHtml } from "./views/activity";
import { blockersHtml } from "./views/blockers";
import { jobHtml } from "./views/job";
import { elsewhere, listHtml } from "./views/list";
import { profileView } from "./views/profile";
import { questionsHtml } from "./views/questions";
import { settingsHtml } from "./views/settings";
import { moreHtml, sideHtml } from "./views/side";

// The box the user is writing in, when repainting would throw their words away.
const draft = () => {
  const a = document.activeElement;
  return isField(a) && a.id !== "q" && (a.value || a.id === "ptext") ? a : null;
};

let listedView: string | null = null;
export function render() {
  if (!hasState()) return;
  const S = state(),
    v = VIEWS[ui.view],
    waiting = S.jobs.filter(j => STUCK.includes(j.status)).length,
    pane = shell("pane");
  document.title = (waiting ? `(${waiting}) ` : "") + "Auto Apply";
  shell("app").className = (v.statuses ? "" : "wide") + (ui.selected && ui.job ? " detail" : "");
  paint(shell("side"), sideHtml());
  const writing = draft();
  if (writing) {
    const form = writing.closest<HTMLFormElement>("form[data-question-form]"),
      gate = writing.closest<HTMLElement>("[data-gate-id]");
    // Preserve drafts only while their durable gate is still current.
    const current = form
      ? S.questionGroups.some(g => g.jobs.some(j => j.gateId === formValue(form, "job")))
      : !gate || ui.job?.gate?.id === gate.dataset["gateId"];
    if (current) return;
    writing.blur();
  }
  if (v.statuses) {
    // Repainting the list replaces the search box: put the cursor back where it was.
    const q = textBox("#q"),
      caret = q && q === document.activeElement ? ([q.selectionStart, q.selectionEnd] as const) : null;
    paint(shell("list"), listHtml());
    // Another section starts at its top, not at the scroll the last one was left at.
    if (listedView !== ui.view) {
      listedView = ui.view;
      shell("list").scrollTop = 0;
    }
    if (ui.selected !== ui.shownSel) {
      ui.shownSel = ui.selected;
      $(".row.sel")?.scrollIntoView({ block: "nearest" }); // keep J/K's selection in view
    }
    if (caret && focused()?.id !== "q") {
      textBox("#q")?.focus();
      textBox("#q")?.setSelectionRange(...caret);
    }
    paint(
      pane,
      ui.job?.id === ui.selected
        ? jobHtml(ui.job)
        : ARCHIVE.includes(ui.view)
          ? `<div class="empty">Pick a job to see why it is ${ui.view === "held" ? "held" : "rejected"}.</div>`
          : ui.view === "review" && !S.jobs.some(j => j.status === "awaiting_approval")
            ? `<div class="empty">Nothing waiting for review. New postings land here once they are assessed.${elsewhere()}</div>`
            : "",
    );
  } else if (ui.view === "activity") paint(pane, activityHtml());
  else if (ui.view === "blockers") paint(pane, blockersHtml());
  else if (ui.view === "questions") paint(pane, questionsHtml());
  else if (ui.view === "profile") void profileView();
  else if (ui.view === "more") paint(pane, moreHtml());
  else paint(pane, settingsHtml());
}
