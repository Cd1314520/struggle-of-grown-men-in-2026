// Lists of records: the one list system. Every set of rows sits in a ListPanel (a titled surface with its
// count, toolbar, rows and footer), and every row is a ListRow: a lead (mark or icon), a body (title, one
// secondary line, a prose snippet) and a trail of at most two short facts. A row grows fact cells, under a
// ListColumns header, only when its panel is at least 56rem wide (`@4xl/list`); below that, which is
// every phone and every list beside an open record, the same row stacks. See docs/ui.md, "Lists".
import { isValidElement, useId, type ComponentProps, type CSSProperties, type ElementType, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/cn";

// Content that changes place with the panel's width: a reason in the snippet when narrow, in a cell when wide.
export const Narrow = ({ children }: { children: ReactNode }) => <span className="contents @4xl/list:hidden">{children}</span>;
export const Wide = ({ children }: { children: ReactNode }) => <span className="hidden @4xl/list:contents">{children}</span>;

// The gutter every row, header, toolbar and footer shares, and the radius the last of them rounds to.
// Children read them as px-(--list-x); outside a panel they fall back to 16px and square corners.
const X = "px-[var(--list-x,1rem)]";
const LAST = "last:rounded-b-[var(--list-r,0)]";
const FRAME = {
  page: "rounded-xl border border-border bg-surface shadow-xs [--list-r:calc(var(--radius-xl)-1px)] [--list-x:1rem] sm:[--list-x:1.25rem] max-sm:-mx-4 max-sm:rounded-none max-sm:border-x-0 max-sm:shadow-none max-sm:[--list-r:0]",
  card: "rounded-xl border border-border bg-surface shadow-xs [--list-r:calc(var(--radius-xl)-1px)] [--list-x:1rem] sm:[--list-x:1.25rem]",
  // The list beside an open record. From lg it fills the column: the header stays, the rows scroll, the
  // footer is pinned. Below lg it is the page (the shell's tab bar takes the last 72px).
  column: "bg-surface [--list-x:1rem] pb-24 max-lg:min-h-[calc(100dvh-3rem)] lg:flex lg:h-full lg:flex-col lg:pb-0",
};

export function ListPanel({
  frame = "page",
  title,
  titleAs,
  count,
  noun,
  description,
  tabs,
  actions,
  toolbar,
  notice,
  columns,
  footer,
  loading,
  bodyRole = "table",
  bodyLabel,
  className,
  children,
  "aria-label": ariaLabel,
  "aria-rowcount": rowCount,
}: {
  frame?: "page" | "column" | "card";
  title?: ReactNode; // the surface's name: h1 in "column", h2 otherwise
  titleAs?: "h1" | "h2" | "h3";
  count?: number | undefined; // beside the title; undefined while loading
  noun?: string; // "column" below lg, where the title is for screen readers only: "334 waiting for you"
  description?: ReactNode; // one line under the title
  tabs?: ReactNode; // a <TabsList> heading the panel in place of the title (inside the page's <Tabs>)
  actions?: ReactNode; // right of the title or tabs: a ⋯ menu, "View all", "Check again"
  toolbar?: ReactNode; // a <ListToolbar>
  notice?: ReactNode; // a <ListNotice>, under the toolbar
  columns?: ReactNode; // a <ListColumns>, shown only when the panel is wide
  footer?: ReactNode; // <Pagination variant="footer"> or <ListFooter>
  loading?: boolean; // placeholder data on screen: the rows dim until the real page arrives
  bodyRole?: "table" | "list" | "none"; // "none": the children bring their own (Questions' nav)
  bodyLabel?: string; // the table's name: "Queue", "Held jobs"
  className?: string;
  children: ReactNode; // ListRow / ListGroup, or EmptyState / NoMatch / SkeletonRows
  "aria-label"?: string; // names the section; otherwise its title does
  "aria-rowcount"?: number | undefined;
}) {
  const id = useId();
  const col = frame === "column";
  const Title: ElementType = titleAs ?? (col ? "h1" : "h2");
  const head = title !== undefined || count !== undefined || !!actions;
  const named = !ariaLabel && title !== undefined && !tabs;
  const countText = count !== undefined && (
    <span className={cn("tabular font-normal", col ? "text-sm text-fg-muted lg:text-xl lg:text-fg-subtle" : "text-lg text-fg-subtle")}>
      {count.toLocaleString()}
      {col && noun && <span className="lg:hidden"> {noun}</span>}
    </span>
  );
  return (
    <section aria-label={ariaLabel} aria-labelledby={named ? id : undefined} className={cn("@container/list flex min-w-0 flex-col", FRAME[frame], className)}>
      {(head || tabs || toolbar || notice) && (
        <div className={cn("shrink-0", (!tabs || toolbar || notice) && "border-b border-border")}>
          {tabs ? (
            <div className={cn("flex items-end gap-3 border-b border-border [&_[role=tablist]]:min-w-0 [&_[role=tablist]]:border-b-0", X, "pt-1")}>
              {tabs}
              {actions && <div className="mb-1.5 ml-auto flex shrink-0 items-center gap-1.5 self-center">{actions}</div>}
            </div>
          ) : (
            head && (
              <div className={cn("flex min-h-8 items-start gap-3 pb-3", X, col ? "pt-4" : "pt-3 sm:pt-4")}>
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-8 items-center gap-2">
                    {title !== undefined && (
                      <Title id={id} className={cn("min-w-0 truncate font-semibold text-fg", col ? "text-xl tracking-[-0.01em] max-lg:sr-only" : "text-lg")}>
                        {title}
                      </Title>
                    )}
                    {countText}
                  </div>
                  {description && <div className="max-w-2xl text-sm text-fg-muted">{description}</div>}
                </div>
                {actions && <div className="flex min-h-8 shrink-0 items-center gap-1.5">{actions}</div>}
              </div>
            )
          )}
          {toolbar && <div className={cn((tabs || !head) && "pt-3")}>{toolbar}</div>}
          {notice}
        </div>
      )}
      <div
        role={bodyRole === "none" ? undefined : bodyRole}
        aria-label={bodyLabel}
        aria-rowcount={rowCount}
        className={cn(
          // Up over the header's line, so the first row's top border is that line and nothing doubles.
          "-mt-px min-w-0",
          col ? "lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:scroll-pb-4" : cn("overflow-clip", LAST),
          loading && "opacity-60 transition-opacity",
        )}
      >
        {columns}
        {children}
      </div>
      {footer}
    </section>
  );
}

// Search, quick filters, sort and segments, attached under the panel's title. Narrow (every phone and
// list column): the search and controls, then the segments under them. Wide: one row, segments left,
// search and controls always right.
export function ListToolbar({ search, controls, segments, className }: { search?: ReactNode; controls?: ReactNode; segments?: ReactNode; className?: string }) {
  return (
    <div className={cn("@container/toolbar pb-3", X, className)}>
      <div className="flex flex-col gap-2.5 @3xl/toolbar:flex-row @3xl/toolbar:items-center @3xl/toolbar:gap-4">
        {(search || controls) && (
          <div className="flex min-w-0 items-center gap-2 @3xl/toolbar:order-2 @3xl/toolbar:ml-auto">
            {search && <div className="min-w-0 flex-1 @3xl/toolbar:w-64 @3xl/toolbar:flex-none">{search}</div>}
            {controls}
          </div>
        )}
        {/* The segments' own box reaches 4px past the gutter, so a selected segment's ring is never clipped. */}
        {segments && <div className="min-w-0 @3xl/toolbar:order-1 @3xl/toolbar:flex-1 [&>*]:-mx-1 [&>*]:px-1">{segments}</div>}
      </div>
    </div>
  );
}

// The grid tracks of a row: lead | body | (cells, wide only) | trail. ListColumns builds the same.
const LEAD = "2rem",
  BODY = "minmax(0,1fr)",
  TRAIL = "4rem"; // fixed when wide, so the cells line up under their header
const tracks = (...t: (string | false | undefined)[]) => t.filter(Boolean).join(" ");

const LINES = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3" } as const;
const SNIPPET = { 2: "line-clamp-2", 3: "line-clamp-3" } as const;

export type ListRowProps = Omit<ComponentProps<"a">, "title" | "ref"> & {
  href?: string; // a link row; without it the row is a div that holds links or buttons of its own
  selected?: boolean;
  lead?: ReactNode; // <CompanyMark> or <ListIcon>
  indent?: boolean; // keep the lead's room empty (rows under a company ListGroup)
  title: ReactNode;
  titleLines?: 1 | 2 | 3 | "none"; // when stacked; default 2. "none": the title clamps itself (a Clamp)
  titleClassName?: string; // e.g. font-normal, when the title is agent prose rather than a name
  secondary?: ReactNode; // one line: the first child truncates, the others keep their width
  snippet?: ReactNode; // prose, clamped; a <Narrow> snippet leaves wide rows altogether
  snippetLines?: 2 | 3; // default 2 on a desktop, 3 on touch
  trail?: ReactNode; // at most two short facts (≤ 6 characters), stacked, right-aligned
  cells?: readonly ReactNode[]; // fact cells, wide only (always, in a dense row)
  columns?: string; // the cells' tracks, shared with ListColumns: "minmax(0,1.2fr) 180px 72px"
  dense?: boolean; // the log: one line of cells then the message on a desktop, two lines on touch
};

const ROW =
  "group relative scroll-mt-10 scroll-mb-4 border-t border-border text-sm text-fg outline-none transition-colors focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset";

export function ListRow({
  href,
  selected,
  lead,
  indent,
  title,
  titleLines = 2,
  titleClassName,
  secondary,
  snippet,
  snippetLines,
  trail,
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
    link && "cursor-pointer hover:bg-subtle/70",
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
          "grid min-h-10 grid-cols-(--row) items-center gap-x-4 py-2 touch:flex touch:flex-wrap touch:items-baseline touch:gap-x-3 touch:gap-y-0.5 touch:py-2.5",
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
  const hasTrail = trail !== undefined && trail !== null && trail !== false;
  const wide = cells?.length ? tracks(hasLead && LEAD, BODY, columns, hasTrail && TRAIL) : undefined;
  const narrowSnippet = isValidElement(snippet) && snippet.type === Narrow;
  return (
    <Row
      role="row"
      href={href}
      aria-current={selected ? "true" : undefined}
      style={{ "--row": tracks(hasLead && LEAD, BODY, hasTrail && "auto"), ...(wide && { "--row-wide": wide }), ...style } as CSSProperties}
      className={cn(
        frame,
        "grid min-h-14 grid-cols-(--row) items-start gap-x-3 py-3 touch:min-h-16 touch:py-3.5",
        wide && "@4xl/list:grid-cols-(--row-wide) @4xl/list:items-center @4xl/list:gap-x-4",
        X,
        className,
      )}
      {...props}
    >
      {hasLead && (
        <div role="cell" className="mt-0.5 flex size-8 items-center justify-center self-start">
          {lead}
        </div>
      )}
      <div role="cell" className="min-w-0">
        <div
          title={tooltip}
          className={cn("text-base font-medium break-words text-fg", titleLines !== "none" && cn(LINES[titleLines], "@4xl/list:line-clamp-1"), titleClassName)}
        >
          {title}
        </div>
        {secondary !== undefined && secondary !== null && secondary !== false && (
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-sm text-fg-muted [&>*]:shrink-0 [&>:first-child]:min-w-0 [&>:first-child]:shrink [&>:first-child]:truncate">
            {typeof secondary === "string" ? <span>{secondary}</span> : secondary}
          </div>
        )}
        {snippet !== undefined && snippet !== null && snippet !== false && (
          <div
            className={cn(
              "mt-1 text-sm break-words text-fg-muted",
              snippetLines ? SNIPPET[snippetLines] : "line-clamp-2 touch:line-clamp-3",
              narrowSnippet && "@4xl/list:hidden",
            )}
          >
            {snippet}
          </div>
        )}
      </div>
      {cells?.map((c, i) => (
        <div key={i} role="cell" className="hidden min-w-0 text-sm text-fg-muted @4xl/list:block">
          {c}
        </div>
      ))}
      {hasTrail && (
        // The first fact reads in text-fg at zero specificity, so a fact that colours itself (Score) keeps its tone.
        <div
          role="cell"
          className="tabular flex flex-col items-end gap-0.5 self-start pt-0.5 text-sm text-fg-muted [:where(&>:first-child)]:text-fg @4xl/list:self-center @4xl/list:pt-0"
        >
          {trail}
        </div>
      )}
    </Row>
  );
}

// The header over a wide list's cells. A list has one if and only if it shows cells.
export function ListColumns({
  columns,
  lead,
  label,
  cells,
  trail,
  dense,
}: {
  columns: string; // the same string the rows get
  lead?: boolean; // the rows have a lead: the label starts over it
  label: ReactNode; // over the body: "Role", "Application"
  cells: readonly ReactNode[];
  trail?: ReactNode; // "Fit"
  dense?: boolean; // over dense rows: cells first, then the label; hidden on touch rather than when narrow
}) {
  const head = "min-w-0 truncate";
  return (
    <div
      role="row"
      style={{ "--row": dense ? tracks(columns, BODY) : tracks(lead && LEAD, BODY, columns, trail !== undefined && TRAIL) } as CSSProperties}
      className={cn(
        "h-9 grid-cols-(--row) items-center gap-x-4 border-t border-border bg-subtle/60 text-xs font-medium text-fg-muted",
        dense ? "grid touch:hidden" : "hidden @4xl/list:grid",
        X,
      )}
    >
      {dense &&
        cells.map((c, i) => (
          <div key={i} role="columnheader" className={head}>
            {c}
          </div>
        ))}
      <div role="columnheader" className={cn(head, lead && !dense && "col-span-2")}>
        {label}
      </div>
      {!dense &&
        cells.map((c, i) => (
          <div key={i} role="columnheader" className={head}>
            {c}
          </div>
        ))}
      {!dense && trail !== undefined && (
        <div role="columnheader" className={cn(head, "text-right")}>
          {trail}
        </div>
      )}
    </div>
  );
}

// A group heading inside a list: a time band, an employer, a day. A row, so it reads as one ("Today 3").
// Sticky under the phone's top bar, or at the top of the list's own scroll from lg.
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
        // Its bottom line lies over the next row's top one, so the band has a line under it while stuck.
        "relative -mb-px flex h-9 min-w-0 items-center gap-2 border-y border-border bg-subtle text-sm font-semibold text-fg touch:h-10",
        sticky && "sticky top-[calc(3rem-1px)] z-10 lg:top-0",
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

// A one-line notice in the panel's header, under the toolbar: "20 more wait on you in Pipeline →".
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
        "mx-[var(--list-x,1rem)] mb-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-md bg-subtle px-3 py-2 text-sm text-fg [&>svg]:size-4 [&>svg]:shrink-0",
        tone === "warning" ? "[&>svg]:text-warning-text" : "[&>svg]:text-fg-subtle",
      )}
    >
      {icon}
      <div className="min-w-0 flex-1 basis-56">{children}</div>
      {action && <div className="ml-auto shrink-0">{action}</div>}
    </div>
  );
}

// The band under a list's rows: pagination, "Load older", "That's everything".
export function ListFooter({ center, className, ...props }: ComponentProps<"div"> & { center?: boolean }) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-3 border-t border-border bg-surface py-2.5 text-sm text-fg-muted",
        center ? "justify-center" : "justify-between",
        X,
        LAST,
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
