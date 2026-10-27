// Where the postings found in the last 30 days ended up: one bar per stage, each a share of the first.
import type { Stats } from "../../../src/api-types";
import { Skeleton, WorkspaceSection } from "../../components/ui";
import { useStats } from "../../lib/api";
import { num } from "../../lib/format";
import { LABEL_HEAD } from "./rail";

const STAGES: readonly (readonly [key: Exclude<keyof Stats["funnel"], "found">, label: string])[] = [
  ["assessed", "Assessed"],
  ["recommended", "Recommended"],
  ["approved", "Approved"],
  ["applied", "Applied"],
  ["responded", "Heard back"],
];

// "926 approvals in 30 days, all by auto apply."
function approvals({ auto, user }: Stats["approvals"]) {
  const n = auto + user;
  if (!n) return "No approvals in 30 days.";
  const who = !user ? "all by auto apply" : !auto ? "all by you" : `${num(auto)} by auto apply, ${num(user)} by you`;
  return `${num(n)} ${n === 1 ? "approval" : "approvals"} in 30 days, ${who}.`;
}

const percent = (part: number, whole: number) => {
  if (!whole) return "–";
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
};

export function Funnel() {
  const { data: st } = useStats();
  const f = st?.funnel;
  const first = f?.assessed ?? 0;
  return (
    <WorkspaceSection
      className={LABEL_HEAD}
      title="Funnel"
      description={
        st && f
          ? `Of ${num(f.found)} postings found in the last 30 days, ${percent(f.assessed, f.found)} passed the title screen to be assessed. ${approvals(st.approvals)}`
          : "Postings found in the last 30 days"
      }
    >
      {!f ? (
        <Skeleton className="h-44" />
      ) : (
        <>
          <div className="mb-2 grid grid-cols-[108px_minmax(0,1fr)_44px_72px] gap-3 text-xs text-fg-muted sm:grid-cols-[104px_minmax(0,1fr)_64px_72px] sm:gap-4">
            <span>Stage</span>
            <span />
            <span className="text-right">Jobs</span>
            <span className="text-right">Conversion</span>
          </div>
          <ol className="flex flex-col gap-2.5">
            {STAGES.map(([key, label], i) => {
              const n = f[key],
                prior = i === 0 ? f.found : f[STAGES[i - 1]?.[0] ?? "assessed"];
              return (
                <li
                  key={key}
                  className="grid grid-cols-[108px_minmax(0,1fr)_44px_72px] items-center gap-3 sm:grid-cols-[104px_minmax(0,1fr)_64px_72px] sm:gap-4"
                >
                  <span className="truncate text-sm text-fg">{label}</span>
                  <span className="h-6 overflow-hidden rounded-sm bg-subtle">
                    <span className="block h-full rounded-sm bg-chart-1" style={{ width: first ? `max(2px, ${(n / first) * 100}%)` : 0 }} />
                  </span>
                  <span className="tabular text-right text-sm font-medium text-fg">{num(n)}</span>
                  <span className="tabular text-right text-sm text-fg-muted">{percent(n, prior)}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </WorkspaceSection>
  );
}
