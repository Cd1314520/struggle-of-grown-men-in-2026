// Pieces more than one page uses.
import type { EventRow } from "../../src/db";
import { state } from "../store";
import { cap, esc, linkify, when } from "../util";

export const title = (t: string) => `<div class="head" style="padding:0 0 18px"><h1>${t}</h1></div>`;

// What is missing before the app can work, shown at the top of the system pages.
export function notices() {
  const S = state(),
    out: string[] = [];
  if (S.profileProblems.length)
    out.push(`Setup isn't finished: ${S.profileProblems.join(", ")}. Nothing is assessed or applied until that's fixed in Profile.`);
  if (!S.gmail.connected)
    out.push("Gmail isn't connected. Applications that need an account or an emailed code will stop and ask you. Connect it in Settings.");
  return out.map(t => `<div class="notice">${esc(t)}</div>`).join("");
}

export const eventRow = (e: Pick<EventRow, "worker" | "kind" | "message" | "at">) =>
  `<div class="ev k-${esc(e.kind)}"><time>${when(e.at)}</time><div><span class="who">${esc(cap(e.worker ?? e.kind))}</span> <span class="msg" data-clamp="1">${linkify(esc(e.message))}</span></div></div>`;
