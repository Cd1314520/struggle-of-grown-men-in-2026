// The Questions inbox: the blockers the pipeline parked on the user, worked down oldest first.
// Questions are answered here, one open at a time; the other gates only link to their application.
import type { QuestionGroup } from "../../src/questions";
import { state, ui } from "../store";
import { esc, plural, when } from "../util";

const DAY = 864e5;
const ageMs = (iso: string) => Date.now() - Date.parse(iso);
const short = (iso: string) => when(iso).replace(" ago", "").replace("just now", "now");
// "3d" for the age chip. Anything blocking for over a day is flagged.
const age = (iso: string) => `<span class="age ${ageMs(iso) > DAY ? "hot" : ""}" title="Asked ${esc(when(iso))}">${esc(short(iso))}</span>`;

// Fixed choices few enough to be buttons: one click answers.
const MAX_OPTIONS = 8;
const pickable = (g: QuestionGroup) => g.options.length > 0 && g.options.length <= MAX_OPTIONS;

// The other gates have one home, In progress, where each is dealt with on its application's page. Here
// they are only counted, so the two pages never list the same work twice.
const LATER: Partial<Record<QuestionGroup["kind"], [one: string, many: string]>> = {
  confirm_submit: ["submit to confirm", "submits to confirm"],
  manual: ["browser hand-off", "browser hand-offs"],
  cover_letter: ["cover letter", "cover letters"],
  submission_ambiguous: ["submission to check", "submissions to check"],
};

export const answerable = () => state().questionGroups.filter(g => g.kind === "question");
// The group shown open: the one the user chose, else the oldest. An empty string means they closed it.
export const openKey = () => {
  if (ui.openQuestion === "") return "";
  const groups = answerable();
  return groups.some(g => g.key === ui.openQuestion) ? (ui.openQuestion ?? "") : (groups[0]?.key ?? "");
};

const BUCKETS: [label: string, olderThan: number][] = [
  ["Older than a week", 7 * DAY],
  ["This week", DAY],
];

function rowHtml(g: QuestionGroup, open: boolean, n: number) {
  const j = g.jobs[0],
    after = Math.max(0, ...g.jobs.map(x => x.queuedAfter));
  const meta = g.jobs.length > 1 ? `${esc(j?.company)} · ${plural(g.jobs.length, "application")}` : `${esc(j?.company)} · ${esc(j?.title)}`;
  return `<button type="button" class="qrow" data-question-row="${esc(g.key)}" aria-expanded="${open}" ${open ? `aria-controls="qp-${n}"` : ""}>
    <span class="t">${esc(g.text)}</span>${age(g.createdAt)}
    <span class="m">${meta}${after ? ` · <b>${after} more after this</b>` : ""}</span></button>`;
}

