import type { NextStep } from "../../../src/steps";
import { Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { ago, agoShort, brief, dateTime, HOUR, parseAt, plain, span } from "../../lib/format";

const msOf = (at: string) => (at.length === 10 ? Date.parse(`${at}T23:59:59`) : parseAt(at));

function nextPhrase(next: NextStep, short = false, now = Date.now()): { text: string; hint: string; tone: string } {
  const at = msOf(next.at),
    when = dateTime(at);
  if (next.whose === "you" && next.due)
    return at < now
      ? { text: "Overdue", hint: `Was due ${when}`, tone: "text-danger-text" }
      : { text: `Due in ${span(at - now)}`, hint: `Due ${when}`, tone: at - now < 48 * HOUR ? "text-warning-text" : "text-fg-muted" };
  if (next.whose === "you") return { text: `Asked ${short ? agoShort(at) : ago(at)}`, hint: `Asked ${when}`, tone: "text-warning-text" };
  if (next.whose === "upcoming") return { text: `Booked in ${span(at - now)}`, hint: `Booked for ${when}`, tone: "text-info-text" };
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
      {brief(next.label, company)}
    </span>
  );
}
