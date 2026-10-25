// The three runs the owner can start by hand, each with whether it is running and when it last ran.
import { Building2, Mail, Play, Radar, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { Button, Card, StatusDot, Time } from "../../components/ui";
import { api, refreshAll } from "../../lib/api";
import { plural } from "../../lib/format";

type Run = "scan" | "track" | "discover";
const STARTED: Record<Run, string> = { scan: "Scan started", track: "Checking mail", discover: "Looking for new companies" };

function Automation({
  icon: Icon,
  name,
  running,
  status,
  detail,
  action,
  busy,
  blocked = false,
  onRun,
}: {
  icon: LucideIcon;
  name: string;
  running: boolean;
  status: ReactNode;
  detail: ReactNode;
  action: string;
  busy: boolean;
  blocked?: boolean; // another run holds what this one needs
  onRun: () => void;
}) {
  return (
    <div className="flex items-start gap-3 px-4 py-3.5 sm:p-5">
      <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-subtle text-fg-muted [&_svg]:size-4">
        <Icon />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-fg">{name}</p>
        <p className="mt-0.5 flex items-center gap-2 text-sm text-fg-muted">
          <StatusDot tone={running ? "info" : "neutral"} pulse={running} />
          <span className="truncate">{status}</span>
        </p>
        <p className="mt-1 hidden text-xs text-fg-subtle sm:block">{detail}</p>
      </div>
      <Button size="sm" icon={<Play />} loading={busy || running} disabled={busy || running || blocked} onClick={onRun} aria-label={`${action}: ${name}`}>
        {running ? "Running" : action}
      </Button>
    </div>
  );
}

export function Automations({ s }: { s: Summary }) {
  const [starting, setStarting] = useState<Run | null>(null);
  const run = async (what: Run) => {
    setStarting(what);
    try {
      await api.run(what);
      toast.success(STARTED[what]);
      await refreshAll();
    } catch {
      // the request already showed the server's refusal
    } finally {
      setStarting(null);
    }
  };
  return (
    <Card className="grid divide-y divide-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
      <Automation
        icon={Radar}
        name="Scan job boards"
        running={s.running.scan}
        status={s.running.scan ? "Scanning now" : s.lastScan ? <Time at={s.lastScan} prefix="Last run " /> : "Not run yet"}
        detail={s.scanMinutes ? `Every ${s.scanMinutes} min across ${plural(s.boards, "board")}` : `${plural(s.boards, "board")}, started by hand`}
        action="Run"
        busy={starting === "scan"}
        onRun={() => void run("scan")}
      />
      <Automation
        icon={Mail}
        name="Check mail"
        running={s.running.track}
        status={s.running.track ? "Checking now" : s.lastTrack ? <Time at={s.lastTrack} prefix="Last run " /> : "Not run yet"}
        detail={s.gmail.connected ? (s.gmail.address ?? "Gmail connected") : "Gmail isn't connected"}
        action="Run"
        busy={starting === "track"}
        onRun={() => void run("track")}
      />
      <Automation
        icon={Building2}
        name="Find companies"
        running={false}
        blocked={s.running.scan}
        status={s.running.scan ? "Waiting for the scan" : "Ready"}
        detail="Adds employers whose boards are worth watching"
        action="Run"
        busy={starting === "discover"}
        onRun={() => void run("discover")}
      />
    </Card>
  );
}
