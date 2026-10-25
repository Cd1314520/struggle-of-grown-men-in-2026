// The sidebar (the tab bar on a phone) and the "More" page behind its last tab.
import { gateLabel } from "../layout";
import { state, ui } from "../store";
import { cap, esc, parseAt, when } from "../util";
import { STUCK, VIEW_KEYS, VIEWS, type ViewKey } from "../views";

// From the server's counts: the list itself holds only the most recently touched of the long backlogs.
const jobCount = (k: ViewKey) => (VIEWS[k].statuses ?? []).reduce((n, s) => n + (state().counts[s] ?? 0), 0);
const num = (n: number) => n.toLocaleString();

export function sideHtml() {
  const S = state();
  // Questions counts what can be answered on that page; the other gates are counted under In progress.
  const asks = S.questionGroups.filter(g => g.kind === "question"),
    staleAsk = asks.some(g => Date.now() - Date.parse(g.createdAt) > 864e5);
  const count = (k: ViewKey) => (k === "questions" ? asks.length : jobCount(k));
  // Questions are counted once, under Questions; In progress counts the rest of what is stuck on the user.
  const stuck = S.jobs.filter(j => STUCK.includes(j.status) && gateLabel(j) !== "Question").length;
  // The badge counts what is waiting on the user: everything to review, and the stuck applications in progress.
  const badge = (k: ViewKey) =>
    k === "progress" && stuck
      ? `<span class="n hot stuck" title="${stuck} need you">${num(stuck)}</span>`
      : k === "questions" && staleAsk
        ? `<span class="n hot stuck" title="Waiting over a day">${num(count(k))}</span>`
        : count(k)
          ? `<span class="n ${k === "review" || k === "questions" ? "hot" : ""}" >${num(count(k))}</span>`
          : "";
  const item = (k: ViewKey) => {
    const v = VIEWS[k];
    return `${v.group ? `<div class="navgroup">${v.group}</div>` : ""}<button class="nav ${v.primary ? "" : "d-only"} ${k === ui.view ? "on" : ""}" data-view="${k}" ${k === ui.view ? 'aria-current="page"' : ""}>${v.short ? `<span class="long">${v.label}</span><span class="short">${v.short}</span>` : v.label}${badge(k)}</button>`;
  };
  const onMore = !VIEWS[ui.view].primary;
  return `<div class="brand">Auto Apply</div>${VIEW_KEYS.filter(k => !VIEWS[k].hidden)
    .map(item)
    .join("")}
    <button class="nav m-only ${onMore ? "on" : ""}" data-view="more">More</button>
    <div class="sidefoot"><div class="keys">${
      ui.view === "questions"
        ? `<span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>Esc</kbd> close</span><span><kbd>1–8</kbd> pick</span><span><kbd>⏎</kbd> open</span>`
        : `<span><kbd>J</kbd> <kbd>K</kbd> move</span><span><kbd>/</kbd> search</span><span title="Approve, confirm, retry: the highlighted button"><kbd>A</kbd> main action</span><span><kbd>X</kbd> reject</span>`
    }</div><div>${cap(S.phase)} · ${S.running.scan ? "scanning…" : `scanned ${when(S.lastScan) || "never"}`}</div>
    <button class="btn sm" data-run="scan" ${S.running.scan ? "disabled" : ""}>Scan now</button></div>`;
}

// The phone's way into the archive and the system pages: each row says what is there, and warns when
// something on that page needs fixing.
function moreHint(k: ViewKey): [text: string, warn: boolean] {
  const S = state(),
    n = jobCount(k);
  if (k === "held") return [n ? `${num(n)} waiting for the real search` : "Nothing held", false];
  if (k === "rejected") return [n ? `${num(n)} you turned down` : "Nothing rejected", false];
  if (k === "activity") {
    const today = new Date().toDateString(),
      errors = new Set(S.highlights.filter(e => e.kind === "error" && new Date(parseAt(e.at)).toDateString() === today).map(e => e.message)).size;
    return errors ? [`${errors} error${errors === 1 ? "" : "s"} today`, true] : [S.lastScan ? `Last scan ${when(S.lastScan)}` : "Not scanned yet", false];
  }
  if (k === "blockers") return ["Why applications stopped short", false];
  if (k === "profile")
    return S.profileProblems.length
      ? [`Setup unfinished: ${S.profileProblems.length} file${S.profileProblems.length === 1 ? "" : "s"}`, true]
      : ["Targets, resume, answers", false];
  if (k === "settings") return S.gmail.connected ? [`${cap(S.phase)} phase · Gmail connected`, false] : ["Gmail not connected", true];
  return ["", false];
}
const moreRow = (k: ViewKey) => {
  const [hint, warn] = moreHint(k);
  return `<button class="nav" data-view="${k}"><span class="mtext">${VIEWS[k].label}${hint ? `<small class="${warn ? "warn" : ""}">${esc(hint)}</small>` : ""}</span><span class="go" aria-hidden="true">›</span></button>`;
};
export const moreHtml = () =>
  `<div class="morelist"><div class="navgroup">Archive</div>${(["held", "rejected"] as const).map(moreRow).join("")}<div class="navgroup">System</div>${(["activity", "blockers", "profile", "settings"] as const).map(moreRow).join("")}</div>`;
