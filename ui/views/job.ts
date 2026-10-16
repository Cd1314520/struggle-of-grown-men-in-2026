// The open job: its header, its tabs, and what each tab shows.
import type { JobDetail } from "../../src/api-types";
import type { Answer, ChecklistItem } from "../../src/rubric";
import { state, ui } from "../store";
import { cap, esc, plural, unent, when } from "../util";
import { SENT, statusOf, TAB_KEYS, TABS, VIEWS, type Tab } from "../views";
import { eventRow, fold } from "./common";
import { gateHtml } from "./gate";
import { practiceEvidenceHtml, practiceLineHtml, practicePill } from "./practice";

const NOISE = /compil|pdfinfo|typst|page count|one page|metadata/i; // build chatter that older assessments wrote into "concerns"

// Checklists stored before items carried a label have none.
type Item = Omit<ChecklistItem, "label"> & { label?: string };
const checklist = (j: JobDetail) => (j.checklist ? (JSON.parse(j.checklist) as Item[]) : []);
const itemLabel = (i: Item) => esc(cap(i.label ?? (i.key.split(".")[1] ?? "").replace(/_/g, " ")));

function verdictHtml(j: JobDetail) {
  const S = state(),
    items = checklist(j).filter(i => i.phase === S.phase);
  if (j.score == null || !items.length) return "";
  const scored = items.filter(i => !i.required).sort((a, b) => b.weight - a.weight);
  const misses = [...items.filter(i => i.required && i.answer === "no"), ...scored.filter(i => i.answer === "no")];
  const hits = scored.filter(i => i.answer === "yes");
  const show = [...misses.map(i => `<span class="chip no">✗ ${itemLabel(i)}</span>`), ...hits.map(i => `<span class="chip yes">✓ ${itemLabel(i)}</span>`)];
  const extra = show.length - 3;
  return `<div class="verdict"><span class="num">${j.score}</span><span class="of">/ 100${S.threshold != null ? ` · needs ${S.threshold}` : ""}</span>${show.slice(0, 3).join("")}${extra > 0 ? `<button class="morebtn" data-tab="score">+${extra} more</button>` : ""}</div>`;
}

