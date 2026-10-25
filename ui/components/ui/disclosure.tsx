import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

// Detail most people need only once ("How this works"), folded under a quiet one-line trigger.
// `id` keeps the open state across remounts for this visit.
const opened = new Set<string>();
export function Disclosure({ id, summary, children, className }: { id?: string; summary: ReactNode; children: ReactNode; className?: string }) {
  const [open, setOpen] = useState(() => (id ? opened.has(id) : false));
  return (
    <Collapsible.Root
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (id) {
          if (o) opened.add(id);
          else opened.delete(id);
        }
      }}
      className={className}
    >
      <Collapsible.Trigger className="group inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg touch:min-h-9">
        <ChevronRight className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
        {summary}
      </Collapsible.Trigger>
      <Collapsible.Content className={cn("mt-2 animate-in pl-[18px] text-sm text-fg-muted")}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
