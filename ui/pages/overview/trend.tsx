// The last 30 days as columns, one metric at a time: applications sent, replies, postings found.
// Hand-drawn SVG at the container's pixel width, so text and bars are never scaled.
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { Stats } from "../../../src/api-types";
import { Segments, Skeleton, WorkspaceSection } from "../../components/ui";
import { useStats } from "../../lib/api";
import { cn } from "../../lib/cn";
import { num } from "../../lib/format";
import { LABEL_HEAD } from "./rail";

type Metric = "applied" | "responses" | "found";
const METRICS: Record<Metric, { tab: string; title: string; unit: [one: string, many: string] }> = {
  applied: { tab: "Sent", title: "Applications sent", unit: ["application", "applications"] },
  responses: { tab: "Replies", title: "Replies from employers", unit: ["reply", "replies"] },
  found: { tab: "Found", title: "Postings found", unit: ["posting", "postings"] },
};

const HEIGHT = 200,
  TOP = 12,
  BOTTOM = 26,
  LEFT = 36,
  RIGHT = 4;

// A local day "YYYY-MM-DD" at its midnight.
const dayDate = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
const short = (d: string) => dayDate(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const long = (d: string) => dayDate(d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const compact = (n: number) => (n >= 1000 ? `${n / 1000}K` : String(n));

// Gridlines at round numbers: about four steps of 1, 2 or 5 times a power of ten.
function ticks(max: number) {
  if (max <= 0) return [0, 1];
  const raw = max / 4,
    mag = 10 ** Math.floor(Math.log10(raw)),
    step = ([1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) ?? raw) || 1;
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
}

// A column with a rounded top and a square foot on the baseline.
function column(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setWidth(Math.floor(e.contentRect.width));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, width] as const;
}

function Chart({ stats, metric }: { stats: Stats; metric: Metric }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const values = stats[metric],
    days = stats.days;
  const grid = ticks(Math.max(...values)),
    top = grid.at(-1) ?? 1;
  const plotW = Math.max(0, width - LEFT - RIGHT),
    plotH = HEIGHT - TOP - BOTTOM,
    slot = plotW / days.length,
    barW = Math.max(2, Math.min(24, slot * 0.62));
  const x = (i: number) => LEFT + i * slot + (slot - barW) / 2,
    y = (v: number) => TOP + plotH - (v / top) * plotH;
  // Every seventh day back from today, so today is always labelled.
  const labelled = days.map((_, i) => (days.length - 1 - i) % 7 === 0);
  const unit = METRICS[metric].unit;

  const onMove = (ev: PointerEvent<SVGSVGElement>) => {
    const box = ev.currentTarget.getBoundingClientRect();
    const i = Math.floor((ev.clientX - box.left - LEFT) / slot);
    setActive(i >= 0 && i < days.length ? i : null);
  };
  const onKey = (ev: KeyboardEvent<SVGSVGElement>) => {
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    const from = active ?? days.length;
    setActive(Math.max(0, Math.min(days.length - 1, from + (ev.key === "ArrowLeft" ? -1 : 1))));
  };
  const tip = active !== null ? { day: days[active] ?? "", value: values[active] ?? 0 } : null;

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          tabIndex={0}
          aria-label={`${METRICS[metric].title} per day over the last ${days.length} days. Use the arrow keys to read each day.`}
          className="block touch-pan-y outline-none"
          onPointerMove={onMove}
          onPointerLeave={() => {
            setActive(null);
          }}
          onKeyDown={onKey}
          onBlur={() => {
            setActive(null);
          }}
        >
          {grid.map(t => (
            <g key={t}>
              <line x1={LEFT} x2={width - RIGHT} y1={y(t)} y2={y(t)} className="stroke-border" strokeWidth={1} shapeRendering="crispEdges" />
              <text x={LEFT - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-fg-subtle text-xs">
                {compact(t)}
              </text>
            </g>
          ))}
          {values.map((v, i) =>
            v > 0 ? (
              <path
                key={i}
                d={column(x(i), y(v), barW, TOP + plotH - y(v))}
                className={cn("fill-chart-1 transition-opacity duration-100", active !== null && active !== i && "opacity-40")}
              />
            ) : null,
          )}
          {days.map((d, i) =>
            labelled[i] ? (
              <text
                key={d}
                x={x(i) + barW / 2}
                y={HEIGHT - 6}
                textAnchor={i === days.length - 1 ? "end" : "middle"}
                className={cn("text-xs", active === i ? "fill-fg" : "fill-fg-subtle")}
              >
                {i === days.length - 1 ? "Today" : short(d)}
              </text>
            ) : null,
          )}
        </svg>
      )}
      {!width && <div style={{ height: HEIGHT }} />}
      {tip && active !== null && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-border bg-surface px-2.5 py-1.5 whitespace-nowrap shadow-md"
          style={{
            left: Math.min(Math.max(x(active) + barW / 2, 64), width - 64),
            top: Math.min(y(tip.value), TOP + plotH) - 8,
          }}
        >
          <div className="text-xs text-fg-muted">{long(tip.day)}</div>
          <div className="text-sm text-fg">
            <span className="tabular font-semibold">{num(tip.value)}</span> {tip.value === 1 ? unit[0] : unit[1]}
          </div>
        </div>
      )}
    </div>
  );
}

export function Trend() {
  const { data: st } = useStats();
  const [metric, setMetric] = useState<Metric>("applied");
  const total = st ? st[metric].reduce((a, b) => a + b, 0) : 0;
  const unit = METRICS[metric].unit;
  return (
    <WorkspaceSection
      className={LABEL_HEAD}
      title={METRICS[metric].title}
      description={st ? `${num(total)} ${total === 1 ? unit[0] : unit[1]} in the last 30 days` : "Last 30 days"}
      actions={
        <Segments
          aria-label="Metric"
          value={metric}
          onValueChange={setMetric}
          segments={(Object.keys(METRICS) as Metric[]).map(m => ({ value: m, label: METRICS[m].tab }))}
        />
      }
    >
      {st ? <Chart stats={st} metric={metric} /> : <Skeleton className="h-[200px]" />}
    </WorkspaceSection>
  );
}
