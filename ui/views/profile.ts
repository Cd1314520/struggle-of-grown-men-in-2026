// Profile: the files the agents read about the user, rendered, with an editor behind "Edit". Each file
// says what it is for, a file still to be filled in is marked on its tab, and an empty one says so.
import { loadProfile } from "../api";
import { md } from "../markdown";
import { state, ui } from "../store";
import { esc, painted, shell } from "../util";
import { notices, PROFILE_LABEL, title } from "./common";

// What each file is for, in one line: who reads it and what it changes.
const PROFILE_DESC: Record<string, string> = {
  "targets.md": "The roles, places and pay you want. Triage and assessment read it to decide what is worth applying to",
  "rubric.yml": "How a posting is scored: the checks and the points each is worth",
  "main.typ": "Your resume, in Typst. Each application gets a copy tailored from it",
  "resume-notes.md": "Facts about your work that tailoring may draw on beyond what the resume says",
  "answers.md": "Standing answers to application questions, so the form filler asks you less",
  "personal.yml": "Contact details and the fields every application form asks for",
  "companies.yml": "The companies whose job boards each scan reads",
};
const PLACEHOLDER = "TODO-FILL"; // as src/profile.ts: the shipped templates carry it until filled in

// profileProblems names the resume "resume"; the tab is its Typst file.
const needs = (file: string) => state().profileProblems.some(p => p === file || (p === "resume" && file.endsWith(".typ")));

// Paints itself: the file has to be fetched first.
export async function profileView() {
  const S = state(),
    pane = shell("pane");
  const file = (ui.profileFile ??= S.profileFiles[0] ?? null);
  if (!file) return;
  const isMd = file.endsWith(".md"),
    raw = ui.profileRaw || !isMd;
  // The editor is painted once and left alone while it is open; the rendered view follows the file.
  if (raw && painted.get(pane) === "profile:" + file) return;
  const text = await loadProfile(file);
  if (file !== ui.profileFile || ui.view !== "profile") return;
  const key = raw ? "profile:" + file : `profile:${file}:${text}:${S.profileProblems.join()}`;
  if (painted.get(pane) === key) return;
  painted.set(pane, key);
  const label = PROFILE_LABEL[file] ?? file,
    desc = PROFILE_DESC[file] ?? "",
    empty = !text.trim(),
    todo = !empty && text.includes(PLACEHOLDER);
  const purpose = `<p class="pfdesc">${esc(desc)}${desc ? "." : ""} <span class="faint">${esc(file)}</span></p>`;
  const flag = todo ? `<p class="pfflag">Still has <code>${PLACEHOLDER}</code> placeholders: replace them before the app will use this file.</p>` : "";
  const body = raw
    ? `<div class="pfhead">${purpose}</div>${flag}<textarea id="ptext" spellcheck="false" placeholder="${empty ? `${esc(label)} is empty. ${esc(desc)}.` : ""}">${esc(text)}</textarea>
    <div class="actions savebar"><button class="btn primary" id="psave" title="Save (Ctrl+S)">Save</button>${isMd ? `<button class="btn" id="pmode">Cancel</button>` : ""}</div>`
    : empty
      ? `<div class="pempty"><b>${esc(label)} is empty.</b><p>${esc(desc)}.</p><button class="btn primary" id="pmode">Write it</button><span class="faint">${esc(file)}</span></div>`
      : `<div class="pfhead">${purpose}<button class="btn" id="pmode">Edit</button></div>${flag}<div class="md">${md(text)}</div>`;
  pane.innerHTML = `<div class="doc page">${title("Profile")}${notices("profile")}${
    S.profileProblems.length
      ? `<p class="hint pfneed">Files marked <span class="dot" aria-hidden="true"></span> are missing, empty or still templates. Nothing is assessed or applied until they are filled in.</p>`
      : ""
  }
    <div class="tabs scrollx" style="margin-top:0">${S.profileFiles
      .map(
        f =>
          `<button class="tab ${f === file ? "on" : ""} ${needs(f) ? "need" : ""}" data-pfile="${f}" title="${f}${needs(f) ? " — still to fill in" : ""}">${PROFILE_LABEL[f] ?? f}</button>`,
      )
      .join("")}</div>
    ${body}</div>`;
}
