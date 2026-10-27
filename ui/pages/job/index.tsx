import { ArrowLeft } from "lucide-react";
import type { Status } from "../../../src/status";
import { Button, Card, Page } from "../../components/ui";
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

// #job/<id>: a job on its own, for links from anywhere (search, Activity, Blockers). It reads as one
// panel, as it does beside a list: a card on the canvas, edge to edge on a phone, where the back link
// sits on the job's own surface rather than in a band of canvas between the top bar and the card.
export function JobPage() {
  const { parts } = useRoute();
  const id = Number(parts[0]) || null;
  const { data: job } = useJob(id);
  if (!id) return null;
  const home = job?.id === id ? homeOf(job.status) : null;
  return (
    <Page width="narrow" className="pt-0 sm:pt-4">
      <div className="flex h-11 items-center pt-2 max-sm:-mx-4 max-sm:bg-surface max-sm:px-4 sm:mb-3 sm:h-8 sm:pt-0">
        {home && (
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <a href={`${home[1]}/${id}`}>
              <ArrowLeft />
              {home[0]}
            </a>
          </Button>
        )}
      </div>
      <Card className="max-sm:-mx-4 max-sm:rounded-none max-sm:border-0 max-sm:shadow-none">
        <JobDetail id={id} layout="page" />
      </Card>
    </Page>
  );
}
