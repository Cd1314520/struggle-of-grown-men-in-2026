// Lists of records. Rows are links or buttons; columns are a CSS grid the page defines once and passes
// to the header and every row, so they line up without a <table>.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export function Table({ className, ...props }: ComponentProps<"div">) {
  return <div role="table" className={cn("overflow-hidden rounded-xl border border-border bg-surface shadow-xs", className)} {...props} />;
}

export function TableHeader({ columns, children, className }: { columns: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="row"
      style={{ gridTemplateColumns: columns }}
      className={cn("hidden h-9 items-center gap-4 border-b border-border bg-subtle/60 px-4 text-xs font-medium text-fg-subtle md:grid", className)}
    >
      {children}
    </div>
  );
}

// A group heading inside a table: "Just opened · 4".
export function TableGroup({ label, count, className }: { label: ReactNode; count?: number; className?: string }) {
  return (
    <div role="row" className={cn("flex h-8 items-center gap-2 border-b border-border bg-subtle/40 px-4 text-xs font-medium text-fg-muted", className)}>
      {label}
      {count !== undefined && <span className="tabular text-fg-subtle">{count.toLocaleString()}</span>}
    </div>
  );
}

const row = "relative flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-sm text-fg last:border-b-0 md:grid";

export function TableRow({ columns, selected, className, children, ...props }: ComponentProps<"a"> & { columns: string; selected?: boolean }) {
  return (
    <a
      role="row"
      aria-current={selected ? "true" : undefined}
      style={{ gridTemplateColumns: columns }}
      className={cn(
        row,
        "group cursor-pointer transition-colors outline-none hover:bg-subtle/70 focus-visible:bg-subtle focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-inset",
        selected && "bg-accent-soft/60 hover:bg-accent-soft/80 before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
        className,
      )}
      {...props}
    >
      {children}
    </a>
  );
}

// A row that holds links or buttons of its own, so it cannot be one link: the same frame, not clickable.
export function TableItem({ columns, className, ...props }: ComponentProps<"div"> & { columns: string }) {
  return <div role="row" style={{ gridTemplateColumns: columns }} className={cn(row, className)} {...props} />;
}

export function TableCell({ className, ...props }: ComponentProps<"div">) {
  return <div role="cell" className={cn("min-w-0", className)} {...props} />;
}

// The page number, typed to jump: Enter or leaving the box goes there, Escape puts it back.
function PageField({ page, pages, onGo }: { page: number; pages: number; onGo: (page: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const go = () => {
    const n = Number(draft);
    setDraft(null);
    if (draft) onGo(Math.min(pages, Math.max(1, n)));
  };
  return (
    <label className="flex items-center gap-1.5 whitespace-nowrap">
      Page
      <input
        inputMode="numeric"
        aria-label={`Page, of ${pages}`}
        value={draft ?? String(page)}
        onChange={e => {
          setDraft(e.target.value.replace(/\D/g, ""));
        }}
        onFocus={e => {
          e.currentTarget.select();
        }}
        onBlur={go}
        onKeyDown={e => {
          if (e.key === "Enter") go();
          else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
        // Wide enough for the last page's number, so the box never jumps as it is typed in.
        style={{ width: `calc(${String(pages).length}ch + 1.25rem)` }}
        className="tabular h-7 rounded-md border border-border bg-surface text-center text-sm text-fg shadow-xs transition-[border-color,box-shadow] outline-none hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15 touch:h-9 touch:text-lg"
      />
      <span className="tabular">of {pages.toLocaleString()}</span>
    </label>
  );
}

// "1–50 of 3,640", the page to jump to, and previous and next. One line in a narrow list pane or on a
// phone, where previous and next keep only their arrows.
export function Pagination({
  offset,
  limit,
  total,
  onChange,
  className,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  className?: string;
}) {
  if (total <= limit && offset === 0) return null;
  const end = Math.min(total, offset + limit),
    pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className={cn("@container flex items-center justify-between gap-3 px-1 py-3 text-sm text-fg-muted", className)}>
      <span className="tabular whitespace-nowrap">
        {(offset + 1).toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          disabled={offset === 0}
          aria-label="Previous page"
          onClick={() => {
            onChange(Math.max(0, offset - limit));
          }}
          icon={<ChevronLeft />}
          className="@max-md:px-2"
        >
          <span className="@max-md:hidden">Previous</span>
        </Button>
        {pages > 1 && (
          <PageField
            // A new page from outside (Next, a shortcut, a new search) starts the box over.
            key={offset}
            page={Math.floor(offset / limit) + 1}
            pages={pages}
            onGo={p => {
              onChange((p - 1) * limit);
            }}
          />
        )}
        <Button
          size="sm"
          disabled={end >= total}
          aria-label="Next page"
          onClick={() => {
            onChange(offset + limit);
          }}
          className="@max-md:px-2"
        >
          <span className="@max-md:hidden">Next</span>
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
