// Pieces more than one page uses.
import type { EventRow } from "../../src/db";
import { state, ui } from "../store";
import { cap, esc, linkify, when } from "../util";

// A disclosure whose open state survives repaints (a state poll repaints the pane when a relative time ticks).
export const fold = (key: string, summary: string, body: string, cls = "") =>
  `<details class="${cls}" data-how="${esc(key)}" ${ui.openHow.has(key) ? "open" : ""}><summary>${summary}</summary>${body}</details>`;

export const title = (t: string) => `<div class="head" style="padding:0 0 18px"><h1>${t}</h1></div>`;

// The profile files by what the owner calls them; profileProblems names the resume "resume".
export const PROFILE_LABEL: Record<string, string> = {
  "targets.md": "Targets",
  "rubric.yml": "Rubric",
  "main.typ": "Resume",
  resume: "Resume",
  "resume-notes.md": "Resume notes",
  "answers.md": "Answers",
  "personal.yml": "Personal",
  "companies.yml": "Companies",
};

// What is missing before the app can work, as one box with a way to fix each line. A page that already
// shows one of these itself (Settings the mailbox, Profile the files) leaves that line out.
export function notices(except?: "gmail" | "profile") {
  const S = state(),
    out: string[] = [];
  if (S.profileProblems.length && except !== "profile")
    out.push(
      `Setup isn't finished: ${esc(S.profileProblems.map(f => PROFILE_LABEL[f] ?? f).join(", "))}. Nothing is assessed or applied until it is. <a href="#profile" data-view="profile">Finish setup →</a>`,
    );
  if (!S.gmail.connected && except !== "gmail")
    out.push(`Gmail isn't connected, so applications that need an account or an emailed code stop and ask you. <a href="/oauth/start">Connect Gmail →</a>`);
  return out.length ? `<div class="notice">${out.map(t => `<p>${t}</p>`).join("")}</div>` : "";
}

export const eventRow = (e: Pick<EventRow, "worker" | "kind" | "message" | "at">) =>
  `<div class="ev rel k-${esc(e.kind)}"><time>${when(e.at)}</time><div><span class="who">${esc(cap(e.worker ?? e.kind))}</span> <span class="msg" data-clamp="1">${linkify(esc(e.message))}</span></div></div>`;
