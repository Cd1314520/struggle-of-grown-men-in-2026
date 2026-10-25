// One job in the review queue: who and what on the left, fit and age on the right.
import { CircleCheck } from "lucide-react";
import type { ListRow } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, Score, TableCell, TableRow, Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { dateTime, place, plural, span, unent } from "../../lib/format";

// Under an employer's heading the mark is the heading's, and the row's text lines up with its name.
const age = (at: number) => span(Date.now() - at);

const COLUMNS = "32px minmax(0,1fr) auto",
  UNDER_COMPANY = "minmax(0,1fr) auto";

export function QueueRow({
  job,
  threshold,
  underCompany,
  link,
}: {
  job: ListRow;
  threshold: number | null;
  underCompany: boolean; // listed under its employer's heading: the line under the title gives the place instead
  link: RowLink;
}) {
  const fresh = job.group === "new";
  return (
    <TableRow
      columns={underCompany ? UNDER_COMPANY : COLUMNS}
      {...link}
      className={cn("grid min-h-[60px] scroll-mt-10 gap-x-3 py-2.5", underCompany && "pl-[60px]")}
    >
      {!underCompany && <CompanyMark name={job.company} />}
      <TableCell>
        <div className="flex min-w-0 items-center gap-2">
          {fresh && (
            <Tooltip content="Opened in the last 6 hours">
              <span role="img" aria-label="Just opened" className="size-1.5 shrink-0 rounded-full bg-accent" />
            </Tooltip>
          )}
          <span className="truncate font-medium text-fg">{unent(job.title)}</span>
        </div>
        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-fg-muted">
          {underCompany ? (
            <span className="truncate" title={job.location ?? undefined}>
              {place(job.location)}
            </span>
          ) : (
            <>
              <span className="truncate">{unent(job.company)}</span>
              {job.companyCount > 1 && <span className="shrink-0 text-fg-subtle">{job.companyCount} to review</span>}
            </>
          )}
          {job.appliedThere > 0 && (
            <Tooltip content={`You have applied here ${job.appliedThere === 1 ? "once" : `${job.appliedThere} times`}`}>
              <span role="img" aria-label={`Applied here ${plural(job.appliedThere, "time")}`} className="flex shrink-0 text-fg-subtle">
                <CircleCheck className="size-3.5" />
              </span>
            </Tooltip>
          )}
        </div>
      </TableCell>
      <TableCell className="flex flex-col items-end gap-0.5 self-start pt-px">
        <Score value={job.score} threshold={threshold} />
        <Tooltip content={`Opened ${dateTime(job.opened_at)}`}>
          <span className={cn("tabular text-xs", fresh ? "text-accent-text" : "text-fg-subtle")}>{age(job.opened_at)}</span>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}
