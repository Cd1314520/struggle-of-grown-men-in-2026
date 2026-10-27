import { cn } from "../../lib/cn";

// A count beside a navigation item or tab: a quiet number, as Linear's sidebar counts are, tinted when it
// waits on you. `badge`: a filled pill over an icon (the phone's tab bar), where a bare number would float.
export function Count({
  value,
  tone = "neutral",
  badge,
  className,
}: {
  value: number;
  tone?: "neutral" | "accent" | "warning";
  badge?: boolean;
  className?: string;
}) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "tabular inline-flex items-center justify-center text-xs font-medium",
        badge
          ? cn(
              "h-[18px] min-w-[18px] rounded-full px-1.5 text-2xs",
              tone === "accent" ? "bg-accent text-accent-fg" : tone === "warning" ? "bg-warning-soft text-warning-text" : "bg-muted text-fg-muted",
            )
          : tone === "accent"
            ? "text-accent-text"
            : tone === "warning"
              ? "text-warning-text"
              : "text-fg-subtle",
        className,
      )}
    >
      {value > 999 ? `${Math.floor(value / 1000)}k` : value}
    </span>
  );
}
