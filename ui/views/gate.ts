// The decision at the foot of a job: what the app is waiting on from the user, and the buttons for it.
// Every gate reads the same way: what is asked, the one primary action, then the rest folded away.
import type { JobDetail } from "../../src/api-types";
import { state } from "../store";
import { cap, esc, linkify, when } from "../util";
import { statusOf } from "../views";
import { fold } from "./common";

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

// What the agent saw when it asked: the page's own wording, quietly, and its fixed choices as chips that fill the answer.
function askedHtml(p: { context: string; options: string[] }, fill: boolean) {
  return `${p.context && p.context.trim() !== "" ? `<p class="hint said">${esc(p.context)}</p>` : ""}${
    p.options.length
      ? `<div class="opts"><span class="hint">Options</span>${p.options.map(o => (fill ? `<button type="button" class="chip" data-fill="${esc(o)}" title="Use this answer">${esc(o)}</button>` : `<span class="chip">${esc(o)}</span>`)).join("")}</div>`
      : ""
  }`;
}

interface Shell {
  title: string;
  lead?: string; // one short line under the title
  body?: string; // what the agent said, the answer box, the summary to approve
  primary?: string;
  secondary?: string[];
  tertiary?: string[]; // rare or destructive: pushed right, and behind ⋯ on a phone
  extra?: string; // a .reveal box a secondary button opens
  why?: string[]; // the policy behind the buttons, folded
  evidence?: string; // the saved page and checkpoint, folded
  attrs?: string;
  first: boolean;
}
function gateShell(g: Shell) {
  const tert = (g.tertiary ?? []).filter(Boolean),
    lead = !!g.primary || !!g.secondary?.some(Boolean);
  // The menu's buttons stay in the DOM while it is closed, so A and X still find Approve and Reject.
  const end = !tert.length
    ? ""
    : lead
      ? `<span class="acts-end" id="gmore"><button type="button" class="btn quiet more-toggle" data-toggle="#gmore" aria-label="More actions" title="More actions">⋯</button><span class="menu">${tert.join("")}</span></span>`
      : `<span class="acts-end">${tert.join("")}</span>`;
  const why = g.why?.length ? fold("gate-why", "How this works", g.why.map(w => `<p class="hint">${w}</p>`).join(""), "gate-why") : "";
  return `<div class="gate ${g.first ? "first" : ""}" ${g.attrs ?? ""}><h3>${g.title}</h3>${g.lead ? `<p class="hint lead">${g.lead}</p>` : ""}${g.body ?? ""}
    <div class="actions">${g.primary ?? ""}${(g.secondary ?? []).join("")}${end}</div>${g.extra ?? ""}${why}${g.evidence ?? ""}</div>`;
}

