import type { ReactNode } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Clamp, Disclosure, Section, StatusDot } from "../../components/ui";
import { cn } from "../../lib/cn";
import { cap, clock, dayLabel, plain, plural } from "../../lib/format";
import { CAUSE, STATUS, type Tone } from "../../lib/labels";
import { timelineOf, workerName, type Entry } from "./model";

type Chatter = Extract<Entry, { type: "run" }> | Extract<Entry, { type: "event" }>;
type Item = { kind: "entry"; e: Entry } | { kind: "agent"; who: string; at: number; from: number; parts: Chatter[] };

const NEAR = 5000;
const SESSION = /\s*\((?:[\w ]+ )?session [\w-]+\)\s*$/i;
const PARKED = /worker stopped: parked on \w+ gate/i;
const AUTO = /^Approved by auto apply:?\s*/i;
const STOPPED = /worker (stopped|aborted)/i;
const KEEP = new Set(["Recheck", "App"]);

const clean = (text: string) => text.replace(SESSION, "");

function Detail({ text }: { text: string }) {
  if (!text) return null;
  return (
    <Clamp lines={2} touchLines={3} className="mt-0.5 text-sm text-fg-muted">
      {cap(plain(clean(text)))}
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

const chatterOf = (e: Entry): string | null => {
  if (e.type === "run") return workerName(e.worker);
  if (e.type === "event" && e.tone === "neutral" && !KEEP.has(e.title) && !AUTO.test(e.detail) && !STOPPED.test(e.detail)) return e.title;
  return null;
};

function itemsOf(job: JobDetail): Item[] {
  const all = timelineOf(job);
  const near = (a: Entry, b: Entry) => Math.abs(a.at - b.at) <= NEAR;
  const gate = (e: Entry) => (e.type === "event" && e.tone === "warning") || e.type === "blocker";
  const statusIdx = all.flatMap((e, i) => (e.type === "status" ? [i] : []));
  const entries = all
    .map(e => {
      if (e.type === "status" && e.to === "approved" && e.auto && !e.note) {
        const why = all.find(o => o.type === "event" && AUTO.test(o.detail) && near(o, e));
        if (why?.type === "event") return { ...e, note: why.detail.replace(AUTO, "") };
      }
      return e;
    })
    .filter((e, i) => {
      if (e.type === "event" && PARKED.test(e.detail)) return !all.some(o => gate(o) && near(o, e));
      if (e.type === "event" && AUTO.test(e.detail)) return !all.some(o => o.type === "status" && o.auto && near(o, e));
      if (e.type !== "status" || e.note || e.auto) return true;
      if (all.some(o => gate(o) && near(o, e))) return false;
      const newer = all[statusIdx.filter(j => j < i).at(-1) ?? -1];
      return !newer || newer.at - e.at > 60000;
    });
  const out: Item[] = [];
  for (const e of entries) {
    const who = chatterOf(e);
    const last = out.at(-1);
    if (!who) out.push({ kind: "entry", e });
    else if (last?.kind === "agent" && last.who === who) {
      last.parts.push(e as Chatter);
      last.from = e.type === "run" ? e.from : e.at;
    } else out.push({ kind: "agent", who, at: e.at, from: e.type === "run" ? e.from : e.at, parts: [e as Chatter] });
  }
  return out;
}

function Line({ tone, title, time, last, quiet, children }: { tone: Tone; title: string; time: string; last: boolean; quiet?: boolean; children?: ReactNode }) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {!last && <span aria-hidden className="absolute top-4 bottom-0 left-[3.5px] w-px bg-border" />}
      <StatusDot tone={tone} className="mt-1.5" />
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm", quiet ? "text-fg-muted" : "font-medium text-fg")}>
          {title}
          <span className="tabular ml-2 font-normal whitespace-nowrap text-fg-muted">{time}</span>
        </p>
        {children}
      </div>
    </li>
  );
}

const span = (from: number, at: number) => (clock(from) !== clock(at) ? `${clock(from)}–${clock(at)}` : clock(at));

function Steps({ steps }: { steps: string[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border font-mono text-xs leading-5">
      {[...steps].reverse().map((s, i) => (
        <li key={i} className="line-clamp-3 py-1.5 break-all first:pt-0 last:pb-0" title={s}>
          {s}
        </li>
      ))}
    </ol>
  );
}

function Agent({ item, last }: { item: Extract<Item, { kind: "agent" }>; last: boolean }) {
  const said = item.parts.filter(p => p.type === "event");
  const steps = item.parts.reduce((n, p) => n + (p.type === "run" ? p.steps.length : 0), 0);
  const lead = said[0]?.detail ?? "";
  const summary = [said.length > 1 && plural(said.length, "update"), steps > 0 && plural(steps, "step")].filter(Boolean).join(", ");
  const more = said.length > 1 || steps > 0;
  return (
    <Line tone="neutral" title={item.who} time={span(item.from, item.at)} last={last} quiet>
      <Detail text={lead} />
      {more && (
        <Disclosure summary={`Show ${summary}`} className="mt-1">
          <ol className="flex flex-col gap-3">
            {item.parts.map((p, i) => (
              <li key={i}>
                <p className="tabular text-xs text-fg-muted">{p.type === "run" ? `${span(p.from, p.at)}, ${plural(p.steps.length, "step")}` : clock(p.at)}</p>
                {p.type === "run" ? (
                  <Steps steps={p.steps} />
                ) : (
                  <p className="mt-0.5 text-sm break-words whitespace-pre-line text-fg">{cap(plain(clean(p.detail)))}</p>
                )}
              </li>
            ))}
          </ol>
        </Disclosure>
      )}
    </Line>
  );
}

function Row({ e, last }: { e: Entry; last: boolean }) {
  const d = describe(e);
  return (
    <Line tone={d.tone} title={d.title} time={e.type === "run" ? span(e.from, e.at) : clock(e.at)} last={last}>
      <Detail text={d.detail} />
      {e.type === "run" && (
        <Disclosure summary="Show steps" className="mt-1">
          <Steps steps={e.steps} />
        </Disclosure>
      )}
    </Line>
  );
}

export function Activity({ job }: { job: JobDetail }) {
  const items = itemsOf(job);
  if (!items.length) return <p className="text-base text-fg-muted">Nothing has happened to this job yet.</p>;
  const days: [string, Item[]][] = [];
  for (const it of items) {
    const label = dayLabel(it.kind === "entry" ? it.e.at : it.at),
      last = days.at(-1);
    if (last?.[0] === label) last[1].push(it);
    else days.push([label, [it]]);
  }
  return (
    <div className="flex flex-col gap-8">
      {days.map(([label, list]) => (
        <Section key={label} title={label}>
          <ol>
            {list.map((it, i) =>
              it.kind === "entry" ? (
                <Row key={`${it.e.type}${it.e.at}${i}`} e={it.e} last={i === list.length - 1} />
              ) : (
                <Agent key={`agent${it.at}${i}`} item={it} last={i === list.length - 1} />
              ),
            )}
          </ol>
        </Section>
      ))}
    </div>
  );
}
