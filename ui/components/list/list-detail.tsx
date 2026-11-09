import { useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { useMedia, WIDE } from "../../lib/media";

const TABBABLE = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]";
const tabbables = (root: HTMLElement | null) =>
  [...(root?.querySelectorAll<HTMLElement>(TABBABLE) ?? [])].filter(el => el.tabIndex >= 0 && el.checkVisibility());
const ROW = "a[role=row]";

export const COLUMN = "lg:w-[380px] lg:shrink-0 lg:border-r lg:border-border lg:bg-surface xl:w-[440px] 2xl:w-[500px]";

export function ListDetail({
  layout,
  children,
  detail,
  open,
  empty,
  label,
  onListClick,
}: {
  layout: "column" | "split";
  children: ReactNode;
  detail: ReactNode;
  open: boolean;
  empty?: ReactNode;
  label: string;
  onListClick?: ((ev: MouseEvent) => void) | undefined;
}) {
  const wide = useMedia(WIDE);
  const column = layout === "column" || open;
  const body = layout === "column" && wide ? (detail ?? empty) : open && detail;
  const list = useRef<HTMLDivElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const hop = (ev: KeyboardEvent, to: HTMLElement | null | undefined) => {
    if (!to) return;
    ev.preventDefault();
    to.focus();
  };
  return (
    <div className="lg:flex lg:h-(--app-h)">
      <div
        ref={list}
        onKeyDown={ev => {
          if (ev.key === "Tab" && !ev.shiftKey && ev.target instanceof Element && ev.target.matches(ROW)) hop(ev, tabbables(panel.current)[0]);
        }}
        onClick={onListClick}
        className={cn("min-w-0 lg:h-full lg:scroll-pb-16 lg:overflow-y-auto", column ? COLUMN : "lg:flex-1")}
      >
        {children}
      </div>
      {body && (
        <div
          ref={panel}
          role="region"
          aria-label={label}
          onKeyDown={ev => {
            if (ev.key === "Tab" && ev.shiftKey && ev.target === tabbables(panel.current)[0])
              hop(ev, list.current?.querySelector<HTMLElement>(`${ROW}:not([tabindex="-1"])`));
          }}
          className={cn(
            "fixed inset-0 z-50 flex animate-slide-left flex-col overscroll-contain bg-surface pb-[env(safe-area-inset-bottom)] lg:pb-0",
            "lg:static lg:z-auto lg:h-full lg:min-w-0 lg:flex-1 lg:animate-in",
          )}
        >
          {body}
        </div>
      )}
    </div>
  );
}
