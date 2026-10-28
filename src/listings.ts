import { applyThrough, betterListing, jobSources, jobsInStatuses, logEvent, updateJob } from "./db";
import { isSubmitting } from "./fill-state";
import { NOT_STARTED } from "./status";

export function preferUsListings() {
  let moved = 0;
  for (const job of jobsInStatuses(NOT_STARTED)) {
    if (job.status === "skipped" || job.submitted_at || isSubmitting(job.id)) continue;
    const home = jobSources(job.id).find(listing => listing.url !== job.url && betterListing(job, listing));
    if (!home) continue;
    applyThrough(job, home.url, home.source, home.location);
    updateJob(job.id, { status: "found", note: null, pending: null, resume_sha: null, resume_frozen_at: null, fill_checkpoint: null });
    logEvent("system", `Now applies through the US listing (${home.location ?? home.url}), not the one abroad; to be assessed again`, job.id);
    moved++;
  }
  if (moved) logEvent("system", `Moved ${moved} jobs from a listing abroad to their US listing`);
  return moved;
}
