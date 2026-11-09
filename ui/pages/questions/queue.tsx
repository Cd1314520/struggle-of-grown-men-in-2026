import { Fragment, useEffect } from "react";
import type { QuestionGroup } from "../../../src/questions";
import { CompanyMark, ListGroup, ListRow, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { href } from "../../lib/router";
import { whyLabel } from "../../lib/why";
import { questionText, sections } from "./model";

function QueueRow({ group, selected, desktopOnly }: { group: QuestionGroup; selected: boolean; desktopOnly: boolean }) {
  const company = group.jobs[0]?.company ?? "";
  const many = group.jobs.length;
  const gist = [whyLabel(group.why), many > 1 ? plural(many, "application") : null].filter(Boolean).join(" · ");
  return (
    <ListRow
      href={href("questions", group.key)}
      data-question={group.key}
      selected={selected}
      tabIndex={selected ? undefined : -1}
      aria-current={selected && !desktopOnly ? "true" : undefined}
      className={cn(desktopOnly && "max-lg:bg-transparent max-lg:before:hidden")}
      lead={<CompanyMark name={company} />}
      title={questionText(group.text)}
      titleLines={3}
      secondary={company}
      gist={gist || null}
      fact={<Time at={group.createdAt} short />}
      snippet={group.missing ? `Missing: ${group.missing}` : null}
    />
  );
}

export function Queue({ groups, selected, desktopOnly }: { groups: readonly QuestionGroup[]; selected: string; desktopOnly: boolean }) {
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(`[data-question="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (row && document.activeElement !== row && document.activeElement?.matches("a[data-question]")) row.focus({ preventScroll: true });
  }, [selected]);
  return (
    <nav aria-label="Questions to answer">
      <div role="table" aria-label="Questions">
        {sections(groups).map(s => (
          <Fragment key={s.label}>
            <ListGroup label={s.label} count={s.groups.length} />
            {s.groups.map(g => (
              <QueueRow key={g.key} group={g} selected={g.key === selected} desktopOnly={desktopOnly} />
            ))}
          </Fragment>
        ))}
      </div>
    </nav>
  );
}
