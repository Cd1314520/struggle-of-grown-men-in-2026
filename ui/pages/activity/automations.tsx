import { Building2, Mail, Play, Radar, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { Summary } from "../../../src/api-types";
import { Button, Menu, MenuContent, MenuItem, MenuTrigger, Spinner } from "../../components/ui";
import { api, refreshAll } from "../../lib/api";
import { ago, plural } from "../../lib/format";

type Run = "scan" | "track" | "discover";
const STARTED: Record<Run, string> = { scan: "Scan started", track: "Checking mail", discover: "Looking for new companies" };

interface Automation {
  run: Run;
  icon: LucideIcon;
  name: string;
  running: boolean;
  blocked?: boolean;
  status: string;
  detail: string;
}

const automations = (s: Summary): Automation[] => [
  {
    run: "scan",
    icon: Radar,
    name: "Scan job boards",
    running: s.running.scan,
    status: s.running.scan ? "Scanning now" : s.lastScan ? `Last run ${ago(s.lastScan)}` : "Not run yet",
    detail: s.scanMinutes ? `Every ${s.scanMinutes} min across ${plural(s.boards, "board")}` : `${plural(s.boards, "board")}, started by hand`,
  },
  {
    run: "track",
    icon: Mail,
    name: "Check mail",
    running: s.running.track,
    status: s.running.track ? "Checking now" : s.lastTrack ? `Last run ${ago(s.lastTrack)}` : "Not run yet",
    detail: s.gmail.connected ? (s.gmail.address ?? "Gmail connected") : "Gmail isn't connected",
  },
  {
    run: "discover",
    icon: Building2,
    name: "Find companies",
    running: false,
    blocked: s.running.scan,
    status: s.running.scan ? "Waiting for the scan" : "Ready",
    detail: "Adds employers whose boards are worth watching",
  },
];

export function RunMenu({ s, size }: { s: Summary | undefined; size?: "sm" | "md" }) {
  const [starting, setStarting] = useState<Run | null>(null);
  const run = async (what: Run) => {
    setStarting(what);
    try {
      await api.run(what);
      toast.success(STARTED[what]);
      await refreshAll();
    } catch {
    } finally {
      setStarting(null);
    }
  };
  const busy = !!s && (s.running.scan || s.running.track);
  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        <Button variant="secondary" size={size} icon={busy || starting ? <Spinner /> : <Play />} disabled={!s}>
          Run
        </Button>
      </MenuTrigger>
      <MenuContent className="w-72">
        {s &&
          automations(s).map(a => {
            const going = a.running || starting === a.run;
            return (
              <MenuItem
                key={a.run}
                icon={going ? <Spinner /> : <a.icon />}
                description={a.status}
                disabled={going || a.blocked}
                aria-label={`Run: ${a.name}`}
                aria-description={`${a.status}. ${a.detail}`}
                title={a.detail}
                onSelect={() => void run(a.run)}
              >
                {a.name}
              </MenuItem>
            );
          })}
      </MenuContent>
    </Menu>
  );
}
