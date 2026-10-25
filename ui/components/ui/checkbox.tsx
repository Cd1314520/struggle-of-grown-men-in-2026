import { Check } from "lucide-react";
import { Checkbox as C, Switch as S } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../../lib/cn";

export function Checkbox({ className, ...props }: ComponentProps<typeof C.Root>) {
  return (
    <C.Root
      className={cn(
        "peer flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong bg-surface shadow-xs transition-colors hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-fg",
        className,
      )}
      {...props}
    >
      <C.Indicator>
        <Check className="size-3" strokeWidth={3} />
      </C.Indicator>
    </C.Root>
  );
}

export function Switch({ className, ...props }: ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent bg-muted transition-colors hover:bg-border-strong disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent data-[state=checked]:hover:bg-accent-hover",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0.5" />
    </S.Root>
  );
}
