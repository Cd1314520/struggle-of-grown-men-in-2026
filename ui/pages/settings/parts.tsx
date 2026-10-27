// The shape of the Settings page: one section per subsystem on the sheet, divided by full-bleed rules, each a
// list of rows with the label and what it means on the left and the value or control on the right.
import { FileCog } from "lucide-react";
import type { ReactNode } from "react";
import { WorkspaceSection } from "../../components/ui";
import { cn } from "../../lib/cn";

// A section's head (its first child) inside the 56rem reading measure, its rule still full-bleed.
export const MEASURED_HEAD = "[&>div:first-child]:max-w-[56rem]";

// A section of the page: a titled region the nav scrolls to, its notices across the sheet, its rows inside
// the reading measure, and a last line that says where its changes are saved.
export function SettingsPanel({
  id,
  title,
  description,
  actions,
  notice,
  footer,
  tone,
  children,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
  footer?: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    // The id sits on a wrapper: the nav scrolls to it, clear of the bar (and on a phone, the nav strip too).
    <div id={id} role="region" aria-label={title} className="scroll-mt-28 lg:scroll-mt-12">
      {/* Its head keeps to the rows' measure, so its action ends where their values do. */}
      <WorkspaceSection flush title={title} description={description} actions={actions} className={MEASURED_HEAD} {...(tone && { tone })}>
        {notice && <div className="border-y border-border">{notice}</div>}
        <div className="flex max-w-[56rem] flex-col divide-y divide-border px-(--list-x) pb-2 [&>:first-child]:pt-1">{children}</div>
        {footer && (
          <div className="max-w-[56rem] px-(--list-x) pb-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border pt-3 text-xs text-fg-muted">{footer}</div>
          </div>
        )}
      </WorkspaceSection>
    </div>
  );
}

// A group of rows inside a section ("The pipeline", "Gmail"): a small uppercase label, as a heading.
export function SettingsGroup({ title }: { title: string }) {
  return <h3 className="pt-6 pb-1.5 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">{title}</h3>;
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
    <div className={cn("flex gap-4 py-4 sm:items-center sm:gap-8", stack ? "flex-col sm:flex-row" : "items-start", className)}>
      <div className="max-w-xl min-w-0 flex-1">
        <p className="text-base font-medium text-fg">{label}</p>
        {description && <div className="mt-0.5 text-sm text-fg-muted">{description}</div>}
      </div>
      {children !== undefined && (
        <div
          className={cn("ml-auto flex min-w-0 shrink-0 items-center gap-2 text-sm text-fg sm:max-w-[55%] sm:justify-end", !stack && "max-w-[55%] justify-end")}
        >
          {children}
        </div>
      )}
    </div>
  );
}

// A fold in a section: the policy behind its values.
export const SettingFold = ({ children }: { children: ReactNode }) => <div className="py-3">{children}</div>;

// Said once per section, on its last line: where a change made here goes.
export const SavedLocally = () => (
  <span className="inline-flex items-start gap-1.5 text-xs text-fg-muted">
    <FileCog className="mt-0.5 size-3.5 shrink-0 text-fg-subtle" />
    <span>
      Changes are saved to <code className="font-mono text-xs">config.local.yml</code>, laid over <code className="font-mono text-xs">config.yml</code>. Reset
      goes back to the latter.
    </span>
  </span>
);