function formHtml(g: QuestionGroup) {
  const j = g.jobs[0],
    many = g.jobs.length > 1;
  const target = many
    ? `<label class="qfor">Answer for <select name="job">${g.jobs.map(x => `<option value="${esc(x.gateId)}">${esc(x.title)} · #${x.id}</option>`).join("")}</select></label>
      <details class="qapps"><summary>${plural(g.jobs.length, "application")} asking this</summary><ul>${g.jobs.map(x => `<li><a href="#progress/${x.id}">${esc(x.company)} · ${esc(x.title)}</a> <span class="age">asked ${esc(when(x.askedAt))}</span></li>`).join("")}</ul></details>`
    : `<input type="hidden" name="job" value="${esc(j?.gateId)}">`;
  // Standing reuse is opt-in per answer. Unticked, the answer is for the chosen application only.
  const scope = g.standingAllowed
    ? `<label class="qstanding" title="${esc(g.scopeLabel)}"><input type="checkbox" name="scope" value="standing"> ${
        many ? `Use for all ${g.jobs.length} listed and future` : "Also use for future"
      } ${esc(j?.company)} applications asking exactly this</label>`
    : `<input type="hidden" name="scope" value="application">`;
  const options = pickable(g)
    ? `<div class="qopts">${g.options.map((o, n) => `<button type="submit" class="btn" data-question-option="${esc(o)}"><kbd>${n + 1}</kbd> ${esc(o)}</button>`).join("")}</div>`
    : "";
  return `<form data-question-form>${target}${options}
      <textarea name="answer" rows="1" aria-label="Your answer" placeholder="${pickable(g) ? "Or type another answer" : "Your answer"}">${esc(ui.questionDrafts.get(g.key) ?? "")}</textarea>
      ${scope}
      <div class="actions"><button class="btn primary" type="submit" data-question-answer>Save and queue</button><span class="hint qkeys"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span></div>
    </form>`;
}

function itemHtml(g: QuestionGroup, open: string, n: number) {
  const isOpen = g.key === open,
    j = g.jobs[0];
  const panel = isOpen
    ? `<div class="qpanel" id="qp-${n}">
      ${g.context || (g.jobs.length === 1 && j) ? `<p class="qctx">${esc(g.context)}${g.jobs.length === 1 && j ? `${g.context ? " · " : ""}<a href="#progress/${j.id}">Open application</a>` : ""}</p>` : ""}
      ${g.options.length > MAX_OPTIONS ? `<details class="qctx"><summary>${g.options.length} options</summary><ul>${g.options.map(o => `<li class="said">${esc(o)}</li>`).join("")}</ul></details>` : ""}
      ${formHtml(g)}</div>`
    : "";
  return `<section class="qitem ${isOpen ? "open" : ""}" data-question-group="${esc(g.key)}">${rowHtml(g, isOpen, n)}${panel}</section>`;
}

export function questionsHtml() {
  const groups = state().questionGroups,
    answer = answerable(),
    open = openKey();
  const oldest = answer.reduce<string | null>((o, g) => (!o || g.createdAt < o ? g.createdAt : o), null);
  const summary = [answer.length ? `${answer.length} to answer` : "", oldest ? `oldest asked ${when(oldest)}` : ""].filter(Boolean);
  const later = new Map<string, number>();
  for (const g of groups) if (g.kind !== "question") later.set(g.kind, (later.get(g.kind) ?? 0) + g.jobs.length);
  const laterText = Object.entries(LATER)
    .map(([kind, [one, many]]) => {
      const n = later.get(kind) ?? 0;
      return n ? `${n} ${n === 1 ? one : many}` : "";
    })
    .filter(Boolean)
    .join(", ");
  // Oldest first, under a heading for each age: the server sends them in the order they were asked.
  let bucket = "";
  const answerRows = answer
    .map((g, n) => {
      const label = BUCKETS.find(([, ms]) => ageMs(g.createdAt) > ms)?.[0] ?? "Today",
        head = label === bucket ? "" : `<div class="qbucket">${label}</div>`;
      bucket = label;
      return head + itemHtml(g, open, n);
    })
    .join("");
  const elsewhere = laterText
    ? `<p class="qelse">Also waiting on you: ${esc(laterText)}. <a href="#progress" data-view="progress">Open In progress ›</a></p>`
    : "";
  return `<div class="doc page" id="questions-inbox">
    <div class="head" style="padding:0"><h1>Questions</h1></div>
    ${summary.length ? `<p class="hint qsum">${summary.join(" · ")}</p>` : ""}
    <details class="qhow"><summary>How answers are reused</summary><p class="hint">An answer goes to the chosen application only, which then resumes. Ticking "Also use for future…" approves a standing answer: it is reused only when the same employer asks the exact same prompt with the same context and options, never as a general profile answer. Cover letters, submit confirmations and browser hand-offs are handled one application at a time, from In progress.</p></details>
    ${elsewhere}
    ${answer.length ? `<div class="qlist">${answerRows}</div>` : `<div class="empty">No questions to answer.</div>`}
  </div>`;
}
