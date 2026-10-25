import { ChevronRight } from "lucide-react";
import type { Status } from "../../../src/status";
import { Page } from "../../components/ui";
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

// #job/<id>: a job on its own, for links from anywhere (search, Activity, Blockers).
export function JobPage() {
  const { parts } = useRoute();
  const id = Number(parts[0]) || null;
  const { data: job } = useJob(id);
  if (!id) return null;
  const home = job?.id === id ? homeOf(job.status) : null;
  return (
    <Page width="narrow" className="max-w-4xl pt-4 sm:pt-6">
      <nav aria-label="Breadcrumb" className="flex h-5 items-center gap-1.5 text-sm text-fg-muted">
        {home && (
          <>
            <a href={`${home[1]}/${id}`} className="hover:text-fg touch:-my-2 touch:py-2">
              {home[0]}
            </a>
            <ChevronRight className="size-3.5 text-fg-subtle" />
            <span className="truncate text-fg-subtle">{job?.company}</span>
          </>
        )}
      </nav>
      <JobDetail id={id} layout="page" />
    </Page>
  );
}
