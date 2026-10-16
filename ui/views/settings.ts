// Settings: adding a posting by hand first (the one thing done here often), then an overview of each
// subsystem's state with its one action, then the detail of each, with the explanations folded away.
import type { DigestStatus } from "../../src/digest";
import { state, ui } from "../store";
import { cap, esc, when } from "../util";
import { notices, title } from "./common";

const num = (n: number) => n.toLocaleString();
type Pill = "ok" | "bad" | "run" | "idle";
const pill = (cls: Pill, text: string) => `<span class="pill ${cls === "idle" ? "" : cls}">${esc(text)}</span>`;

// The digest's delivery states as the owner would say them.
const DIGEST_STATE: Record<string, [Pill, string]> = {
  disabled: ["idle", "Off"],
  not_connected: ["bad", "Mailbox not connected"],
  idle: ["ok", "Nothing waiting"],
  ready: ["run", "Waiting for the next send"],
  sending: ["run", "Sending"],
  sent: ["ok", "Sent"],
  uncertain: ["bad", "Send uncertain, reconciling with Sent mail"],
  failed: ["bad", "Last send failed"],
};
const digestState = (d: DigestStatus): [Pill, string] => DIGEST_STATE[d.deliveryState] ?? ["idle", d.deliveryState];

function autoHtml() {
  const S = state(),
    a = S.autoApply;
  if (!a.enabled) return "Off. Every application waits for your approval in To review.";
  if (!a.phases.includes(S.phase)) return `Off in the ${S.phase} phase (on for ${a.phases.join(", ") || "none"}).`;
  const submit = a.submit ? "They are also submitted without your confirmation." : "They still stop for your OK before submitting.";
  return `On. Jobs scoring ${a.minScore} or more with verified positive practice evidence${a.allowConcerns ? "" : " with no concerns raised"} are approved for you, up to ${a.perDay} a day (${a.approvedToday} so far today). ${submit}`;
}

// When the next daily digest goes out, in the digest's own time zone: "Today 09:00 (America/Chicago)".
function nextDigest(digest: DigestStatus) {
  if (!digest.enabled) return "Disabled";
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: digest.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const clock = (at: Date) => {
    const part = Object.fromEntries(formatter.formatToParts(at).map(p => [p.type, p.value])) as Record<string, string | undefined>;
    return { day: `${part["year"] ?? ""}-${part["month"] ?? ""}-${part["day"] ?? ""}`, time: `${part["hour"] ?? ""}:${part["minute"] ?? ""}` };
  };
  const now = clock(new Date());
  const sentToday = !!digest.lastSentAt && clock(new Date(digest.lastSentAt)).day >= now.day;
  const due = sentToday ? `Tomorrow ${digest.time}` : now.time >= digest.time ? `Due now: today's ${digest.time} window is open` : `Today ${digest.time}`;
  return `${due} (${digest.timeZone})`;
}

function autoState(): [Pill, string, string] {
  const S = state(),
    a = S.autoApply;
  if (!a.enabled) return ["idle", "Off", "Everything waits for you in To review"];
  if (!a.phases.includes(S.phase)) return ["idle", `Off in ${S.phase}`, `On for ${a.phases.join(", ") || "no phase"}`];
  return ["run", "On", `${a.approvedToday} of ${a.perDay} approved today`];
}

