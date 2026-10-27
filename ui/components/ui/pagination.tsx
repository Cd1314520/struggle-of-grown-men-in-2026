// The pager under a list: the range, a page box to jump with, and previous and next.
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";
import { ListFooter } from "./list";

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
        className="tabular h-7 rounded-md border border-border bg-surface text-center text-sm text-fg shadow-xs transition-[border-color,box-shadow] outline-none hover:border-border-strong focus:border-accent focus:ring-3 focus:ring-accent/15 touch:h-9"
      />
      <span className="tabular">of {pages.toLocaleString()}</span>
    </label>
  );
}

// "1–50 of 3,640 jobs", the page to jump to, and previous and next. One line in a narrow list pane or on a
// phone, where previous and next keep only their arrows. `footer` is a ListPanel's footer band.
export function Pagination({
  offset,
  limit,
  total,
  onChange,
  variant = "plain",
  noun,
  className,
}: {
  offset: number;
  limit: number;
  total: number;
  onChange: (offset: number) => void;
  variant?: "plain" | "footer";
  noun?: string; // after the total: "jobs"
  className?: string;
}) {
  if (total <= limit && offset === 0) return null;
  const end = Math.min(total, offset + limit),
    pages = Math.max(1, Math.ceil(total / limit));
  const Frame = variant === "footer" ? ListFooter : "div";
  return (
    <Frame className={cn("@container", variant === "plain" && "flex items-center justify-between gap-3 px-1 py-3 text-sm text-fg-muted", className)}>
      <span className="tabular min-w-0 truncate whitespace-nowrap">
        {(offset + 1).toLocaleString()}–{end.toLocaleString()} of {total.toLocaleString()}
        {/* Narrow, the page controls need the row: the range stays whole and the noun goes. */}
        {noun && <span className="@max-md:hidden"> {noun}</span>}
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
    </Frame>
  );
}
