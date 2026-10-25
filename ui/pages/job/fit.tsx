// The Fit tab: the whole checklist the score came from, what cost points first, and the practice verdict.
import { Check, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Disclosure, EmptyState, Score, Section, StatusLabel } from "../../components/ui";
import { cn } from "../../lib/cn";
import { checklistOf, groupsOf, itemLabel, practiceOf, tally, type Item, type Phase } from "./model";

const MARK = {
  no: <X className="size-4 text-danger-text" />,
  unclear: <CircleHelp className="size-4 text-fg-subtle" />,
  yes: <Check className="size-4 text-success-text" />,
};

function ItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="mt-0.5 shrink-0">{MARK[item.answer]}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 text-sm text-fg">
            <span className="font-medium">{itemLabel(item)}</span>
            <span className="text-fg-muted">. {item.statement}</span>
          </p>
          <span className="tabular shrink-0 text-xs text-fg-subtle">{item.required ? "Required" : `${item.points} / ${item.weight}`}</span>
        </div>
        {item.evidence && (
          <button
            type="button"
            onClick={() => {
              setOpen(!open);
            }}
            className={cn("mt-1 block text-left text-sm text-fg-muted hover:text-fg", !open && "line-clamp-2")}
          >
            {item.evidence}
          </button>
        )}
      </div>
    </li>
  );
}

function Group({ title, items }: { title: string; items: Item[] }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 text-xs font-medium text-fg-subtle">
        {title}
        <span className="tabular">{items.length}</span>
      </div>
      <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
        {items.map(i => (
          <ItemRow key={i.key} item={i} />
        ))}
      </ul>
    </div>
  );
}

function Checklist({ items }: { items: Item[] }) {
  const g = groupsOf(items);
  return (
    <div className="flex flex-col gap-5">
      {!g.missed.length && <p className="text-sm text-fg-muted">Nothing missed.</p>}
      <Group title="Missed" items={g.missed} />
      <Group title="Unclear" items={g.unclear} />
      <Group title="Met" items={g.met} />
    </div>
  );
}

function PracticeEvidence({ job, phase }: { job: JobDetail; phase: Phase }) {
  const p = practiceOf(job, phase);
  if (!p) return null;
  return (
    <Section title="Practice eligibility" actions={<StatusLabel tone={p.qualifies ? "success" : "neutral"} label={p.verdict} className="text-fg" />}>
      <p className="max-w-[68ch] text-base text-fg">{/[.)]$/.test(p.reason) ? p.reason : `${p.reason}.`}</p>
      {p.rows.length > 0 && (
        <dl className="mt-4 grid grid-cols-[minmax(96px,auto)_1fr] gap-x-6 gap-y-3 text-sm">
          {p.rows.map(([label, value, evidence]) => (
            <div key={label} className="contents">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="min-w-0">
                <span className="text-fg">{value}</span>
                {evidence && <p className="mt-0.5 text-fg-muted">{evidence}</p>}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </Section>
  );
}

export function Fit({ job, phase, threshold }: { job: JobDetail; phase: Phase; threshold: number | null }) {
  const items = checklistOf(job);
  const here = items.filter(i => i.phase === phase),
    real = phase === "practice" ? items.filter(i => i.phase === "real") : [];
  if (job.score == null && !items.length)
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Not scored yet" description="The checklist shows here once the job is assessed." className="py-10" />
        <PracticeEvidence job={job} phase={phase} />
      </div>
    );
  const t = tally(here),
    r = tally(real);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-5">
        <Score value={job.score} threshold={threshold} size="lg" />
        <div className="text-sm text-fg-muted">
          <p className="text-fg">
            {here.length ? (
              <>
                <span className="tabular font-medium">{t.points}</span> of <span className="tabular">{t.of}</span> points
              </>
            ) : (
              `Scored ${job.score ?? "–"}`
            )}
          </p>
          <p>
            {phase === "practice" ? "Practice" : "Real"} phase{threshold != null && `, needs ${threshold}`}
          </p>
        </div>
      </div>
      {here.length ? <Checklist items={here} /> : <p className="text-sm text-fg-muted">This assessment predates the checklist.</p>}
      {real.length > 0 && (
        <Disclosure id="real-phase" summary={`Real-phase score: ${r.points} of ${r.of} points`}>
          <div className="pt-2">
            <Checklist items={real} />
          </div>
        </Disclosure>
      )}
      <PracticeEvidence job={job} phase={phase} />
    </div>
  );
}
