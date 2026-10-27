// The shape of a settings page: one card per section, each a list of rows with the label and what it
// means on the left and the value or control on the right.
import { FileCog } from "lucide-react";
import type { ReactNode } from "react";
import { ListFooter, ListPanel } from "../../components/ui";
import { cn } from "../../lib/cn";

// A section of the page: a titled card (the region the nav scrolls to), its rows, and a footer that
// says where its values are changed.
export function SettingsPanel({
  id,
  title,
  description,
  actions,
  notice,
  footer,
  children,
  className,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    // The id sits on a wrapper: the nav scrolls to it, clear of the top bar and the phone's nav strip.
    <div id={id} className="scroll-mt-28 lg:scroll-mt-8">
      <ListPanel
        frame="card"
        title={title}
        description={description}
        actions={actions}
        notice={notice}
        bodyRole="none"
        footer={footer && <ListFooter className="flex-wrap gap-y-2">{footer}</ListFooter>}
        {...(className && { className })}
      >
        {children}
      </ListPanel>
    </div>
  );
}

// A group of rows inside a section's card ("The pipeline", "Gmail"): the list's group band, as a heading.
export function SettingsGroup({ title }: { title: string }) {
  return (
    <h3 className="relative -mb-px flex h-9 items-center border-y border-border bg-subtle px-(--list-x) text-sm font-semibold text-fg touch:h-10">{title}</h3>
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
    <div
      className={cn("flex gap-4 border-t border-border px-(--list-x) py-4 sm:items-center sm:gap-8", stack ? "flex-col sm:flex-row" : "items-start", className)}
    >
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium text-fg">{label}</p>
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

// A fold in a section's card: the policy behind its values.
export const SettingFold = ({ children }: { children: ReactNode }) => <div className="border-t border-border px-(--list-x) py-3">{children}</div>;

// Said once per card, in its footer: these values are read, not set, here.
export const FromConfig = ({ what = "these", file = "config.yml" }: { what?: string; file?: string }) => (
  <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
    <FileCog className="size-3.5 shrink-0 text-fg-subtle" />
    <span>
      Change {what} in <code className="font-mono text-xs">{file}</code>
    </span>
  </span>
);
