import { ChevronRight } from "lucide-react";
import { Collapsible } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

const opened = new Set<string>();
export function Disclosure({
  id,
  summary,
  inset = true,
  children,
  className,
}: {
  id?: string;
  summary: ReactNode;
  inset?: boolean;
  children: ReactNode;
  className?: string;
}) {
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
      <Collapsible.Content className={cn("mt-2 animate-in text-sm text-fg-muted", inset && "pl-[18px]")}>{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
