import { Check, CircleHelp, ExternalLink, Info, X } from "lucide-react";
import type { JobDetail, Summary } from "../../../src/api-types";
import { SENT } from "../../../src/status";
import { Callout, Clamp, Properties, Section, Subhead } from "../../components/ui";
import { cap } from "../../lib/format";
import { checklistOf, groupsOf, itemLabel, practiceOf, resumeChangesOf, resumeNote, risksOf, verdictOf, type Item, type Phase } from "./model";

const MARK = {
  no: <X className="mt-0.5 size-4 shrink-0 text-danger-text" />,
  unclear: <CircleHelp className="mt-0.5 size-4 shrink-0 text-warning-text" />,
  yes: <Check className="mt-0.5 size-4 shrink-0 text-success-text" />,
};

function CheckList({ title, items }: { title: string; items: Item[] }) {
  const shown = items.slice(0, 4);
  return (
    <div className="min-w-0">
      <Subhead count={items.length} className="mb-2">
        {title}
      </Subhead>
      <ul className="flex flex-col gap-2">
        {shown.map(i => (
          <li key={i.key} className="flex items-start gap-2 text-sm text-fg" title={i.statement}>
            {MARK[i.answer]}
            <span className="min-w-0">
              {itemLabel(i)}
              {i.required && i.answer !== "yes" && <span className="text-fg-muted"> (must pass)</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function needsYou(job: JobDetail) {
  if (job.status !== "awaiting_approval" || !job.note || !/^needs your review:/i.test(job.note)) return null;
  const why = job.note
    .replace(/^needs your review:\s*/i, "")
    .replace(/^the posting does not settle:/i, "the posting doesn't settle:")
    .replace(/\bthis employer\b/i, job.company)
    .trim();
  return why ? cap(why) : null;
}

const times = (n: number) => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);

export function Overview({ job, phase, targets }: { job: JobDetail; phase: Phase; targets: Summary["targets"]; openTab?: (tab: string) => void }) {
  const items = checklistOf(job).filter(i => i.phase === phase);
  const { misses, hits } = verdictOf(items);
  const unclear = groupsOf(items).unclear.filter(i => i.required || i.weight >= 20);
  const risks = risksOf(job.concerns).slice(0, 3);
  const practice = practiceOf(job, targets);
  const sentThere = job.siblings.filter(s => SENT.includes(s.status)).length;
  const why = needsYou(job);
  const applied = sentThere > 0 && !/already applying/i.test(why ?? "") ? `You already applied to ${job.company} ${times(sentThere)}.` : null;

  if (!job.rationale && !items.length && !risks.length && job.score == null) return <p className="text-base text-fg-muted">Not assessed yet.</p>;

  const columns = [
    misses.length > 0 && <CheckList key="m" title="Misses" items={misses} />,
    unclear.length > 0 && <CheckList key="u" title="Unclear" items={unclear} />,
    hits.length > 0 && <CheckList key="h" title="Matches" items={hits} />,
  ].filter(Boolean);
  const changes = resumeChangesOf(job.resume_changes).length;
  const resume = job.hasPdf
    ? resumeNote(job)
    : job.resumeFrozen
      ? "Locked, no PDF on file"
      : `${changes ? `${changes} ${changes === 1 ? "change" : "changes"}` : "Base resume"}, no PDF yet`;
  const practiceFlag = practice && !practice.qualifies ? practice : null;

  return (
    <div className="flex flex-col gap-8">
      {(why ?? applied) && (
        <Callout tone={why ? "warning" : "neutral"} icon={why ? <CircleHelp /> : <Info />}>
          {why && <p className="text-sm text-fg">{why}</p>}
          {applied && <p className="text-sm text-fg">{applied}</p>}
        </Callout>
      )}

      {job.rationale && (
        <Section title="Why it fits">
          <Clamp lines={4} className="text-base leading-relaxed text-fg">
            {job.rationale}
          </Clamp>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Watch out">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-fg marker:text-fg-subtle">
            {risks.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Section>
      )}

      {columns.length > 0 && (
        <Section title="Matches and misses">
          <div className={columns.length === 3 ? "grid grid-cols-1 gap-x-8 gap-y-5 @lg:grid-cols-3" : "grid grid-cols-1 gap-x-8 gap-y-5 @lg:grid-cols-2"}>
            {columns}
          </div>
        </Section>
      )}

      <Section title="Details">
        <Properties
          items={[
            [
              "Resume",
              <div key="r" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={!job.hasPdf && job.status === "awaiting_approval" ? "text-warning-text" : undefined}>{resume}</span>
                {job.hasPdf && (
                  <a
                    href={`/api/jobs/${job.id}/resume.pdf`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-accent-text underline-offset-2 hover:underline"
                  >
                    Open resume
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>,
            ],
            practiceFlag && [
              "Practice",
              <div key="p" className="flex flex-col gap-0.5">
                <span className="font-medium text-fg">{practiceFlag.verdict}</span>
                <span className="text-fg-muted">{practiceFlag.reason}</span>
              </div>,
            ],
          ]}
        />
      </Section>
    </div>
  );
}
