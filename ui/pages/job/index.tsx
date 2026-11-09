import { ArrowLeft, ChevronRight } from "lucide-react";
import { ASSESSING, FILL_STAGE, SENT, type Status } from "../../../src/status";
import { Button, Workspace } from "../../components/ui";
import { useJob } from "../../lib/api";
import { href, useRoute, type Page as Section } from "../../lib/router";
import { JobDetail } from "./detail";

function homeOf(status: Status): readonly [label: string, link: string] | null {
  const at = (page: Section, ...parts: string[]) => href(page, ...parts);
  if (status === "awaiting_approval") return ["Review", at("review")];
  if (FILL_STAGE.includes(status) || ASSESSING.includes(status)) return ["Pipeline", at("pipeline")];
  if (SENT.includes(status)) return ["Applications", at("applications")];
  if (status === "held") return ["Held", at("archive", "held")];
  if (status === "rejected") return ["Rejected", at("archive", "rejected")];
  return null;
}

export function JobPage() {
  const { parts } = useRoute();
  const id = Number(parts[0]) || null;
  const { data: job } = useJob(id);
  if (!id) return null;
  const home = job?.id === id ? homeOf(job.status) : null;
  return (
    <Workspace>
      <div className="z-20 flex h-[calc(3rem+1px)] min-w-0 items-center gap-1 border-b border-border bg-surface px-(--list-x) lg:sticky lg:top-0">
        {home && (
          <Button asChild variant="ghost" size="sm" className="-ml-2.5 touch:-ml-3">
            <a href={`${home[1]}/${id}`}>
              <ArrowLeft className="lg:hidden" />
              {home[0]}
            </a>
          </Button>
        )}
        {home && job && (
          <>
            <ChevronRight aria-hidden className="size-3.5 shrink-0 text-fg-subtle max-lg:hidden" />
            <span className="min-w-0 truncate px-1 text-sm font-medium text-fg max-lg:hidden">{job.title}</span>
          </>
        )}
      </div>
      <JobDetail id={id} layout="page" />
    </Workspace>
  );
}
