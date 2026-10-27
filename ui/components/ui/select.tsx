import { ArrowUpDown, Check, ChevronDown } from "lucide-react";
import { Select as S } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface Option<T extends string = string> {
  value: T;
  label: ReactNode;
}

// A compact select. `prefix` labels the trigger: "Sort: Newest". `collapse`: in a Workspace bar narrower
// than 80rem (a phone, a list column, a page in a window under ~1520px), the
// trigger keeps only an icon, and says the rest to screen readers.
export function Select<T extends string>({
  value,
  onValueChange,
  options,
  prefix,
  collapse,
  className,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: readonly Option<T>[];
  prefix?: string;
  collapse?: boolean;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const current = options.find(o => o.value === value)?.label;
  const name = ariaLabel ?? (collapse && prefix && typeof current === "string" ? `${prefix}: ${current}` : prefix);
  const wide = collapse && "@max-[80rem]/bar:hidden";
  return (
    <S.Root
      value={value}
      disabled={!!disabled}
      onValueChange={v => {
        onValueChange(v as T);
      }}
    >
      <S.Trigger
        aria-label={name}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-fg shadow-xs transition-[background-color,border-color,box-shadow] outline-none hover:border-border-strong hover:bg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/15 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-border-strong data-[state=open]:bg-subtle touch:h-10",
          collapse && "@max-[80rem]/bar:w-8 @max-[80rem]/bar:justify-center @max-[80rem]/bar:px-0 touch:@max-[80rem]/bar:w-10",
          className,
        )}
      >
        {collapse && <ArrowUpDown aria-hidden className="hidden size-4 text-fg-muted @max-[80rem]/bar:block" />}
        {prefix && <span className={cn("text-fg-subtle", wide)}>{prefix}</span>}
        <span className={cn("contents", wide)}>
          <S.Value />
        </span>
        <S.Icon className={cn(wide)}>
          <ChevronDown className="size-3.5 text-fg-subtle" />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 min-w-[var(--radix-select-trigger-width)] animate-pop overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg"
        >
          <S.Viewport>
            {options.map(o => (
              <S.Item
                key={o.value}
                value={o.value}
                className="relative flex h-8 cursor-pointer items-center rounded-md pr-8 pl-2 text-sm text-fg outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-subtle touch:h-10"
              >
                <S.ItemText>{o.label}</S.ItemText>
                <S.ItemIndicator className="absolute right-2">
                  <Check className="size-3.5 text-accent-text" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
