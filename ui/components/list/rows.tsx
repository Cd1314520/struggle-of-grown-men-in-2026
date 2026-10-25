// Pieces of a job row shared by the lists whose rows are columns on a desktop (Pipeline, Applications).
import type { ReactNode } from "react";
import type { ListRow } from "../../../src/api-types";
import { CompanyMark, TableCell, TableRow } from "../ui";
import { unent } from "../../lib/format";
import type { RowLink } from "./use-open-record";

// The employer's mark, the role, and the employer under it.
export function RoleCell({ row }: { row: Pick<ListRow, "title" | "company"> }) {
  return (
    <TableCell className="flex items-center gap-3">
      <CompanyMark name={row.company} />
      <div className="min-w-0">
        <div className="truncate font-medium text-fg">{unent(row.title)}</div>
        <div className="truncate text-fg-muted">{unent(row.company)}</div>
      </div>
    </TableCell>
  );
}

// A row with no columns: the role and employer on the left, one fact on the right of each line. A
// phone's list, and the list beside an open job.
export function CompactRow({ row, link, top, bottom }: { row: ListRow; link: RowLink; top: ReactNode; bottom: ReactNode }) {
  return (
    <TableRow columns="1fr" {...link} className="items-start gap-3 py-3 md:flex">
      <CompanyMark name={row.company} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <span className="min-w-0 flex-1 truncate font-medium text-fg">{unent(row.title)}</span>
          <span className="shrink-0 text-fg-subtle">{top}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-fg-muted">{unent(row.company)}</span>
          <span className="shrink-0">{bottom}</span>
        </div>
      </div>
    </TableRow>
  );
}
