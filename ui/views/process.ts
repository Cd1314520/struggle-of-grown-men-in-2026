// What happened after an application was sent: each step the employer asked for, whose move it is, and
// the buttons to record what the user did. The mailbox agent adds most steps; the user adds the rest.
import type { JobDetail } from "../../src/api-types";
import type { Step, StepKind } from "../../src/steps";
import { cap, dateTime, esc, linkify, parseAt, when } from "../util";

const KIND: Record<StepKind, string> = {
  questionnaire: "Questionnaire",
  assessment: "Assessment",
  schedule: "Booking",
  interview: "Interview",
  info_request: "Information request",
  other: "Step",
};
const KINDS = Object.keys(KIND) as StepKind[];
const ENDED = ["rejected_by_company", "withdrawn"];

// A deadline given as a day reads as that day; a time as the local date and time.
const day = (s: string) => new Date(`${s}T00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const at = (s: string) => (s.length === 10 ? day(s) : dateTime(parseAt(s)));
const ms = (s: string) => (s.length === 10 ? Date.parse(`${s}T23:59:59`) : parseAt(s));
// The value a datetime-local box takes for a stored time, on the local clock.
const localInput = (s: string | null) => {
  if (!s || s.length === 10) return "";
  const d = new Date(parseAt(s));
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function stateOf(s: Step): readonly [cls: string, label: string] {
  if (s.state === "todo") return s.due_at && ms(s.due_at) < Date.now() ? ["bad", "Overdue"] : ["need", "To do"];
  if (s.state === "done") return ["ok", "Done · waiting on them"];
  if (s.state === "scheduled") return s.scheduled_at && ms(s.scheduled_at) > Date.now() ? ["run", "Booked"] : ["ok", "Held · waiting on them"];
  return s.state === "expired" ? ["bad", "Expired"] : ["idle", cap(s.state)];
}

// The fields of a step, empty for a new one.
function fieldsHtml(s: Step | null) {
  const kind = s?.kind ?? "assessment";
  return `<div class="stfields">
    <label>Kind<select name="kind">${KINDS.map(k => `<option value="${k}" ${k === kind ? "selected" : ""}>${KIND[k]}</option>`).join("")}</select></label>
    <label class="wide">What<input type="text" name="title" value="${esc(s?.title)}" placeholder="HackerRank assessment, 90 min"></label>
    <label>Due<input type="date" name="due" value="${esc(s?.due_at?.slice(0, 10))}"></label>
    <label class="wide">Link<input type="url" name="link" value="${esc(s?.link)}" placeholder="https://"></label>
    <label class="wide">Notes<textarea name="detail" rows="2">${esc(s?.detail)}</textarea></label>
  </div>`;
}

function stepHtml(s: Step) {
  const [cls, label] = stateOf(s),
    box = `st-${s.id}`;
  const facts = [
    s.scheduled_at ? (s.state === "scheduled" ? `<b>${esc(at(s.scheduled_at))}</b>` : `booked for ${esc(at(s.scheduled_at))}`) : "",
    s.due_at && s.state === "todo" ? `due ${esc(at(s.due_at))}` : "",
    s.done_at ? `done ${when(s.done_at)}` : "",
    `${s.source === "mail" ? "from mail" : "added by you"} ${when(s.created_at)}`,
  ].filter(Boolean);
  const btn = (op: string, text: string, kind = "btn sm") => `<button class="${kind}" data-step-op="${op}" data-step="${s.id}">${text}</button>`;
  const toggle = (what: string, text: string) => `<button class="btn sm quiet" data-toggle="#${box}-${what}">${text}</button>`;
  const bookable = s.kind === "schedule" || s.kind === "interview";
  const open = s.state === "todo" || s.state === "done" || s.state === "scheduled";
  const actions = open
    ? [
        s.state === "todo" ? btn("done", "Done", "btn sm primary") : "",
        s.state === "todo" ? toggle("note", "Done, with a note…") : "",
        bookable ? toggle("book", s.state === "scheduled" ? "Change time" : "Booked for…") : "",
        s.state !== "todo" ? btn("todo", "Back to to-do", "btn sm quiet") : "",
        toggle("edit", "Edit"),
        btn("cancel", "Cancel", "btn sm quiet"),
        btn("remove", "Remove", "btn sm quiet danger"),
      ]
    : [btn("todo", "Reopen", "btn sm quiet"), btn("remove", "Remove", "btn sm quiet danger")];
  return `<li class="step ${open ? "" : "closed"}" data-step-box>
    <div class="st-h"><span class="tag ${cls}">${label}</span><span class="st-k">${KIND[s.kind]}</span><span class="st-t">${esc(s.title)}</span></div>
    <div class="hint">${facts.join(" · ")}</div>
    ${s.link ? `<div class="st-link"><a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer">${esc(s.link.replace(/^https?:\/\//, "").slice(0, 60))} ↗</a></div>` : ""}
    ${s.detail ? `<p class="hint said">${linkify(esc(s.detail))}</p>` : ""}
    ${s.done_note ? `<p class="hint said">Your note: ${esc(s.done_note)}</p>` : ""}
    <div class="actions">${actions.join("")}</div>
    <div class="reveal" id="${box}-note"><textarea name="note" rows="2" placeholder="How it went, what you sent"></textarea><div class="actions">${btn("done", "Save as done")}</div></div>
    <div class="reveal" id="${box}-book"><input type="datetime-local" name="at" value="${esc(localInput(s.scheduled_at))}"><div class="actions">${btn("book", "Save time")}</div></div>
    <div class="reveal" id="${box}-edit">${fieldsHtml(s)}<div class="actions">${btn("edit", "Save changes")}</div></div>
  </li>`;
}

// The line under the heading: whose move it is, or how the application ended.
function leadOf(j: JobDetail) {
  const n = j.next;
  if (j.status === "offer") return `Offer${j.note ? `: ${esc(j.note)}` : ""}`;
  if (ENDED.includes(j.status)) return `${j.status === "withdrawn" ? "Withdrawn" : "Declined"} ${when(j.updated_at)}${j.note ? `: ${esc(j.note)}` : ""}`;
  if (!n) return `Sent ${when(j.submitted_at)}. No reply yet.`;
  if (n.whose === "you") return `Your move: ${esc(n.label)}${n.due ? `, due ${esc(at(n.at))}` : ""}`;
  if (n.whose === "upcoming") return `Booked: ${esc(n.label)}, ${esc(at(n.at))}`;
  const days = Math.floor((Date.now() - ms(n.at)) / 864e5);
  return `Waiting on ${esc(j.company)} since ${esc(at(n.at))}${n.quiet ? ` · quiet for ${days} days` : ""}`;
}

export function processHtml(j: JobDetail) {
  if (!["submitted", "interview", "offer", ...ENDED].includes(j.status) || j.gate) return "";
  const ended = ENDED.includes(j.status);
  const outcomes = ended
    ? [`<button class="btn quiet" data-act="reopen_application">Back in process</button>`]
    : [
        j.status === "offer" ? "" : `<button class="btn quiet" data-act="mark_offer">Mark offer</button>`,
        `<button class="btn quiet" data-act="mark_declined">Mark declined</button>`,
        `<button class="btn quiet danger" data-act="withdraw">Withdraw</button>`,
      ];
  const steps = j.steps.length
    ? `<ol class="steps">${j.steps.map(stepHtml).join("")}</ol>`
    : ended
      ? ""
      : `<p class="hint">Requests from the employer show up here when the mailbox is checked. Add one yourself for anything that came another way.</p>`;
  return `<div class="gate first process"><h3>Next steps</h3><p class="hint lead">${leadOf(j)}</p>${steps}
    <div class="actions">${ended ? "" : `<button class="btn" data-toggle="#st-add">Add a step</button>`}<span class="acts-end" id="stmore"><button type="button" class="btn quiet more-toggle" data-toggle="#stmore" aria-label="More actions" title="More actions">⋯</button><span class="menu">${outcomes.filter(Boolean).join("")}</span></span></div>
    <div class="reveal" id="st-add" data-step-box>${fieldsHtml(null)}<div class="actions"><button class="btn primary" data-step-op="add">Add step</button></div></div>
  </div>`;
}
