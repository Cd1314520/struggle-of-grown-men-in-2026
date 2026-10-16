// Everything the user does: clicks, keys, typing and form submits, delegated from the document.
import * as api from "./api";
import { ordered, showMore, toggleFold, togglePart } from "./layout";
import { render } from "./render";
import { go, refresh } from "./router";
import { rememberFilters, setState, state, ui } from "./store";
import { $, blur, cap, esc, formValue, painted, setDisabled, shell, textBox, toast, wide } from "./util";
import { isTab, isView, TAB_KEYS, viewOf, VIEWS } from "./views";
import { gateIdOf } from "./views/gate";
import { answerable, openKey } from "./views/questions";

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

// Opens a group ("" closes them all) and puts the cursor where the user acts next.
// "next" follows a save: a typed question gets the cursor in its box, but one-click options stay on the row and
// ignore picks for a moment, so a second press meant for the last question cannot answer this one.
function openQuestion(key: string, focus: "row" | "answer" | "next" | null) {
  ui.openQuestion = key;
  blur(); // a focused draft holds off repaints; its text is kept in ui.questionDrafts
  render();
  const item = key ? document.querySelector(`[data-question-group="${CSS.escape(key)}"]`) : null;
  if (!item) return;
  item.scrollIntoView({ block: "nearest" });
  const opts = $(".qopts", item);
  if (focus === "next" && opts) {
    opts.classList.add("hold");
    setTimeout(() => {
      opts.classList.remove("hold");
    }, 600);
  }
  if (focus === "row" || (focus === "next" && opts)) $("[data-question-row]", item)?.focus();
  else if (focus) ($("[data-question-option]", item) ?? $("textarea", item))?.focus();
}
// J/K: the next or previous group to answer, from the open one.
function stepQuestion(by: 1 | -1) {
  const keys = answerable().map(g => g.key),
    at = keys.indexOf(openKey());
  const next = keys[at < 0 ? 0 : Math.min(keys.length - 1, Math.max(0, at + by))];
  if (next) openQuestion(next, "row");
}

// `picked` is the option button that submitted the form, if one did.
async function answerQuestion(form: HTMLFormElement, picked?: string) {
  if (form.dataset["sending"]) return;
  const box = $("input[type=checkbox][name=scope]", form);
  const gateId = formValue(form, "job"),
    answer = (picked ?? formValue(form, "answer")).trim(),
    scope = box instanceof HTMLInputElement ? (box.checked ? "standing" : "application") : formValue(form, "scope");
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
  const before = answerable().map(g => g.key),
    at = before.indexOf(group.key);
  form.dataset["sending"] = "true";
  const controls = [...form.elements];
  for (const el of controls) setDisabled(el, true);
  try {
    const result = await api.answerQuestion(gateId, answer, scope);
    ui.questionDrafts.delete(group.key);
    blur();
    setState(await api.loadState());
    // Working down the queue: this question while other applications still ask it, then the next question
    // the same application asks (it is still blocked), then the next oldest.
    const left = answerable(),
      jobs = new Set(group.jobs.map(j => j.id)),
      next =
        left.find(g => g.key === group.key) ??
        left.find(g => !before.includes(g.key) && g.jobs.some(j => jobs.has(j.id))) ??
        left.find(g => before.indexOf(g.key) > at) ??
        left[0];
    const queued = result.jobIds.length > 1 ? ` · ${result.jobIds.length} applications queued` : "";
    toast(`Answered${queued} · ${next ? `next: ${next.text}` : "nothing left to answer"}`);
    openQuestion(next?.key ?? "", "next");
  } catch {
    await refreshQuietly();
  } finally {
    delete form.dataset["sending"];
    for (const el of controls) setDisabled(el, false);
  }
}

// Keys on the Questions page. True when the key was handled.
function questionKey(ev: KeyboardEvent, el: HTMLElement): boolean {
  const form = el.closest<HTMLFormElement>("form[data-question-form]"),
    row = el.closest<HTMLElement>("[data-question-row]");
  if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey) && form) {
    form.requestSubmit($("[data-question-answer]", form) ?? undefined);
    return true;
  }
  if (ev.key === "Escape" && (form || row)) {
    const key = (form ?? row)?.closest<HTMLElement>("[data-question-group]")?.dataset["questionGroup"] ?? "";
    openQuestion("", null);
    $(`[data-question-row="${CSS.escape(key)}"]`)?.focus();
    return true;
  }
  // Enter on a row opens it ready to answer, rather than toggling it shut.
  if (ev.key === "Enter" && row) {
    openQuestion(row.dataset["questionRow"] ?? "", "answer");
    return true;
  }
  if (el.matches("textarea, input, select") || ev.metaKey || ev.ctrlKey || ev.altKey) return false;
  if (ev.key === "j" || ev.key === "k") stepQuestion(ev.key === "j" ? 1 : -1);
  else if (/^[1-8]$/.test(ev.key) && !ev.repeat) $(`.qitem.open .qopts:not(.hold) [data-question-option]:nth-child(${ev.key})`)?.click();
  else return false;
  return true;
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
        ? `Sent ${result.groups} item${result.groups === 1 ? "" : "s"}${result.messageId ? ` · ${result.messageId}` : ""}`
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

