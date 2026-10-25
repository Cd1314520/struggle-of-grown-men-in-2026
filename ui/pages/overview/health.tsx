// Whether the machine is healthy: one row per subsystem with its state, and a way to its settings.
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import type { Summary } from "../../../src/api-types";
import type { DigestStatus } from "../../../src/digest";
import { Button, Card, CardHeader, Skeleton, StatusLabel } from "../../components/ui";
import { ago, cap, MINUTE, num } from "../../lib/format";
import type { Tone } from "../../lib/labels";

interface Row {
  name: string;
  state: readonly [label: string, tone: Tone];
  detail: ReactNode;
  pulse?: boolean;
}

// The digest's delivery states as the owner would say them.
const DIGEST: Record<string, readonly [string, Tone]> = {
  not_connected: ["No mailbox", "danger"],
  idle: ["Nothing to send", "success"],
  ready: ["Queued", "info"],
  sending: ["Sending", "info"],
  sent: ["Sent", "success"],
  uncertain: ["Checking", "warning"],
  failed: ["Failed", "danger"],
};

// When the next digest goes out, on the digest's own clock: "today at 09:00", "tomorrow at 09:00".
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
    ? { name: "Auto apply", state: ["Off", "neutral"], detail: "Every match waits for your review" }
    : !a.phases.includes(s.phase)
      ? { name: "Auto apply", state: ["Paused", "neutral"], detail: `On in the ${a.phases.join(" and ") || "no"} phase only` }
      : { name: "Auto apply", state: ["On", "success"], detail: `${num(a.approvedToday)} of ${num(a.perDay)} approved today` };
  const digest: Row = !d.enabled
    ? { name: "Daily digest", state: ["Off", "neutral"], detail: "Questions wait here, not in your inbox" }
    : { name: "Daily digest", state: DIGEST[d.deliveryState] ?? [cap(d.deliveryState), "neutral"], detail: d.lastError ?? nextDigest(d) };
  const phase: Row = {
    name: "Phase",
    state: [cap(s.phase), s.phase === "real" ? "accent" : "neutral"],
    detail:
      s.phase === "practice" && held
        ? `${num(held)} strong matches held for the real search`
        : s.phase === "practice"
          ? "Practising on lower-stakes roles"
          : "Applying to target roles",
  };
  return [scanner, mailbox, auto, digest, phase];
}

export function Health({ summary }: { summary: Summary | undefined }) {
  return (
    <Card>
      <CardHeader
        title="System"
        actions={
          <Button asChild variant="ghost" size="sm" className="-my-1 -mr-2">
            <a href="#settings">
              Settings
              <ArrowRight />
            </a>
          </Button>
        }
      />
      {!summary ? (
        <div className="space-y-3 px-5 pb-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <ul className="border-t border-border">
          {rows(summary).map(r => (
            <li key={r.name} className="flex min-h-14 items-center gap-3 border-b border-border px-5 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-fg">{r.name}</p>
                <p className="truncate text-sm text-fg-muted">{r.detail}</p>
              </div>
              <StatusLabel tone={r.state[1]} label={r.state[0]} pulse={r.pulse} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
