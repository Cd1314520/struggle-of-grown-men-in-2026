import { cn } from "../../lib/cn";

// A count beside a navigation item or tab.
export function Count({ value, tone = "neutral", className }: { value: number; tone?: "neutral" | "accent" | "warning"; className?: string }) {
  if (!value) return null;
  return (
    <span
      className={cn(
        "tabular inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-2xs font-medium",
        tone === "accent" ? "bg-accent text-accent-fg" : tone === "warning" ? "bg-warning-soft text-warning-text" : "bg-muted text-fg-muted",
        className,
      )}
    >
      {value > 999 ? `${Math.floor(value / 1000)}k` : value}
    </span>
  );
}
