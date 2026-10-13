// The open job: its header, its tabs, and what each tab shows.
import type { JobDetail } from "../../src/api-types";
import type { Answer, ChecklistItem } from "../../src/rubric";
import { state, ui } from "../store";
import { cap, esc, plural, unent, when } from "../util";
import { SENT, statusOf, TAB_KEYS, TABS, VIEWS, type Tab } from "../views";
import { eventRow } from "./common";
import { gateHtml } from "./gate";
import { practiceEvidenceHtml } from "./practice";

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
    ${practiceEvidenceHtml(j)}
    ${risks.length ? `<div class="section"><div class="label">Watch out</div><ul class="risks">${risks.map(r => `<li>${esc(r)}</li>`).join("")}</ul></div>` : ""}
    ${j.hasPdf ? `<div class="section inline"><a href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener">Open resume ↗</a>${resumeNote ? `<span>${resumeNote}</span>` : ""}</div>` : ""}`;
  const gate = gateHtml(j);
  // Approving is a judgement on the fit, so the fit comes first. Every other decision is about what
  // the agent just did, so that comes first and the fit folds away.
  if (j.status === "awaiting_approval" || !gate) return outcome + fit + gate;
  const folded =
    j.score == null
      ? ""
      : `<div class="section"><details><summary>Fit ${j.score}${risks.length ? ` · ${plural(risks.length, "thing")} to watch` : ""}</summary>${fit}</details></div>`;
  return gate + folded;
}

const MARK: Record<Answer, string> = { yes: "✓", no: "✗", unclear: "?" };
function scoreHtml(j: JobDetail) {
  const S = state(),
    items = checklist(j);
  const practiceBlock = practiceEvidenceHtml(j);
  if (!items.length && !practiceBlock) return `<div class="empty">Not scored yet.</div>`;
  const block = (phase: Item["phase"]) => {
    const rows = items.filter(i => i.phase === phase);
    if (!rows.length) return "";
    const possible = rows.reduce((n, i) => n + Math.max(0, i.weight), 0),
      earned = rows.reduce((n, i) => n + i.points, 0);
    const met = rows.filter(i => i.required && i.answer !== "no"),
      shown = rows.filter(i => !met.includes(i));
    return (
      `<div class="section"><div class="label">${phase} · ${earned} / ${possible}</div>` +
      (met.length
        ? `<div class="chk"><span class="mark yes">✓</span><span>${plural(met.length, "requirement")} met <span style="color:var(--sub)">(${met.map(itemLabel).join(", ")})</span></span></div>`
        : "") +
      shown
        .map(
          i =>
            `<div class="chk"><span class="mark ${i.answer}">${MARK[i.answer]}</span><span>${esc(i.statement)}</span><span class="pts">${i.required ? "required" : `${i.points} / ${i.weight}`}</span>${i.evidence ? `<span class="why">${esc(i.evidence)}</span>` : ""}</div>`,
        )
        .join("") +
      `</div>`
    );
  };
  return practiceBlock + block(S.phase) + (S.phase === "practice" ? block("real") : "");
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
  return `<div class="section inline"><a class="btn" href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener">Open ${esc(j.pdfName)}</a><a href="/api/jobs/${j.id}/resume.pdf" download="${esc(j.pdfName)}">Download</a>
      ${j.resumeFrozen ? `<span>Locked ${when(j.resume_frozen_at)} · ${esc((j.resume_sha ?? "").slice(0, 10))}</span>` : ""}</div>
    ${bullets.length ? `<div class="section"><div class="label">What changed</div><ul class="risks" style="color:var(--text)">${bullets.map(b => `<li>${esc(b)}</li>`).join("")}</ul></div>` : ""}
    ${j.diff ? `<div class="section"><details><summary>Source diff against your base resume</summary><pre>${diff}</pre></details></div>` : ""}
    <a href="/api/jobs/${j.id}/resume.pdf" target="_blank" rel="noopener"><img class="shot page" src="/api/jobs/${j.id}/resume.png?v=${esc(j.resume_sha ?? j.updated_at)}" alt="First page of the tailored resume"></a>`;
}

function postingHtml(j: JobDetail) {
  const also = j.sources
    .map(s => `<div><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(cap(s.source))}</a>${s.location ? ` · ${esc(s.location)}` : ""}</div>`)
    .join("");
  return `<div class="section"><dl class="kv"><dt>Listed on</dt><dd><a href="${esc(j.url)}" target="_blank" rel="noopener">${esc(cap(j.source))} ↗</a></dd>${also ? `<dt>Also listed</dt><dd>${also}</dd>` : ""}<dt>Found</dt><dd>${when(j.found_at)}</dd></dl></div>
    <div class="section"><div class="label">Description</div><pre class="desc">${esc(unent(j.description ?? "Not captured. Open the posting."))}</pre></div>`;
}

const logHtml = (j: JobDetail) => `<div class="section">${j.events.map(eventRow).join("") || `<div class="empty">Nothing yet.</div>`}</div>`;

const BODY: Record<Tab, (j: JobDetail) => string> = { summary: summaryHtml, score: scoreHtml, resume: resumeHtml, posting: postingHtml, log: logHtml };

export function jobHtml(j: JobDetail) {
  const [cls, label] = statusOf(j.status);
  const others = j.siblings.length,
    sent = j.siblings.filter(x => SENT.includes(x.status)).length;
  return `<div class="doc"><button class="btn quiet back" data-back="1">← ${VIEWS[ui.view].label}</button>
    <div class="eyebrow"><span>${esc(j.company)}</span>${others ? `<span>${others} other role${others > 1 ? "s" : ""} here${sent ? `, ${sent} applied` : ""}</span>` : ""}<a href="${esc(j.url)}" target="_blank" rel="noopener">Original ↗</a></div>
    <h2>${esc(j.title)}</h2>
    <div class="facts">${["ok", "bad"].includes(cls) && j.status !== "failed" ? `<span class="pill ${cls}">${label}</span>` : ""}<span>${esc(j.location ?? "Location not listed")}</span>${j.opened_at && !j.submitted_at ? `<span>Opened ${when(new Date(j.opened_at).toISOString())}</span>` : ""}${j.submitted_at ? `<span>Applied ${when(j.submitted_at)}</span>` : ""}</div>
    <div class="tabs" role="tablist">${TAB_KEYS.map(k => `<button class="tab ${k === ui.tab ? "on" : ""}" data-tab="${k}" role="tab" aria-selected="${String(k === ui.tab)}">${TABS[k]}</button>`).join("")}</div>
    ${BODY[ui.tab](j)}</div>`;
}
