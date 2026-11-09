import type { ReactNode } from "react";
import { WorkspaceSection } from "../../components/ui";
import { cn } from "../../lib/cn";

export const MEASURED_HEAD = "[&>div:first-child]:max-w-[56rem]";

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
    <div id={id} role="region" aria-label={title} className="scroll-mt-28 lg:scroll-mt-12">
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

export function SettingsGroup({ title }: { title: string }) {
  return <h3 className="pt-6 pb-1.5 text-xs font-medium text-fg-muted">{title}</h3>;
}

export function SettingRow({
  label,
  tag,
  description,
  children,
  stack,
  block,
  className,
}: {
  label: string;
  tag?: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  stack?: boolean;
  block?: boolean;
  className?: string;
}) {
  if (block)
    return (
      <div className={cn("flex flex-col gap-3 py-4", className)}>
        <div className="max-w-xl min-w-0">
          <p className="text-sm font-medium text-fg">
            {label}
            {tag}
          </p>
          {description && <div className="mt-0.5 text-sm text-fg-muted">{description}</div>}
        </div>
        {children !== undefined && <div className="flex min-w-0 items-start gap-2 text-sm text-fg">{children}</div>}
      </div>
    );
  return (
    <div className={cn("flex gap-4 py-4 sm:items-center sm:gap-8", stack ? "flex-col sm:flex-row" : "items-start", className)}>
      <div className="max-w-xl min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {label}
          {tag}
        </p>
        {description && <div className="mt-0.5 text-sm text-fg-muted">{description}</div>}
      </div>
      {children !== undefined && (
        <div
          className={cn(
            "ml-auto flex min-w-0 shrink-0 items-center gap-2 text-sm text-fg sm:max-w-[55%] sm:justify-end",
            stack ? "max-sm:ml-0 max-sm:w-full" : "max-w-[55%] justify-end",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}
