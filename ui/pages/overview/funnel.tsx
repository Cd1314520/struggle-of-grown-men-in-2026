import type { Stats } from "../../../src/api-types";
import { Skeleton, WorkspaceSection } from "../../components/ui";
import { useStats } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";
import { useWidth } from "../../lib/media";
import { LABEL_HEAD } from "./rail";

type Stage = Exclude<keyof Stats["funnel"], "found">;

// Each stage is a subset of the one before it, so what leaves the flow at a step is the difference of two stages.
const STAGES: readonly (readonly [key: Stage, label: string, dropped: string])[] = [
  ["assessed", "Assessed", ""],
  ["recommended", "Recommended", "Not recommended"],
  ["approved", "Approved", "Not approved"],
  ["applied", "Applied", "Not sent"],
  ["responded", "Heard back", "No reply"],
];

const HEAD = 42,
  FLOW = 150,
  GAP = 10,
  FOOT = 38,
  HEIGHT = HEAD + FLOW + GAP + FOOT,
  NODE = 10,
  // Room right of the last column for its labels.
  RIGHT = 76,
  MIN_WIDTH = 520;

function approvals({ auto, user }: Stats["approvals"]) {
  const n = auto + user;
  if (!n) return "No approvals in the last 30 days";
  const who = !user ? "all by auto apply" : !auto ? "all by you" : `${num(auto)} auto-approved, ${num(user)} by you`;
  return `${num(n)} ${n === 1 ? "approval" : "approvals"} in the last 30 days by approval date, ${who}`;
}

const percent = (part: number, whole: number) => {
  if (!whole) return "–";
  const p = (part / whole) * 100;
  return `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`;
};

function band(x0: number, s0: number, s1: number, x1: number, t0: number, t1: number) {
  const m = (x0 + x1) / 2;
  return `M${x0},${s0}C${m},${s0} ${m},${t0} ${x1},${t0}V${t1}C${m},${t1} ${m},${s1} ${x0},${s1}Z`;
}

function Stacked({ funnel: f }: { funnel: Stats["funnel"] }) {
  return (
    <ol className="space-y-4">
      {STAGES.map(([key, label, dropped], i) => {
        const prev = STAGES[i - 1]?.[0],
          lost = prev ? f[prev] - f[key] : 0;
        return (
          <li key={key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-fg-muted">{label}</span>
              <span className="tabular">
                <span className="font-medium text-fg">{num(f[key])}</span>
                {prev && <span className="text-xs text-fg-muted"> {percent(f[key], f[prev])}</span>}
              </span>
            </div>
            <div className="mt-1.5 h-2 rounded-sm bg-muted">
              <div className="h-full min-w-0.5 rounded-sm bg-chart-1" style={{ width: f.assessed ? `${(f[key] / f.assessed) * 100}%` : 0 }} />
            </div>
            {prev && lost > 0 && (
              <div className="tabular mt-1 text-xs text-fg-muted">
                {dropped} <span className="font-medium text-fg">{num(lost)}</span> {percent(lost, f[prev])}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Sankey({ funnel: f, approved }: { funnel: Stats["funnel"]; approved: string }) {
  const [ref, measured] = useWidth();
  const width = Math.max(measured, MIN_WIDTH),
    step = (width - RIGHT) / (STAGES.length - 1),
    scale = f.assessed ? FLOW / f.assessed : 0;
  const h = (v: number) => (v > 0 ? Math.max(1, v * scale) : 0);
  const x = (i: number) => i * step;
  const summary = STAGES.slice(1)
    .map(([key, label], i) => `${label.toLowerCase()} ${num(f[key])} (${percent(f[key], f[STAGES[i]?.[0] ?? "assessed"])})`)
    .join(", ");

  return (
    <div ref={ref}>
      {measured > 0 && measured < MIN_WIDTH ? (
        <Stacked funnel={f} />
      ) : measured > 0 ? (
        <svg width={width} height={HEIGHT} role="img" aria-label={`Of ${num(f.assessed)} postings assessed in the last 30 days: ${summary}.`} className="block">
          {STAGES.map(([key, label, dropped], i) => {
            const prev = STAGES[i - 1]?.[0];
            if (!prev) return null;
            const from = STAGES[i - 1]?.[1] ?? "",
              kept = f[key],
              lost = f[prev] - kept,
              x0 = x(i - 1) + NODE,
              x1 = x(i),
              top = HEAD + h(kept),
              dropTop = top + GAP;
            return (
              <g key={key}>
                <path d={band(x0, HEAD, top, x1, HEAD, top)} className="fill-chart-1 opacity-30 transition-opacity hover:opacity-50">
                  <title>{`${from} → ${label}: ${num(kept)} (${percent(kept, f[prev])})`}</title>
                </path>
                {lost > 0 && (
                  <path
                    d={band(x0, top, top + h(lost), x1, dropTop, dropTop + h(lost))}
                    className="fill-fg-subtle opacity-20 transition-opacity hover:opacity-40 dark:opacity-30 dark:hover:opacity-50"
                  >
                    <title>{`${from} → ${dropped}: ${num(lost)} (${percent(lost, f[prev])})`}</title>
                  </path>
                )}
                <rect x={x1} y={dropTop} width={NODE} height={h(lost)} rx={1} className="fill-fg-subtle" />
                <text x={x1} y={dropTop + h(lost) + 16} className="fill-fg-muted text-xs">
                  {dropped}
                </text>
                <text x={x1} y={dropTop + h(lost) + 32} className="tabular text-xs">
                  <tspan className="fill-fg font-medium">{num(lost)}</tspan>
                  <tspan className="fill-fg-muted"> {percent(lost, f[prev])}</tspan>
                </text>
              </g>
            );
          })}
          {STAGES.map(([key, label], i) => {
            const prev = STAGES[i - 1]?.[0];
            return (
              <g key={key}>
                <rect x={x(i)} y={HEAD} width={NODE} height={h(f[key])} rx={1} className="fill-chart-1">
                  {key === "approved" && <title>{approved}</title>}
                  {key === "responded" && <title>Counts applications to postings found in the last 30 days</title>}
                </rect>
                <text x={x(i)} y={14} className="fill-fg-muted text-xs">
                  {label}
                </text>
                <text x={x(i)} y={32} className="tabular text-sm">
                  <tspan className="fill-fg font-medium">{num(f[key])}</tspan>
                  {prev && <tspan className="fill-fg-muted text-xs"> {percent(f[key], f[prev])}</tspan>}
                </text>
              </g>
            );
          })}
        </svg>
      ) : (
        <div style={{ height: HEIGHT }} />
      )}
    </div>
  );
}

export function Funnel() {
  const { data: st } = useStats();
  const f = st?.funnel;
  return (
    <WorkspaceSection
      className={cn(LABEL_HEAD, "lg:max-xl:border-b-0")}
      title="Funnel"
      description={
        st && f
          ? `Postings found in the last 30 days: ${num(f.found)}, ${percent(f.assessed, f.found)} passed the title screen`
          : "Postings found in the last 30 days"
      }
    >
      {st && f ? <Sankey funnel={f} approved={approvals(st.approvals)} /> : <Skeleton className="h-[240px]" />}
    </WorkspaceSection>
  );
}
