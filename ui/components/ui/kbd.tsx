import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Kbd({ className, size = "md", ...props }: ComponentProps<"kbd"> & { size?: "sm" | "md" }) {
  return (
    <kbd
      className={cn(
        // A key hint means nothing to a finger.
        "inline-flex items-center justify-center rounded-sm touch:hidden border border-border/60 bg-muted font-sans font-medium text-fg-muted",
        size === "sm" ? "h-4 min-w-4 px-1 text-2xs" : "h-5 min-w-5 px-1.5 text-2xs",
        className,
      )}
      {...props}
    />
  );
}
