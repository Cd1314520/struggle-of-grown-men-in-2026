import { useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useEdgeFade } from "./tabs";

// The frame of a full-width page: a header with the title and its actions, then the content. The title
// sits 16px down, where a list pane's does (Review, Questions), so switching pages never moves it. Every
// page shares one frame, so its title sits at the same x too: `narrow` (a reading page: Activity,
// Settings, Setup) caps the content at 56rem on the left of that frame rather than centring a narrower one.
export function Page({ children, className, width = "default" }: { children: ReactNode; className?: string; width?: "default" | "narrow" | "full" }) {
  return (
    <div className={cn("mx-auto w-full px-4 pt-4 pb-24 sm:px-8 lg:pb-12", width === "full" ? "max-w-none" : "max-w-6xl", className)}>
      {width === "narrow" ? <div className="max-w-4xl">{children}</div> : children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  descriptionOnPhone = true,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  // A list page passes false: below lg it goes straight to its panel, under the top bar that names it.
  descriptionOnPhone?: boolean;
  className?: string;
  children?: ReactNode; // below the title row: stats
}) {
  // With nothing to show below lg (the title is for screen readers there), the header takes no room; on a
  // phone it also takes back the page's top padding and a pixel, so a full-bleed list panel starts on
  // the top bar's line.
  const bare = !descriptionOnPhone && !actions;
  return (
    <header className={cn("mb-6", bare && "max-lg:mb-0 max-sm:-mb-[calc(1rem+1px)]", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {/* The basis makes the actions wrap under the title on a phone rather than squeeze it. */}
        <div className="min-w-0 flex-1 basis-60">
          {/* A 32px line, so the title centres on the actions beside it and on a list pane's title row. Below lg
              the shell's top bar names the page, so the page leads with its description, as a list pane does. */}
          <h1 className="text-xl leading-8 font-semibold tracking-[-0.01em] text-fg max-lg:sr-only">{title}</h1>
          {/* A div, so a loading Skeleton can stand in for the line. */}
          {description && (
            <div className={cn("max-w-2xl text-sm text-fg-muted max-lg:min-h-8 max-lg:content-center lg:mt-0.5", !descriptionOnPhone && "max-lg:hidden")}>
              {description}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

// A titled block inside a page or panel: an h2 at a surface's size, with its count and actions centred on it.
export function Section({
  title,
  count,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  count?: number | undefined;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-6", className)}>
      <div className="mb-3">
        <div className="flex min-h-8 items-center gap-3">
          <h2 className="min-w-0 flex-1 text-lg font-semibold text-fg">
            {title}
            {count !== undefined && <span className="tabular ml-2 font-normal text-fg-subtle">{count.toLocaleString()}</span>}
          </h2>
          {actions}
        </div>
        {description && <p className="text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

// The heading of a group outside a list ("Misses", "On the form", a day in a job's activity). Inside a list
// the group is a ListGroup band.
export function Subhead({ children, count, className }: { children: ReactNode; count?: number | undefined; className?: string }) {
  return (
    <div className={cn("text-sm font-semibold text-fg", className)}>
      {children}
      {count !== undefined && <span className="tabular ml-1.5 font-normal text-fg-subtle">{count.toLocaleString()}</span>}
    </div>
  );
}

// The sections of one page (Settings, Profile's files). From lg a sticky list beside the content, the
// selected item looking like the sidebar's; below lg a strip under the top bar that scrolls sideways.
export interface SectionNavItem<K extends string> {
  key: K;
  label: ReactNode;
  hint?: ReactNode; // under the label, from lg: a file's gist
  tone?: "danger" | undefined; // the label in danger: a section with a problem
  href?: string | undefined; // a link rather than a button, where each item is a route (Profile's files)
}
export function SectionNav<K extends string>({
  label,
  items,
  value,
  onSelect,
  className,
}: {
  label: string;
  items: readonly SectionNavItem<K>[];
  value: K | null;
  onSelect?: (key: K) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useEdgeFade(ref);
  return (
    <nav
      aria-label={label}
      className={cn(
        "sticky top-12 z-20 -mx-4 bg-canvas/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8 lg:top-8 lg:z-auto lg:mx-0 lg:w-44 lg:shrink-0 lg:self-start lg:bg-transparent lg:p-0 lg:backdrop-blur-none",
        className,
      )}
    >
      <div ref={ref} style={fade} className="-mx-1 flex gap-1 overflow-x-auto px-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0">
        {items.map(item => {
          const on = item.key === value;
          const Item = item.href ? "a" : "button";
          return (
            <Item
              key={item.key}
              {...(item.href ? { href: item.href } : { type: "button" as const })}
              aria-current={on ? (item.href ? "page" : "true") : undefined}
              onClick={() => {
                onSelect?.(item.key);
              }}
              className={cn(
                "flex shrink-0 flex-col rounded-md px-2.5 py-1.5 text-left text-sm font-medium whitespace-nowrap transition-colors touch:min-h-9 lg:whitespace-normal",
                on ? "bg-surface text-fg shadow-xs ring-1 ring-border" : "text-fg-muted hover:bg-muted/70 hover:text-fg",
                item.tone === "danger" && "text-danger-text",
              )}
            >
              <span>{item.label}</span>
              {item.hint && <span className="hidden text-xs font-normal text-fg-muted lg:block">{item.hint}</span>}
            </Item>
          );
        })}
      </div>
    </nav>
  );
}

export const Separator = ({ className, vertical }: { className?: string; vertical?: boolean }) => (
  <div role="separator" className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />
);
