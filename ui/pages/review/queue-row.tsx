// One job in the review queue: the employer's mark, the role and who posts it, and fit over age at the right.
import { CircleCheck } from "lucide-react";
import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, ListRow, Score, Time, Tooltip } from "../../components/ui";
import { place, plural, unent } from "../../lib/format";

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
  // The accent dot is the one sign of a fresh posting; the age beside it stays plain.
  const fresh = job.group === "new";
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
      secondary={
        <>
          {underCompany ? <span title={job.location ?? undefined}>{place(job.location)}</span> : <span>{unent(job.company)}</span>}
          {!underCompany && job.companyCount > 1 && <span className="tabular">{job.companyCount} to review</span>}
          {job.appliedThere > 0 && (
            <Tooltip content={`You have applied here ${job.appliedThere === 1 ? "once" : `${job.appliedThere} times`}`}>
              <span role="img" aria-label={`Applied here ${plural(job.appliedThere, "time")}`} className="flex text-fg-subtle">
                <CircleCheck className="size-3.5" />
              </span>
            </Tooltip>
          )}
        </>
      }
      trail={
        <>
          <Score value={job.score} threshold={threshold} />
          <Time at={job.opened_at} short />
        </>
      }
    />
  );
}
