import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Kbd } from "./kbd";
import { Spinner } from "./spinner";

const buttonVariants = cva(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-[background-color,border-color,color,box-shadow,opacity] duration-100 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Disabled, the primary goes grey rather than a washed-out accent: it reads as not yet, not as faint.
        primary: "bg-accent text-accent-fg shadow-xs hover:bg-accent-hover disabled:bg-muted disabled:text-fg-subtle disabled:shadow-none disabled:opacity-100",
        secondary: "border border-border bg-surface text-fg shadow-xs hover:border-border-strong hover:bg-subtle active:bg-muted",
        ghost: "text-fg-muted hover:bg-subtle hover:text-fg active:bg-muted",
        danger: "bg-danger text-white shadow-xs hover:opacity-90",
        "danger-ghost": "text-danger-text hover:bg-danger-soft",
        link: "h-auto px-0 text-accent-text hover:underline underline-offset-2",
      },
      size: {
        sm: "h-7 px-2.5 text-sm touch:h-9 touch:px-3 [&_svg]:size-3.5",
        md: "h-8 px-3 text-sm touch:h-10",
        lg: "h-9 px-4 text-base touch:h-11",
        icon: "size-8 touch:size-10",
        "icon-sm": "size-7 touch:size-9 [&_svg]:size-3.5",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    loading?: boolean;
    icon?: ReactNode; // before the label
    shortcut?: string; // shown as a key hint at the end
  };

export function Button({ className, variant, size, asChild, loading, icon, shortcut, children, disabled, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  if (asChild)
    return (
      <Comp className={cn(buttonVariants({ variant, size }), className)} {...props}>
        {children}
      </Comp>
    );
  return (
    <button type="button" className={cn(buttonVariants({ variant, size }), className)} disabled={disabled ?? loading} {...props}>
      {loading ? <Spinner /> : icon}
      {children}
      {shortcut && (
        <Kbd className={cn("ml-1 touch:hidden", variant === "primary" && !(disabled ?? loading) && "border-white/25 bg-white/15 text-accent-fg")} size="sm">
          {shortcut}
        </Kbd>
      )}
    </button>
  );
}
