// The Posting tab: the description in reading type, and every place the job is listed.
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Button, Properties, Section, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { cap, host, unent } from "../../lib/format";

const SOURCE = (s: string) => (s === "linkedin" ? "LinkedIn" : cap(s));

function Listed({ url, source, location }: { url: string; source: string; location?: string | null }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline">
        {SOURCE(source)}
        <ExternalLink className="size-3.5" />
      </a>
      <span className="text-fg-subtle">{location ?? host(url)}</span>
    </span>
  );
}

export function Posting({ job }: { job: JobDetail }) {
  const [open, setOpen] = useState(false);
  const desc = job.description ? unent(job.description).trim() : "";
  const long = desc.length > 1800 || desc.split("\n").length > 24;
  return (
    <div className="flex flex-col gap-8">
      <Section title="Description">
        {desc ? (
          <div>
            <div className={cn("relative", long && !open && "max-h-[440px] overflow-hidden")}>
              <p className="max-w-[68ch] text-base leading-7 break-words whitespace-pre-line text-fg">{desc}</p>
              {long && !open && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[var(--job-bg)] to-transparent" />
              )}
            </div>
            {long && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setOpen(!open);
                }}
              >
                {open ? "Show less" : "Show the whole description"}
              </Button>
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
      </Section>
      <Section title="Where it is listed">
        <Properties
          items={[
            ["Listed on", <Listed key="l" url={job.url} source={job.source} />],
            ...job.sources.filter(s => s.url !== job.url).map((s, i) => [i ? "" : "Also listed", <Listed key={s.url} {...s} />] as const),
            job.posted_at ? ["Posted", <Time key="p" at={job.posted_at} />] : null,
            ["Found", <Time key="f" at={job.found_at} />],
          ]}
        />
      </Section>
    </div>
  );
}
