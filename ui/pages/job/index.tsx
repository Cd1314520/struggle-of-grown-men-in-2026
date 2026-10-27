import { ArrowLeft } from "lucide-react";
import type { Status } from "../../../src/status";
import { Button, Workspace } from "../../components/ui";
import { useJob } from "../../lib/api";
import { href, useRoute, type Page as Section } from "../../lib/router";
import { JobDetail } from "./detail";

// The list a job is worked from, by its status, so the page can link back to it in context.
function homeOf(status: Status): readonly [label: string, link: string] | null {
  const at = (page: Section, ...parts: string[]) => href(page, ...parts);
  if (status === "awaiting_approval") return ["Review", at("review")];
  if (["awaiting_submit", "needs_input", "needs_manual", "failed", "filling", "approved", "prepping", "locating", "triaged"].includes(status))
    return ["Pipeline", at("pipeline")];
  if (["submitted", "interview", "offer", "rejected_by_company", "withdrawn"].includes(status)) return ["Applications", at("applications")];
  if (status === "held") return ["Held", at("archive", "held")];
  if (status === "rejected") return ["Rejected", at("archive", "rejected")];
  return null;
}

// #job/<id>: a job on its own, for links from anywhere (search, Activity, Blockers), on the sheet as every
// page is. Its bar leads with the way back to the list that holds it; the job's header is the page's h1.
// The bar is the page's own rather than a WorkspaceBar, whose title line (and so its back link) is for
// screen readers below lg, where a phone needs the way back most.
export function JobPage() {
  const { parts } = useRoute();
  const id = Number(parts[0]) || null;
  const { data: job } = useJob(id);
  if (!id) return null;
  const home = job?.id === id ? homeOf(job.status) : null;
  return (
    <Workspace>
      <div className="z-20 flex h-[calc(3rem+1px)] items-center border-b border-border bg-surface/95 px-(--list-x) backdrop-blur lg:sticky lg:top-0">
        {home && (
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <a href={`${home[1]}/${id}`}>
              <ArrowLeft />
              {home[0]}
            </a>
          </Button>
        )}
      </div>
      <JobDetail id={id} layout="page" />
    </Workspace>
  );
}
