import { Check, CircleHelp, X } from "lucide-react";
import type { JobDetail, Summary } from "../../../src/api-types";
import { Clamp, Disclosure, EmptyState, Properties, Score, Section, Subhead } from "../../components/ui";
import { cn } from "../../lib/cn";
import { checklistOf, groupsOf, itemLabel, practiceOf, tally, type Item, type Phase } from "./model";

const MARK = {
  no: <X className="size-4 text-danger-text" />,
  unclear: <CircleHelp className="size-4 text-warning-text" />,
  yes: <Check className="size-4 text-success-text" />,
};

function ItemRow({ item }: { item: Item }) {
  const unsettled = item.required && item.answer === "unclear";
  const weight = (
    <span className={cn("tabular font-medium", unsettled ? "text-warning-text" : "text-fg-muted")}>
      {item.required ? (unsettled ? "Must pass, not settled" : "Must pass") : `${item.points} / ${item.weight}`}
    </span>
  );
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 shrink-0">{MARK[item.answer]}</span>
      <div className="min-w-0 flex-1">
        {item.answer === "yes" ? (
          <p className="text-sm font-medium text-fg" title={item.statement}>
            {itemLabel(item)}
          </p>
        ) : (
          <p className="text-sm text-fg">
            <span className="font-medium">{itemLabel(item)}</span>
            <span className="text-fg-muted">. {item.statement}</span>
          </p>
        )}
        {item.evidence ? (
          <Clamp lines={2} className="mt-1 text-sm text-fg-muted">
            {weight}
            <span aria-hidden className="mx-1.5 text-fg-subtle">
              ·
            </span>
            {item.evidence}
          </Clamp>
        ) : (
          <p className="mt-1 text-sm">{weight}</p>
        )}
      </div>
    </li>
  );
}

function Passed({ items }: { items: Item[] }) {
  return (
    <Disclosure summary={`Passed ${items.length} must-pass ${items.length === 1 ? "check" : "checks"}`} className="py-3">
      <ul className="flex flex-col gap-1.5">
        {items.map(i => (
          <li key={i.key} className="flex items-start gap-2" title={i.statement}>
            <Check className="mt-0.5 size-4 shrink-0 text-success-text" />
            <span className="min-w-0">
              <span className="text-fg">{itemLabel(i)}</span>
              {i.evidence && <span className="text-fg-muted">: {i.evidence}</span>}
            </span>
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}

function Group({ title, items, nested }: { title: string; items: Item[]; nested: boolean }) {
  if (!items.length) return null;
  const rows = items.filter(i => !(i.required && i.answer === "yes")),
    passed = items.filter(i => i.required && i.answer === "yes");
  const list = (
    <div className="border-y border-border">
      {rows.length > 0 && (
        <ul className="divide-y divide-border">
          {rows.map(i => (
            <ItemRow key={i.key} item={i} />
          ))}
        </ul>
      )}
      {passed.length > 0 && (
        <div className={cn(rows.length > 0 && "border-t border-border")}>
          <Passed items={passed} />
        </div>
      )}
    </div>
  );
  if (nested)
    return (
      <div>
        <Subhead count={items.length} className="mb-2">
          {title}
        </Subhead>
        {list}
      </div>
    );
  return (
    <Section title={title} count={items.length}>
      {list}
    </Section>
  );
}

function Checklist({ items, nested = false }: { items: Item[]; nested?: boolean }) {
  const g = groupsOf(items);
  return (
    <div className={nested ? "flex flex-col gap-6" : "flex flex-col gap-8"}>
      <Group title="Missed" items={g.missed} nested={nested} />
      <Group title="Unclear" items={g.unclear} nested={nested} />
      <Group title="Met" items={g.met} nested={nested} />
    </div>
  );
}

function PracticeEvidence({ job, targets }: { job: JobDetail; targets: Summary["targets"] }) {
  const p = practiceOf(job, targets);
  if (!p) return null;
  const reason = p.reason.toLowerCase();
  const repeats = p.rows.some(
    ([, value, evidence]) => reason.includes(value.toLowerCase()) || (!!evidence && reason.includes(evidence.toLowerCase().slice(0, 40))),
  );
  return (
    <Section title="Practice eligibility">
      <p className="text-base text-fg">
        <span className="font-semibold">{p.verdict}.</span>
        {!repeats && ` ${/[.)]$/.test(p.reason) ? p.reason : `${p.reason}.`}`}
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

export function Fit({ job, phase, targets, threshold }: { job: JobDetail; phase: Phase; targets: Summary["targets"]; threshold: number | null }) {
  const items = checklistOf(job);
  const here = items.filter(i => i.phase === phase),
    other = items.filter(i => i.phase !== phase);
  if (job.score == null && !items.length)
    return (
      <div className="flex flex-col gap-8">
        <EmptyState title="Not scored yet" description="The checklist shows here once the job is assessed." className="py-10" />
        <PracticeEvidence job={job} targets={targets} />
      </div>
    );
  const t = tally(here),
    o = tally(other);
  return (
    <div className="flex flex-col gap-8">
      <p className="text-sm text-fg-muted">
        {here.length ? (
          <>
            <span className="tabular font-medium text-fg">{t.points}</span> of <span className="tabular">{t.of}</span> points on the {phase} rubric
            {job.score != null && (
              <>
                , a fit of <span className="tabular font-medium text-fg">{job.score}</span>
              </>
            )}
          </>
        ) : (
          `Scored ${job.score ?? "–"} on the ${phase} rubric`
        )}
        {threshold != null && `, needs ${threshold}`}
      </p>
      {here.length ? <Checklist items={here} /> : <p className="text-sm text-fg-muted">This assessment predates the checklist.</p>}
      {other.length > 0 && (
        <Disclosure id="other-rubric" summary={`${phase === "practice" ? "Real" : "Practice"} rubric: ${o.points} of ${o.of} points`}>
          <div className="pt-2">
            <Checklist items={other} nested />
          </div>
        </Disclosure>
      )}
      <PracticeEvidence job={job} targets={targets} />
    </div>
  );
}

export function FitFact({ value, threshold, bare = false }: { value: number | null; threshold: number | null; bare?: boolean }) {
  if (bare)
    return (
      <span title="Fit" aria-label={value == null ? "Fit not scored" : `Fit ${value}`}>
        <Score value={value} threshold={threshold} className="inline-block min-w-[3ch] text-right" />
      </span>
    );
  return (
    <span className="flex items-baseline gap-1">
      Fit
      <Score value={value} threshold={threshold} className="inline-block min-w-[3ch] text-right" />
    </span>
  );
}
