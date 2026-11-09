import { isValidElement, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

const X = "px-[var(--list-x,1rem)]";

const LEAD = "auto",
  BODY = "minmax(0,1fr)";
const tracks = (...t: (string | false | undefined)[]) => t.filter(Boolean).join(" ");
const shown = (n: ReactNode) => n !== undefined && n !== null && n !== false;

const LINES = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;
const DESK = {
  1: "",
  2: "lg:block lg:truncate touch:line-clamp-2 touch:whitespace-normal",
  3: "lg:block lg:truncate touch:line-clamp-3 touch:whitespace-normal",
} as const;
const SNIPPET = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export type ListRowProps = Omit<ComponentProps<"a">, "title" | "ref"> & {
  href?: string;
  selected?: boolean;
  lead?: ReactNode;
  indent?: boolean;
  title: ReactNode;
  titleLines?: 1 | 2 | 3 | "none";
  titleClassName?: string;
  secondary?: ReactNode;
  gist?: ReactNode;
  snippet?: ReactNode;
  snippetLines?: 2 | 3;
  fact?: ReactNode;
  actions?: ReactNode;
  dense?: boolean;
  cells?: readonly ReactNode[];
  columns?: string;
};

const ROW =
  "group relative scroll-mt-12 scroll-mb-12 text-sm text-fg outline-none transition-colors after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:h-px after:bg-border/70 focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset";

export function ListRow({
  href,
  selected,
  lead,
  indent,
  title,
  titleLines = 2,
  titleClassName,
  secondary,
  gist,
  snippet,
  snippetLines,
  fact,
  actions,
  cells,
  columns,
  dense,
  className,
  style,
  ...props
}: ListRowProps) {
  const Row = (href ? "a" : "div") as "a";
  const link = href !== undefined;
  const frame = cn(ROW, link && "cursor-pointer hover:bg-subtle", selected && "bg-muted hover:bg-muted");
  const tooltip = typeof title === "string" ? title : undefined;

  if (dense) {
    return (
      <Row
        role="row"
        href={href}
        aria-current={selected ? "true" : undefined}
        style={{ "--row": tracks(columns, BODY), ...style } as CSSProperties}
        className={cn(
          frame,
          "grid min-h-9 grid-cols-(--row) items-center gap-x-3 py-1.5 after:left-0 touch:flex touch:flex-wrap touch:items-baseline touch:gap-x-3 touch:gap-y-0.5 touch:py-2.5",
          X,
          className,
        )}
        {...props}
      >
        {cells?.map((c, i) => (
          <div key={i} role="cell" className="min-w-0 truncate text-fg-muted touch:order-1 touch:text-xs">
            {c}
          </div>
        ))}
        <div
          role="cell"
          title={tooltip}
          className={cn("min-w-0 truncate text-fg touch:order-first touch:line-clamp-2 touch:basis-full touch:whitespace-normal", titleClassName)}
        >
          {title}
        </div>
      </Row>
    );
  }

  const hasLead = lead !== undefined || indent;
  const hasFact = shown(fact),
    hasActions = shown(actions);
  const one = !shown(snippet) && titleLines !== "none";
  const single = one && !shown(secondary) && !shown(gist);
  const prose = shown(snippet);
  return (
    <Row
      role="row"
      href={href}
      aria-current={selected ? "true" : undefined}
      style={{ "--row": tracks(hasLead && LEAD, BODY, hasFact && "auto", hasActions && "auto"), ...style } as CSSProperties}
      className={cn(
        frame,
        "grid grid-cols-(--row) items-center gap-x-3 touch:items-start",
        single ? "min-h-12 py-2.5 touch:min-h-14 touch:py-3" : "min-h-16 py-3 touch:min-h-[4.5rem] touch:py-3.5",
        prose && "items-start",
        hasLead ? "after:left-[calc(var(--list-x,1rem)+2.75rem)]" : "after:left-[var(--list-x,1rem)]",
        "row-wide:after:left-0",
        one ? "row-wide:min-h-11 row-wide:py-1.5" : "row-wide:min-h-12 row-wide:items-start row-wide:py-2.5",
        X,
        className,
      )}
      {...props}
    >
      {hasLead && (
        <div
          role="cell"
          className={cn(
            "flex size-8 items-center justify-center touch:mt-0.5",
            prose && "mt-0.5",
            "row-wide:size-6 row-wide:[&>*]:size-6 row-wide:[&>*]:text-2xs row-wide:[&_svg]:size-3.5",
          )}
        >
          {lead}
        </div>
      )}
      <div role="cell" className={cn("min-w-0", one && "row-wide:flex row-wide:items-center row-wide:gap-3")}>
        <div
          title={tooltip}
          className={cn(
            "text-base font-medium break-words text-fg",
            titleLines !== "none" && cn(LINES[titleLines], DESK[titleLines], "@4xl/ws:block @4xl/ws:truncate"),
            one && "row-wide:block row-wide:max-w-[66%] row-wide:shrink-0 row-wide:truncate row-wide:text-sm",
            titleClassName,
          )}
        >
          {title}
        </div>
        {(shown(secondary) || shown(gist)) && (
          <div
            className={cn(
              "mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-fg-muted max-lg:@max-[40rem]/ws:flex-col max-lg:@max-[40rem]/ws:items-stretch max-lg:@max-[40rem]/ws:gap-0",
              one && "row-wide:mt-0 row-wide:flex-1",
            )}
          >
            {shown(secondary) && (
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 [&>*]:shrink-0 [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:truncate",
                  shown(gist) ? "max-w-[70%] shrink max-lg:@max-[40rem]/ws:max-w-none" : "flex-1",
                )}
              >
                {typeof secondary === "string" ? <span>{secondary}</span> : secondary}
              </div>
            )}
            {shown(secondary) && shown(gist) && (
              <span aria-hidden className="shrink-0 text-fg-subtle max-lg:@max-[40rem]/ws:hidden">
                —
              </span>
            )}
            {shown(gist) && (
              <div className="min-w-[5rem] flex-1 truncate max-lg:@max-[40rem]/ws:min-w-0 max-lg:@max-[40rem]/ws:line-clamp-1 max-lg:@max-[40rem]/ws:whitespace-normal touch:max-lg:@max-[40rem]/ws:line-clamp-2">
                {gist}
              </div>
            )}
          </div>
        )}
        {shown(snippet) && (
          <div className={cn("mt-1 max-w-[72ch] text-sm break-words text-fg-muted", snippetLines ? SNIPPET[snippetLines] : "line-clamp-2 touch:line-clamp-3")}>
            {snippet}
          </div>
        )}
      </div>
      {hasFact && (
        <div
          role="cell"
          className={cn(
            "tabular flex min-w-12 items-center justify-end gap-2 pl-1 text-sm whitespace-nowrap text-fg-muted touch:pt-0.5",
            !one && "row-wide:pt-0.5",
            prose && "pt-0.5",
          )}
        >
          {fact}
        </div>
      )}
      {hasActions && (
        <div
          role="cell"
          className="flex items-center gap-1 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 touch:-mt-1 touch:opacity-100"
        >
          {actions}
        </div>
      )}
    </Row>
  );
}

