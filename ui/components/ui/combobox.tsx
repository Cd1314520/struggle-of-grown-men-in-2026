import { Command } from "cmdk";
import { Check, ChevronsUpDown, CornerDownLeft } from "lucide-react";
import { Popover } from "radix-ui";
import { useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";

export interface ComboOption {
  value: string;
  label: string;
  hint?: ReactNode;
  group?: string;
  selected?: string;
}

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder = "Choose…",
  search = "Search…",
  empty = "Nothing matches",
  custom,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (v: string) => void;
  options: readonly ComboOption[];
  placeholder?: string;
  search?: string;
  empty?: string;
  custom?: (typed: string) => string;
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find(o => o.value === value);
  const groups = [...new Set(options.map(o => o.group ?? ""))];
  const typed = q.trim();
  const pick = (v: string) => {
    setOpen(false);
    setQ("");
    if (v !== value) onValueChange(v);
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={o => {
        setOpen(o);
        if (!o) setQ("");
      }}
    >
      <Popover.Trigger
        disabled={!!disabled}
        aria-label={ariaLabel}
        className={cn(
          "inline-flex h-8 min-w-0 items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-sm text-fg shadow-xs transition-[background-color,border-color,box-shadow] outline-none hover:border-fg-subtle/50 hover:bg-subtle focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/15 disabled:pointer-events-none disabled:opacity-50 data-[state=open]:border-border-strong data-[state=open]:bg-subtle touch:h-10",
          className,
        )}
      >
        <span className={cn("min-w-0 flex-1 truncate text-left", !current && !value && "text-fg-subtle")}>
          {current ? (current.selected ?? current.label) : value || placeholder}
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 text-fg-subtle" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          className="z-50 w-[min(26rem,calc(100vw-1rem))] animate-pop overflow-hidden rounded-lg border border-border-strong bg-surface shadow-lg"
        >
          <Command loop>
            <Command.Input
              value={q}
              onValueChange={setQ}
              placeholder={search}
              className="h-10 w-full border-b border-border bg-transparent px-3 text-base text-fg outline-none placeholder:text-fg-subtle sm:text-sm touch:h-11 touch:text-lg"
            />
            <Command.List className="max-h-[min(22rem,50dvh)] overflow-y-auto overscroll-contain p-1">
              <Command.Empty className="px-3 py-6 text-center text-sm text-fg-muted">{empty}</Command.Empty>
              {groups.map(g => (
                <Command.Group
                  key={g}
                  heading={g || undefined}
                  className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle"
                >
                  {options
                    .filter(o => (o.group ?? "") === g)
                    .map(o => (
                      <Command.Item
                        key={o.value}
                        value={`${o.label} ${o.value} ${o.group ?? ""}`}
                        onSelect={() => {
                          pick(o.value);
                        }}
                        className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none data-[selected=true]:bg-muted touch:h-10"
                      >
                        <Check className={cn("size-3.5 shrink-0 text-accent-text", o.value !== value && "invisible")} />
                        <span className="min-w-0 flex-1 truncate">{o.label}</span>
                        {o.hint && <span className="shrink-0 text-xs text-fg-subtle tabular">{o.hint}</span>}
                      </Command.Item>
                    ))}
                </Command.Group>
              ))}
              {custom && typed && !options.some(o => o.value === typed) && (
                <Command.Item
                  value={`custom ${typed}`}
                  forceMount
                  onSelect={() => {
                    pick(typed);
                  }}
                  className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-fg outline-none select-none data-[selected=true]:bg-muted touch:h-10"
                >
                  <CornerDownLeft className="size-3.5 shrink-0 text-fg-subtle" />
                  <span className="min-w-0 flex-1 truncate">{custom(typed)}</span>
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
