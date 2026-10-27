// The workspace: every page is one white sheet from the sidebar's edge to the window's, top to bottom. A
// slim bar heads it (title, count, tabs, segments, search, sort, actions on one line), then the rows edge to
// edge, then a slim footer. No cards, no page header block, no column headers. See docs/ui.md, "Frames".
import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { SkeletonRows } from "./feedback";
import { Tooltip } from "./tooltip";

export interface WorkspaceBarProps {
  title: ReactNode; // the page's name: an h1, for screen readers only below lg (the top bar names the page)
  titleAs?: "h1" | "h2";
  count?: number | undefined; // beside the title: the whole list; undefined while loading
  noun?: string; // a column below lg, where the count is a line of its own: "334 waiting for you"
  meta?: ReactNode; // after the title, muted: "461 things need you", the open job's name
  back?: ReactNode; // before the title: a ghost sm link back to the list (the job page)
  tabs?: ReactNode; // a <TabsList variant="bar"> (inside the page's <Tabs>), right of the title
  segments?: ReactNode; // <Segments>: on the bar's line when it has room, else a line of their own
  search?: ReactNode; // a <SearchInput>
  controls?: ReactNode; // <FilterMenu>, <Select prefix="Sort" collapse>: icon-only under 80rem
  actions?: ReactNode; // buttons at the right, size="sm": Run, Release held, Check again
  hint?: string; // the page's one-line description, behind an info button (desktop only)
}

// A line of the bar, at its height for each place: the page on a desktop, a column, a phone.
const LINE = "flex min-w-0 shrink-0 items-center";

export function WorkspaceBar({
  frame = "page",
  title,
  titleAs: Title = "h1",
  count,
  noun,
  meta,
  back,
  tabs,
  segments,
  search,
  controls,
  actions,
  hint,
}: WorkspaceBarProps & { frame?: "page" | "column" }) {
  const col = frame === "column";
  // Inline only on a wide page bar with no tabs; otherwise the segments take a line of their own.
  const inline = !col && !tabs;
  const tools = !!(search || controls || actions);
  return (
    <div
      className={cn(
        "@container/bar z-20 flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border bg-surface/95 px-(--list-x) backdrop-blur",
        // A column's first line has a rule under it, level with the open record's position bar beside it.
        col ? "lg:relative lg:before:absolute lg:before:inset-x-0 lg:before:top-12 lg:before:h-px lg:before:bg-border" : "lg:sticky lg:top-0",
      )}
    >
      {/* Title and count. Below lg the top bar names the page: the h1 is for screen readers, and a column
          keeps its count as a line ("334 waiting for you"). */}
      <div
        className={cn(
          LINE,
          "order-1 h-12 gap-2",
          col && (search ? "lg:shrink-0" : "lg:flex-1"),
          noun && count !== undefined ? "max-lg:order-0 max-lg:h-auto max-lg:basis-full max-lg:pt-3" : "max-lg:sr-only",
        )}
      >
        {back}
        <Title className="min-w-0 truncate text-base font-semibold tracking-[-0.005em] text-fg max-lg:sr-only">{title}</Title>
        {count !== undefined && (
          <span className="tabular shrink-0 text-base text-fg-subtle max-lg:text-sm max-lg:text-fg-muted">
            {count.toLocaleString()}
            {noun && <span className="lg:hidden"> {noun}</span>}
          </span>
        )}
        {meta && <span className="min-w-0 truncate text-sm text-fg-muted max-lg:hidden">{meta}</span>}
      </div>
      {tabs && <div className={cn(LINE, "order-1 h-12 min-w-0 max-lg:flex-1 lg:order-2 lg:ml-3 [&_[role=tablist]]:min-w-0")}>{tabs}</div>}
      {segments && (
        // The segments' own box reaches 4px past their room, so a selected segment's ring is never clipped.
        <div
          className={cn(
            LINE,
            "order-9 h-11 basis-full pb-1 [&>*]:-mx-1 [&>*]:px-1",
            inline && "lg:@[68rem]/bar:order-2 lg:@[68rem]/bar:ml-3 lg:@[68rem]/bar:h-12 lg:@[68rem]/bar:flex-1 lg:@[68rem]/bar:basis-0 lg:@[68rem]/bar:pb-0",
          )}
        >
          {segments}
        </div>
      )}
      {/* On a phone with tabs, the tabs and actions are the first line and the search the second. */}
      {tabs && tools && <div aria-hidden className="order-3 basis-full lg:hidden" />}
      {search && (
        <div
          className={cn(
            LINE,
            "order-4 h-14 flex-1 [&>*]:w-full",
            // In a column, between the title and the controls, so the bar keeps to two lines: that, then segments.
            col ? "lg:order-2 lg:h-12 lg:basis-24 lg:[&_input]:text-ellipsis" : "lg:ml-auto lg:h-12 lg:w-56 lg:flex-none lg:@[80rem]/bar:w-64",
          )}
        >
          {search}
        </div>
      )}
      {controls && <div className={cn(LINE, "order-5 h-14 gap-2 lg:h-12", !search && !col && "lg:ml-auto")}>{controls}</div>}
      {actions && (
        <div className={cn(LINE, "order-6 h-14 gap-1.5 lg:h-12", tabs && "max-lg:order-2 max-lg:h-12", !search && !controls && "ml-auto")}>{actions}</div>
      )}
      {hint && !col && (
        <div className={cn(LINE, "order-7 h-12 max-lg:hidden", !tools && "ml-auto")}>
          <Tooltip content={hint}>
            <Button variant="ghost" size="icon-sm" aria-label="About this page" icon={<Info />} className="-mr-1.5" />
          </Tooltip>
        </div>
      )}
    </div>
  );
}

