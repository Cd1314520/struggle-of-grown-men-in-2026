// The Overview tab: why the job fits, what to watch out for, and the few facts that bear on the decision.
import { ArrowRight, Check, CircleAlert, ExternalLink, X } from "lucide-react";
import type { JobDetail } from "../../../src/api-types";
import { Button, Clamp, Properties, Section, Subhead } from "../../components/ui";
import { checklistOf, itemLabel, practiceOf, resumeNote, risksOf, verdictOf, type Item, type Phase } from "./model";

// The first few of a side, under a count of them all.
function CheckList({ title, items, met }: { title: string; items: Item[]; met: boolean }) {
  const shown = items.slice(0, 4);
  return (
    <div className="min-w-0">
      <Subhead count={items.length || undefined} className="mb-2">
        {title}
      </Subhead>
      {shown.length ? (
        <ul className="flex flex-col gap-2">
          {shown.map(i => (
            <li key={i.key} className="flex items-start gap-2 text-sm text-fg" title={i.statement}>
              {met ? <Check className="mt-0.5 size-4 shrink-0 text-success-text" /> : <X className="mt-0.5 size-4 shrink-0 text-danger-text" />}
              <span className="min-w-0">
                {itemLabel(i)}
                {i.required && !met && <span className="text-fg-muted"> (required)</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">{met ? "Nothing scored as met." : "Nothing missed."}</p>
      )}
    </div>
  );
}

export function Overview({ job, phase, openTab }: { job: JobDetail; phase: Phase; openTab: (tab: string) => void }) {
  const items = checklistOf(job).filter(i => i.phase === phase);
  const { misses, hits } = verdictOf(items);
  const risks = risksOf(job.concerns).slice(0, 3);
  const practice = practiceOf(job, phase);
  // The header counts the employer's other roles; what bears on this one is whether any went out.
  const sentThere = job.siblings.filter(s => ["submitted", "interview", "offer", "rejected_by_company", "withdrawn"].includes(s.status)).length;

  if (!job.rationale && !items.length && !risks.length && job.score == null)
    return <p className="text-base text-fg-muted">Not assessed yet. The fit, the risks and a tailored resume show here once it is.</p>;

  return (
    <div className="flex flex-col gap-8">
      {job.rationale && (
        <Section title="Why it fits">
          <Clamp lines={4} className="text-base leading-relaxed text-fg">
            {job.rationale}
          </Clamp>
        </Section>
      )}

      {items.length > 0 && (
        <Section
          title="Matches and misses"
          actions={
            <Button
              variant="link"
              size="sm"
              className="px-0 touch:px-0"
              onClick={() => {
                openTab("fit");
              }}
            >
              All {items.length} checks
              <ArrowRight />
            </Button>
          }
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 @lg:grid-cols-2">
            <CheckList title="Misses" items={misses} met={false} />
            <CheckList title="Matches" items={hits} met />
          </div>
        </Section>
      )}

      {risks.length > 0 && (
        <Section title="Watch out">
          <ul className="flex flex-col gap-2.5">
            {risks.map(r => (
              <li key={r} className="flex items-start gap-2.5 text-base text-fg">
                <CircleAlert className="mt-[3px] size-4 shrink-0 text-fg-subtle" />
                {r}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Details">
        <Properties
          items={[
            practice && [
              "Practice",
              <div key="p" className="flex flex-col gap-0.5">
                <span className="font-medium text-fg">{practice.verdict}</span>
                <span className="text-fg-muted">{practice.reason}</span>
              </div>,
            ],
            [
              "Resume",
              <div key="r" className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>{resumeNote(job)}</span>
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
            sentThere > 0 && ["Applied here", `${sentThere} other ${sentThere === 1 ? "application" : "applications"} to ${job.company}`],
          ]}
        />
      </Section>
    </div>
  );
}
