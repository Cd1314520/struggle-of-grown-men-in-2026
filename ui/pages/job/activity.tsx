// The Activity tab: one timeline of status moves, stops and the log, newest first, grouped by day.
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Disclosure, Overline, StatusDot } from "../../components/ui";
import { cn } from "../../lib/cn";
import { cap, clock, dayLabel, plain, plural } from "../../lib/format";
import { CAUSE, STATUS, type Tone } from "../../lib/labels";
import { timelineOf, workerName, type Entry } from "./model";

function Detail({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <button
      type="button"
      onClick={() => {
        setOpen(!open);
      }}
      className={cn("mt-0.5 block text-left text-sm break-words whitespace-pre-line text-fg-muted hover:text-fg", !open && "line-clamp-2")}
    >
      {cap(plain(text))}
    </button>
  );
}

function describe(e: Entry): { tone: Tone; title: string; detail: string } {
  if (e.type === "status")
    return {
      tone: STATUS[e.to][1],
      title: e.to === "approved" && e.auto ? "Approved automatically" : `Moved to ${STATUS[e.to][0]}`,
      detail: e.note ?? "",
    };
  if (e.type === "blocker") return { tone: "danger", title: `Stopped: ${CAUSE[e.cause]}`, detail: e.detail };
  if (e.type === "event") return e;
  return { tone: "neutral", title: `${workerName(e.worker)} worked through ${plural(e.steps.length, "step")}`, detail: "" };
}

function Row({ e, last }: { e: Entry; last: boolean }) {
  const d = describe(e);
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-4 bottom-0 left-[3.5px] w-px bg-border" />}
      <StatusDot tone={d.tone} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-3">
          <p className="min-w-0 flex-1 text-sm font-medium text-fg">{d.title}</p>
          <span className="tabular shrink-0 text-xs text-fg-subtle">
            {e.type === "run" && clock(e.from) !== clock(e.at) ? `${clock(e.from)}–${clock(e.at)}` : clock(e.at)}
          </span>
        </div>
        <Detail text={d.detail} />
        {e.type === "run" && (
          <Disclosure summary="Show steps" className="mt-1">
            <ol className="flex flex-col gap-1">
              {[...e.steps].reverse().map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </Disclosure>
        )}
      </div>
    </li>
  );
}

export function Activity({ job }: { job: JobDetail }) {
  const entries = timelineOf(job);
  if (!entries.length) return <p className="text-base text-fg-muted">Nothing has happened to this job yet.</p>;
  const days: [string, Entry[]][] = [];
  for (const e of entries) {
    const label = dayLabel(e.at),
      last = days.at(-1);
    if (last?.[0] === label) last[1].push(e);
    else days.push([label, [e]]);
  }
  return (
    <div className="flex flex-col gap-6">
      {days.map(([label, list]) => (
        <section key={label}>
          <Overline className="mb-3">{label}</Overline>
          <ol>
            {list.map((e, i) => (
              <Row key={`${e.type}${e.at}${i}`} e={e} last={i === list.length - 1} />
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
