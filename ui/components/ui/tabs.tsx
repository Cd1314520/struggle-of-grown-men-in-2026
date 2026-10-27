import { Tabs as T } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/cn";

// Tabs: switching between different views (a job's Overview, Fit, Resume…; Archive's Held and Rejected).
// Linear's view switchers: small pills, the selected one filled and hairlined. A page's tabs sit in its
// Workspace bar (`tabs`, `variant="bar"`); a job's in a strip with a rule under it.
export const Tabs = T.Root;
export const TabsContent = T.Content;
export function TabsList({ className, variant, ...props }: ComponentProps<typeof T.List> & { variant?: "bar" }) {
  return (
    <T.List
      className={cn("flex h-11 items-center gap-1 overflow-x-auto border-b border-border touch:h-12", variant === "bar" && "h-12 border-b-0", className)}
      {...props}
    />
  );
}
// The list scrolls sideways and would clip an outline: keyboard focus shows as an inset ring.
// A view switcher's pill, shared by tabs and segments.
const PILL =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset touch:h-9 touch:min-w-9";

export function TabsTrigger({ className, count, children, ...props }: ComponentProps<typeof T.Trigger> & { count?: number | undefined }) {
  return (
    <T.Trigger
      className={cn(
        PILL,
        "data-[state=active]:border-border data-[state=active]:bg-muted/60 data-[state=active]:text-fg data-[state=active]:shadow-xs",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className="tabular text-xs font-normal text-fg-subtle">{count.toLocaleString()}</span>}
    </T.Trigger>
  );
}

// A row that scrolls sideways when it is too long for its space: the clipped side fades, so the last
// segment reads as "more this way" rather than cut off.
const FADE = "24px";
export function useEdgeFade(ref: RefObject<HTMLDivElement | null>) {
  const [edges, setEdges] = useState("");
  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft > 1,
      end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges(`${start ? "s" : ""}${end ? "e" : ""}`);
  }, [ref]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", measure);
    };
  }, [ref, measure]);
  // Counts arrive after the first paint and widen the row without resizing the box.
  useLayoutEffect(measure);
  const mask = edges
    ? `linear-gradient(to right, ${edges.includes("s") ? `transparent, black ${FADE}` : "black"}, ${edges.includes("e") ? `black calc(100% - ${FADE}), transparent` : "black"})`
    : undefined;
  return mask ? { maskImage: mask } : undefined;
}

// A row of segments: narrowing one list to a group (Your move, Upcoming…), in its Workspace bar. Each
// shows its count; a warning or danger count is tinted while it is above zero.
export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | undefined;
  tone?: "neutral" | "accent" | "warning" | "danger" | undefined;
  data?: Record<`data-${string}`, string> | undefined; // on the segment's button: Pipeline's data-stage
}
export function Segments<T extends string>({
  value,
  onValueChange,
  segments,
  className,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  segments: readonly Segment<T>[];
  className?: string;
  "aria-label": string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref);
  return (
    <div ref={ref} style={fade} role="tablist" aria-label={ariaLabel} className={cn("flex items-center gap-1 overflow-x-auto", className)}>
      {segments.map(s => {
        const on = s.value === value;
        return (
          <button
            key={s.value}
            type="button"
            role="tab"
            aria-selected={on}
            data-segment={s.value}
            {...s.data}
            onClick={() => {
              onValueChange(s.value);
            }}
            className={cn(PILL, on && "border-border bg-muted/60 text-fg shadow-xs hover:bg-muted/60")}
          >
            {s.label}
            {s.count !== undefined && (
              <span
                className={cn(
                  "tabular text-xs",
                  on ? "text-fg-muted" : "text-fg-subtle",
                  s.count > 0 && (s.tone === "warning" ? "text-warning-text" : s.tone === "danger" && "text-danger-text"),
                )}
              >
                {s.count.toLocaleString()}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
