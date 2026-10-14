// Settings: the mailbox, the daily digest, adding a posting by hand, and what config.yml currently says.
import type { DigestStatus } from "../../src/digest";
import { LOW_PAY_MAX_USD, ONSITE_PAY_MAX_USD } from "../../src/practice";
import { state, ui } from "../store";
import { cap, esc, when } from "../util";
import { notices, title } from "./common";

const usd = (amount: number) => `$${amount.toLocaleString("en-US")}`;

function autoHtml() {
  const S = state(),
    a = S.autoApply;
  if (!a.enabled) return "Off. Every application waits for your approval in To review.";
  if (!a.phases.includes(S.phase)) return `Off in the ${S.phase} phase (on for ${a.phases.join(", ") || "none"}).`;
  const submit = a.submit ? "They are also submitted without your confirmation." : "They still stop for your OK before submitting.";
  return `On. Jobs scoring ${a.minScore} or more with verified positive practice evidence${a.allowConcerns ? "" : " with no concerns raised"} are approved for you, up to ${a.perDay} a day (${a.approvedToday} so far today). ${submit}`;
}

// When the next daily digest goes out, in the digest's own time zone.
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
  const tomorrow = new Date(Date.parse(`${now.day}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const due = sentToday
    ? `${tomorrow} at ${digest.time}`
    : now.time >= digest.time
      ? `Due at the next scheduler tick (today's ${digest.time} window is open)`
      : `${now.day} at ${digest.time}`;
  return `${due} · ${digest.timeZone}`;
}

export function settingsHtml() {
  const S = state(),
    a = S.autoApply,
    digest = S.digest,
    held = S.counts["held"] ?? 0,
    browsers = S.browsers;
  const autoSubmits = a.enabled && a.submit && a.phases.includes(S.phase);
  const confirmNote =
    (S.confirmBeforeSubmit ? "Manual approvals require your OK before submitting." : "Manually approved jobs submit without confirmation.") +
    (autoSubmits ? " Eligible auto-approved jobs submit directly." : " Auto-approved jobs still require your OK before submitting.");
  return `<div class="doc page">${title("Settings")}${notices()}
    <div class="section" style="margin-top:0"><div class="label">Mailbox</div>
      <dl class="kv"><dt>Status</dt><dd>${S.gmail.connected ? `Connected as ${esc(S.gmail.address)}` : `Not connected${S.mailbox ? `. Sign in as ${esc(S.mailbox)}` : ""}`}</dd><dt>OAuth redirect URI</dt><dd><code>${esc(S.redirectUri)}</code></dd></dl>
      <div class="actions"><a class="btn" href="/oauth/start">${S.gmail.connected ? "Reconnect Gmail" : "Connect Gmail"}</a></div></div>
    <div class="section" id="settings-digest"><div class="label">Daily questions digest</div>
      <dl class="kv">
        <dt>Enabled</dt><dd data-digest-enabled>${digest.enabled ? "Yes" : "No"}</dd>
        <dt>Next daily schedule</dt><dd data-digest-next>${esc(nextDigest(digest))}; sends only previously undelivered groups.</dd>
        <dt>Recipient</dt><dd data-digest-recipient>${esc(digest.recipient ?? "No verified connected mailbox")}</dd>
        <dt>Delivery state</dt><dd data-digest-state>${esc(digest.deliveryState)}</dd>
        <dt>Undelivered groups</dt><dd data-digest-count>${digest.undeliveredGroups}</dd>
        <dt>Last successful send</dt><dd data-digest-last>${digest.lastSentAt ? `${esc(digest.lastSentAt)} (${esc(when(digest.lastSentAt))})` : "Never"}</dd>
        <dt>Last error</dt><dd data-digest-error ${digest.lastError ? 'role="alert"' : ""}>${esc(digest.lastError ?? "None")}</dd>
      </dl>
      <p class="hint" style="margin-top:12px">Configure <code>questionDigest.enabled</code>, <code>questionDigest.time</code> (HH:mm) and <code>questionDigest.timeZone</code> in <code>config.yml</code>. Delivery goes only to the verified configured/connected Gmail mailbox, never an arbitrary recipient. The message contains grouped prompts, counts and links, not answer values or credentials.</p>
      <p class="hint" style="margin-top:6px">Send now bypasses the daily schedule, not delivery deduplication. Adding another application to an unchanged notified group does not send it again. An uncertain send is reconciled with Sent mail before any retry.</p>
      <div class="actions"><button class="btn primary" id="digest-send" ${ui.digestBusy || !digest.enabled || !digest.recipient ? "disabled" : ""}>${ui.digestBusy ? "Sending / reconciling…" : "Send digest now"}</button><button class="btn" id="digest-refresh" ${ui.digestBusy ? "disabled" : ""}>Refresh digest status</button></div>
      <p class="hint" id="digest-result" role="status">${esc(ui.digestResult)}</p>
    </div>
    <div class="section"><div class="label">Add a posting</div><div class="actions" style="margin-top:0;flex-wrap:nowrap"><input type="text" id="addurl" placeholder="Paste a job URL" aria-label="Job URL" inputmode="url"><button class="btn" id="addbtn">Add</button></div></div>
    <div class="section"><div class="label">Phase</div><p class="prose">${cap(S.phase)}. Change it in <code>config.yml</code>. ${held ? `${held} held job${held === 1 ? "" : "s"} can go back through triage once you switch.` : "No jobs are held back."}</p>
      ${held ? `<div class="actions"><button class="btn" data-run="release_held">Release held jobs</button></div>` : ""}</div>
    <div class="section" id="settings-auto-apply"><div class="label">Auto apply</div>
      <p class="prose auto-status">${autoHtml()} Change it in <code>config.yml</code>.</p>
      <dl class="kv auto-settings" style="margin-top:12px">
        <dt>Practice gate</dt>
        <dd class="auto-gate">A job counts as practice only on positive evidence that you would decline it: a posted annual base ceiling of at most ${usd(LOW_PAY_MAX_USD)}; or mandatory onsite/hybrid attendance outside the Austin / Houston area, with either a posted ceiling of at most ${usd(ONSITE_PAY_MAX_USD)} or no posted pay and work judged not to be high-end tech. Anything else is held back to protect roles you may want. A low real score or travel is not practice proof.</dd>
        <dt>Caps</dt>
        <dd class="auto-caps">${a.perDay} auto-approvals/day (${a.approvedToday} so far today); ${S.applyPerDay} new applications/day (blocked and failed starts count; resuming one already started does not). Daily quotas reset at midnight UTC.</dd>
        <dt>Safeguards</dt>
        <dd class="auto-safeguards">Missing practice proof is held back (not spent); low fit or failed qualifications are skipped. Hand-picked postings${a.allowConcerns ? "" : " and jobs with concerns"} wait in To review.${a.allowConcerns ? " Concerns alone do not block a proven practice role." : ""} Invalid auto-approvals are held before fill. ${confirmNote}</dd>
      </dl>
    </div>
    <div class="section"><div class="label">Browser</div><p class="prose">${browsers.length > 1 ? `Up to ${browsers.length} browser slots run on this machine.` : "Chrome runs on this machine."} These are shared slot views, not application links. Ordinary parked applications release their slots; inspect their saved screenshot/checkpoint instead. Only explicitly reserved manual handoffs and ambiguous submissions expose a browser link on their application page. Do not take over a browser without checking its current application.</p>
      <div class="actions">${browsers.map((u, i) => `<a class="btn" href="${esc(u)}" target="_blank" rel="noopener">Open browser${browsers.length > 1 ? ` ${i + 1}` : ""}</a>`).join("")}</div></div>
  </div>`;
}
