import { applyThrough, betterListing, jobSources, jobsInStatuses, logEvent, moveJob } from "./db";
import { isSubmitting } from "./fill-state";
import { applicationStarted, NOT_STARTED } from "./status";

export function preferUsListings() {
  let moved = 0;
  // Skipped jobs are most of the table and are never moved: leave them out of the read.
  for (const job of jobsInStatuses(NOT_STARTED.filter(status => status !== "skipped"))) {
    if (applicationStarted(job) || isSubmitting(job.id)) continue;
    const home = jobSources(job.id).find(listing => listing.url !== job.url && betterListing(job, listing));
    if (!home) continue;
    if (!moveJob(job.id, NOT_STARTED, { status: "found", note: null, pending: null })) continue;
    applyThrough(job, home.url, home.source, home.location);
    logEvent("system", `Now applies through the US listing (${home.location ?? home.url}), not the one abroad; to be assessed again`, job.id);
    moved++;
  }
  if (moved) logEvent("system", `Moved ${moved} jobs from a listing abroad to their US listing`);
  return moved;
}
