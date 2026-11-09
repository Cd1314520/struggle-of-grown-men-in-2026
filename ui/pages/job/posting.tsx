import { ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Properties, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { cap, unent } from "../../lib/format";

const SOURCE = (s: string) => (s === "linkedin" ? "LinkedIn" : cap(s));

function Listed({ url, source, location }: { url: string; source: string; location?: string | null }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline">
        {SOURCE(source)}
        <ExternalLink className="size-3.5" />
      </a>
      {location && <span className="text-fg-muted">{location}</span>}
    </span>
  );
}

export function Posting({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState(false);
  const desc = job.description ? unent(job.description).trim() : "";
  const long = desc.length > 1800 || desc.split("\n").length > 24;
  return (
    <div className="flex flex-col gap-6">
      <Properties
        items={[
          ["Listed on", <Listed key="l" url={job.url} source={job.source} />],
          ...job.sources
            .filter(s => s.url !== job.url)
            .map(
              (s, i) =>
                [
                  i ? "" : "Also listed",
                  <Listed key={s.url} url={s.url} source={s.source} location={s.location !== job.location ? s.location : null} />,
                ] as const,
            ),
          job.posted_at ? ["Posted", <Time key="p" at={job.posted_at} />] : null,
        ]}
      />
      <div className="border-t border-border pt-6">
        {desc ? (
          <div>
            <div className={cn("relative", long && !open && "max-h-[440px] overflow-hidden")}>
              <p className="text-base leading-relaxed break-words whitespace-pre-line text-fg">{desc}</p>
              {long && !open && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--job-bg)] to-transparent" />
              )}
            </div>
            {long && (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => {
                  setOpen(!open);
                }}
                className="mt-1 inline-flex items-center gap-1 text-sm text-fg-muted hover:text-fg touch:-my-2 touch:py-2"
              >
                <ChevronRight aria-hidden className={cn("size-3.5 transition-transform", open && "rotate-90")} />
                {open ? "Show less" : "Show the whole description"}
              </button>
            )}
          </div>
        ) : (
          <p className="text-base text-fg-muted">
            Not captured.{" "}
            <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-accent-text underline-offset-2 hover:underline">
              Open the posting
            </a>
          </p>
        )}
      </div>
    </div>
  );
}
