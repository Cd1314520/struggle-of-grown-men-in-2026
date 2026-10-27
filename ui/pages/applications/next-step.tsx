// Whose move it is on a sent application, as a short phrase with the time that matters: when it is
// due, when it is booked, or how long the employer has been quiet.
import type { NextStep } from "../../../src/steps";
import { Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { ago, agoShort, brief, dateTime, HOUR, parseAt, plain, span } from "../../lib/format";

// A deadline given as a bare day lasts until that day ends, on the local clock.
const msOf = (at: string) => (at.length === 10 ? Date.parse(`${at}T23:59:59`) : parseAt(at));

// `short` is a row's one fact, 12 characters at most: "Asked 3d" for "Asked 3d ago"; the rest already fit.
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
    ? { text: `Quiet for ${span(now - at)}`, hint: `Waiting on them since ${when}`, tone: "text-fg-muted" }
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

// The step itself, as a row has room for it: its first clause, without the employer's name the row already
// shows (the row's gist truncates it). The whole of it is on hover and on the job page.
export function NextLabel({ next, company, className }: { next: NextStep; company: string; className?: string }) {
  return (
    <span className={className} title={plain(next.label)}>
      {brief(next.label, company)}
    </span>
  );
}