// One line per subsystem: what it is, its state, the one thing to do about it. The name jumps to its detail.
function overview() {
  const S = state(),
    d = S.digest,
    held = S.counts["held"] ?? 0,
    [dCls, dText] = digestState(d),
    [aCls, aText, aNote] = autoState(),
    slots = S.browsers.length;
  const row = (name: string, href: string, badge: string, note: string, action = "") =>
    `<div class="ovrow"><a class="ovname" href="#${href}" data-jump>${name}</a><span class="ovstate">${badge}${note ? `<span class="hint">${note}</span>` : ""}</span>${action}</div>`;
  return `<div class="overview">${[
    row(
      "Gmail",
      "settings-mailbox",
      S.gmail.connected ? pill("ok", "Connected") : pill("bad", "Not connected"),
      S.gmail.connected ? esc(S.gmail.address) : S.mailbox ? `Sign in as ${esc(S.mailbox)}` : "",
      S.gmail.connected ? "" : `<a class="btn sm primary" href="/oauth/start">Connect Gmail</a>`,
    ),
    row(
      "Daily digest",
      "settings-digest",
      `<span data-digest-state>${d.enabled ? pill(dCls, dText) : pill("idle", "Off")}</span>`,
      d.enabled && d.recipient ? `Next ${esc(nextDigest(d))}` : d.undeliveredGroups ? `${num(d.undeliveredGroups)} not sent yet` : "",
    ),
    row("Auto apply", "settings-auto-apply", pill(aCls, aText), esc(aNote)),
    row("Phase", "settings-phase", pill("idle", cap(S.phase)), held ? `${num(held)} held for the real search` : ""),
    row("Browser", "settings-browser", pill(slots ? "ok" : "idle", slots ? `${slots} slot${slots === 1 ? "" : "s"}` : "None"), ""),
  ].join("")}</div>`;
}

// Explanations, folded: read once, then in the way. Which ones are open survives a repaint.
const how = (key: string, body: string) =>
  `<details class="how" data-how="${key}" ${ui.openHow.has(key) ? "open" : ""}><summary>How this works</summary>${body}</details>`;

