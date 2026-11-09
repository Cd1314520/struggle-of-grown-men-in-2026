import type { ReactNode } from "react";
import type { Summary } from "../../../src/api-types";
import type { DigestStatus } from "../../../src/digest";
import { ListBody, ListRow, StatusLabel } from "../../components/ui";
import { ago, cap, MINUTE, num, plural } from "../../lib/format";
import type { Tone } from "../../lib/labels";
import { CLOSED, RailHead } from "./rail";

interface Row {
  name: string;
  state: readonly [label: string, tone: Tone];
  detail: ReactNode;
  pulse?: boolean;
}

const DIGEST: Record<string, readonly [string, Tone]> = {
  not_connected: ["No mailbox", "danger"],
  idle: ["Nothing to send", "success"],
  ready: ["Queued", "info"],
  sending: ["Sending", "info"],
  sent: ["Sent", "success"],
  uncertain: ["Checking", "warning"],
  failed: ["Failed", "danger"],
  abandoned: ["Gave up", "danger"],
};

function nextDigest(d: DigestStatus) {
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone: d.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const there = (at: Date) => {
    const p = Object.fromEntries(format.formatToParts(at).map(x => [x.type, x.value])) as Record<string, string | undefined>;
    return { day: `${p["year"] ?? ""}-${p["month"] ?? ""}-${p["day"] ?? ""}`, time: `${p["hour"] ?? ""}:${p["minute"] ?? ""}` };
  };
  const now = there(new Date());
  if (d.lastSentAt && there(new Date(d.lastSentAt)).day >= now.day) return `Next tomorrow at ${d.time}`;
  return now.time >= d.time ? "Due now" : `Next today at ${d.time}`;
}

function rows(s: Summary): Row[] {
  const a = s.autoApply,
    d = s.digest,
    held = s.counts["held"] ?? 0;
  const sinceScan = s.lastScan ? Date.now() - Date.parse(s.lastScan) : Infinity;
  const scanner: Row = s.running.scan
    ? { name: "Scanner", state: ["Scanning", "info"], pulse: true, detail: `Reading ${num(s.boards)} sources now` }
    : {
        name: "Scanner",
        state: !s.scanMinutes ? ["Manual", "neutral"] : sinceScan > 3 * s.scanMinutes * MINUTE ? ["Behind", "warning"] : ["Healthy", "success"],
        detail: (
          <>
            {s.lastScan ? `Last ran ${ago(s.lastScan)}` : "Never run"}
            {s.scanMinutes ? `, every ${s.scanMinutes} min` : ""} across {num(s.boards)} sources
          </>
        ),
      };
  const mailbox: Row = s.gmail.connected
    ? { name: "Mailbox", state: ["Connected", "success"], detail: s.lastTrack ? `Checked ${ago(s.lastTrack)}` : (s.gmail.address ?? "Not checked yet") }
    : { name: "Mailbox", state: ["Not connected", "warning"], detail: "Connect Gmail to track replies and codes" };
  const auto: Row = !a.enabled
    ? { name: "Approval", state: ["Gated", "neutral"], detail: "You approve every job and OK every send" }
    : { name: "Approval", state: ["Auto-apply", "success"], detail: `${num(a.approvedToday)} of ${num(a.perDay)} approved today` };
  const digest: Row = !d.enabled
    ? { name: "Daily digest", state: ["Off", "neutral"], detail: "Questions wait here, not in your inbox" }
    : { name: "Daily digest", state: DIGEST[d.deliveryState] ?? [cap(d.deliveryState), "neutral"], detail: d.lastError ?? nextDigest(d) };
  const targets: Row = {
    name: "Target employers",
    state: s.targets.holdBack ? ["Held back", "neutral"] : ["Applying", "accent"],
    detail: s.targets.holdBack
      ? held
        ? `${plural(held, "job")} held for later`
        : "Saved for later; the rest are practice"
      : "Applied to alongside practice jobs",
  };
  return [scanner, mailbox, auto, digest, targets];
}

const NORMAL: readonly Tone[] = ["success", "neutral", "accent"];

export function Health({ summary }: { summary: Summary | undefined }) {
  const off = summary ? rows(summary).filter(r => r.pulse === true || !NORMAL.includes(r.state[1])) : [];
  return (
    <ListBody label="System" loading={!summary} className={CLOSED}>
      <RailHead label="System" link={{ href: "#settings", label: "Settings" }} />
      {summary && !off.length && (
        <ListRow title="All normal" gist={summary.lastScan ? `Scanned ${ago(summary.lastScan)}` : undefined} fact={<StatusLabel tone="success" label="OK" />} />
      )}
      {summary &&
        off.map(r => (
          <ListRow
            key={r.name}
            title={r.name}
            gist={<span data-detail>{r.detail}</span>}
            className="[&_div:has(>[data-detail])]:line-clamp-2 [&_div:has(>[data-detail])]:whitespace-normal"
            fact={<StatusLabel tone={r.state[1]} label={r.state[0]} pulse={r.pulse} />}
          />
        ))}
    </ListBody>
  );
}
