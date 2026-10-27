import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

const LINES = { 1: "line-clamp-1", 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 5: "line-clamp-5" };
const TOUCH = { 1: "touch:line-clamp-1", 2: "touch:line-clamp-2", 3: "touch:line-clamp-3", 4: "touch:line-clamp-4", 5: "touch:line-clamp-5" };

// Long agent text, a few lines at a time ("touchLines" on a phone, where a line holds less). "Show more"
// appears only when something was cut off. Not inside a link row: there the snippet clamps, and the
// whole text is one tap away.
export function Clamp({
  lines = 2,
  touchLines,
  children,
  className,
}: {
  lines?: keyof typeof LINES;
  touchLines?: keyof typeof LINES;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => {
      setCut(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const watch = new ResizeObserver(check);
    watch.observe(el);
    return () => {
      watch.disconnect();
    };
  }, [open, children]);
  return (
    <div>
      <div ref={ref} className={cn("break-words whitespace-pre-line", !open && [LINES[lines], touchLines && TOUCH[touchLines]], className)}>
        {children}
      </div>
      {(cut || open) && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="mt-1 text-sm font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
