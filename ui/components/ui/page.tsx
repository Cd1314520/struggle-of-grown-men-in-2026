import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// The frame of a full-width page: a header with the title and its actions, then the content. The title
// sits 16px down, where a list pane's does (Review, Questions), so switching pages never moves it.
export function Page({ children, className, width = "default" }: { children: ReactNode; className?: string; width?: "default" | "narrow" | "full" }) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 pt-4 pb-24 sm:px-8 lg:pb-12",
        width === "narrow" ? "max-w-3xl" : width === "default" ? "max-w-6xl" : "max-w-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode; // below the title row: segments, toolbars
}) {
  return (
    <header className={cn("mb-6", className)}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        {/* The basis makes the actions wrap under the title on a phone rather than squeeze it. */}
        <div className="min-w-0 flex-1 basis-60">
          {/* A 32px line, so the title centres on the actions beside it and on a list pane's title row. Below lg
              the shell's top bar names the page, so the page leads with its description, as a list pane does. */}
          <h1 className="text-xl leading-8 font-semibold tracking-[-0.01em] text-fg max-lg:sr-only">{title}</h1>
          {/* A div, so a loading Skeleton can stand in for the line. */}
          {description && <div className="max-w-2xl text-sm text-fg-muted max-lg:min-h-8 max-lg:content-center lg:mt-0.5">{description}</div>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-5">{children}</div>}
    </header>
  );
}

// A titled block inside a page or panel.
export function Section({
  title,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-6", className)}>
      <div className="mb-3 flex items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

// A small uppercase heading over a group of rows.
export const Overline = ({ children, className }: { children: ReactNode; className?: string }) => (
  <div className={cn("text-xs font-medium tracking-wide text-fg-subtle uppercase", className)}>{children}</div>
);

export const Separator = ({ className, vertical }: { className?: string; vertical?: boolean }) => (
  <div role="separator" className={cn(vertical ? "w-px self-stretch bg-border" : "h-px w-full bg-border", className)} />
);
