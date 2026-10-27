import { Tooltip as T } from "radix-ui";
import type { ReactNode } from "react";
import { Kbd } from "./kbd";

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <T.Provider delayDuration={350} skipDelayDuration={150}>
    {children}
  </T.Provider>
);

// Wraps one focusable element. Keep the text short; it is a hint, never the only place something is said.
export function Tooltip({
  content,
  shortcut,
  side = "top",
  children,
}: {
  content: ReactNode;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: ReactNode;
}) {
  if (!content) return children;
  return (
    <T.Root>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="z-50 flex max-w-xs animate-in items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-fg shadow-md select-none"
        >
          {content}
          {shortcut && <Kbd size="sm">{shortcut}</Kbd>}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
