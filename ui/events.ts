// Everything the user does: clicks, keys, typing and form submits, delegated from the document.
import * as api from "./api";
import { ordered, toggleFold } from "./layout";
import { render } from "./render";
import { go, refresh } from "./router";
import { rememberFilters, setState, state, ui } from "./store";
import { $, blur, formValue, painted, setDisabled, shell, textBox, toast, wide } from "./util";
import { isTab, isView, TAB_KEYS, viewOf, VIEWS } from "./views";
import { gateIdOf } from "./views/gate";

// The repaint that follows a failed request must not fail the handler too.
const refreshQuietly = () => refresh().catch(() => undefined);

// True when the user would rather keep what they typed in the profile editor.
const keepEdits = () => ui.profileDirty && !confirm(`Discard your unsaved changes to ${ui.profileFile ?? "this file"}?`);
async function saveProfile() {
  const file = ui.profileFile,
    box = textBox("#ptext");
  if (!file || !box) return;
  if (!(await api.saveProfileFile(file, box.value))) {
    toast(`Could not save ${file}. Your changes are still in the editor.`);
    return;
  }
  ui.profileDirty = false;
  blur();
  ui.profileRaw = false;
  painted.delete(shell("pane"));
  toast(`Saved ${file}`);
  void refresh();
}

// ---- the Questions inbox

