// One archived job: the role, why it was set aside, where, its fit, and when. Narrow, the reason is the
// row's snippet; wide, it is a cell beside the place and the time.
import { MapPin } from "lucide-react";
import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, ListColumns, ListRow, Narrow, Score, Time, Tooltip } from "../../components/ui";
import { place, unent } from "../../lib/format";

// `uniform`: every row on the page was set aside for the same reason, which the panel says once instead.
const columnsOf = (uniform: boolean) => (uniform ? "180px 80px" : "minmax(0,1fr) 180px 80px");

export function ArchiveColumns({ when, uniform }: { when: string; uniform: boolean }) {
  return <ListColumns columns={columnsOf(uniform)} lead label="Role" cells={uniform ? ["Location", when] : ["Reason", "Location", when]} trail="Fit" />;
}

export function ArchiveRow({ job, threshold, uniform, link }: { job: Row; threshold: number | null; uniform: boolean; link: RowLink }) {
  const why = job.reason;
  const located = !!job.location?.trim();
  return (
    <ListRow
      {...link}
      lead={<CompanyMark name={job.company} />}
      title={unent(job.title)}
      secondary={
        // The employer keeps its whole name where it can; the place takes what is left.
        <span className="flex min-w-0 items-center gap-2">
          <span className="max-w-full shrink-0 truncate">{unent(job.company)}</span>
          {located && (
            <Narrow>
              {/* A pin parts the place from the employer, both in the same muted voice. */}
              <span className="flex min-w-0 items-center gap-1" title={job.location ?? undefined}>
                <MapPin aria-hidden className="size-3.5 shrink-0 text-fg-subtle" />
                <span className="truncate">{place(job.location)}</span>
              </span>
            </Narrow>
          )}
        </span>
      }
      snippet={
        why &&
        !uniform && (
          <Narrow>
            <span title={why.detail ?? undefined}>{why.label}</span>
          </Narrow>
        )
      }
      trail={
        <>
          <Score value={job.score} threshold={threshold} />
          <Narrow>
            <Time at={job.updated_at} short />
          </Narrow>
        </>
      }
      columns={columnsOf(uniform)}
      cells={[
        ...(uniform
          ? []
          : [
              why ? (
                <Tooltip key="why" content={why.detail || why.label.length > 50 ? <span className="line-clamp-4">{why.detail ?? why.label}</span> : null}>
                  <span className="line-clamp-2">{why.label}</span>
                </Tooltip>
              ) : (
                <span key="why" />
              ),
            ]),
        <span key="place" className="block truncate" title={job.location ?? undefined}>
          {place(job.location)}
        </span>,
        <Time key="at" at={job.updated_at} />,
      ]}
    />
  );
}
