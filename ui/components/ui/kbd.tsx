import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Kbd({ className, size = "md", ...props }: ComponentProps<"kbd"> & { size?: "sm" | "md" }) {
  return (
    <kbd
      className={cn(
        "inline-flex items-center justify-center rounded-sm border border-border bg-surface font-sans font-medium text-fg-muted shadow-[0_1px_0_var(--border)]",
        size === "sm" ? "h-4 min-w-4 px-1 text-2xs" : "h-5 min-w-5 px-1.5 text-2xs",
        className,
      )}
      {...props}
    />
  );
}
