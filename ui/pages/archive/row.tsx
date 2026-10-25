// One archived job: the role, why it was set aside, where, its fit, and when.
import type { ListRow } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, Score, TableCell, TableHeader, TableRow, Time, Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { place, unent } from "../../lib/format";

const COLUMNS = "minmax(0,2.3fr) minmax(0,2fr) minmax(0,1.1fr) 44px 76px";

export function ArchiveHeader({ when }: { when: string }) {
  return (
    <TableHeader columns={COLUMNS}>
      <span>Role</span>
      <span>Reason</span>
      <span>Location</span>
      <span className="text-right">Fit</span>
      <span className="text-right">{when}</span>
    </TableHeader>
  );
}

export function ArchiveRow({ job, threshold, link }: { job: ListRow; threshold: number | null; link: RowLink }) {
  const why = job.reason;
  return (
    <TableRow columns={COLUMNS} {...link} className="flex-nowrap scroll-mt-4 scroll-mb-4">
      <TableCell className="flex min-w-0 flex-1 items-center gap-3">
        <CompanyMark name={job.company} />
        <div className="min-w-0">
          <div className="truncate font-medium text-fg">{unent(job.title)}</div>
          <div className="truncate text-fg-muted">{unent(job.company)}</div>
        </div>
      </TableCell>
      <TableCell className="hidden md:block">
        {why && (
          <Tooltip content={why.detail || why.label.length > 50 ? <span className="line-clamp-4">{why.detail ?? why.label}</span> : null}>
            <span className="block truncate text-fg-muted">{why.label}</span>
          </Tooltip>
        )}
      </TableCell>
      <TableCell className={cn("hidden truncate md:block", job.location?.trim() ? "text-fg-muted" : "text-fg-subtle")} title={job.location ?? undefined}>
        {place(job.location)}
      </TableCell>
      <TableCell className="shrink-0 text-right">
        <Score value={job.score} threshold={threshold} />
      </TableCell>
      <TableCell className="hidden text-right text-fg-subtle md:block">
        <Time at={job.updated_at} />
      </TableCell>
    </TableRow>
  );
}
