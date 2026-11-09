import { Check } from "lucide-react";
import { DropdownMenu as M } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({ className, align = "end", ...props }: ComponentProps<typeof M.Content>) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className={cn("z-50 min-w-44 animate-pop overflow-hidden rounded-lg border border-border-strong bg-surface p-1 shadow-lg", className)}
        {...props}
      />
    </M.Portal>
  );
}

export function MenuItem({
  className,
  icon,
  danger,
  shortcut,
  count,
  checked,
  description,
  children,
  ...props
}: ComponentProps<typeof M.Item> & {
  icon?: ReactNode;
  danger?: boolean;
  shortcut?: string;
  count?: ReactNode;
  checked?: boolean;
  description?: ReactNode;
}) {
  return (
    <M.Item
      className={cn(
        "flex cursor-pointer items-center gap-2",
        description ? "items-start py-1.5 [&>svg]:mt-0.5" : "h-8 touch:h-10",
        "rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&>svg]:size-4",
        danger ? "text-danger-text data-[highlighted]:bg-danger-soft [&>svg]:text-danger-text" : "text-fg [&>svg]:text-fg-subtle",
        className,
      )}
      {...props}
    >
      {icon}
      {description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span>{children}</span>
          <span className="text-sm text-fg-muted">{description}</span>
        </span>
      ) : (
        <span className="flex-1">{children}</span>
      )}
      {count !== undefined && <span className="tabular text-xs text-fg-subtle">{count}</span>}
      {shortcut && <span className="text-xs text-fg-subtle touch:hidden">{shortcut}</span>}
      {checked !== undefined && <Check aria-hidden className={cn("size-3.5 shrink-0 text-accent-text", !checked && "invisible")} />}
    </M.Item>
  );
}
export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-subtle">{children}</M.Label>
);
