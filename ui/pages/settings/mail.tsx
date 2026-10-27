// Gmail and the daily questions digest: one section, the digest's buttons in its footer.
import { Copy, RefreshCw, Send } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import type { DigestStatus } from "../../../src/digest";
import { Button, Disclosure, StatusLabel, Time, Tooltip } from "../../components/ui";
import { api, queryClient } from "../../lib/api";
import { plural } from "../../lib/format";
import type { Tone } from "../../lib/labels";
import { FromConfig, SettingFold, SettingRow, SettingsGroup, SettingsPanel } from "./parts";

function Gmail({ s }: { s: Summary }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(s.redirectUri);
      toast.success("Redirect URI copied");
    } catch {
      toast.error("Couldn't copy. Select the address and copy it by hand.");
    }
  };
  return (
    <>
      <SettingsGroup title="Gmail" />
      <SettingRow
        stack
        label="Mailbox"
        description={
          s.gmail.connected
            ? "Applications create accounts and read emailed codes with it, and the digest goes out through it."
            : `Applications that need an account or an emailed code stop and ask you until it's connected.${s.mailbox ? ` Sign in as ${s.mailbox}.` : ""}`
        }
      >
        {s.gmail.connected ? (
          <>
            <StatusLabel tone="success" label={s.gmail.address ?? "Connected"} className="min-w-0 truncate text-fg" />
            <Button asChild size="sm">
              <a href="/oauth/start">Reconnect</a>
            </Button>
          </>
        ) : (
          <>
            <StatusLabel tone="danger" label="Not connected" />
            <Button asChild size="sm" variant="primary">
              <a href="/oauth/start">Connect Gmail</a>
            </Button>
          </>
        )}
      </SettingRow>
      <SettingRow stack label="OAuth redirect URI" description="Google must list this address for the connection to work.">
        <code className="min-w-0 truncate font-mono text-xs text-fg">{s.redirectUri}</code>
        <Tooltip content="Copy">
          <Button size="icon-sm" variant="ghost" aria-label="Copy the redirect URI" onClick={() => void copy()}>
            <Copy />
          </Button>
        </Tooltip>
      </SettingRow>
    </>
  );
}

// The digest's delivery states as the owner would say them.
const DIGEST_STATE: Record<string, [Tone, string]> = {
  disabled: ["neutral", "Off"],
  not_connected: ["danger", "Mailbox not connected"],
  idle: ["success", "Nothing waiting"],
  ready: ["info", "Waiting for the next send"],
  sending: ["info", "Sending"],
  sent: ["success", "Sent"],
  uncertain: ["warning", "Send uncertain, reconciling with Sent mail"],
  failed: ["danger", "Last send failed"],
};

// When the next daily digest goes out, in the digest's own time zone: "Today 09:00".
function nextDigest(d: DigestStatus) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: d.timeZone,
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
  const sentToday = !!d.lastSentAt && clock(new Date(d.lastSentAt)).day >= now.day;
  return sentToday ? `Tomorrow ${d.time}` : now.time >= d.time ? `Due now: today's ${d.time} window is open` : `Today ${d.time}`;
}

export function Mail({ s }: { s: Summary }) {
  const d = s.digest;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  // Sending, then reading the status back either way: a send that threw may still have gone out.
  const run = async (send: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      if (send) {
        const r = await api.sendDigest();
        const line = r.sent
          ? `Sent ${plural(r.groups, "item")}${r.messageId ? ` (message ${r.messageId})` : ""}`
          : `Not sent: ${r.reason ?? "No new undelivered groups"}`;
        setResult(line);
        toast(line);
      }
    } catch (err) {
      setResult(`Send failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      try {
        const digest = await api.digestStatus();
        queryClient.setQueryData<Summary>(["summary"], s => s && { ...s, digest });
        if (!send) setResult("");
      } catch {
        setResult("Could not refresh digest status. Delivery outcome is unverified; check Gmail before retrying.");
      }
      setBusy(false);
    }
  };
  const [tone, label] = d.enabled ? (DIGEST_STATE[d.deliveryState] ?? ["neutral", d.deliveryState]) : (["neutral", "Off"] as const);
  return (
    <SettingsPanel
      id="mail"
      title="Mail & digest"
      footer={
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" icon={<Send />} loading={busy} disabled={busy || !d.enabled || !d.recipient} onClick={() => void run(true)}>
              {busy ? "Sending or reconciling" : "Send now"}
            </Button>
            <Button size="sm" variant="ghost" icon={<RefreshCw />} disabled={busy} onClick={() => void run(false)}>
              Refresh status
            </Button>
          </div>
          <FromConfig what="the schedule" />
        </>
      }
    >
      <Gmail s={s} />
      <SettingsGroup title="Daily questions digest" />
      <SettingRow label="Status" description="One email a day with the questions waiting on you and the employers' steps falling due.">
        <StatusLabel tone={tone} label={label} pulse={d.deliveryState === "sending"} className="text-fg" />
      </SettingRow>
      <SettingRow label="Recipient" description="Only the verified, connected mailbox. Never anyone else.">
        <span className={d.recipient ? "truncate" : "text-fg-muted"}>{d.recipient ?? "No verified connected mailbox"}</span>
      </SettingRow>
      <SettingRow label="Next send" description={`Daily at ${d.time}, ${d.timeZone} time.`}>
        <span className={d.enabled ? "" : "text-fg-muted"}>{d.enabled ? nextDigest(d) : "Disabled"}</span>
      </SettingRow>
      <SettingRow label="Waiting to go out" description={d.lastSentAt ? <Time at={d.lastSentAt} prefix="Last sent " /> : "Never sent."}>
        <span className="tabular font-medium">{plural(d.undeliveredGroups, "group")}</span>
      </SettingRow>
      {d.lastError && (
        <SettingRow label="Last error">
          <span role="alert" className="text-danger-text">
            {d.lastError}
          </span>
        </SettingRow>
      )}
      {result && (
        <p role="status" className="animate-in border-t border-border px-(--list-x) py-3 text-sm text-fg">
          {result}
        </p>
      )}
      <SettingFold>
        <Disclosure id="settings-digest" summary="How the digest works">
          <div className="space-y-2">
            <p>
              Set <code className="font-mono">questionDigest.enabled</code>, <code className="font-mono">questionDigest.time</code> (HH:mm) and{" "}
              <code className="font-mono">questionDigest.timeZone</code> in <code className="font-mono">config.yml</code>. Each send holds only groups not
              delivered before, and the employers' steps still to do that fall due within 48 hours (each once per deadline). Delivery goes only to the verified
              configured or connected Gmail mailbox, never an arbitrary recipient. The message contains grouped prompts, counts and links, not answer values or
              credentials.
            </p>
            <p>
              Send now bypasses the daily schedule, not delivery deduplication. Adding another application to an unchanged notified group does not send it
              again. An uncertain send is reconciled with Sent mail before any retry.
            </p>
          </div>
        </Disclosure>
      </SettingFold>
    </SettingsPanel>
  );
}
