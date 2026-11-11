import type { ListRow as Row } from "../../../src/api-types";
import type { RowLink } from "../../components/list";
import { ListRow, Time, Tooltip } from "../../components/ui";
import { cap, unent } from "../../lib/format";
import { FitFact } from "../job/fit";
import { AppliedHere } from "../review/queue-row";

const BLOCKER: Record<string, string> = {
  site_down: "Site down",
  blocked: "Blocked by site",
  no_form: "No application form",
  login: "Login wall",
  captcha: "Captcha",
  browser: "Browser failed",
  other: "Blocked",
  unknown: "Blocked",
};

const GATE: Record<string, string> = {
  question: "a question",
  manual: "a browser hand-off",
  cover_letter: "a cover letter",
  confirm_submit: "the submit OK",
  submission_ambiguous: "an unclear submission",
};

function shortReason(label: string) {
  const text = label.replace(/^(cleared|stopped):\s*/i, "").replace(/\s*\(see blockers\)\s*$/i, "");
  const blocker = BLOCKER[text];
  if (blocker) return blocker;
  const gate = /^stuck on an? (\w+) gate for over a day$/i.exec(text)?.[1];
  if (gate) return `Stuck on ${GATE[gate] ?? gate.replace(/_/g, " ")} for over a day`;
  const parked = /^parked since before (\S+) without an answer$/i.exec(text)?.[1];
  if (parked) return `Unanswered since before ${parked}`;
  if (/^lever hcaptcha/i.test(text)) return "Lever hCaptcha blocks submits";
  return cap(text);
}

const nobreak = (s: string) => s.replace(/(\d)-(\d)/g, "$1‑$2");

export function ArchiveRow({ job, threshold, rejected, link }: { job: Row; threshold: number | null; rejected: boolean; link: RowLink }) {
  const why = job.reason;
  const label = why && shortReason(why.label);
  const full = why && (why.detail ? `${why.label}: ${why.detail}` : why.label);
  return (
    <ListRow
      {...link}
      title={unent(job.title)}
      secondary={
        <>
          <span>{unent(job.company)}</span>
          <AppliedHere times={job.appliedThere} />
        </>
      }
      gist={
        why &&
        label && (
          <Tooltip content={<span className="line-clamp-4">{full}</span>}>
            <span>{nobreak(label)}</span>
          </Tooltip>
        )
      }
      fact={
        <span className="flex items-baseline gap-3">
          <Time at={rejected ? job.updated_at : job.opened_at} short className="min-w-[3ch] text-right text-xs text-fg-subtle" />
          {job.score != null && <FitFact value={job.score} threshold={threshold} />}
        </span>
      }
    />
  );
}