export function gateHtml(j: JobDetail) {
  const p = j.gate;
  const shot = p?.shot
    ? `<a href="/api/jobs/${j.id}/gate.png?v=${p.shot}" target="_blank" rel="noopener" title="Open full size"><img class="shot" src="/api/jobs/${j.id}/gate.png?v=${p.shot}" alt="Saved application page, not a live browser"></a>`
    : "";
  const live = j.vncUrl ? `<a class="btn" data-browser-lease href="${esc(j.vncUrl)}" target="_blank" rel="noopener">Inspect reserved browser</a>` : "";
  const gateId = gateIdOf(j);
  const reserve = gateId ? `<button class="btn" data-browser-action="reserve" data-gate-id="${esc(gateId)}">Reserve browser for inspection</button>` : "";
  const release = gateId ? `<button class="btn quiet" data-browser-action="release" data-gate-id="${esc(gateId)}">Release browser</button>` : "";
  const checkpoint = j.checkpoint;
  const CHECKPOINT_WHY =
    "A local checkpoint does not prove the employer saved the page. The worker verifies the existing draft before continuing. Its former browser may now belong to another application.";
  // The saved page and the checkpoint are for when something looks off: one fold for both.
  const evidence =
    shot || checkpoint
      ? `<div class="gate-ev">${fold(
          "gate-evidence",
          `${shot ? (checkpoint ? "Saved page & checkpoint" : "Saved page") : "Saved checkpoint"}${checkpoint ? ` · ${esc(when(checkpoint.savedAt))}` : ""}`,
          `${shot}${
            checkpoint
              ? `<div data-checkpoint><dl class="kv" style="margin-top:12px">
    <dt>Step</dt><dd>${esc(checkpoint.step)}</dd><dt>Page URL</dt><dd>${esc(checkpoint.url ?? "Not recorded")}</dd>
    <dt>Notes</dt><dd>${esc(checkpoint.notes)}</dd><dt>Frozen resume SHA</dt><dd><code>${esc(checkpoint.resumeSha ?? "Not recorded")}</code></dd>
    </dl></div>`
              : ""
          }`,
        )}</div>`
      : "";
  const why = (...lines: string[]) => [...lines, ...(checkpoint ? [CHECKPOINT_WHY] : [])];
  const first = j.status !== "awaiting_approval" && j.status !== "held";
  // An application that may already have gone out can only be resolved or rejected, never held.
  const hold = j.submissionAmbiguous ? "" : `<button class="btn quiet" data-act="hold">Hold for later</button>`;
  const reject = `<button class="btn quiet danger" data-act="reject">Reject</button>`;
  const asked = p?.createdAt ? `Asked ${esc(when(p.createdAt))}` : "";
  const recoveryMode = j.recoveryMode ?? (j.submissionAmbiguous && !p && (j.status === "filling" || j.status === "needs_manual") ? "verify" : null);
  if (recoveryMode === "verify") {
    const isRunning = j.status === "filling";
    return gateShell({
      first,
      title: isRunning ? "Checking application status" : "Queued to check status",
      lead: isRunning ? "The agent is checking the exact application and mail in the browser." : "Waiting for an eligible browser worker.",
      body: j.note
        ? `<div class="section">${fold("prior-note", "Previous run note", `<p class="said" style="color:var(--sub)">${esc(j.note)}</p>`)}</div>`
        : "",
      tertiary: [`<button class="btn quiet danger" data-act="reject">Reject application</button>`],
      why: why("No new submit happens while the status is unknown."),
      evidence,
    });
  }
  if (j.submissionAmbiguous && !["submitted", "interview", "offer", "rejected_by_company", "withdrawn", "rejected"].includes(j.status)) {
    const context = (p?.context || parsePending(j.pending)?.context || "").trim();
    const reason = context && context !== p?.text ? context : (p?.text ?? j.note ?? "");
    const recoverBtn = gateId ? `<button class="btn primary" data-act="recover" data-gate-id="${esc(gateId)}">Check status & recover</button>` : "";
    // Checking by hand: look in the browser, then say what you found. Both answers ask to confirm.
    const browser = j.manualBrowserReserved ? `${live}${release.replace("btn quiet", "btn sm")}` : reserve.replace('class="btn"', 'class="btn sm"');
    return gateShell({
      first,
      attrs: `data-submission-ambiguous ${gateId ? `data-gate-id="${esc(gateId)}"` : ""}`,
      title: "Submission outcome is unknown",
      lead: "The final submit may already have happened. Check before anything is sent again.",
      body: `<p class="said">${esc(reason)}</p>
        <div class="selfcheck"><span class="hint">To look yourself:</span>${browser}</div>
        <div class="selfcheck"><span class="hint">I checked it myself:</span><button class="btn" data-act="mark_submitted">Verified submitted</button><button class="btn" data-act="confirmed_not_submitted">Verified not submitted · queue</button></div>`,
      primary: recoverBtn,
      tertiary: [reject],
      why: why(
        "Check status & recover: the agent signs in with saved credentials and checks the exact application and mail; no new submit while the status is unknown.",
        "To check yourself, inspect the existing application/account and confirmation mail. Ordinary retry and response are disabled; never create another application to check.",
        j.manualBrowserReserved
          ? "You reserved this browser for inspection. Release browser when finished so other applications can use the slot."
          : "This blocker releases its slot after the worker exits. Reserve the browser only when you need to inspect it. The saved draft, checkpoint and submission protection remain intact.",
      ),
      evidence,
    });
  }
  if (j.status === "awaiting_approval")
    return gateShell({
      first,
      title: "Apply to this job?",
      lead: state().confirmBeforeSubmit
        ? "The agent fills in the form and stops for your OK before it submits."
        : "The agent fills in the form and submits it.",
      body: j.resumeFrozen ? `<p class="hint">This application already started with its frozen resume, so the resume can no longer be changed.</p>` : "",
      primary: `<button class="btn primary" data-act="approve" title="Approve (A)">Approve</button>`,
      secondary: j.resumeFrozen ? [] : [`<button class="btn" data-toggle="#redo">Change resume</button>`],
      tertiary: [hold, reject.replace('data-act="reject"', 'data-act="reject" title="Reject (X)"')],
      extra: `<div class="reveal" id="redo"><textarea id="fb" rows="3" placeholder="What should change in the resume?"></textarea><div class="actions"><button class="btn" data-act="redo" data-text="#fb">Redo with this note</button></div></div>`,
    });
  if (p?.kind === "question" || p?.kind === "cover_letter") {
    const letter = p.kind === "cover_letter";
    return gateShell({
      first,
      attrs: `data-gate-id="${esc(p.id)}"`,
      title: letter ? "This application requires a cover letter" : "The agent needs an answer",
      lead: asked,
      body: `<p class="said ask">${esc(p.text)}</p>${askedHtml(p, !letter)}
        <label for="ans" class="hint" style="display:block;margin-top:14px">${letter ? "Cover letter · this application only, entered exactly as you write it" : `Your answer · this application only — <a href="#questions">answer all matching</a>`}</label><textarea id="ans" rows="${letter ? 12 : 3}" required></textarea>`,
      primary: `<button class="btn primary" data-act="respond" data-text="#ans">${letter ? "Save letter and queue" : "Save and queue"}</button>`,
      tertiary: [hold, reject],
      why: why(
        letter
          ? "The letter is stored for this application only and typed into the form as written."
          : "Stored durably for this application, never added to your global answer bank. For explicitly scoped standing reuse, use Questions.",
      ),
      evidence,
    });
  }
  if (p?.kind === "confirm_submit")
    return gateShell({
      first,
      attrs: `data-gate-id="${esc(p.id)}"`,
      title: "Submit this application?",
      lead: asked && `Filled in and waiting · ${asked.toLowerCase()}`,
      body: entered(p.text),
      primary: `<button class="btn primary" data-act="respond" data-fixed="approve">Approve submission</button>`,
      secondary: [`<button class="btn" data-toggle="#chgbox">Change something</button>`],
      tertiary: [hold, reject],
      extra: `<div class="reveal" id="chgbox"><label for="chg">Changes for this application</label><textarea id="chg" rows="3" placeholder="What should the agent change first?"></textarea><div class="actions"><button class="btn" data-act="respond" data-text="#chg">Save changes and queue</button></div></div>`,
      why: why("Approval applies only to this application's exact saved summary. The worker resumes and verifies it before submitting."),
      evidence,
    });
  if (p?.kind === "manual") {
    const recover = `<button class="btn" data-act="recover" data-gate-id="${esc(p.id)}">Check status & recover</button>`,
      submitted = `<button class="btn quiet" data-act="mark_submitted">I submitted it</button>`;
    // Before the browser is reserved the next step is to take it; once it is, the next step is to give it back.
    const reserved = j.manualBrowserReserved;
    return gateShell({
      first,
      attrs: `data-gate-id="${esc(p.id)}" data-manual-handoff`,
      title: "Browser hand-off: the agent needs you to take over",
      lead: asked,
      body: `<p class="said ask">${esc(p.text)}</p>${askedHtml(p, false)}`,
      primary: reserved
        ? `<button class="btn primary" data-act="respond" data-fixed="done">Hand control back</button>`
        : reserve.replace('class="btn"', 'class="btn primary"'),
      secondary: reserved ? [live] : [recover],
      tertiary: reserved ? [release, recover.replace('class="btn"', 'class="btn quiet"'), submitted, hold, reject] : [submitted, hold, reject],
      why: why(
        reserved
          ? "You reserved this browser for inspection. Release browser when finished so other applications can use the slot."
          : "This blocker releases its slot after the worker exits. Reserve the browser before inspecting or changing it. The saved draft and checkpoint remain intact.",
        "Hand control back and Check status & recover resume the authorized application after checking its current state; existing drafts are reused and submission approval rules still apply.",
      ),
      evidence,
    });
  }
  if (j.status === "failed")
    return gateShell({
      first,
      title: "This application failed",
      body: `<p class="said" style="color:var(--sub)">${esc(cap(j.note ?? "No reason was recorded."))}</p>`,
      primary: `<button class="btn primary" data-act="retry">Retry</button>`,
      secondary: [live],
      tertiary: [`<button class="btn quiet" data-act="mark_submitted">Mark submitted</button>`, hold, reject],
      evidence,
    });
  if (j.status === "held")
    return gateShell({
      first,
      title: "Held for later",
      lead: j.note ? esc(cap(j.note)) : "",
      primary: `<button class="btn primary" data-act="retry">Assess now</button>`,
      tertiary: [reject],
    });
  if (j.status === "rejected")
    return `<div class="gate ${first ? "first" : ""}">${j.submissionAmbiguous ? `<p class="hint">Rejected with an unresolved submission marker. Reconsidering is disabled to prevent a duplicate application.</p>` : `<div class="actions" style="margin-top:0"><button class="btn" data-act="retry">Reconsider</button></div>`}</div>`;
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
    // The note is from an earlier run: folded, so the line above is the only current state.
    return gateShell({
      first,
      title: statusOf(j.status)[1],
      lead: doing,
      body: j.note
        ? `<div class="section">${fold("prior-note", "Previous run note", `<p class="said" style="color:var(--sub)">${esc(j.note)}</p>`)}</div>`
        : "",
      tertiary: [`<button class="btn quiet danger" data-act="reject" title="Stop and reject (X)">Stop & reject</button>`],
      why: checkpoint ? [CHECKPOINT_WHY] : [],
      evidence,
    });
  }
  return "";
}
