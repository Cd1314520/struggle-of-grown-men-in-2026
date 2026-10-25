import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

const LINES = { 2: "line-clamp-2", 3: "line-clamp-3", 4: "line-clamp-4", 5: "line-clamp-5" };

// Long agent text, a few lines at a time. "Show more" appears only when something is cut off.
export function Clamp({ lines, children, className }: { lines: keyof typeof LINES; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null);
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
      <p ref={ref} className={cn("break-words whitespace-pre-line", !open && LINES[lines], className)}>
        {children}
      </p>
      {(cut || open) && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="mt-1 text-sm font-medium text-accent-text hover:underline touch:-my-2 touch:py-2"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
