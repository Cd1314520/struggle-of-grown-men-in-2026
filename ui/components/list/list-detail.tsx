// A list and the record open from it. From lg the record sits beside the list ("column": the list is
// always a column; "split": the list is the page until a record opens) or over its right side
// ("overlay": a wide table that stays live under the panel). Below lg the record covers the screen,
// tab bar included, and is not there at all until opened, so its keys never act on a record nobody sees.
import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMedia, WIDE } from "../../lib/media";

const TABBABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]";
const tabbables = (root: HTMLElement | null) =>
  [...(root?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])].filter(el => el.tabIndex >= 0 && el.checkVisibility());
// The list's one tab stop: the open record's row (the others have tabIndex -1).
const ROW = "a[role=row]";

// The column's widths at lg/xl/2xl, shared with the loading skeletons that stand in for it.
export const COLUMN = "lg:w-[380px] lg:shrink-0 lg:border-r lg:border-border lg:bg-surface xl:w-[440px] 2xl:w-[500px]";

export function ListDetail({
  layout,
  children,
  detail,
  open,
  empty,
  label,
  onListClick,
}: {
  layout: "column" | "split" | "overlay";
  children: ReactNode; // the list
  detail: ReactNode; // the open record
  open: boolean; // the URL opens a record; a column may show one on a desktop without it (Questions' first)
  empty?: ReactNode; // beside a column with nothing to show
  label: string; // the record's region, for screen readers
  onListClick?: ((ev: MouseEvent) => void) | undefined;
}) {
  const wide = useMedia(WIDE);
  const column = layout === "column" || (layout === "split" && open);
  const body = layout === "column" && wide ? (detail ?? empty) : open && detail;
  const list = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null);
  // Tab goes from the open row straight to the record, past the list's pagination, and Shift+Tab back.
  const hop = (ev: KeyboardEvent, to: HTMLElement | null | undefined) => {
    if (!to) return;
    ev.preventDefault();
    to.focus();
  };
  return (
    <div className={cn(layout !== "overlay" && "lg:flex lg:h-dvh")}>
      <div
        ref={list}
        onKeyDown={ev => {
          if (ev.key === "Tab" && !ev.shiftKey && ev.target instanceof Element && ev.target.matches(ROW)) hop(ev, tabbables(panel.current)[0]);
        }}
        onClick={onListClick}
        // The scroll padding keeps a row brought into view clear of a pagination bar stuck to the bottom.
        className={cn("min-w-0", layout !== "overlay" && "lg:h-full lg:scroll-pb-16 lg:overflow-y-auto", column ? COLUMN : "lg:flex-1")}
      >
        {children}
      </div>
      {body && (
        <div
          ref={panel}
          role="region"
          aria-label={label}
          onKeyDown={ev => {
            if (ev.key === "Tab" && ev.shiftKey && ev.target === tabbables(panel.current)[0])
              hop(ev, list.current?.querySelector<HTMLElement>(`${ROW}:not([tabindex="-1"])`));
          }}
          className={cn(
            "fixed inset-0 z-50 flex animate-slide-left flex-col overscroll-contain bg-surface pb-[env(safe-area-inset-bottom)] lg:pb-0",
            layout === "overlay"
              ? // shadow-lg falls downward; a full-height panel needs its shadow cast left, over the list it covers.
                "lg:left-auto lg:w-[min(760px,calc(100vw-15rem-120px))] lg:border-l lg:border-border lg:before:pointer-events-none lg:before:absolute lg:before:inset-y-0 lg:before:right-full lg:before:w-10 lg:before:bg-linear-to-l lg:before:from-black/8 lg:before:to-transparent"
              : "lg:static lg:z-auto lg:h-full lg:min-w-0 lg:flex-1 lg:animate-in",
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
}

// The head of a list column: the title (the shell's top bar names the page on a phone) and the count, with
// the list's controls on the same line; the search and groups under them.
export function ListHeader({
  title,
  count,
  noun,
  actions,
  children,
}: {
  title: string;
  count: number | undefined; // undefined while loading
  noun: string; // after the count on a phone, where the title is not shown: "246 waiting for you"
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 px-4 pt-4 pb-3 lg:border-b lg:border-border">
      <div className="flex min-h-8 items-center gap-2">
        <h1 className="hidden text-xl font-semibold tracking-[-0.01em] text-fg lg:block">{title}</h1>
        {count !== undefined && (
          <span className="tabular text-sm text-fg-muted lg:mt-0.5 lg:text-fg-subtle">
            {count.toLocaleString()}
            <span className="lg:hidden"> {noun}</span>
          </span>
        )}
        {actions && <div className="ml-auto flex min-w-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
