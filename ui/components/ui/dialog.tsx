import { X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export const Dialog = D.Root;

type AutoFocus = ((e: Event) => void) | undefined;
// Dialogs here open from state (a shortcut, a menu item, a button elsewhere), not a Radix trigger, so
// Radix has nowhere to put focus back on close: remember what had it on open and return there.
export function useReturnFocus(onOpen?: AutoFocus, onClose?: AutoFocus) {
  const from = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: (e: Event) => {
      const el = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // A menu item goes away with its menu: its trigger takes focus back instead.
      const menu = el?.closest("[role=menu]")?.getAttribute("aria-labelledby");
      from.current = menu ? document.getElementById(menu) : el;
      onOpen?.(e);
    },
    onCloseAutoFocus: (e: Event) => {
      onClose?.(e);
      if (e.defaultPrevented || !from.current?.isConnected) return;
      e.preventDefault();
      from.current.focus({ preventScroll: true });
    },
  };
}

// A dialog: title and description, the content, then the buttons in a band along the foot (Cancel as
// `secondary`, then the one primary action). ConfirmDialog is built on it, so every dialog reads alike.
export function DialogContent({
  title,
  description,
  children,
  className,
  footer,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof D.Content> & { title: ReactNode; description?: ReactNode; footer?: ReactNode }) {
  const focus = useReturnFocus(onOpenAutoFocus, onCloseAutoFocus);
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 animate-in bg-overlay backdrop-blur-[2px]" />
      <D.Content
        className={cn(
          "fixed top-[12vh] left-1/2 z-50 flex max-h-[80vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 animate-pop flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none",
          className,
        )}
        {...props}
        {...focus}
      >
        <div className={cn("flex items-start gap-4 px-5 pt-5", children ? "pb-4" : "pb-5")}>
          <div className="min-w-0 flex-1">
            <D.Title className="text-lg font-semibold text-fg">{title}</D.Title>
            {/* A div, so a description can hold paragraphs of its own. */}
            <D.Description asChild className={cn(!description && "sr-only", "mt-1 text-sm text-fg-muted")}>
              <div>{description ?? title}</div>
            </D.Description>
          </div>
          <D.Close
            className="-mt-1 -mr-2 flex size-7 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-subtle hover:text-fg touch:size-9"
            aria-label="Close"
          >
            <X className="size-4" />
          </D.Close>
        </div>
        {children && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>}
        {footer && <div className="flex items-center justify-end gap-2 border-t border-border bg-subtle/60 px-5 py-3">{footer}</div>}
      </D.Content>
    </D.Portal>
  );
}

// A panel that slides in from the side (or up from the bottom on a phone): the open job on small screens, the mobile menu.
export function Sheet({
  open,
  onOpenChange,
  side = "right",
  title,
  children,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  side?: "right" | "left";
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const focus = useReturnFocus();
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-in bg-overlay" />
        <D.Content
          {...focus}
          className={cn(
            "fixed inset-y-0 z-50 flex w-full flex-col bg-surface shadow-lg outline-none",
            side === "right" ? "right-0 max-w-2xl animate-slide-left border-l" : "left-0 max-w-[280px] border-r",
            className,
          )}
        >
          <D.Title className="sr-only">{title}</D.Title>
          <D.Description className="sr-only">{title}</D.Description>
          {children}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// Confirmation before something that cannot be undone. Resolves through the buttons it renders.
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirm,
  danger,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirm: string;
  danger?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const confirmButton = useRef<HTMLButtonElement>(null),
    cancelButton = useRef<HTMLButtonElement>(null);
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <DialogContent
        role="alertdialog"
        title={title}
        description={description}
        className="max-w-md"
        // Focus lands on the confirm button, or on Cancel when confirming destroys something, so a stray
        // Enter is harmless. Set here rather than with autoFocus, which would move it before the opener is recorded.
        onOpenAutoFocus={e => {
          e.preventDefault();
          (danger ? cancelButton : confirmButton).current?.focus();
        }}
        footer={
          <>
            <D.Close asChild>
              <Button ref={cancelButton}>Cancel</Button>
            </D.Close>
            <Button
              ref={confirmButton}
              variant={danger ? "danger" : "primary"}
              onClick={() => {
                onConfirm();
                onOpenChange(false);
              }}
            >
              {confirm}
            </Button>
          </>
        }
      >
        {children}
      </DialogContent>
    </D.Root>
  );
}
