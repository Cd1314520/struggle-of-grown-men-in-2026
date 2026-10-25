import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

// A surface that groups related content.
export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-xl border border-border bg-surface shadow-xs", className)} {...props} />;
}
export function CardHeader({ title, description, actions, className }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    // Actions wrap under the title when both don't fit, so a phone never squeezes the title.
    <div className={cn("flex flex-wrap items-start gap-x-3 gap-y-3 px-5 pt-4 pb-3", className)}>
      <div className="min-w-0 flex-1 basis-48">
        <h3 className="text-lg font-semibold text-fg">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}
export function CardFooter({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-2 border-t border-border px-5 py-3", className)} {...props} />;
}
