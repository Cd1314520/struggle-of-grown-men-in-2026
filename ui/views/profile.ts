// Profile: the files the agents read about the user, rendered, with an editor behind "Edit".
import { loadProfile } from "../api";
import { md } from "../markdown";
import { state, ui } from "../store";
import { esc, painted, shell } from "../util";
import { notices, title } from "./common";

const PROFILE_LABEL: Record<string, string> = {
  "targets.md": "Targets",
  "rubric.yml": "Rubric",
  "main.typ": "Resume",
  "resume-notes.md": "Resume notes",
  "answers.md": "Answers",
  "personal.yml": "Personal",
  "companies.yml": "Companies",
};

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
  const key = raw ? "profile:" + file : `profile:${file}:${text}`;
  if (painted.get(pane) === key) return;
  painted.set(pane, key);
  pane.innerHTML = `<div class="doc page">${title("Profile")}${notices()}
    <div class="tabs scrollx" style="margin-top:0">${S.profileFiles.map(f => `<button class="tab ${f === file ? "on" : ""}" data-pfile="${f}" title="${f}">${PROFILE_LABEL[f] ?? f}</button>`).join("")}</div>
    ${
      raw
        ? `<textarea id="ptext" spellcheck="false">${esc(text)}</textarea>
    <div class="actions savebar"><button class="btn primary" id="psave" title="Save (Ctrl+S)">Save</button>${isMd ? `<button class="btn" id="pmode">Cancel</button>` : ""}</div>`
        : `<div class="actions" style="margin-top:14px"><button class="btn sm" id="pmode">Edit</button><span class="hint">${file}</span></div><div class="md">${md(text)}</div>`
    }</div>`;
}
