// The decision at the foot of a job: what the app is waiting on from the user, and the buttons for it.
import type { JobDetail } from "../../src/api-types";
import { state } from "../store";
import { cap, esc, linkify, when } from "../util";
import { statusOf } from "../views";
import { questionDetailsHtml } from "./questions";

// The gate a job's `pending` column points at, for jobs whose gate row is not open any more.
export const parsePending = (raw: string | null | undefined): { gateId?: string; context?: string } | null => {
  if (!raw) return null;
  try {
    const p: unknown = JSON.parse(raw);
    if (!p || typeof p !== "object") return null;
    const { gateId, context } = p as Record<string, unknown>;
    return { ...(typeof gateId === "string" && { gateId }), ...(typeof context === "string" && { context }) };
  } catch {
    return null;
  }
};
// The gate an action on this job answers.
export const gateIdOf = (j: JobDetail | null) => j?.gate?.id ?? parsePending(j?.pending)?.gateId;

// "Label: value" lines from the agent become a definition list; anything else stays as text.
// A summary written as one paragraph is taken a sentence at a time instead, so each answer gets its own row.
function entered(text: string) {
  text = text.replace(/\/\S*\/data\/jobs\/\S*\/([^/\s]+)/g, "$1"); // the frozen resume's path on disk: the file name is enough
  let lines = text.split("\n").filter(l => l.trim());
  const prose = lines.length < 3;
  if (prose)
    lines = text
      .split(/(?<=[^A-Z.]\.)\s+(?=[A-Z"])/)
      .filter(l => l.trim())
      .map(l => l.replace(/\.$/, ""));
  const rows: [label: string, value: string][] = [];
  for (const line of lines) {
    const m = /^([^:]{2,60}):\s+(.*)$/s.exec(line),
      last = rows.at(-1);
    if (m) rows.push([m[1] ?? "", m[2] ?? ""]);
    else if (last && !prose) last[1] += "\n" + line;
    else rows.push(["", line]);
  }
  return rows.length < 3
    ? `<p class="said">${linkify(esc(text))}</p>`
    : `<dl class="kv" style="margin-top:12px">${rows.map(([k, v]) => (k ? `<dt>${esc(k)}</dt><dd>${linkify(esc(v.trim()))}</dd>` : `<dd class="full">${linkify(esc(v.trim()))}</dd>`)).join("")}</dl>`;
}

export function gateHtml(j: JobDetail) {
  const p = j.gate;
  const shot = p?.shot
    ? `<a href="/api/jobs/${j.id}/gate.png?v=${p.shot}" target="_blank" rel="noopener" title="Open full size"><img class="shot" src="/api/jobs/${j.id}/gate.png?v=${p.shot}" alt="Saved application page, not a live browser"></a>`
    : "";
  const live = j.vncUrl ? `<a class="btn" data-browser-lease href="${esc(j.vncUrl)}" target="_blank" rel="noopener">Inspect reserved browser</a>` : "";
  const gateId = gateIdOf(j);
  const browserAction = !gateId
    ? ""
    : j.manualBrowserReserved
      ? `${live}<button class="btn" data-browser-action="release" data-gate-id="${esc(gateId)}">Release browser</button>`
      : `<button class="btn" data-browser-action="reserve" data-gate-id="${esc(gateId)}">Reserve browser for inspection</button>`;
  const checkpoint = j.checkpoint;
  const saved = checkpoint
    ? `<div class="section" data-checkpoint><details><summary>Saved checkpoint · ${esc(when(checkpoint.savedAt))}</summary><dl class="kv">
    <dt>Step</dt><dd>${esc(checkpoint.step)}</dd><dt>Page URL</dt><dd>${esc(checkpoint.url ?? "Not recorded")}</dd>
    <dt>Notes</dt><dd>${esc(checkpoint.notes)}</dd><dt>Frozen resume SHA</dt><dd><code>${esc(checkpoint.resumeSha ?? "Not recorded")}</code></dd>
    </dl><p class="hint">A local checkpoint does not prove the employer saved the page. The worker verifies the existing draft before continuing. Its former browser may now belong to another application.</p></details></div>`
    : "";
  const first = j.status === "awaiting_approval" ? "" : "first";
  const reject = `<button class="btn quiet danger" data-act="reject">Reject</button>`;
  const recoveryMode = j.recoveryMode ?? (j.submissionAmbiguous && !p && (j.status === "filling" || j.status === "needs_manual") ? "verify" : null);
  if (recoveryMode === "verify") {
    const isRunning = j.status === "filling";
    return `<div class="gate ${first}"><h3>${isRunning ? "Checking application status" : "Queued to check status"}</h3>
      <p class="hint">${isRunning ? "The agent is checking the exact application and mail in the browser; no new submit while status unknown." : "Status check requested. Waiting for an eligible browser worker."}</p>
      ${j.note ? `<p class="hint">Prior run note — not the current check result</p><p class="said" style="color:var(--sub)">${esc(j.note)}</p>` : ""}
      ${saved}
      <div class="actions"><button class="btn quiet danger" data-act="reject">Reject application</button></div></div>`;
  }
  if (j.submissionAmbiguous && !["submitted", "interview", "offer", "rejected_by_company", "rejected"].includes(j.status)) {
    const context = (p?.context || parsePending(j.pending)?.context || "").trim();
    const reason = context && context !== p?.text ? context : (p?.text ?? j.note ?? "");
    const recoverBtn = gateId ? `<button class="btn" data-act="recover" data-gate-id="${esc(gateId)}">Check status & recover</button>` : "";
    return `<div class="gate ${first}" data-submission-ambiguous ${gateId ? `data-gate-id="${esc(gateId)}"` : ""}><h3>Submission outcome is unknown</h3>
      <p class="hint">${j.manualBrowserReserved ? "You reserved this browser for inspection. Release browser when finished so other applications can use the slot." : "This blocker releases its slot after the worker exits. Reserve the browser only when you need to inspect it."} The saved draft, checkpoint, and submission protection remain intact.</p>
      <p class="hint">The final submit may already have happened. Inspect the existing application/account and confirmation mail before deciding. Ordinary retry and response are disabled; never create another application to check.</p>
      <p class="said">${esc(reason)}</p>${shot}${saved}
      <p class="hint" style="margin-top:12px">The agent signs in with saved credentials and checks exact application/mail; no new submit while status unknown.</p>
      <div class="actions">${recoverBtn}${browserAction}<button class="btn" data-act="mark_submitted">Verified submitted</button><button class="btn" data-act="confirmed_not_submitted">Verified not submitted · queue</button>${reject}</div></div>`;
  }
  if (j.status === "awaiting_approval")
    return `<div class="gate"><h3>Apply to this job?</h3>
      <p class="hint">${state().confirmBeforeSubmit ? "The agent fills in the form and stops for your OK before it submits." : "The agent fills in the form and submits it."}</p>
      <div class="actions"><button class="btn primary" data-act="approve" title="Approve (A)">Approve</button>${j.resumeFrozen ? "" : `<button class="btn" data-toggle="#redo">Change resume</button>`}${reject}</div>
      ${j.resumeFrozen ? `<p class="hint">This application already started with its frozen resume, so the resume can no longer be changed.</p>` : ""}<div class="reveal" id="redo"><textarea id="fb" rows="3" placeholder="What should change in the resume?"></textarea><div class="actions"><button class="btn" data-act="redo" data-text="#fb">Redo with this note</button></div></div></div>`;
  if (p?.kind === "question")
    return `<div class="gate ${first}" data-gate-id="${esc(p.id)}"><h3>The agent needs an answer</h3><p class="said">${esc(p.text)}</p>${questionDetailsHtml(p)}${shot}${saved}
      <label for="ans" class="hint" style="display:block;margin-top:12px">Your answer · this application only</label><textarea id="ans" rows="3" required></textarea><p class="hint" style="margin-top:6px">Stored durably for this application, never added to your global answer bank. For explicitly scoped standing reuse, use <a href="#questions">Questions</a>.</p>
      <div class="actions"><button class="btn primary" data-act="respond" data-text="#ans">Save answer and queue</button>${reject}</div></div>`;
  if (p?.kind === "cover_letter")
    return `<div class="gate ${first}" data-gate-id="${esc(p.id)}"><h3>This application requires a cover letter</h3><p class="said">${esc(p.text)}</p>${questionDetailsHtml(p)}${shot}${saved}
      <label for="ans" class="hint" style="display:block;margin-top:12px">Cover letter · this application only</label><textarea id="ans" rows="12" required></textarea><p class="hint" style="margin-top:6px">Entered exactly as you write it, for this job only.</p>
      <div class="actions"><button class="btn primary" data-act="respond" data-text="#ans">Save letter and queue</button>${reject}</div></div>`;
  if (p?.kind === "confirm_submit")
    return `<div class="gate ${first}" data-gate-id="${esc(p.id)}"><h3>Submit this application?</h3><p class="hint">Approval applies only to this application's exact saved summary. The worker resumes and verifies it before submitting.</p>
      ${entered(p.text)}${shot}${saved}
      <div class="actions"><button class="btn primary" data-act="respond" data-fixed="approve">Approve submission</button><button class="btn" data-toggle="#chgbox">Change something</button>${reject}</div>
      <div class="reveal" id="chgbox"><label for="chg">Changes for this application</label><textarea id="chg" rows="3" placeholder="What should the agent change first?"></textarea><div class="actions"><button class="btn" data-act="respond" data-text="#chg">Save changes and queue</button></div></div></div>`;
  if (p?.kind === "manual")
    return `<div class="gate ${first}" data-gate-id="${esc(p.id)}" data-manual-handoff><h3>The agent needs browser help</h3><p class="said">${esc(p.text)}</p>${questionDetailsHtml(p)}${shot}${saved}
      <p class="hint" style="margin-top:12px">${j.manualBrowserReserved ? "You reserved this browser for inspection. Release browser when finished so other applications can use the slot." : "This blocker releases its slot after the worker exits. Reserve the browser before inspecting or changing it."} The saved draft and checkpoint remain intact.</p>
      <p class="hint" style="margin-top:12px">Resumes the authorized application after checking its current state; existing drafts are reused and submission approval rules still apply.</p>
      <div class="actions"><button class="btn" data-act="recover" data-gate-id="${esc(p.id)}">Check status & recover</button>${browserAction}${j.manualBrowserReserved ? `<button class="btn primary" data-act="respond" data-fixed="done">Hand control back</button>` : ""}<button class="btn" data-act="mark_submitted">I submitted it</button>${reject}</div></div>`;
  if (j.status === "failed")
    return `<div class="gate ${first}"><h3>This application failed</h3><p class="said" style="color:var(--sub)">${esc(cap(j.note ?? "No reason was recorded."))}</p>
      <div class="actions"><button class="btn primary" data-act="retry">Retry</button>${live}<button class="btn" data-act="mark_submitted">Mark submitted</button>${reject}</div></div>`;
  if (j.status === "held")
    return `<div class="gate ${first}"><h3>Held for later</h3><p class="hint">${esc(cap(j.note ?? ""))}</p>
      <div class="actions"><button class="btn" data-act="retry">Assess now</button>${reject}</div></div>`;
  if (j.status === "rejected")
    return `<div class="gate ${first}">${j.submissionAmbiguous ? `<p class="hint">Rejected with an unresolved submission marker. Reconsidering is disabled to prevent a duplicate application.</p>` : `<div class="actions" style="margin-top:0"><button class="btn" data-act="retry">Reconsider</button></div>`}</div>`;
  if (["approved", "filling", "triaged", "prepping", "locating"].includes(j.status)) {
    const last = j.events.find(e => e.kind === "step");
    const doing =
      checkpoint && (j.status === "approved" || j.status === "filling")
        ? j.status === "approved"
          ? "Queued to resume the authorized application when a worker is available."
          : "Resuming the authorized application with its saved answers and frozen resume."
        : last
          ? esc(last.message)
          : "Waiting for a free worker.";
    return `<div class="gate ${first}"><h3>${statusOf(j.status)[1]}</h3><p class="hint">${doing}</p>${j.note ? `<p class="hint">Prior run note</p><p class="said" style="color:var(--sub)">${esc(j.note)}</p>` : ""}${saved}<div class="actions"><button class="btn" data-act="reject">Stop</button></div></div>`;
  }
  return "";
}
