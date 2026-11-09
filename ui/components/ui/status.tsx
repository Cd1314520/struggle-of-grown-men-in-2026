import type { Status } from "../../../src/status";
import { cn } from "../../lib/cn";
import { STATUS, type Tone } from "../../lib/labels";

const DOT: Record<Tone, string> = {
  neutral: "bg-fg-subtle",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

export function StatusDot({ tone, pulse, className }: { tone: Tone; pulse?: boolean | undefined; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0", className)} aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-40", DOT[tone])} />}
      <span className={cn("relative inline-flex size-2 rounded-full", DOT[tone])} />
    </span>
  );
}

export function StatusLabel({ tone, label, pulse, className }: { tone: Tone; label: string; pulse?: boolean | undefined; className?: string | undefined }) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm whitespace-nowrap text-fg-muted", className)}>
      <StatusDot tone={tone} pulse={pulse} />
      {label}
    </span>
  );
}

export function JobStatus({ status, label, className }: { status: Status; label?: string | undefined; className?: string }) {
  const [text, tone] = STATUS[status];
  return <StatusLabel tone={tone} label={label ?? text} pulse={status === "filling" || status === "prepping"} className={className} />;
}
