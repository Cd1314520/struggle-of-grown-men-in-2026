import { useRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useEdgeFade } from "./tabs";

// A titled block inside the open job's panel (Why it fits, Details): an h2, with its count and actions centred on it.
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

// The sections of one page (Settings, Profile's files), in a WorkspaceBody's `nav` aside: from lg a list in
// that column, below lg a strip under the bar that scrolls sideways. The aside makes it sticky.
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
    <nav aria-label={label} className={cn("px-(--list-x) py-2 lg:px-3 lg:py-4", className)}>
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
                "flex min-h-8 shrink-0 flex-col justify-center rounded-md px-2.5 py-1.5 text-left text-sm font-medium whitespace-nowrap transition-colors touch:min-h-9 lg:whitespace-normal",
                on ? "bg-subtle text-fg" : "text-fg-muted hover:bg-subtle hover:text-fg",
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