// The outcome stays under the box (with a link to the job) rather than only in a passing toast.
async function addPosting() {
  const box = textBox("#addurl");
  if (!box) return;
  const url = box.value.trim();
  if (!url) {
    box.focus();
    return;
  }
  const named = (id: number, fallback: string) => {
    const j = state().jobs.find(x => x.id === id);
    return `<a href="#" data-open="${id}">${esc(j ? `${j.company} — ${j.title}` : fallback)}</a>`;
  };
  try {
    const { id } = await api.addPosting(url);
    ui.addDraft = "";
    ui.addResult = { ok: true, html: `Added: ${named(id, "the new posting")}. It will be assessed shortly.` };
    box.value = "";
    toast("Added. It will be assessed shortly.");
  } catch (err) {
    const known = err instanceof api.ApiError && err.status === 409,
      body = err instanceof api.ApiError && typeof err.body === "object" && err.body ? (err.body as { id?: unknown }) : {};
    ui.addDraft = url;
    ui.addResult = {
      ok: false,
      html:
        known && typeof body.id === "number"
          ? `Already tracked: ${named(body.id, `job ${body.id}`)}.`
          : esc(err instanceof Error && err.message ? cap(err.message) + "." : "Could not add it."),
    };
  }
  // The box may keep focus, and render leaves a page with a focused draft alone: write the line directly.
  const line = $("#add-result"),
    result = ui.addResult;
  if (line) {
    line.innerHTML = result.html;
    line.classList.toggle("bad", !result.ok);
  }
  render();
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
  "[data-question-row],[data-view],[data-job],[data-act],[data-run],[data-pfile],[data-back],[data-tab],[data-toggle],[data-feed],[data-open],[data-filter],[data-clamp],[data-more],[data-fold],[data-part],[data-cap],[data-browser-action],[data-jump],[data-fill],#psave,#pmode,#addbtn,#digest-send,#digest-refresh";

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

  if (d["questionRow"] !== undefined) {
    const key = d["questionRow"];
    openQuestion(key === openKey() ? "" : key, key === openKey() ? null : "answer");
  } else if (d["jump"] !== undefined) {
    // An in-page anchor: the hash is the route, so scroll instead of following it.
    ev.preventDefault();
    $(t.getAttribute("href") ?? "")?.scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (d["view"]) {
    ev.preventDefault(); // a link styled as text, e.g. in a notice
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
  else if (d["fill"] !== undefined) {
    // A question's fixed option, picked from the gate: it fills the answer box rather than saving, so it can still be edited.
    const box = textBox("#ans");
    if (box) {
      box.value = d["fill"];
      box.focus();
    }
  } else if (d["more"]) t.previousElementSibling?.classList.add("open");
  else if (d["fold"]) {
    toggleFold(d["fold"]);
    render();
  } else if (d["part"]) {
    togglePart(d["part"]);
    render();
  } else if (d["cap"]) {
    showMore(d["cap"]);
    render();
  } else if (d["filter"]) {
    ui.filt[ui.view] = d["filter"];
    rememberFilters();
    // Keep the open job only if it is still in the list.
    if (VIEWS[ui.view].statuses && !ordered().some(j => j.id === ui.selected)) go(ui.view, wide() ? (ordered()[0]?.id ?? null) : null, true);
    else render();
  } else if (d["feed"]) {
    ui.feedAll = d["feed"] === "all";
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
  if (ui.view === "questions" && questionKey(ev, el)) ev.preventDefault();
  else if (mod && ev.key === "s" && el.id === "ptext") {
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
  // A presses the gate's one primary button (Approve, Retry, Reserve browser…), never one that needs words typed
  // first, and never Approve submission: sending an application cannot be undone, so it takes a click.
  else if (ev.key === "a") $('.gate > .actions > .btn.primary:not([data-text]):not([data-fixed="approve"]):not([disabled])')?.click();
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
  else if (el.name === "answer" && el.form?.matches("[data-question-form]")) {
    const key = el.closest<HTMLElement>("[data-question-group]")?.dataset["questionGroup"];
    if (key) ui.questionDrafts.set(key, el.value);
  } else if (el.id === "q") {
    ui.query[ui.view] = el.value;
    render();
  }
}

export function listen() {
  document.addEventListener("submit", ev => {
    const form = ev.target instanceof Element ? ev.target.closest<HTMLFormElement>("form[data-question-form]") : null;
    if (!form) return;
    ev.preventDefault();
    const by = ev.submitter instanceof HTMLElement ? ev.submitter.dataset["questionOption"] : undefined;
    void answerQuestion(form, by);
  });
  document.addEventListener("click", ev => void onClick(ev));
  // Remember which "How this works" sections are open, so a repaint from a state poll keeps them open.
  document.addEventListener(
    "toggle",
    ev => {
      const el = ev.target;
      if (el instanceof HTMLDetailsElement && el.dataset["how"]) {
        if (el.open) ui.openHow.add(el.dataset["how"]);
        else ui.openHow.delete(el.dataset["how"]);
      }
    },
    true,
  );
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("input", onInput);
  addEventListener("beforeunload", ev => {
    if (ui.profileDirty) ev.preventDefault();
  });
}
