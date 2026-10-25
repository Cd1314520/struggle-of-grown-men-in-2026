// The shape of a settings page: titled sections of cards, each a list of rows with the label and what it
// means on the left and the value or control on the right.
import { FileCog } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui";
import { cn } from "../../lib/cn";

export function SettingsSection({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 lg:scroll-mt-8">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-fg">
        {title}
      </h2>
      {description && <p className="mt-1 text-sm text-fg-muted">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

export function SettingsCard({ title, children, footer, className }: { title?: string; children: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      {title && <h3 className="px-5 pt-4 text-base font-semibold text-fg">{title}</h3>}
      <div className="divide-y divide-border">{children}</div>
      {footer && <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-subtle/50 px-5 py-3">{footer}</div>}
    </Card>
  );
}

// The value sits beside the label at every width; `stack` puts a wide control under it on a phone.
export function SettingRow({
  label,
  description,
  children,
  stack,
  className,
}: {
  label: string;
  description?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-4 px-5 py-4 sm:items-center sm:gap-8", stack ? "flex-col sm:flex-row" : "items-start", className)}>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">{label}</p>
        {description && <div className="mt-0.5 text-sm text-fg-muted">{description}</div>}
      </div>
      {children !== undefined && (
        <div className={cn("flex min-w-0 shrink-0 items-center gap-2 text-sm text-fg sm:max-w-[55%] sm:justify-end", !stack && "max-w-[55%] justify-end")}>
          {children}
        </div>
      )}
    </div>
  );
}

// Said once per card: these values are read, not set, here.
export const FromConfig = ({ what = "these" }: { what?: string }) => (
  <span className="inline-flex items-center gap-1.5 text-xs text-fg-subtle">
    <FileCog className="size-3.5" />
    Change {what} in <code className="font-mono">config.yml</code>
  </span>
);