export function settingsHtml() {
  const S = state(),
    a = S.autoApply,
    digest = S.digest,
    held = S.counts["held"] ?? 0,
    browsers = S.browsers,
    r = ui.addResult;
  const autoSubmits = a.enabled && a.submit && a.phases.includes(S.phase);
  const confirmNote =
    (S.confirmBeforeSubmit ? "Manual approvals require your OK before submitting." : "Manually approved jobs submit without confirmation.") +
    (autoSubmits ? " Eligible auto-approved jobs submit directly." : " Auto-approved jobs still require your OK before submitting.");
  return `<div class="doc page">${title("Settings")}${notices("gmail")}
    <div class="card"><div class="label">Add a posting</div>
      <div class="actions" style="margin-top:0;flex-wrap:nowrap"><input type="text" id="addurl" placeholder="Paste a job URL" aria-label="Job URL" inputmode="url" value="${esc(ui.addDraft)}"><button class="btn primary" id="addbtn">Add</button></div>
      <p class="hint addres ${r && !r.ok ? "bad" : ""}" id="add-result" role="status">${r ? r.html : "Assessed like any posting a scan finds."}</p></div>
    <div class="section"><div class="label">Overview</div>${overview()}</div>

    <div class="section" id="settings-mailbox"><div class="label">Gmail</div>
      ${S.gmail.connected ? `<div class="actions" style="margin-top:0"><a class="btn" href="/oauth/start">Reconnect Gmail</a></div>` : ""}
      ${how("mailbox", `<p class="hint">Gmail lets applications create accounts and read emailed codes, and carries the daily digest. Google must list this OAuth redirect URI: <code>${esc(S.redirectUri)}</code></p>`)}</div>

    <div class="section" id="settings-digest"><div class="label">Daily questions digest</div>
      <dl class="kv">
        <dt>Recipient</dt><dd data-digest-recipient>${esc(digest.recipient ?? "No verified connected mailbox")}</dd>
        <dt>Waiting</dt><dd><span data-digest-count>${digest.undeliveredGroups} not sent yet</span> · <span data-digest-last ${digest.lastSentAt ? `title="${esc(digest.lastSentAt)}"` : ""}>${digest.lastSentAt ? `last sent ${esc(when(digest.lastSentAt))}` : "never sent"}</span></dd>
        ${digest.lastError ? `<dt>Last error</dt><dd data-digest-error role="alert" class="bad">${esc(digest.lastError)}</dd>` : ""}
      </dl>
      <div class="actions"><button class="btn primary" id="digest-send" ${ui.digestBusy || !digest.enabled || !digest.recipient ? "disabled" : ""}>${ui.digestBusy ? "Sending / reconciling…" : "Send digest now"}</button><button class="btn sm quiet" id="digest-refresh" ${ui.digestBusy ? "disabled" : ""}>Refresh status</button></div>
      <p class="hint" id="digest-result" role="status">${esc(ui.digestResult)}</p>
      ${how(
        "digest",
        `<p class="hint">Configure <code>questionDigest.enabled</code>, <code>questionDigest.time</code> (HH:mm) and <code>questionDigest.timeZone</code> in <code>config.yml</code>. Each send holds only groups not delivered before. Delivery goes only to the verified configured/connected Gmail mailbox, never an arbitrary recipient. The message contains grouped prompts, counts and links, not answer values or credentials.</p>
      <p class="hint" style="margin-top:6px">Send now bypasses the daily schedule, not delivery deduplication. Adding another application to an unchanged notified group does not send it again. An uncertain send is reconciled with Sent mail before any retry.</p>`,
      )}
    </div>

    <div class="section" id="settings-auto-apply"><div class="label">Auto apply</div>
      <p class="prose auto-status">${autoHtml()} Change it in <code>config.yml</code>.</p>
      <dl class="kv auto-settings" style="margin-top:12px">
        <dt>Caps</dt>
        <dd class="auto-caps">${a.perDay} auto-approvals/day (${a.approvedToday} so far today); ${S.applyPerDay} new applications/day (blocked and failed starts count; resuming one already started does not). Daily quotas reset at midnight UTC.</dd>
      </dl>
      ${how(
        "auto",
        `<dl class="kv">
        <dt>Practice gate</dt>
        <dd class="auto-gate">A job counts as practice only when its employer is one your real search rules out: on your practice list, or judged an early-stage startup, a non-tech enterprise, an IT services firm or consultancy, or government. Employers on your frontier list, and every tech company at scale (a rejection there follows you across its teams), are held back for the real search. Pay, location and a low real score are not practice proof.</dd>
        <dt>Safeguards</dt>
        <dd class="auto-safeguards">Missing practice proof is held back (not spent); low fit or failed qualifications are skipped. Hand-picked postings${a.allowConcerns ? "" : " and jobs with concerns"} wait in To review.${a.allowConcerns ? " Concerns alone do not block a proven practice role." : ""} Invalid auto-approvals are held before fill. ${confirmNote}</dd>
      </dl>`,
      )}
    </div>

    <div class="section" id="settings-phase"><div class="label">Phase</div><p class="prose">${cap(S.phase)}. Change it in <code>config.yml</code>. ${held ? `${num(held)} held job${held === 1 ? "" : "s"} can go back through triage once you switch.` : "No jobs are held back."}</p>
      ${held ? `<div class="actions"><button class="btn danger" data-run="release_held">Release ${num(held)} held job${held === 1 ? "" : "s"}…</button></div>` : ""}</div>

    <div class="section" id="settings-browser"><div class="label">Browser</div><p class="prose">${browsers.length > 1 ? `Up to ${browsers.length} browser slots run on this machine.` : "Chrome runs on this machine."}</p>
      ${browsers.length ? `<div class="actions">${browsers.map((u, i) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Open browser${browsers.length > 1 ? ` ${i + 1}` : ""}</a>`).join("")}</div>` : ""}
      ${how("browser", `<p class="hint">These are shared slot views, not application links. Ordinary parked applications release their slots; inspect their saved screenshot/checkpoint instead. Only explicitly reserved manual handoffs and ambiguous submissions expose a browser link on their application page. Do not take over a browser without checking its current application.</p>`)}</div>
  </div>`;
}
