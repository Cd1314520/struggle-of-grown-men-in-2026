// Lists of records: the one list system. A list fills its Workspace edge to edge (workspace.tsx: the bar,
// then the rows, then the footer), and every row is a ListRow: a lead (mark or icon), a title, one second
// line (the meta, then the gist behind a dash) and ONE fact at the right. No columns, no header row, at any
// width. Groups are small uppercase ListGroup labels. See docs/ui.md, "Lists".
import { isValidElement, type ComponentProps, type CSSProperties, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

// The gutter every row, group label, notice and footer shares: the Workspace sets it; outside one, 16px.
const X = "px-[var(--list-x,1rem)]";

// The grid tracks of a row: lead | body | fact | actions.
const LEAD = "2rem",
  BODY = "minmax(0,1fr)";
const tracks = (...t: (string | false | undefined)[]) => t.filter(Boolean).join(" ");
const shown = (n: ReactNode) => n !== undefined && n !== null && n !== false;

const LINES = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;
// With a mouse from lg every row is two lines, a list column too: the title takes one (the open record
// beside it, or the hover, shows the rest), the second line the other. On touch the title wraps.
const DESK = { 1: "", 2: "lg:line-clamp-1 touch:line-clamp-2", 3: "lg:line-clamp-1 touch:line-clamp-3" } as const;
const SNIPPET = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export type ListRowProps = Omit<ComponentProps<"a">, "title" | "ref"> & {
  href?: string; // a link row; without it the row is a div that holds links or buttons of its own
  selected?: boolean;
  lead?: ReactNode; // <CompanyMark> or <ListIcon>
  indent?: boolean; // keep the lead's room empty (rows under a company ListGroup)
  title: ReactNode;
  titleLines?: 1 | 2 | 3 | "none"; // on touch; default 2 (always one line from lg with a mouse). "none": the title clamps itself (a Clamp)
  titleClassName?: string; // e.g. font-normal, when the title is agent prose rather than a name
  secondary?: ReactNode; // the second line's meta, usually the company: its first child truncates
  gist?: ReactNode; // after the meta, behind a dash: the one thing that matters (the next step, the stage, the reason)
  snippet?: ReactNode; // prose rows only (blockers, questions, highlights), clamped
  snippetLines?: 2 | 3; // default 2 on a desktop, 3 on touch
  fact?: ReactNode; // ONE short fact at the right, ≤ 12 characters: "Asked 3d", "Waiting 6h", "Fit 88", "4h"
  actions?: ReactNode; // icon-sm buttons right of the fact, shown on hover (always on touch)
  dense?: boolean; // the log: one line on a desktop, two lines on touch
  cells?: readonly ReactNode[]; // a dense row only: its fixed-width leads before the title (the time, the kind)
  columns?: string; // a dense row only: those leads' widths, "4.5rem 8rem"
};

// No boxed lines: each row draws an inset hairline under itself, from the title's x to the window's edge.
const ROW =
  "group relative scroll-mt-12 scroll-mb-12 text-sm text-fg outline-none transition-colors after:pointer-events-none after:absolute after:right-0 after:bottom-0 after:h-px after:bg-border focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset";

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
  // A div when the row holds links of its own; typed as the link, whose props are a superset.
  const Row = (href ? "a" : "div") as "a";
  const link = href !== undefined;
  const frame = cn(
    ROW,
    link && "cursor-pointer hover:bg-subtle",
    selected && "bg-accent-soft/60 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent hover:bg-accent-soft/80",
  );
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
          "grid min-h-10 grid-cols-(--row) items-center gap-x-3 py-2 after:left-[var(--list-x,1rem)] touch:flex touch:flex-wrap touch:items-baseline touch:gap-x-3 touch:gap-y-0.5 touch:py-2.5",
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
  return (
    <Row
      role="row"
      href={href}
      aria-current={selected ? "true" : undefined}
      style={{ "--row": tracks(hasLead && LEAD, BODY, hasFact && "auto", hasActions && "auto"), ...style } as CSSProperties}
      className={cn(
        frame,
        "grid min-h-16 grid-cols-(--row) items-center gap-x-3 py-3 touch:min-h-[4.5rem] touch:items-start touch:py-3.5",
        // The hairline starts where the title does: past the 32px lead and its 12px gap.
        hasLead ? "after:left-[calc(var(--list-x,1rem)+2.75rem)]" : "after:left-[var(--list-x,1rem)]",
        X,
        className,
      )}
      {...props}
    >
      {hasLead && (
        <div role="cell" className="flex size-8 items-center justify-center touch:mt-0.5">
          {lead}
        </div>
      )}
      <div role="cell" className="min-w-0">
        <div
          title={tooltip}
          className={cn(
            "text-base font-medium break-words text-fg",
            titleLines !== "none" && cn(LINES[titleLines], DESK[titleLines], "@4xl/ws:line-clamp-1"),
            titleClassName,
          )}
        >
          {title}
        </div>
        {(shown(secondary) || shown(gist)) && (
          // One line, the meta then the gist, truncating; a list column too. Only a phone (under 40rem, below
          // lg) gives the gist a line of its own under the meta, rather than the two truncating to a word apiece.
          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-fg-muted max-lg:@max-[40rem]/ws:flex-col max-lg:@max-[40rem]/ws:items-stretch max-lg:@max-[40rem]/ws:gap-0">
            {shown(secondary) && (
              <div
                className={cn(
                  "flex min-w-0 items-center gap-2 [&>*]:shrink-0 [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:truncate",
                  shown(gist) ? "max-w-[45%] shrink-0 max-lg:@max-[40rem]/ws:max-w-none" : "flex-1",
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
              <div className="min-w-0 flex-1 truncate max-lg:@max-[40rem]/ws:line-clamp-1 max-lg:@max-[40rem]/ws:whitespace-normal touch:max-lg:@max-[40rem]/ws:line-clamp-2">
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
        // On touch it sits level with the title's first line.
        <div role="cell" className="tabular flex items-center gap-2 pl-1 text-sm whitespace-nowrap text-fg-muted touch:pt-0.5">
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

// A group label inside a list: a time band, an employer, a day. Small and uppercase on the sheet, no band.
// A row, so it reads as one ("Your move 6"). It sticks under the bar (`--group-top`, set by the Workspace).
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
  hint?: ReactNode; // after the count: "4 to review"
  lead?: ReactNode; // <CompanyMark size="sm"> over an employer's roles
  sticky?: boolean;
  className?: string;
}) {
  return (
    <div
      role="row"
      className={cn(
        "relative flex h-9 min-w-0 items-end gap-2 bg-surface/95 pb-1.5 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase backdrop-blur touch:h-10",
        lead && "h-11 touch:h-11",
        sticky && "sticky top-[var(--group-top,3rem)] z-10",
        X,
        className,
      )}
    >
      {lead}
      <span className={cn("min-w-0 truncate", lead && "pb-0.5")}>{label}</span>
      {count !== undefined && <span className={cn("tabular shrink-0 font-normal text-fg-subtle", lead && "pb-0.5")}>{count.toLocaleString()}</span>}
      {hint && <span className={cn("shrink-0 font-normal tracking-normal text-fg-subtle normal-case", lead && "pb-0.5")}>{hint}</span>}
    </div>
  );
}

// A one-line notice across the list, under the bar: "20 more wait on you in Pipeline →". Full bleed, no box.
export function ListNotice({
  tone = "neutral",
  icon,
  children,
  action,
}: {
  tone?: "neutral" | "warning";
  icon?: ReactNode;
  children: ReactNode;
  action?: ReactNode; // a Button variant="link" size="sm"
}) {
  return (
    <div
      role={tone === "warning" ? "alert" : "status"}
      className={cn(
        // Too long for one line on a phone, the action wraps to the right of a line of its own.
        "flex min-h-10 flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border py-2 text-sm text-fg [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "warning" ? "[&>svg]:text-warning-text" : "[&>svg]:text-fg-subtle",
        X,
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 basis-56">{children}</div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

// The slim line under a list's rows: pagination, "Load older", "That's everything". From lg it sticks to
// the bottom of the list's scroll.
export function ListFooter({ center, className, ...props }: ComponentProps<"div"> & { center?: boolean }) {
  return (
    <div
      className={cn(
        "z-10 flex min-h-11 shrink-0 items-center gap-3 border-t border-border bg-surface/95 py-1.5 text-sm text-fg-muted backdrop-blur lg:sticky lg:bottom-0",
        center ? "justify-center text-fg-subtle" : "justify-between",
        X,
        className,
      )}
      {...props}
    />
  );
}

// The one icon tile: 32px, a soft tone behind a glyph. Leads a row that has no employer.
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
