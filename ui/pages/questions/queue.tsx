// The queue: every open question, newest posting first, under how long ago the posting opened.
import { Fragment, useEffect } from "react";
import type { QuestionGroup } from "../../../src/questions";
import { CompanyMark, ListGroup, ListRow, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { href } from "../../lib/router";
import { questionText, sections } from "./model";

// `desktopOnly`: nothing is open on a phone yet, but the desktop shows the first question beside the queue.
// Rows and group headings are the Review queue's, so the two inboxes read alike.
function QueueRow({ group, selected, desktopOnly }: { group: QuestionGroup; selected: boolean; desktopOnly: boolean }) {
  const company = group.jobs[0]?.company ?? "";
  const many = group.jobs.length;
  return (
    <ListRow
      href={href("questions", group.key)}
      data-question={group.key}
      selected={selected}
      // Only the open question's row is a tab stop, so Tab reaches its options; J/K walk the queue.
      tabIndex={selected ? undefined : -1}
      aria-current={selected && !desktopOnly ? "true" : undefined}
      className={cn(desktopOnly && "max-lg:bg-transparent max-lg:before:hidden")}
      lead={<CompanyMark name={company} />}
      // A question is the whole point of the row: it gets a third line at every width.
      title={questionText(group.text)}
      titleLines={3}
      secondary={company}
      // One answer resumes every application that asked it: how many is what matters past the employer.
      gist={many > 1 && <span className="tabular">{plural(many, "application")}</span>}
      fact={<Time at={group.createdAt} short />}
    />
  );
}

export function Queue({ groups, selected, desktopOnly }: { groups: readonly QuestionGroup[]; selected: string; desktopOnly: boolean }) {
  // J/K and a save move the open question; keep its row in sight, and focus on a row with it, so the
  // queue keeps its one tab stop.
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(`[data-question="${CSS.escape(selected)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (row && document.activeElement !== row && document.activeElement?.matches("a[data-question]")) row.focus({ preventScroll: true });
  }, [selected]);
  return (
    <nav aria-label="Questions to answer">
      {/* Headings and rows are siblings, as in Review: each heading sticks until the next covers it. */}
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
