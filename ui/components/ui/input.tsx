import { Search, X } from "lucide-react";
import { forwardRef, type ComponentProps } from "react";
import { cn } from "../../lib/cn";
import { Kbd } from "./kbd";

const field =
  "w-full rounded-md border border-border-strong bg-surface text-base text-fg shadow-xs transition-[border-color,box-shadow] outline-none placeholder:text-fg-subtle hover:border-fg-subtle/50 focus:border-accent focus:ring-3 focus:ring-accent/15 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-8 px-2.5 sm:text-sm touch:h-10 touch:text-base", className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentProps<"textarea">>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-20 resize-y px-2.5 py-2 leading-relaxed sm:text-sm touch:text-base", className)} {...props} />;
});

export const SearchInput = forwardRef<
  HTMLInputElement,
  Omit<ComponentProps<"input">, "onChange" | "value"> & { value: string; onValueChange: (v: string) => void; shortcut?: string }
>(function SearchInput({ className, value, onValueChange, shortcut = "/", ...props }, ref) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-subtle" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={e => {
          onValueChange(e.target.value);
        }}
        onKeyDown={e => {
          if (e.key === "Escape") {
            onValueChange("");
            e.currentTarget.blur();
          }
        }}
        className={cn(field, "h-8 pr-8 pl-8 sm:text-sm touch:h-10 touch:pr-10 touch:text-base [&::-webkit-search-cancel-button]:hidden")}
        {...props}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onValueChange("");
          }}
          className="absolute top-1/2 right-1.5 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm touch:size-8 text-fg-subtle hover:bg-subtle hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        shortcut && <Kbd className="pointer-events-none absolute top-1/2 right-2 hidden -translate-y-1/2 sm:inline-flex touch:hidden">{shortcut}</Kbd>
      )}
    </div>
  );
});

export function Label({ className, ...props }: ComponentProps<"label">) {
  return <label className={cn("text-sm font-medium text-fg", className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-sm font-medium text-fg">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}
