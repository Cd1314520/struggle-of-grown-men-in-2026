// The queue: every open question, newest posting first, under how long ago the posting opened.
import { Fragment, useEffect } from "react";
import type { QuestionGroup } from "../../../src/questions";
import { CompanyMark, Count, TableCell, TableGroup, TableRow, Time, Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { href } from "../../lib/router";
import { questionText, sections } from "./model";

// `desktopOnly`: nothing is open on a phone yet, but the desktop shows the first question beside the queue.
// Rows and group headings are the Review queue's, so the two inboxes read alike.
function QueueRow({ group, selected, desktopOnly }: { group: QuestionGroup; selected: boolean; desktopOnly: boolean }) {
  const company = group.jobs[0]?.company ?? "";
  const many = group.jobs.length;
  return (
    <TableRow
      columns="32px minmax(0,1fr)"
      href={href("questions", group.key)}
      data-question={group.key}
      selected={selected}
      // Only the open question's row is a tab stop, so Tab reaches its options; J/K walk the queue.
      tabIndex={selected ? undefined : -1}
      aria-current={selected && !desktopOnly ? "true" : undefined}
      className={cn("grid scroll-mt-10 items-start gap-x-3 py-3", desktopOnly && "max-lg:bg-transparent max-lg:before:hidden")}
    >
      <CompanyMark name={company} />
      <TableCell>
        <p className="line-clamp-2 font-medium break-words text-fg">{questionText(group.text)}</p>
        <div className="mt-0.5 flex items-center gap-2 text-fg-muted">
          <span className="min-w-0 flex-1 truncate">{company}</span>
          {many > 1 && (
            <Tooltip content={`Asked by ${many} applications`}>
              <span>
                <Count value={many} />
              </span>
            </Tooltip>
          )}
          <Time at={group.createdAt} className="text-xs text-fg-subtle" />
        </div>
      </TableCell>
    </TableRow>
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
    <nav aria-label="Questions to answer" className="pb-6">
      {/* Headings and rows are siblings, as in Review: each heading sticks until the next covers it. */}
      {sections(groups).map(s => (
        <Fragment key={s.label}>
          <TableGroup label={s.label} count={s.groups.length} className="sticky top-12 z-10 bg-subtle lg:top-0" />
          {s.groups.map(g => (
            <QueueRow key={g.key} group={g} selected={g.key === selected} desktopOnly={desktopOnly} />
          ))}
        </Fragment>
      ))}
    </nav>
  );
}
