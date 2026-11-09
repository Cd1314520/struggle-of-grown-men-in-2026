import { Copy, RefreshCw, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import type { DigestStatus } from "../../../src/digest";
import { Button, ListNotice, StatusLabel, Time, Tooltip } from "../../components/ui";
import { api, queryClient } from "../../lib/api";
import { plural } from "../../lib/format";
import type { Tone } from "../../lib/labels";
import { ConfigRow } from "./field";
import { SettingRow, SettingsGroup, SettingsPanel } from "./parts";

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
        label="Gmail connection"
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
      <ConfigRow
        path="mailbox"
        label="Application mailbox"
        description="The dedicated mailbox applications are sent from. Connecting any other Google account is refused."
        field={{ kind: "text", type: "email", nullable: true, placeholder: "you@example.com" }}
      />
      {!s.gmail.connected && (
        <SettingRow stack label="OAuth redirect URI" description="Google must list this address for the connection to work.">
          <code className="min-w-0 truncate font-mono text-xs text-fg">{s.redirectUri}</code>
          <Tooltip content="Copy">
            <Button size="icon-sm" variant="ghost" aria-label="Copy the redirect URI" onClick={() => void copy()}>
              <Copy />
            </Button>
          </Tooltip>
        </SettingRow>
      )}
    </>
  );
}

const DIGEST_STATE: Record<string, [Tone, string]> = {
  disabled: ["neutral", "Off"],
  not_connected: ["danger", "Mailbox not connected"],
  idle: ["success", "Nothing waiting"],
  ready: ["info", "Waiting for the next send"],
  sending: ["info", "Sending"],
  sent: ["success", "Sent"],
  uncertain: ["warning", "Send uncertain, reconciling with Sent mail"],
  failed: ["danger", "Last send failed"],
  abandoned: ["danger", "Gave up after repeated failures"],
};

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
  return sentToday ? `tomorrow ${d.time}` : now.time >= d.time ? "due now" : `today ${d.time}`;
}

export function Mail({ s }: { s: Summary }) {
  const d = s.digest;
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
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
  const quiet = d.deliveryState === "sent" || d.deliveryState === "idle" || d.deliveryState === "ready";
  const [tone, label]: readonly [Tone, string] = !d.enabled
    ? ["neutral", "Off"]
    : quiet
      ? d.undeliveredGroups
        ? ["info", `${plural(d.undeliveredGroups, "group")} waiting`]
        : ["success", "Nothing waiting"]
      : (DIGEST_STATE[d.deliveryState] ?? ["neutral", d.deliveryState]);
  const troubled = !!d.lastError || d.deliveryState === "failed" || d.deliveryState === "abandoned" || d.deliveryState === "uncertain";
  return (
    <SettingsPanel
      id="mail"
      title="Mail & digest"
      notice={
        d.enabled &&
        troubled && (
          <ListNotice tone="warning" icon={<TriangleAlert />}>
            <span role="alert">
              {DIGEST_STATE[d.deliveryState]?.[1] ?? "Digest problem"}
              {d.lastError ? `: ${d.lastError}` : "."}
            </span>
          </ListNotice>
        )
      }
    >
      <Gmail s={s} />
      <SettingsGroup title="Daily questions digest" />
      <SettingRow
        stack
        label="Status"
        description={
          <>
            {d.enabled ? `Next ${nextDigest(d)}` : "One email a day with the questions waiting on you and steps falling due"}
            {d.lastSentAt ? (
              <>
                {" · "}
                <Time at={d.lastSentAt} prefix="last sent " />
              </>
            ) : (
              " · never sent"
            )}
            {d.recipient && d.recipient !== s.gmail.address && ` · to ${d.recipient}`}
            {!d.recipient && <span className="block text-warning-text">No verified mailbox to send to.</span>}
          </>
        }
      >
        <StatusLabel tone={tone} label={label} pulse={d.deliveryState === "sending"} className="mr-auto text-fg sm:mr-0" />
        <Button size="sm" icon={<Send />} loading={busy} disabled={busy || !d.enabled || !d.recipient} onClick={() => void run(true)}>
          {busy ? "Sending or reconciling" : "Send now"}
        </Button>
        <Tooltip content="Refresh status">
          <Button size="icon-sm" variant="ghost" aria-label="Refresh status" disabled={busy} onClick={() => void run(false)}>
            <RefreshCw />
          </Button>
        </Tooltip>
      </SettingRow>
      {result && (
        <p role="status" className="animate-in py-3 text-sm text-fg">
          {result}
        </p>
      )}
      <ConfigRow
        path="questionDigest.enabled"
        label="Send the digest"
        description="Only new questions, and steps due within 48 hours."
        field={{ kind: "bool" }}
      />
      <ConfigRow path="questionDigest.time" label="Send at" field={{ kind: "time" }} />
      <ConfigRow path="questionDigest.timeZone" label="Time zone" field={{ kind: "zone" }} />
    </SettingsPanel>
  );
}
