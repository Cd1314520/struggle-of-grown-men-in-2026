// The Fit tab: the whole checklist the score came from, what cost points first, and the practice verdict.
import { Check, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Disclosure, EmptyState, Properties, Score, Section } from "../../components/ui";
import { cn } from "../../lib/cn";
import { checklistOf, groupsOf, itemLabel, practiceOf, tally, type Item, type Phase } from "./model";

const MARK = {
  no: <X className="size-4 text-danger-text" />,
  unclear: <CircleHelp className="size-4 text-fg-subtle" />,
  yes: <Check className="size-4 text-success-text" />,
};

function ItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  // What the item weighs leads its evidence, so the statement gets the whole line above.
  const weight = <span className="tabular mr-2 font-medium text-fg-muted">{item.required ? "Required" : `${item.points} / ${item.weight}`}</span>;
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 shrink-0">{MARK[item.answer]}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          <span className="font-medium">{itemLabel(item)}</span>
          <span className="text-fg-muted">. {item.statement}</span>
        </p>
        {item.evidence ? (
          <button
            type="button"
            onClick={() => {
              setOpen(!open);
            }}
            className={cn("mt-1 block text-left text-sm text-fg-muted hover:text-fg", !open && "line-clamp-2")}
          >
            {weight}
            {item.evidence}
          </button>
        ) : (
          <p className="mt-1 text-sm">{weight}</p>
        )}
      </div>
    </li>
  );
}

function Group({ title, items }: { title: string; items: Item[] }) {
  if (!items.length) return null;
  return (
    <Section title={title} count={items.length}>
      <ul className="divide-y divide-border border-y border-border">
        {items.map(i => (
          <ItemRow key={i.key} item={i} />
        ))}
      </ul>
    </Section>
  );
}

function Checklist({ items }: { items: Item[] }) {
  const g = groupsOf(items);
  return (
    <div className="flex flex-col gap-8">
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
    <Section title="Practice eligibility">
      <p className="text-base text-fg">
        <span className="font-semibold">{p.verdict}.</span> {/[.)]$/.test(p.reason) ? p.reason : `${p.reason}.`}
      </p>
      {p.rows.length > 0 && (
        <Properties
          className="mt-4"
          items={p.rows.map(
            ([label, value, evidence]) =>
              [
                label,
                <div key={label}>
                  <span className="text-fg">{value}</span>
                  {evidence && <p className="mt-0.5 text-fg-muted">{evidence}</p>}
                </div>,
              ] as const,
          )}
        />
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

// A list row's one fact where the fit is what matters: "Fit 88", the number toned as everywhere else.
export function FitFact({ value, threshold }: { value: number | null; threshold: number | null }) {
  return (
    <span className="flex items-baseline gap-1">
      Fit
      <Score value={value} threshold={threshold} />
    </span>
  );
}
