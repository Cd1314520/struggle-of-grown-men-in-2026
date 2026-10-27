// One job in the review queue: the employer's mark, the role, who posts it and where, and the fit at the
// right. The age is the time band's over it.
import { CircleCheck } from "lucide-react";
import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, ListRow, Tooltip } from "../../components/ui";
import { place, plural, unent } from "../../lib/format";
import { FitFact } from "../job/fit";

export function QueueRow({
  job,
  threshold,
  underCompany,
  link,
}: {
  job: Row;
  threshold: number | null;
  underCompany: boolean; // listed under its employer's heading: the line under the title gives the place instead
  link: RowLink;
}) {
  // The accent dot is the one sign of a fresh posting.
  const fresh = job.group === "new";
  const where = !!job.location?.trim() && <span title={job.location}>{place(job.location)}</span>;
  // Applied here before: a tick after the employer's name.
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
      // Under an employer's heading the mark is the heading's, and the row's text lines up with its name.
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
      // Under its employer the place is all the line needs; otherwise the employer, then how many of its
      // roles wait here or, with one, where it is.
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