export function ListGroup({
  label,
  count,
  hint,
  lead,
  sticky = true,
  className,
}: {
  label: ReactNode;
  count?: number | undefined;
  hint?: ReactNode;
  lead?: ReactNode;
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      role="row"
      className={cn(
        "relative flex h-9 min-w-0 items-center gap-2 bg-subtle text-sm font-medium text-fg after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border/70 touch:h-10",
        lead && "h-10 touch:h-11",
        sticky && "sticky top-[var(--group-top,3rem)] z-10",
        X,
        className,
      )}
    >
      {lead}
      <span className="min-w-0 truncate">{label}</span>
      {count !== undefined && <span className="tabular shrink-0 font-normal text-fg-subtle">{count.toLocaleString()}</span>}
      {hint && <span className="shrink-0 font-normal text-fg-subtle">{hint}</span>}
    </div>
  );
}

export function ListNotice({
  tone = "neutral",
  icon,
  children,
  action,
}: {
  tone?: "neutral" | "warning";
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={cn("flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 text-sm text-fg", X)}
    >
      <div className="flex min-w-0 flex-1 basis-56 items-start gap-x-3">
        {icon && (
          <span
            className={cn(
              "flex h-[1lh] w-8 shrink-0 items-center justify-center row-wide:w-6 [&>svg]:size-4",
              tone === "warning" ? "[&>svg]:text-warning-text" : "[&>svg]:text-fg-subtle",
            )}
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">{children}</div>
      </div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

export function ListFooter({ center, className, ...props }: ComponentProps<"div"> & { center?: boolean }) {
  return (
    <div
      className={cn(
        "z-10 -mt-px flex min-h-11 shrink-0 items-center gap-3 border-t border-border bg-surface py-1.5 text-sm text-fg-muted lg:sticky lg:bottom-0",
        center ? "justify-center text-fg-subtle" : "justify-between",
        X,
        className,
      )}
      {...props}
    />
  );
}

const TONES = {
  neutral: "bg-subtle text-fg-muted",
  accent: "bg-accent-soft text-accent-text",
  warning: "bg-warning-soft text-warning-text",
  danger: "bg-danger-soft text-danger-text",
  info: "bg-info-soft text-info-text",
  success: "bg-success-soft text-success-text",
};
export function ListIcon({ icon, tone = "neutral", className }: { icon: LucideIcon | ReactNode; tone?: keyof typeof TONES; className?: string }) {
  const component = typeof icon === "function" || (typeof icon === "object" && icon !== null && !isValidElement(icon) && "render" in icon);
  const Icon = icon as LucideIcon;
  return (
    <span
      aria-hidden
      className={cn("tabular flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-semibold [&_svg]:size-4", TONES[tone], className)}
    >
      {component ? <Icon /> : icon}
    </span>
  );
}
