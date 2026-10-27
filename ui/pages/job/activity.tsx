// The Activity tab: one timeline of status moves, stops and the log, newest first, grouped by day.
import type { JobDetail } from "../../../src/api-types";
import { Clamp, Disclosure, StatusDot, Subhead } from "../../components/ui";
import { cap, clock, dayLabel, plain, plural } from "../../lib/format";
import { CAUSE, STATUS, type Tone } from "../../lib/labels";
import { timelineOf, workerName, type Entry } from "./model";

function Detail({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Clamp lines={2} touchLines={3} className="mt-0.5 text-sm text-fg-muted">
      {cap(plain(text))}
    </Clamp>
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
        <p className="text-sm font-medium text-fg">
          {d.title}
          <span className="tabular ml-2 font-normal whitespace-nowrap text-fg-muted">
            {e.type === "run" && clock(e.from) !== clock(e.at) ? `${clock(e.from)}–${clock(e.at)}` : clock(e.at)}
          </span>
        </p>
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
          <Subhead className="mb-3">{label}</Subhead>
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
