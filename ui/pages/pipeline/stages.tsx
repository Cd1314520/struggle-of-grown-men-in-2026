// The pipeline's stages as one strip of counts. Each tile selects its group; the stages that wait on
// the owner say so in colour only when something is in them.
import { StatusDot } from "../../components/ui";
import { cn } from "../../lib/cn";
import type { Tone } from "../../lib/labels";

interface Stage {
  label: string;
  short: string; // on a phone and beside an open job, where five tiles share 400px
  caption: string;
  tone: Tone; // when the stage holds anything
  pulse?: boolean;
}
// In the order the server groups them (src/listing.ts).
export const STAGES: Record<string, Stage> = {
  needs_you: { label: "Needs you", short: "Needs you", caption: "Paused until you act", tone: "warning" },
  questions: { label: "Waiting on answers", short: "Answers", caption: "Answered in Questions", tone: "warning" },
  failed: { label: "Failed", short: "Failed", caption: "Stopped with an error", tone: "danger" },
  applying: { label: "Applying", short: "Applying", caption: "Queued or in the browser", tone: "info", pulse: true },
  assessing: { label: "Assessing", short: "Assessing", caption: "Before your review", tone: "info" },
};
const COUNT_TONE: Partial<Record<Tone, string>> = { warning: "text-warning-text", danger: "text-danger-text" };

// `counts` is null while the first page loads.
export function StageStrip({
  counts,
  value,
  onSelect,
  compact,
}: {
  counts: ReadonlyMap<string, number> | null;
  value: string;
  onSelect: (key: string) => void;
  compact: boolean;
}) {
  // Beside an open job, and on a phone, a tile is a short label over its count; the description and
  // the full label come in as the page widens.
  return (
    <div
      role="tablist"
      aria-label="Stages"
      className={cn(
        "grid grid-cols-5 gap-px overflow-hidden rounded-xl border border-border bg-border shadow-xs",
        compact && "-mx-4 rounded-none border-x-0 shadow-none",
      )}
    >
      {Object.entries(STAGES).map(([key, stage]) => {
        const count = counts?.get(key) ?? null,
          on = key === value,
          tone = count ? stage.tone : "neutral";
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={on}
            data-stage={key}
            onClick={() => {
              onSelect(key);
            }}
            className={cn(
              "relative flex min-w-0 flex-col items-center gap-0.5 bg-surface px-1 py-2.5 text-center transition-colors outline-none hover:bg-subtle/60 focus-visible:bg-subtle",
              !compact && "md:items-start md:gap-1 md:px-4 md:pt-3.5 md:pb-4 md:text-left",
              on && "after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-accent",
            )}
          >
            <span className={cn("flex max-w-full items-center gap-2 text-xs font-medium", !compact && "md:text-sm", on ? "text-fg" : "text-fg-muted")}>
              {!compact && <StatusDot tone={tone} pulse={!!stage.pulse && !!count} className="hidden md:inline-flex" />}
              <span className={cn("truncate", !compact && "xl:hidden")}>{stage.short}</span>
              {!compact && <span className="hidden truncate xl:inline">{stage.label}</span>}
            </span>
            <span className={cn("tabular text-lg font-semibold tracking-[-0.01em]", !compact && "md:text-2xl", COUNT_TONE[tone] ?? "text-fg")}>
              {count?.toLocaleString() ?? "–"}
            </span>
            {!compact && <span className="hidden max-w-full truncate text-xs text-fg-subtle xl:block">{stage.caption}</span>}
          </button>
        );
      })}
    </div>
  );
}
