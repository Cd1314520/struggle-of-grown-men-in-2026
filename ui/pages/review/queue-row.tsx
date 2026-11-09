import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { ListRow, Tooltip } from "../../components/ui";
import { agoShort, cap, place, plural, unent } from "../../lib/format";
import { FitFact } from "../job/fit";

export function AppliedHere({ times }: { times: number }) {
  if (times <= 0) return null;
  return (
    <Tooltip content={`You have applied to this employer ${times === 1 ? "once" : `${times} times`}`}>
      <span className="tabular font-normal text-fg-subtle">{times === 1 ? "Applied here" : `Applied here ${times}×`}</span>
    </Tooltip>
  );
}

function noteReason(job: Row): { text: string; capped?: boolean } | null {
  const note = (job.note ?? "").trim().replace(/^needs your review:\s*/i, "");
  if (!note) return null;
  if (/\(auto apply allows \d+/i.test(note)) return { text: "Already applying here", capped: true };
  const unclear = /^the posting does not settle:\s*(.+)$/i.exec(note);
  if (unclear?.[1]) return { text: `Unclear: ${unclear[1]}` };
  return { text: cap(note) };
}

function why(job: Row): { text: string; target?: boolean; capped?: boolean; detail?: string } | null {
  const reason = noteReason(job);
  if (job.rubric !== "real") return reason;
  return reason ? { ...reason, text: "Target employer", target: true, detail: reason.text } : { text: "Target employer", target: true };
}

export function QueueRow({
  job,
  threshold,
  underCompany,
  byAge,
  link,
}: {
  job: Row;
  threshold: number | null;
  underCompany: boolean;
  byAge: boolean;
  link: RowLink;
}) {
  const where = job.location?.trim() ? place(job.location) : null;
  const reason = why(job);
  const others = job.companyCount - 1;
  const dot = !byAge && job.group === "new" && (
    <Tooltip content="Opened in the last 6 hours">
      <span role="img" aria-label="Just opened" className="size-1.5 rounded-full bg-accent" />
    </Tooltip>
  );
  const age = (!byAge || job.group === "older") && (
    <span className="tabular text-fg-subtle" title={`Opened ${agoShort(job.opened_at)} ago`}>
      {agoShort(job.opened_at)}
    </span>
  );
  return (
    <ListRow
      {...link}
      title={unent(job.title)}
      secondary={
        <>
          <span title={job.location ?? undefined}>
            {!underCompany && unent(job.company)}
            {where && <span className={underCompany ? undefined : "lg:hidden"}>{underCompany ? where : ` · ${where}`}</span>}
          </span>
          {!underCompany && !reason?.capped && <AppliedHere times={job.appliedThere} />}
          {!underCompany && others > 0 && (
            <Tooltip content={`${plural(job.companyCount, "job")} from this company in the queue`}>
              <span className="tabular text-fg-subtle">+{others}</span>
            </Tooltip>
          )}
          {age}
        </>
      }
      gist={
        reason &&
        (reason.target ? (
          <>
            <span className="font-medium text-accent-text">{reason.text}</span>
            {reason.detail && ` · ${reason.detail}`}
          </>
        ) : (
          reason.text
        ))
      }
      fact={
        <>
          {dot}
          <FitFact value={job.score} threshold={threshold} />
        </>
      }
    />
  );
}
