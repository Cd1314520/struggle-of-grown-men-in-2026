import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

// What an empty list or page says: an icon, one line, an optional nudge and action. `md` on the sheet,
// under the bar; `sm` inside a section.
export function EmptyState({
  icon,
  title,
  description,
  action,
  size = "md",
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 text-center", sm ? "py-10" : "py-16", className)}>
      {icon && (
        <div
          className={cn(
            "flex items-center justify-center rounded-lg border border-border bg-surface text-fg-subtle shadow-xs",
            sm ? "mb-3 size-9 [&_svg]:size-4.5" : "mb-4 size-10 [&_svg]:size-5",
          )}
        >
          {icon}
        </div>
      )}
      <p className={cn("font-medium text-fg", sm ? "text-base" : "text-lg")}>{title}</p>
      {description && <p className={cn("mt-1 text-sm text-fg-muted", sm ? "max-w-64" : "max-w-sm")}>{description}</p>}
      {action && <div className={sm ? "mt-4" : "mt-5"}>{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--subtle)_0%,var(--muted)_50%,var(--subtle)_100%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

// Rows of placeholder while a list loads, shaped like ListRow: a mark, two lines and the fact, each with
// its inset hairline. `dense` is the log's one line; `lead={false}` drops the mark.
export function SkeletonRows({ rows = 8, dense, lead = true, className }: { rows?: number; dense?: boolean; lead?: boolean; className?: string }) {
  const mark = lead && !dense;
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={cn(
            "relative flex items-center gap-3 px-[var(--list-x,1rem)] after:absolute after:right-0 after:bottom-0 after:h-px after:bg-border",
            mark ? "after:left-[calc(var(--list-x,1rem)+2.75rem)]" : "after:left-[var(--list-x,1rem)]",
            dense ? "min-h-10 py-2" : "min-h-16 py-3 touch:min-h-[4.5rem]",
          )}
        >
          {mark && <Skeleton className="size-8 shrink-0 rounded-md" />}
          {dense ? (
            <Skeleton className="h-3 flex-1" />
          ) : (
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          )}
          {!dense && <Skeleton className="h-3.5 w-14" />}
        </div>
      ))}
    </div>
  );
}

// A notice across the top of a page or card. One sentence and an action.
export function Callout({
  tone = "neutral",
  icon,
  title,
  children,
  action,
  className,
}: {
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "border-border bg-subtle [&>svg]:text-fg-subtle",
    accent: "border-accent/20 bg-accent-soft [&>svg]:text-accent-text",
    warning: "border-warning/25 bg-warning-soft [&>svg]:text-warning-text",
    danger: "border-danger/20 bg-danger-soft [&>svg]:text-danger-text",
    success: "border-success/20 bg-success-soft [&>svg]:text-success-text",
  };
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      className={cn("flex items-start gap-3 rounded-lg border px-4 py-3 [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0", tones[tone], className)}
    >
      {icon}
      <div className="min-w-0 flex-1 text-sm text-fg">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title ? "mt-0.5 text-fg-muted" : "")}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
