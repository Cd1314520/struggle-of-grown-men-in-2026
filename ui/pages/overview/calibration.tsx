// Does the Fit score predict who moves on? Every application ever sent, by score band: how many the
// employer moved on (an assessment, scheduling, an interview or an offer) and how many it turned down.
import type { Stats } from "../../../src/api-types";
import { Skeleton, WorkspaceSection } from "../../components/ui";
import { useStats } from "../../lib/api";
import { num } from "../../lib/format";
import { LABEL_HEAD } from "./rail";

// Below this many sent, a band's rate is noise: it shows, marked.
const MIN_SENT = 10;
// Roughly where comparing the bands starts to mean something.
const ENOUGH_MOVED_ON = 30;

const rate = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "–");

function lead(bands: Stats["calibration"]) {
  const sent = bands.reduce((n, b) => n + b.sent, 0),
    moved = bands.reduce((n, b) => n + b.advanced, 0);
  if (!sent) return "Nothing sent yet.";
  const enough = moved >= ENOUGH_MOVED_ON ? "" : ` Too few to compare bands yet; that takes about ${ENOUGH_MOVED_ON}.`;
  return `${num(moved)} of ${num(sent)} applications sent moved on.${enough}`;
}

export function Calibration() {
  const { data: st } = useStats();
  const bands = st?.calibration;
  const most = Math.max(1, ...(bands ?? []).map(b => (b.sent ? b.advanced / b.sent : 0)));
  return (
    <WorkspaceSection className={LABEL_HEAD} title="Fit score and replies" description={bands ? lead(bands) : "Every application sent, by Fit score"}>
      {!bands ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="mb-2 grid grid-cols-[88px_minmax(0,1fr)_48px_56px_56px] gap-3 text-xs text-fg-muted sm:gap-4">
            <span>Fit score</span>
            <span />
            <span className="text-right">Sent</span>
            <span className="text-right">Moved on</span>
            <span className="text-right">Turned down</span>
          </div>
          <ol className="flex flex-col gap-2.5">
            {bands.map(b => {
              const share = b.sent ? b.advanced / b.sent : 0;
              const thin = b.sent > 0 && b.sent < MIN_SENT;
              return (
                <li
                  key={b.label}
                  className="grid grid-cols-[88px_minmax(0,1fr)_48px_56px_56px] items-center gap-3 sm:gap-4"
                  title={thin ? `Only ${b.sent} sent: too few for the rate to mean much` : undefined}
                >
                  <span className="truncate text-sm text-fg">{b.label}</span>
                  <span className="h-6 overflow-hidden rounded-sm bg-subtle">
                    <span className="block h-full rounded-sm bg-chart-1" style={{ width: b.advanced ? `max(2px, ${(share / most) * 100}%)` : 0 }} />
                  </span>
                  <span className="tabular text-right text-sm text-fg-muted">{num(b.sent)}</span>
                  <span className={`tabular text-right text-sm font-medium ${thin ? "text-fg-subtle" : "text-fg"}`}>
                    {b.sent ? `${rate(b.advanced, b.sent)}${thin ? "*" : ""}` : "–"}
                  </span>
                  <span className="tabular text-right text-sm text-fg-muted">{b.sent ? rate(b.rejected, b.sent) : "–"}</span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-xs text-fg-muted">
            Moved on: an assessment, a call to schedule, an interview or an offer, even if a no came later. * fewer than {MIN_SENT} sent.
          </p>
        </>
      )}
    </WorkspaceSection>
  );
}
