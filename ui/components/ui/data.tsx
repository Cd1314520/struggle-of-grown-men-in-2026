// Small pieces that show one value: a score, an employer's mark, a time, a stat, a key-value list.
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { ago, agoShort, dateTime, parseAt } from "../../lib/format";
import { Tooltip } from "./tooltip";

// A fit score: the number, coloured against the threshold, with a thin bar under it in the larger size.
export function Score({
  value,
  threshold,
  size = "sm",
  className,
}: {
  value: number | null;
  threshold?: number | null;
  size?: "sm" | "lg";
  className?: string;
}) {
  if (value == null) return <span className={cn("text-sm text-fg-subtle", className)}>–</span>;
  const tone = threshold != null && value < threshold ? "text-fg-subtle" : value >= 80 ? "text-success-text" : "text-fg";
  if (size === "sm") return <span className={cn("tabular text-sm font-semibold", tone, className)}>{value}</span>;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className={cn("tabular text-2xl font-semibold", tone)}>{value}</span>
      <div className="relative h-1 w-16 overflow-hidden rounded-full bg-muted">
        <div
          className={cn("absolute inset-y-0 left-0 rounded-full", value >= 80 ? "bg-success" : value >= (threshold ?? 0) ? "bg-accent" : "bg-fg-subtle")}
          style={{ width: `${value}%` }}
        />
        {threshold != null && <div className="absolute inset-y-0 w-px bg-fg-muted" style={{ left: `${threshold}%` }} />}
      </div>
    </div>
  );
}

// An employer's initials on a tint picked from its name, standing in for a logo.
const TINTS = [
  "bg-[#eef0fe] text-[#4a4ac4] dark:bg-[#1e1e3a] dark:text-[#a5a5ff]",
  "bg-[#e9f7f0] text-[#1d7a52] dark:bg-[#11251c] dark:text-[#5fd39d]",
  "bg-[#fdf4e3] text-[#96600a] dark:bg-[#2a2010] dark:text-[#f0bb63]",
  "bg-[#ebf3fe] text-[#2563c4] dark:bg-[#12203a] dark:text-[#8ab9ff]",
  "bg-[#fbeefa] text-[#a3368f] dark:bg-[#2a1228] dark:text-[#f08ad8]",
  "bg-[#eef6f7] text-[#20727d] dark:bg-[#10262a] dark:text-[#6fd0dc]",
];
export function CompanyMark({ name, size = "md", className }: { name: string; size?: "sm" | "md" | "lg"; className?: string }) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  const initials = (words.length > 1 ? (words[0]?.[0] ?? "") + (words[1]?.[0] ?? "") : name.slice(0, 2)).toUpperCase();
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) | 0;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md font-semibold select-none",
        size === "sm" ? "size-6 text-2xs" : size === "md" ? "size-8 text-xs" : "size-11 text-base",
        TINTS[Math.abs(h) % TINTS.length],
        className,
      )}
    >
      {initials}
    </span>
  );
}

// "3h ago", with the exact time on hover. `short` is a row's trail: "3h", "2d", "now".
export function Time({ at, short, className, prefix = "" }: { at: string | number | null | undefined; short?: boolean; className?: string; prefix?: string }) {
  if (!at) return null;
  const ms = typeof at === "number" ? at : parseAt(at);
  return (
    <Tooltip content={dateTime(ms)}>
      <time dateTime={new Date(ms).toISOString()} className={cn("tabular whitespace-nowrap", className)}>
        {prefix}
        {short ? agoShort(ms) : ago(ms)}
      </time>
    </Tooltip>
  );
}

// A number with its label, for stat rows.
export function Stat({ label, value, hint, className }: { label: ReactNode; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="tabular text-2xl font-semibold tracking-[-0.01em] text-fg">{value}</span>
      {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
    </div>
  );
}

// Numbers in a line, with no tiles and no borders: an Applications or Overview header's stats.
export function StatRow({ items, className }: { items: readonly { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-10 gap-y-3", className)}>
      {items.map((s, i) => (
        <div key={i} className="flex flex-col">
          <dt className="text-sm text-fg-muted">{s.label}</dt>
          <dd className="tabular text-xl font-semibold text-fg">{s.value}</dd>
          {s.hint && <dd className="text-xs text-fg-muted">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

// Label/value rows: two columns where there is room, and stacked (the label over its value) in less
// than 28rem, a phone or a narrow panel, so a value never wraps a word to a line.
export function Properties({
  items,
  className,
}: {
  items: readonly (readonly [label: ReactNode, value: ReactNode] | false | null | undefined)[];
  className?: string;
}) {
  return (
    <div className={cn("@container", className)}>
      <dl className="grid gap-y-3 text-sm @md:grid-cols-[minmax(96px,160px)_1fr] @md:gap-x-6 @md:gap-y-2.5">
        {items.filter(Boolean).map((item, i) => {
          const [k, v] = item as readonly [ReactNode, ReactNode];
          return (
            <div key={i} className="flex min-w-0 flex-col gap-0.5 @md:contents">
              <dt className="text-fg-muted">{k}</dt>
              <dd className="min-w-0 break-words text-fg">{v}</dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