// The sheet. `page`: the page itself (the window scrolls; from lg, inside a split list, the list's pane
// does), the bar sticks to the top. `column`: the list beside an open record: from lg the bar stays, the
// rows scroll, the footer is pinned; below lg it is the page. Sets the gutter (`--list-x`) and where group
// labels stick (`--group-top`) for everything inside.
export function Workspace({
  frame = "page",
  bar,
  strip,
  notice,
  footer,
  loading,
  bodyRole,
  bodyLabel,
  className,
  children,
  "aria-label": ariaLabel,
  "aria-rowcount": rowCount,
}: {
  frame?: "page" | "column";
  bar?: WorkspaceBarProps;
  strip?: ReactNode; // a <WorkspaceStrip> under the bar: numbers that scroll away
  notice?: ReactNode; // a <ListNotice> under the bar (and strip), scrolls away
  footer?: ReactNode; // <Pagination variant="footer"> or <ListFooter>
  loading?: boolean; // placeholder data on screen: the rows dim until the real page arrives
  bodyRole?: "table" | "list" | "none"; // a list page's rows; omitted on a page that is not a list
  bodyLabel?: string; // the table's name: "Applications", "Queue"
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-rowcount"?: number | undefined;
}) {
  const col = frame === "column";
  // The bar's height from lg, where group labels stick under it: one 48px line and its rule, or two when
  // the segments take a line of their own (always with tabs; under 68rem of bar without).
  const two = bar?.segments && (bar.tabs ? "lg:[--group-top:calc(5.75rem+1px)]" : "lg:@max-[68rem]/ws:[--group-top:calc(5.75rem+1px)]");
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "@container/ws flex min-w-0 flex-col bg-surface [--list-x:1rem] max-lg:min-h-[calc(100dvh-3rem)] max-lg:pb-24",
        col ? "max-lg:sm:[--list-x:1.5rem] lg:h-full" : "min-h-full sm:[--list-x:1.5rem]",
        className,
      )}
    >
      {bar && <WorkspaceBar frame={frame} {...bar} />}
      {strip}
      {notice}
      <div
        role={bodyRole === "none" ? undefined : bodyRole}
        aria-label={bodyLabel}
        aria-rowcount={rowCount}
        className={cn(
          "min-w-0 [--group-top:3rem]",
          col ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[--group-top:0px]" : cn("lg:[--group-top:calc(3rem+1px)]", two),
          loading && "opacity-60 transition-opacity",
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

// Numbers in one line under a page's bar: "Sent 431  In process 11  Reply rate 19%". Scrolls away.
export function WorkspaceStrip({ items, className }: { items: readonly { label: ReactNode; value: ReactNode; hint?: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("flex h-12 shrink-0 items-center gap-8 overflow-x-auto border-b border-border px-(--list-x) whitespace-nowrap", className)}>
      {items.map((s, i) => (
        <div key={i} className="flex items-baseline gap-2">
          <dt className="text-sm text-fg-muted">{s.label}</dt>
          <dd className="tabular text-sm font-semibold text-fg">{s.value}</dd>
          {s.hint && <dd className="text-xs text-fg-muted">{s.hint}</dd>}
        </div>
      ))}
    </dl>
  );
}

// A titled part of a page that is not a list, divided from the next by a full-bleed rule, never a card.
// Reading content inside caps itself at 56rem (`max-w-[56rem]`); the rule does not. `flush`: no padding
// under the header, for a section that is a list (its ListBody bleeds to the edges).
export function WorkspaceSection({
  title,
  count,
  description,
  actions,
  id,
  flush,
  tone,
  className,
  children,
}: {
  title: ReactNode;
  count?: number | undefined;
  description?: ReactNode;
  actions?: ReactNode;
  id?: string;
  flush?: boolean;
  tone?: "danger";
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={cn("scroll-mt-14 border-b border-border", !flush && "pb-6", className)}>
      <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 px-(--list-x) pt-6", flush ? "pb-3" : "pb-4")}>
        <div className="min-w-0 flex-1 basis-60">
          <h2 className={cn("flex min-h-8 items-center gap-2 text-base font-semibold", tone === "danger" ? "text-danger-text" : "text-fg")}>
            {title}
            {count !== undefined && <span className="tabular font-normal text-fg-subtle">{count.toLocaleString()}</span>}
          </h2>
          {description && <p className="max-w-[56rem] text-sm text-fg-muted">{description}</p>}
        </div>
        {actions && <div className="flex min-h-8 shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className={cn(!flush && "px-(--list-x)")}>{children}</div>
    </section>
  );
}

// A page with a side pane: a nav (Settings' sections, Profile's files), a rail (the Overview's system
// state) or a pane (Resume's import). From lg (xl for a rail) a full-height column beside the main part
// with a rule between; below that it stacks: a nav as a sideways strip under the bar, the rest after.
const ASIDE = {
  nav: "lg:w-52",
  rail: "xl:w-88",
  pane: "lg:w-104",
};
export function WorkspaceBody({
  aside,
  asideSide = "right",
  asideWidth = "rail",
  className,
  children,
}: {
  aside: ReactNode;
  asideSide?: "left" | "right";
  asideWidth?: keyof typeof ASIDE;
  className?: string;
  children: ReactNode;
}) {
  const at = asideWidth === "rail" ? "xl" : "lg";
  const left = asideSide === "left";
  return (
    <div className={cn("flex min-w-0 flex-1 flex-col", at === "xl" ? "xl:flex-row" : "lg:flex-row", className)}>
      <div className={cn("min-w-0 flex-1", left && asideWidth !== "nav" && "order-2")}>{children}</div>
      <aside
        className={cn(
          "min-w-0 shrink-0 border-border",
          ASIDE[asideWidth],
          asideWidth === "nav"
            ? "sticky top-12 z-10 order-first border-b bg-surface/95 backdrop-blur lg:top-[calc(3rem+1px)] lg:h-[calc(100dvh-3rem-1px)] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:bg-surface lg:backdrop-blur-none"
            : cn(at === "xl" ? "xl:border-l" : "lg:border-l", "max-lg:border-t", at === "xl" && "lg:max-xl:border-t"),
          left && asideWidth !== "nav" && cn("order-first", at === "xl" ? "xl:border-r xl:border-l-0" : "lg:border-r lg:border-l-0"),
        )}
      >
        {aside}
      </aside>
    </div>
  );
}

// Rows with no frame of their own: a list inside a WorkspaceSection, bleeding to the section's edges so a
// row's hover runs the full width.
export function ListBody({
  label,
  role = "table",
  rowCount,
  loading,
  className,
  children,
}: {
  label: string;
  role?: "table" | "list";
  rowCount?: number | undefined;
  loading?: boolean; // no data yet: placeholder rows
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role={role} aria-label={label} aria-rowcount={rowCount} className={cn("min-w-0 [--group-top:3rem] lg:[--group-top:calc(3rem+1px)]", className)}>
      {loading ? <SkeletonRows rows={4} /> : children}
    </div>
  );
}
