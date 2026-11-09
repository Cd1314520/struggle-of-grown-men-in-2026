import { Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { SkeletonRows } from "./feedback";
import { Tooltip } from "./tooltip";

export interface WorkspaceBarProps {
  title: ReactNode;
  titleAs?: "h1" | "h2";
  count?: number | undefined;
  noun?: string;
  meta?: ReactNode;
  back?: ReactNode;
  tabs?: ReactNode;
  segments?: ReactNode;
  search?: ReactNode;
  controls?: ReactNode;
  actions?: ReactNode;
  hint?: string;
}

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
  const inline = !col && !tabs;
  const tools = !!(search || controls || actions);
  const split = col && !!tabs && tools;
  return (
    <div
      className={cn(
        "@container/bar z-20 flex shrink-0 flex-wrap items-center gap-x-3 border-b border-border bg-surface px-(--list-x)",
        col ? "lg:relative lg:before:absolute lg:before:inset-x-0 lg:before:top-12 lg:before:h-px lg:before:bg-border" : "lg:sticky lg:top-0",
      )}
    >
      <div
        className={cn(
          LINE,
          "order-1 h-12 gap-2",
          col && (search ? "lg:shrink-0" : "lg:flex-1"),
          noun && count !== undefined ? "max-lg:order-0 max-lg:h-auto max-lg:basis-full max-lg:pt-3" : "max-lg:sr-only",
        )}
      >
        {back}
        <Title className="min-w-0 truncate text-sm font-medium text-fg max-lg:sr-only">{title}</Title>
        {count !== undefined && (
          <span className="tabular shrink-0 text-sm text-fg-subtle max-lg:text-fg-muted">
            {count.toLocaleString()}
            {noun && <span className="lg:hidden"> {noun}</span>}
          </span>
        )}
        {meta && <span className="min-w-0 truncate text-sm text-fg-muted max-lg:hidden">{meta}</span>}
      </div>
      {tabs && <div className={cn(LINE, "order-1 h-12 min-w-0 max-lg:flex-1 lg:order-2 lg:ml-3 [&_[role=tablist]]:min-w-0")}>{tabs}</div>}
      {segments && (
        <div
          className={cn(
            LINE,
            "order-9 h-10 basis-full pb-1.5 max-lg:[&>*]:-mx-(--list-x) max-lg:[&>*]:scroll-px-(--list-x) max-lg:[&>*]:px-(--list-x) touch:h-11 touch:pb-1 lg:h-11 lg:pb-1 lg:[&>*]:-mx-1 lg:[&>*]:px-1",
            inline && "lg:@[88rem]/bar:order-2 lg:@[88rem]/bar:ml-3 lg:@[88rem]/bar:h-12 lg:@[88rem]/bar:flex-1 lg:@[88rem]/bar:basis-0 lg:@[88rem]/bar:pb-0",
          )}
        >
          {segments}
        </div>
      )}
      {tabs && tools && <div aria-hidden className={cn("order-3 basis-full", !split && "lg:hidden")} />}
      {search && (
        <div
          className={cn(
            LINE,
            "order-4 h-12 flex-1 touch:h-14 [&>*]:w-full",
            col
              ? cn("lg:h-12 lg:min-w-36 lg:[&_input]:text-ellipsis", split ? "lg:order-4" : "lg:order-2 lg:basis-24")
              : "lg:ml-auto lg:h-12 lg:w-56 lg:flex-none lg:@[80rem]/bar:w-64",
          )}
        >
          {search}
        </div>
      )}
      {controls && <div className={cn(LINE, "order-5 h-12 gap-2 touch:h-14 lg:h-12", !search && !col && "lg:ml-auto")}>{controls}</div>}
      {actions && (
        <div
          className={cn(
            LINE,
            "order-6 h-12 gap-1.5 touch:h-14 lg:h-12",
            tabs && "max-lg:order-2 max-lg:h-12",
            controls && "lg:-ml-1",
            !search && !controls && "ml-auto",
          )}
        >
          {actions}
        </div>
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
  strip?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  loading?: boolean;
  bodyRole?: "table" | "list" | "none";
  bodyLabel?: string;
  className?: string;
  children: ReactNode;
  "aria-label"?: string;
  "aria-rowcount"?: number | undefined;
}) {
  const col = frame === "column";
  const two = bar?.segments && (bar.tabs ? "lg:[--group-top:calc(5.75rem+1px)]" : "lg:@max-[88rem]/ws:[--group-top:calc(5.75rem+1px)]");
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "@container/ws flex min-w-0 flex-col bg-surface [--list-x:1rem] max-lg:min-h-[calc(100dvh-3rem)] max-lg:pb-[calc(3.5rem+1px+env(safe-area-inset-bottom))]",
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
          col ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:[--group-top:0px]" : cn("flex flex-1 flex-col lg:[--group-top:calc(3rem+1px)]", two),
          loading && "opacity-60 transition-opacity",
        )}
      >
        {children}
      </div>
      {footer}
    </section>
  );
}

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

const ASIDE = {
  nav: "lg:w-52",
  rail: "xl:w-88",
  pane: "lg:w-80 xl:w-104",
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
            ? "sticky top-12 z-10 order-first border-b bg-surface lg:top-[calc(3rem+1px)] lg:h-[calc(var(--app-h)-3rem-1px)] lg:overflow-y-auto lg:border-r lg:border-b-0 lg:bg-surface lg:backdrop-blur-none"
            : cn(at === "xl" ? "xl:border-l" : "lg:border-l", "max-lg:border-t", at === "xl" && "lg:max-xl:border-t"),
          left && asideWidth !== "nav" && cn("order-first", at === "xl" ? "xl:border-r xl:border-l-0" : "lg:border-r lg:border-l-0"),
        )}
      >
        {aside}
      </aside>
    </div>
  );
}

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
  loading?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div role={role} aria-label={label} aria-rowcount={rowCount} className={cn("min-w-0 [--group-top:3rem] lg:[--group-top:calc(3rem+1px)]", className)}>
      {loading ? <SkeletonRows rows={4} /> : children}
    </div>
  );
}
