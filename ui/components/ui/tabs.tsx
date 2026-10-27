import { Tabs as T } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/cn";

// Underlined tabs: switching between different views (a job's Overview, Fit, Resume…; Archive's Held and
// Rejected). A list's tabs head its ListPanel (`tabs`).
export const Tabs = T.Root;
export const TabsContent = T.Content;
export function TabsList({ className, ...props }: ComponentProps<typeof T.List>) {
  return <T.List className={cn("flex h-10 items-stretch gap-5 overflow-x-auto border-b border-border", className)} {...props} />;
}
// The list scrolls sideways and would clip an outline: keyboard focus shows as an accent underline and label.
export function TabsTrigger({ className, count, children, ...props }: ComponentProps<typeof T.Trigger> & { count?: number | undefined }) {
  return (
    <T.Trigger
      className={cn(
        "relative -mb-px inline-flex h-10 items-center justify-center gap-1.5 border-b-2 border-transparent text-sm font-medium whitespace-nowrap text-fg-muted transition-colors outline-none hover:text-fg data-[state=active]:border-fg data-[state=active]:text-fg focus-visible:border-accent focus-visible:text-accent-text data-[state=active]:focus-visible:border-accent data-[state=active]:focus-visible:text-accent-text touch:min-w-9",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && <span className="tabular text-sm font-normal text-fg-subtle">{count.toLocaleString()}</span>}
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

// A row of segments: narrowing one list to a group (Your move, Upcoming…), in its panel's toolbar. Each
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
            className={cn(
              "inline-flex h-8 shrink-0 items-center touch:h-9 gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors",
              on ? "bg-muted text-fg" : "text-fg-muted hover:bg-subtle hover:text-fg",
            )}
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
