import { CircleCheck } from "lucide-react";
import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, ListRow, Tooltip } from "../../components/ui";
import { place, plural, unent } from "../../lib/format";
import { FitFact } from "../job/fit";

export function QueueRow({ job, threshold, underCompany, link }: { job: Row; threshold: number | null; underCompany: boolean; link: RowLink }) {
  const fresh = job.group === "new";
  const where = !!job.location?.trim() && <span title={job.location}>{place(job.location)}</span>;
  const applied = job.appliedThere > 0 && (
    <Tooltip content={`You have applied here ${job.appliedThere === 1 ? "once" : `${job.appliedThere} times`}`}>
      <span role="img" aria-label={`Applied here ${plural(job.appliedThere, "time")}`} className="flex text-fg-subtle">
        <CircleCheck className="size-3.5" />
      </span>
    </Tooltip>
  );
  return (
    <ListRow
      {...link}
      {...(underCompany ? { indent: true } : { lead: <CompanyMark name={job.company} /> })}
      title={
        <>
          {fresh && (
            <Tooltip content="Opened in the last 6 hours">
              <span role="img" aria-label="Just opened" className="mr-2 mb-0.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
            </Tooltip>
          )}
          {unent(job.title)}
        </>
      }
      secondary={
        underCompany ? (
          where
        ) : (
          <>
            <span>{unent(job.company)}</span>
            {applied}
          </>
        )
      }
      gist={!underCompany && (job.companyCount > 1 ? <span className="tabular">{job.companyCount} to review</span> : where)}
      fact={<FitFact value={job.score} threshold={threshold} />}
    />
  );
}
