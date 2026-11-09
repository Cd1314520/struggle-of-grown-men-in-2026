import type { NextStep } from "../../../src/steps";
import { Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { ago, agoShort, brief, cap, clock, DAY, dateTime, HOUR, parseAt, plain, span } from "../../lib/format";

const msOf = (at: string) => (at.length === 10 ? Date.parse(`${at}T23:59:59`) : parseAt(at));

const daysFrom = (at: number, now: number) => Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);

function slot(at: number, timed: boolean, now: number): string {
  const days = daysFrom(at, now),
    d = new Date(at);
  if (days >= 7) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  if (!timed) return days === 0 ? "today" : days === 1 ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "short" });
  if (days === 0) return clock(at);
  return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${clock(at)}`;
}

function nextPhrase(next: NextStep, short = false, now = Date.now()): { text: string; hint: string; tone: string } {
  const at = msOf(next.at),
    when = dateTime(at),
    timed = next.at.length !== 10;
  if (next.whose === "you" && next.due)
    return at < now
      ? { text: "Overdue", hint: `Was due ${when}`, tone: "text-danger-text" }
      : { text: `Due ${slot(at, false, now)}`, hint: `Due ${when}, in ${span(at - now)}`, tone: at - now < 48 * HOUR ? "text-warning-text" : "text-fg-muted" };
  if (next.whose === "you")
    return {
      text: short ? `Open ${agoShort(at)}` : `They asked ${ago(at)}`,
      hint: `They asked ${when}`,
      tone: now - at > 2 * DAY ? "text-warning-text" : "text-fg-muted",
    };
  if (next.whose === "upcoming") return { text: cap(slot(at, timed, now)), hint: `Booked for ${when}, in ${span(at - now)}`, tone: "text-info-text" };
  return next.quiet
    ? { text: `Quiet for ${span(now - at)}`, hint: `Waiting on them since ${when}`, tone: "text-warning-text" }
    : { text: `Waiting ${span(now - at)}`, hint: `Waiting on them since ${when}`, tone: "text-fg-muted" };
}

export function NextPhrase({ next, short, className }: { next: NextStep; short?: boolean; className?: string }) {
  const p = nextPhrase(next, short);
  return (
    <Tooltip content={p.hint}>
      <span className={cn("whitespace-nowrap", p.tone, className)}>{p.text}</span>
    </Tooltip>
  );
}

export function NextLabel({ next, company, className }: { next: NextStep; company: string; className?: string }) {
  return (
    <span className={className} title={plain(next.label)}>
      {next.whose === "them" && <span className="text-fg-subtle">Done: </span>}
      {brief(next.label, company)}
    </span>
  );
}