function summaryHtml(j: JobDetail) {
  const risks = (j.concerns ?? "")
    .split(/\n|(?<=\.)\s+(?=[A-Z])/)
    .map(s => s.replace(/^[-•\s]+/, "").trim())
    .filter(s => s && !NOISE.test(s))
    .slice(0, 3);
  const changes = (j.resume_changes ?? "").split("\n").filter(l => l.trim() && !NOISE.test(l)).length;
  const resumeNote = j.resumeFrozen
    ? j.submitted_at
      ? "as submitted"
      : "locked for this application"
    : changes
      ? `${plural(changes, "change")} from your base resume`
      : "";
  const outcome =
    (SENT.includes(j.status) || j.status === "rejected_by_company") && j.note ? `<div class="section"><p class="prose">${esc(j.note)}</p></div>` : "";
  const fit = `${verdictHtml(j)}
    ${j.rationale ? `<p class="prose clamp" style="margin-top:12px">${esc(j.rationale)}</p>${j.rationale.length > 190 ? `<button class="morebtn" data-more="1">More</button>` : ""}` : ""}
    ${risks.length ? `<div class="section"><div class="label">Watch out</div><ul class="risks">${risks.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
    ${j.hasPdf ? `<div class="section inline"><a href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener">Open resume ↗</a>${resumeNote ? `<span>${resumeNote}</span>` : ""}</div>` : ""}
    ${practiceLineHtml(j)}`;
  const gate = gateHtml(j);
  // Approving, and taking a job off hold, are judgements on the fit, so the fit comes first. Every other
  // decision is about what the agent just did, so that comes first and the fit folds away.
  if (j.status === "awaiting_approval" || j.status === "held" || !gate) return outcome + fit + gate;
  const folded =
    j.score == null
      ? ""
      : `<div class="section">${fold("fit", `Fit ${j.score}${risks.length ? ` · ${plural(risks.length, "thing")} to watch` : ""}`, fit)}</div>`;
  return gate + folded;
}

const MARK: Record<Answer, string> = { yes: "✓", no: "✗", unclear: "?" };
const ORDER: Record<Answer, number> = { no: 0, unclear: 1, yes: 2 };
const chkRow = (i: Item) =>
  `<div class="chk"><span class="mark ${i.answer}">${MARK[i.answer]}</span><span>${esc(i.statement)}</span><span class="pts">${i.required ? "required" : `${i.points} / ${i.weight}`}</span>${i.evidence ? `<span class="why clamp" style="--lines:1" data-clamp="1">${esc(i.evidence)}</span>` : ""}</div>`;
// What cost points first; what was met folds into one line.
function scoreHtml(j: JobDetail) {
  const S = state(),
    items = checklist(j);
  const practice = practiceEvidenceHtml(j);
  if (j.score == null && !items.length) return `<div class="empty">Not scored yet.</div>${practice}`;
  const tally = (rows: Item[]) => `${rows.reduce((n, i) => n + i.points, 0)} / ${rows.reduce((n, i) => n + Math.max(0, i.weight), 0)}`;
  const block = (rows: Item[]) => {
    const open = rows
        .filter(i => i.answer !== "yes")
        .sort((a, b) => ORDER[a.answer] - ORDER[b.answer] || Number(b.required) - Number(a.required) || b.weight - a.weight),
      met = rows.filter(i => i.answer === "yes").sort((a, b) => Number(b.required) - Number(a.required) || b.weight - a.weight);
    return (
      (open.length ? open.map(chkRow).join("") : `<p class="hint">Nothing missed.</p>`) +
      (met.length ? `<div class="met">${fold(`met-${rows[0]?.phase ?? ""}`, `✓ ${met.length} met`, met.map(chkRow).join(""))}</div>` : "")
    );
  };
  const here = items.filter(i => i.phase === S.phase),
    real = S.phase === "practice" ? items.filter(i => i.phase === "real") : [];
  const head = `<div class="verdict"><span class="num">${j.score ?? "–"}</span><span class="of">/ 100${S.threshold != null ? ` · needs ${S.threshold}` : ""} · ${S.phase} phase${here.length ? ` · ${tally(here)} points` : ""}</span></div>`;
  return (
    head +
    (here.length
      ? `<div class="section">${block(here)}</div>`
      : `<p class="hint" style="margin-top:10px">Scored ${j.score}. This assessment predates the checklist.</p>`) +
    (real.length ? `<div class="section">${fold("real-phase", `Real-phase score · ${tally(real)}`, block(real))}</div>` : "") +
    practice
  );
}

function resumeHtml(j: JobDetail) {
  if (!j.hasPdf) return `<div class="empty">No tailored resume yet.</div>`;
  const bullets = (j.resume_changes ?? "")
    .split("\n")
    .map(l => l.replace(/^[-•\s]+/, "").trim())
    .filter(l => l && !NOISE.test(l));
  const diff = j.diff
    .split("\n")
    .map(l => `<span class="${l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}">${esc(l)}</span>`)
    .join("\n");
  // What changed is what to judge; the file itself is a click away.
  return `${bullets.length ? `<div class="section"><div class="label">What changed</div><ul class="risks" style="color:var(--text)">${bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>` : ""}
    <div class="section inline"><a class="btn" href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener">Open ${esc(j.pdfName)}</a><a href="/api/jobs/${j.id}/resume.pdf" download="${esc(j.pdfName)}">Download</a>
      ${j.resumeFrozen ? `<span>Locked ${when(j.resume_frozen_at)} · ${esc((j.resume_sha ?? "").slice(0, 10))}</span>` : ""}</div>
    ${j.diff ? `<div class="section"><details><summary>Source diff against your base resume</summary><pre>${diff}</pre></details></div>` : ""}
    <a href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener"><img class="shot page" src="/api/jobs/${j.id}/resume.png?v=${esc(j.resume_sha ?? j.updated_at)}" alt="First page of the tailored resume"></a>`;
}

function postingHtml(j: JobDetail) {
  const desc = unent(j.description ?? "Not captured. Open the posting.");
  const also = j.sources
    .map(s => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(cap(s.source))}</a>${s.location ? ` · ${esc(s.location)}` : ""}</div>`)
    .join("");
  return `<div class="section"><dl class="kv"><dt>Listed on</dt><dd><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(cap(j.source))} ↗</a></dd>${also ? `<dt>Also listed</dt><dd>${also}</dd>` : ""}<dt>Found</dt><dd>${when(j.found_at)}</dd></dl></div>
    <div class="section"><div class="label">Description</div><pre class="desc clamp" style="--lines:20">${esc(desc)}</pre>${desc.split("\n").length > 20 || desc.length > 2000 ? `<button class="morebtn" data-more="1">Show the whole description</button>` : ""}</div>`;
}

const logHtml = (j: JobDetail) =>
  `<div class="section">${j.events.map(eventRow).join("") || `<div class="empty">No activity yet. Found ${when(j.found_at)}.</div>`}</div>`;

const BODY: Record<Tab, (j: JobDetail) => string> = { summary: summaryHtml, score: scoreHtml, resume: resumeHtml, posting: postingHtml, log: logHtml };

// What the job waits on, in the header. A stuck job says what it is stuck on, from its open gate.
const GATE_LABEL: Record<string, string> = { question: "Question", cover_letter: "Cover letter", manual: "Browser hand-off", confirm_submit: "Confirm submit" };
function statePill(j: JobDetail) {
  const [cls, label] = statusOf(j.status);
  if (j.submissionAmbiguous && j.status !== "rejected" && !SENT.includes(j.status)) return `<span class="pill need">Outcome unknown</span>`;
  // Every job in To review is waiting for review: no colour needed there.
  if (j.status === "awaiting_approval") return `<span class="pill">To review</span>`;
  return `<span class="pill ${cls}">${esc((j.gate && GATE_LABEL[j.gate.kind]) ?? label)}</span>`;
}
// The score in the header, so it never drops out of sight, whatever the tab or checklist. It opens the Score tab.
function fitPill(j: JobDetail) {
  if (j.score == null) return "";
  const t = state().threshold;
  return `<button class="pill score-pill ${t != null && j.score >= t ? "ok" : ""}" data-tab="score" title="Fit score: open the Score tab">Fit ${j.score}${t != null ? ` <span>/ needs ${t}</span>` : ""}</button>`;
}

export function jobHtml(j: JobDetail) {
  const others = j.siblings.length,
    sent = j.siblings.filter(x => SENT.includes(x.status)).length;
  return `<div class="doc"><button class="btn quiet back" data-back="1">← ${VIEWS[ui.view].label}</button>
    <div class="eyebrow"><span>${esc(j.company)}</span>${others ? `<span>${others} other role${others > 1 ? "s" : ""} here${sent ? `, ${sent} applied` : ""}</span>` : ""}<a href="${esc(j.url)}" target="_blank" rel="noopener">Original ↗</a></div>
    <h2>${esc(j.title)}</h2>
    <div class="facts">${statePill(j)}${fitPill(j)}${practicePill(j)}<span>${esc(j.location ?? "Location not listed")}</span>${j.submitted_at ? `<span>Applied ${when(j.submitted_at)}</span>` : j.found_at ? `<span>Found ${when(j.found_at)}</span>` : ""}</div>
    <div class="tabs" role="tablist">${TAB_KEYS.map(k => `<button class="tab ${k === ui.tab ? "on" : ""}" data-tab="${k}" role="tab" aria-selected="${String(k === ui.tab)}">${TABS[k]}</button>`).join("")}</div>
    ${BODY[ui.tab](j)}</div>`;
}
