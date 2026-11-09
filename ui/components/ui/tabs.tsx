import { Tabs as T } from "radix-ui";
import { useCallback, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from "react";
import { cn } from "../../lib/cn";

export const Tabs = T.Root;
export const TabsContent = T.Content;
export function TabsList({ className, variant, style, ...props }: ComponentProps<typeof T.List> & { variant?: "bar" }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref);
  useRevealSelected(ref);
  return (
    <T.List
      ref={ref}
      style={{ ...fade, ...style }}
      className={cn(
        "flex h-11 items-center gap-1 overflow-x-auto border-b border-border max-sm:gap-0.5 touch:h-12",
        variant === "bar" && "h-12 border-b-0",
        className,
      )}
      {...props}
    />
  );
}
const PILL =
  "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-fg-muted transition-colors outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset max-sm:px-2 touch:h-9 touch:min-w-9";

export function TabsTrigger({ className, count, children, ...props }: ComponentProps<typeof T.Trigger> & { count?: number | undefined }) {
  return (
    <T.Trigger
      className={cn(
        PILL,
        "group data-[state=active]:border-border data-[state=active]:bg-muted/60 data-[state=active]:text-fg data-[state=active]:shadow-xs data-[state=active]:hover:bg-muted/60",
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="tabular text-xs font-normal text-fg-subtle group-data-[state=active]:text-fg-muted">{count.toLocaleString()}</span>
      )}
    </T.Trigger>
  );
}

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
  useLayoutEffect(measure);
  const mask = edges
    ? `linear-gradient(to right, ${edges.includes("s") ? `transparent, black ${FADE}` : "black"}, ${edges.includes("e") ? `black calc(100% - ${FADE}), transparent` : "black"})`
    : undefined;
  return mask ? { maskImage: mask } : undefined;
}

export function useRevealSelected(ref: RefObject<HTMLDivElement | null>) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reveal = () => {
      const on = el.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!on || el.scrollWidth <= el.clientWidth) return;
      const pad = parseInt(FADE, 10) + 8;
      const box = el.getBoundingClientRect(),
        pill = on.getBoundingClientRect();
      if (pill.left < box.left + pad) el.scrollLeft -= box.left + pad - pill.left;
      else if (pill.right > box.right - pad) el.scrollLeft += pill.right - (box.right - pad);
    };
    reveal();
    const watch = new MutationObserver(reveal);
    watch.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-selected"] });
    const ro = new ResizeObserver(reveal);
    ro.observe(el);
    return () => {
      watch.disconnect();
      ro.disconnect();
    };
  }, [ref]);
}

export interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  count?: number | undefined;
  tone?: "neutral" | "accent" | "warning" | "danger" | undefined;
  data?: Record<`data-${string}`, string> | undefined;
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
  useRevealSelected(ref);
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
