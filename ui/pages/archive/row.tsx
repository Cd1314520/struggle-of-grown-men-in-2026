// One archived job: the role, the employer, why it was set aside, and its fit at the right.
import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { CompanyMark, ListRow, Tooltip } from "../../components/ui";
import { place, unent } from "../../lib/format";
import { FitFact } from "../job/fit";

// `uniform`: every row on the page was set aside for the same reason, which the list says once instead,
// and the rows give the place in its stead.
export function ArchiveRow({ job, threshold, uniform, link }: { job: Row; threshold: number | null; uniform: boolean; link: RowLink }) {
  const why = job.reason;
  const located = !!job.location?.trim();
  return (
    <ListRow
      {...link}
      lead={<CompanyMark name={job.company} />}
      title={unent(job.title)}
      secondary={unent(job.company)}
      gist={
        why && !uniform ? (
          <Tooltip content={why.detail || why.label.length > 60 ? <span className="line-clamp-4">{why.detail ?? why.label}</span> : null}>
            <span>{why.label}</span>
          </Tooltip>
        ) : (
          located && <span title={job.location ?? undefined}>{place(job.location)}</span>
        )
      }
      fact={<FitFact value={job.score} threshold={threshold} />}
    />
  );
}
