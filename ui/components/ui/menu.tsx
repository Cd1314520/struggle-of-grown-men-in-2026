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
        className={cn("z-50 min-w-44 animate-pop overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg", className)}
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
  children,
  ...props
}: ComponentProps<typeof M.Item> & { icon?: ReactNode; danger?: boolean; shortcut?: string }) {
  return (
    <M.Item
      className={cn(
        "flex h-8 cursor-pointer items-center touch:h-10 gap-2 rounded-md px-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-subtle [&_svg]:size-4",
        danger ? "text-danger-text data-[highlighted]:bg-danger-soft [&_svg]:text-danger-text" : "text-fg [&_svg]:text-fg-subtle",
        className,
      )}
      {...props}
    >
      {icon}
      <span className="flex-1">{children}</span>
      {shortcut && <span className="text-xs text-fg-subtle touch:hidden">{shortcut}</span>}
    </M.Item>
  );
}
export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => (
  <M.Label className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-subtle">{children}</M.Label>
);