async function answerQuestion(form: HTMLFormElement) {
  if (form.dataset["sending"]) return;
  const gateId = formValue(form, "job"),
    answer = formValue(form, "answer").trim(),
    scope = formValue(form, "scope");
  if (!answer) {
    $("[name=answer]", form)?.focus();
    toast("Type an answer first.");
    return;
  }
  const group = state().questionGroups.find(g => g.jobs.some(j => j.gateId === gateId));
  if (!group) {
    blur();
    await refresh();
    toast("This question has already changed. Reloaded the inbox.");
    return;
  }
  if (
    scope === "standing" &&
    !confirm(
      `Approve a standing answer for ${group.scopeLabel}?\n\nThis requeues all ${group.jobs.length} matching open applications and allows future reuse only for this exact employer/prompt/context/options scope.`,
    )
  )
    return;
  form.dataset["sending"] = "true";
  const controls = [...form.elements];
  for (const el of controls) setDisabled(el, true);
  try {
    const result = await api.answerQuestion(gateId, answer, scope);
    blur();
    toast(`Answer saved · queued applications: ${result.jobIds.map(id => `#${id}`).join(", ")}`);
    await refresh();
  } catch {
    await refreshQuietly();
  } finally {
    delete form.dataset["sending"];
    for (const el of controls) setDisabled(el, false);
  }
}

// ---- Settings

async function digest(send: boolean) {
  if (ui.digestBusy) return;
  ui.digestBusy = true;
  render();
  try {
    if (send) {
      const result = await api.sendDigest();
      ui.digestResult = result.sent
        ? `Sent ${result.groups} group${result.groups === 1 ? "" : "s"}${result.messageId ? ` · ${result.messageId}` : ""}`
        : `Not sent: ${result.reason ?? "No new undelivered groups"}`;
      toast(ui.digestResult);
    }
  } catch (err) {
    ui.digestResult = `Send failed: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    try {
      state().digest = await api.loadDigestStatus();
    } catch {
      ui.digestResult = "Could not refresh digest status. Delivery outcome is unverified; check Gmail before retrying.";
    }
    ui.digestBusy = false;
    render();
  }
}

async function addPosting() {
  const box = textBox("#addurl");
  if (!box) return;
  if (!box.value.trim()) {
    box.focus();
    return;
  }
  await api.addPosting(box.value.trim());
  box.value = "";
  toast("Added. It will be assessed shortly.");
  void refresh();
}

const RUN_STARTED: Record<string, string> = {
  scan: "Scan started",
  discover: "Looking for new companies",
  track: "Checking mail",
  release_held: "Held jobs released",
};
async function run(what: string) {
  await api.run(what);
  toast(RUN_STARTED[what] ?? "");
  void refresh();
}

// ---- the open job

const GATE_CLOSED = "This gate is no longer open; reload the application.";

async function browserAction(t: HTMLElement, id: number) {
  const action = t.dataset["browserAction"] ?? "",
    gateId = t.dataset["gateId"] ?? gateIdOf(ui.job);
  if (!gateId) {
    toast(GATE_CLOSED);
    return;
  }
  setDisabled(t, true);
  try {
    await api.browserAction(id, { action, gateId });
    toast(action === "reserve" ? "Browser reserved" : "Browser reservation released");
  } catch {
    // The request already displayed the server's error; refresh to restore the current gate.
  } finally {
    await refreshQuietly();
    setDisabled(t, false);
  }
}

async function recover(t: HTMLElement, id: number, gateId: string | undefined) {
  if (!gateId) {
    toast(GATE_CLOSED);
    return;
  }
  setDisabled(t, true);
  try {
    await api.recoverJob(id, gateId);
    toast("Recovery queued");
  } catch {
    // The request already displayed the server's error.
  } finally {
    await refreshQuietly();
    setDisabled(t, false);
  }
}

const DONE: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  redo: "Redo requested",
  retry: "Back in the queue",
  respond: "Response saved · queued to resume",
  mark_submitted: "Marked as submitted",
  confirmed_not_submitted: "Verified not submitted · queued to resume",
};
async function jobAction(t: HTMLElement, id: number) {
  const d = t.dataset,
    act = d["act"] ?? "";
  const text = d["fixed"] ?? (d["text"] ? (textBox(d["text"])?.value.trim() ?? "") : "");
  if (d["text"] && !text) {
    toast("Type something first.");
    return;
  }
  const ambiguous = !!ui.job?.submissionAmbiguous;
  if (
    (act === "confirmed_not_submitted" || act === "mark_submitted") &&
    ambiguous &&
    !confirm(
      act === "confirmed_not_submitted"
        ? "I inspected the existing employer application/account and confirmation mail and verified this application was NOT submitted. Requeue this existing application?"
        : "I verified the existing application was submitted. Mark it submitted without another submit attempt?",
    )
  )
    return;
  const gateId = d["gateId"] ?? gateIdOf(ui.job);
  if (act === "recover") {
    await recover(t, id, gateId);
    return;
  }
  // Clearing a queue: after acting, move straight to the next job in this list.
  const list = ordered(),
    at = list.findIndex(j => j.id === id),
    next = list[at + 1] ?? list[at - 1];
  setDisabled(t, true);
  try {
    await api.jobAction(id, { action: act, text, gateId });
  } catch {
    await refreshQuietly();
    return;
  } finally {
    setDisabled(t, false);
  }
  blur();
  const from = ui.view;
  setState(await api.loadState());
  const stillHere = ordered().some(j => j.id === id),
    goNext = next && ordered().some(j => j.id === next.id) ? next : null;
  const done = DONE[act] ?? "";
  const undoReject = async () => {
    await api.jobAction(id, { action: "retry", text: "" });
    setState(await api.loadState());
    go(from, ordered(from).some(j => j.id === id) ? id : null, true);
  };
  toast(!stillHere && goNext ? `${done} · next: ${goNext.title}` : done, act === "reject" && !ambiguous ? () => void undoReject() : null);
  if (stillHere) {
    await refresh();
    return;
  }
  go(ui.view, goNext?.id ?? null, true);
  // The next job's buttons land under the same thumb: ignore taps for a moment.
  setTimeout(() => {
    const bar = $(".gate > .actions");
    if (!bar) return;
    bar.classList.add("hold");
    setTimeout(() => {
      bar.classList.remove("hold");
    }, 600);
  }, 0);
}

// ---- dispatch

const CLICKABLE =
  "[data-view],[data-job],[data-act],[data-run],[data-pfile],[data-back],[data-tab],[data-toggle],[data-feed],[data-open],[data-filter],[data-clamp],[data-more],[data-fold],[data-browser-action],#psave,#pmode,#addbtn,#digest-send,#digest-refresh";

async function onClick(ev: MouseEvent) {
  const t = ev.target instanceof Element ? ev.target.closest<HTMLElement>(CLICKABLE) : null;
  if (!t || (t instanceof HTMLButtonElement && t.disabled)) return;
  const d = t.dataset,
    leavesEditor = !!(d["view"] || d["pfile"] || d["open"] || t.id === "pmode");
  if (leavesEditor && keepEdits()) {
    ev.preventDefault();
    return;
  }
  if (leavesEditor) ui.profileDirty = false;
  if (d["run"] === "release_held" && !confirm(`Send all ${state().counts["held"] ?? 0} held jobs back through triage? Each one is assessed again.`)) return;

  if (d["view"]) {
    if (!isView(d["view"])) return;
    go(d["view"]);
    scrollTo(0, 0);
  } else if (d["job"]) go(ui.view, Number(d["job"]));
  else if (d["open"]) {
    ev.preventDefault();
    const id = Number(d["open"]);
    go(viewOf(state().jobs.find(x => x.id === id)?.status), id);
  } else if (d["back"]) go(ui.view);
  else if (d["tab"]) {
    if (isTab(d["tab"])) ui.tab = d["tab"];
    render();
  } else if (d["toggle"]) {
    const el = $(d["toggle"]);
    el?.classList.toggle("open");
    if (el) $("textarea", el)?.focus();
  } else if (d["clamp"]) t.classList.toggle("open");
  else if (d["more"]) t.previousElementSibling?.classList.add("open");
  else if (d["fold"]) {
    toggleFold(d["fold"]);
    render();
  } else if (d["filter"]) {
    ui.filt[ui.view] = d["filter"];
    rememberFilters();
    // Keep the open job only if it is still in the list.
    if (VIEWS[ui.view].statuses && !ordered().some(j => j.id === ui.selected)) go(ui.view, wide() ? (ordered()[0]?.id ?? null) : null, true);
    else render();
  } else if (d["feed"]) {
    ui.feedAll = !ui.feedAll;
    render();
  } else if (d["pfile"]) {
    ui.profileFile = d["pfile"];
    ui.profileRaw = false;
    blur();
    render();
  } else if (t.id === "pmode") {
    ui.profileRaw = !ui.profileRaw;
    blur();
    painted.delete(shell("pane"));
    render();
  } else if (t.id === "psave") await saveProfile();
  else if (t.id === "addbtn") await addPosting();
  else if (t.id === "digest-send" || t.id === "digest-refresh") await digest(t.id === "digest-send");
  else if (d["run"]) await run(d["run"]);
  else if (ui.selected === null) return;
  else if (d["browserAction"]) {
    ev.preventDefault();
    await browserAction(t, ui.selected);
  } else if (d["act"]) await jobAction(t, ui.selected);
}

function onKeydown(ev: KeyboardEvent) {
  const el = ev.target instanceof HTMLElement ? ev.target : null,
    mod = ev.metaKey || ev.ctrlKey;
  if (!el) return;
  if (mod && ev.key === "s" && el.id === "ptext") {
    ev.preventDefault();
    void saveProfile();
  } else if ((ev.key === "Enter" || ev.key === " ") && el.matches(".row")) {
    ev.preventDefault();
    go(ui.view, Number(el.dataset["job"]));
  } else if (ev.key === "Enter" && el.id === "addurl") $("#addbtn")?.click();
  else if (ev.key === "Escape" && el.id === "q") {
    ui.query[ui.view] = "";
    el.blur();
    render();
  } else if (el.matches("textarea, input, select, button, a") || mod || ev.altKey || !VIEWS[ui.view].statuses) return;
  else if (ev.key === "/" && $("#q")) {
    ev.preventDefault();
    $("#q")?.focus();
  } else if (ev.key === "j" || ev.key === "k") {
    const list = ordered(),
      n = list[list.findIndex(j => j.id === ui.selected) + (ev.key === "j" ? 1 : -1)];
    if (n) go(ui.view, n.id, true);
  } else if (ev.repeat)
    return; // a held key must not decide the next job too
  else if (ev.key === "a") $('.gate [data-act="approve"]')?.click();
  else if (ev.key === "x") $('.gate [data-act="reject"]')?.click();
  else if (/^[1-5]$/.test(ev.key) && ui.job) {
    ui.tab = TAB_KEYS[Number(ev.key) - 1] ?? ui.tab;
    render();
  }
}

function onInput(ev: Event) {
  const el = ev.target;
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return;
  if (el.id === "ptext") ui.profileDirty = true;
  else if (el.id === "q") {
    ui.query[ui.view] = el.value;
    render();
  }
}

export function listen() {
  document.addEventListener("submit", ev => {
    const form = ev.target instanceof Element ? ev.target.closest<HTMLFormElement>("form[data-question-form]") : null;
    if (!form) return;
    ev.preventDefault();
    void answerQuestion(form);
  });
  document.addEventListener("click", ev => void onClick(ev));
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("input", onInput);
  addEventListener("beforeunload", ev => {
    if (ui.profileDirty) ev.preventDefault();
  });
}
