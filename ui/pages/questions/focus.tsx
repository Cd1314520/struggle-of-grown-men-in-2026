import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AnswerScope, QuestionGroup } from "../../../src/questions";
import type { Job } from "./model";
import { Button, Checkbox, Kbd, Linkified, Select, Spinner, Subhead, Textarea, Time, Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { combo, typing, useHotkeys } from "../../lib/hotkeys";
import { WIDE } from "../../lib/media";
import { href } from "../../lib/router";
import { whyLabel } from "../../lib/why";
import { addsToQuestion, bankByDefault, choices, contextText, drafts, employers, MAX_KEYED, queuedAfter, questionText } from "./model";

export interface Answer {
  gateId: string;
  answer: string;
  scope: AnswerScope;
  via: number | "text";
}

const SAVE_KEY = combo("↵");

function FormContext({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const quote = useRef<HTMLQuoteElement>(null);
  useLayoutEffect(() => {
    const el = quote.current;
    if (!el || open) return;
    const check = () => {
      setClipped(el.scrollHeight > el.clientHeight + 1);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [open, text]);
  return (
    <div className="flex flex-col gap-2">
      <Subhead>On the form</Subhead>
      <blockquote
        ref={quote}
        className={cn(
          "border-l-2 border-border pl-3 text-base break-words text-fg-muted",
          open ? "max-h-[45vh] overflow-y-auto pr-2" : "line-clamp-5 lg:line-clamp-8",
        )}
      >
        <Linkified text={open ? text : text.replace(/\n{2,}/g, "\n")} />
      </blockquote>
      {(open || clipped) && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="ml-3.5 self-start text-sm font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2"
        >
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </div>
  );
}

function ForJob({ group, gateId, onGateId }: { group: QuestionGroup; gateId: string; onGateId: (id: string) => void }) {
  const label = (j: Job) => `${j.company} — ${j.title}`;
  const job = group.jobs.find(j => j.gateId === gateId) ?? group.jobs[0];
  return (
    <div className="flex min-w-0 items-center gap-1">
      <Select
        aria-label="Answer for"
        prefix="For"
        value={gateId}
        onValueChange={onGateId}
        className="max-w-full min-w-0 [&_span[style]]:truncate"
        options={group.jobs.map(j => ({
          value: j.gateId,
          label: group.jobs.filter(o => label(o) === label(j)).length > 1 ? `${label(j)} (#${j.id})` : label(j),
        }))}
      />
      {job && (
        <Tooltip content="Open in Pipeline">
          <Button asChild variant="ghost" size="icon-sm" className="shrink-0 text-fg-subtle">
            <a href={href("pipeline", job.id)} aria-label="Open in Pipeline">
              <ArrowUpRight />
            </a>
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

function OptionCard({
  n,
  label,
  keyed,
  busy,
  disabled,
  onPick,
}: {
  n: number;
  label: string;
  keyed: boolean;
  busy: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      data-option={n}
      disabled={disabled}
      onClick={onPick}
      className={cn(
        "group flex min-h-12 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-left text-base text-fg shadow-xs transition-[background-color,border-color,box-shadow] duration-100 outline-none",
        "hover:border-accent/40 hover:bg-accent-soft/50 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/15 active:bg-accent-soft disabled:opacity-60",
        busy && "border-accent bg-accent-soft disabled:opacity-100",
      )}
    >
      {keyed && <Kbd className="group-hover:border-accent/30 group-hover:text-accent-text max-lg:hidden @max-xl/pane:hidden">{n}</Kbd>}
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {busy && <Spinner className="text-accent-text" />}
    </button>
  );
}

export function FocusPane({
  group,
  index,
  total,
  sending,
  autoFocus,
  canAnswer,
  onAnswer,
  onMove,
  onSkip,
  onBack,
}: {
  group: QuestionGroup;
  index: number;
  total: number;
  sending: Answer["via"] | null;
  autoFocus: boolean;
  canAnswer: () => boolean;
  onAnswer: (a: Answer, group: QuestionGroup) => void;
  onMove: (by: 1 | -1) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState(() => drafts.get(group.key) ?? "");
  const [gateId, setGateId] = useState(group.jobs[0]?.gateId ?? "");
  const [keep, setKeep] = useState(() => bankByDefault(group));
  const box = useRef<HTMLTextAreaElement>(null);
  const opts = choices(group),
    keyed = opts.length <= MAX_KEYED,
    job = group.jobs.find(j => j.gateId === gateId) ?? group.jobs[0],
    many = group.jobs.length > 1,
    context = contextText(group),
    why = group.why === "other" || (group.why === "free_text" && !opts.length) ? null : whyLabel(group.why),
    after = queuedAfter(group),
    busy = sending !== null;

  useEffect(() => {
    if (autoFocus) box.current?.focus();
  }, [autoFocus]);

  const submit = (answer: string, via: Answer["via"]) => {
    if (busy || !canAnswer()) return;
    const text = answer.trim();
    if (!text) {
      box.current?.focus();
      return;
    }
    onAnswer({ gateId, answer: text, scope: keep ? "bank" : "application", via }, group);
  };

  useHotkeys([
    ...opts.slice(0, keyed ? MAX_KEYED : 0).map((o, i) => ({
      key: String(i + 1),
      run: () => {
        submit(o, i + 1);
      },
    })),
    {
      key: "mod+Enter",
      inFields: true,
      run: () => {
        submit(draft, "text");
      },
    },
    {
      key: "Enter",
      run: ev => {
        if (ev.target instanceof HTMLElement && ev.target.matches("a, button")) ev.target.click();
        else box.current?.focus();
      },
    },
    {
      key: "Escape",
      inFields: true,
      run: ev => {
        if (typing(ev.target) && ev.target instanceof HTMLElement) ev.target.blur();
        else if (!matchMedia(WIDE).matches) onBack();
      },
    },
  ]);

  return (
    <div className="@container/pane flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2 sm:px-3">
        <a
          href={href("questions")}
          aria-label="Back to all questions"
          onClick={ev => {
            ev.preventDefault();
            onBack();
          }}
          className="mr-1 flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg lg:hidden"
        >
          <ArrowLeft className="size-4.5" />
        </a>
        <Tooltip content="Previous" shortcut="K">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous question"
            disabled={index === 0}
            onClick={() => {
              onMove(-1);
            }}
          >
            <ChevronUp />
          </Button>
        </Tooltip>
        <Tooltip content="Next" shortcut="J">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next question"
            disabled={index >= total - 1}
            onClick={() => {
              onMove(1);
            }}
          >
            <ChevronDown />
          </Button>
        </Tooltip>
        <span className="tabular ml-1 text-sm whitespace-nowrap text-fg-muted">
          {(index + 1).toLocaleString()} <span className="text-fg-subtle">of</span> {total.toLocaleString()}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={group.key} className="flex w-full max-w-3xl animate-in flex-col gap-7 px-4 pt-6 pb-8 sm:px-6 lg:pt-10">
          <div className="flex flex-col gap-2">
            <h2 className={cn("font-semibold tracking-[-0.01em] break-words text-fg", group.text.length > 180 ? "text-lg" : "text-xl")}>
              {questionText(group.text)}
            </h2>
            {job &&
              (many ? (
                <ForJob group={group} gateId={gateId} onGateId={setGateId} />
              ) : (
                <p className="text-base break-words">
                  <a href={href("pipeline", job.id)} className="group font-medium text-fg hover:underline">
                    {job.company}
                    <ArrowUpRight className="ml-0.5 inline size-3.5 align-[-0.125em] text-fg-subtle group-hover:text-fg" />
                  </a>
                  <span aria-hidden className="text-fg-subtle">
                    {" —\u00a0"}
                  </span>
                  <span className="text-fg-muted">{job.title}</span>
                </p>
              ))}
            <p className="text-sm text-fg-muted">
              <Time at={group.createdAt} prefix="Asked " />
              {why && <> · {why}</>}
              {after > 0 && <> · {plural(after, "more question")} after this</>}
            </p>
            {addsToQuestion(group) && <p className="text-sm break-words text-fg-muted">Missing: {group.missing}</p>}
          </div>

          {context && <FormContext text={context} />}

          <div className="flex flex-col gap-3">
            {group.kind === "question" && (
              <label className="flex cursor-pointer items-start gap-2.5 pb-1 text-sm text-fg" title="Also answers matching parked questions, at any employer">
                <Checkbox
                  className="mt-0.5"
                  checked={keep}
                  disabled={busy}
                  onCheckedChange={v => {
                    setKeep(v === true);
                  }}
                />
                <span>{many ? `Answer all ${group.jobs.length} (${employers(group)}) and save to my answers` : "Save to my answers"}</span>
              </label>
            )}
            {opts.length > 0 && (
              <div className="@container">
                <div className={cn("grid gap-2", opts.length % 2 === 0 && opts.length <= 4 && opts.every(o => o.length <= 28) && "@xl:grid-cols-2")}>
                  {opts.map((o, i) => (
                    <OptionCard
                      key={`${i}:${o}`}
                      n={i + 1}
                      label={o}
                      keyed={keyed}
                      busy={sending === i + 1}
                      disabled={busy}
                      onPick={() => {
                        submit(o, i + 1);
                      }}
                    />
                  ))}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-border bg-surface shadow-xs transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15 hover:border-border-strong focus-within:hover:border-accent">
              <Textarea
                ref={box}
                aria-label="Your answer"
                rows={opts.length ? 2 : 4}
                value={draft}
                disabled={busy}
                placeholder={opts.length ? "Or type another answer" : "Type your answer"}
                onChange={e => {
                  setDraft(e.target.value);
                  if (e.target.value) drafts.set(group.key, e.target.value);
                  else drafts.delete(group.key);
                }}
                className="min-h-0 resize-none border-0 bg-transparent shadow-none hover:border-0 focus:ring-0"
              />
              <div className="flex items-center justify-end gap-1.5 px-2 pb-2">
                <Button variant="ghost" size="sm" disabled={busy || total < 2} onClick={onSkip}>
                  Skip
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={sending === "text"}
                  disabled={busy || !draft.trim()}
                  shortcut={SAVE_KEY}
                  onClick={() => {
                    submit(draft, "text");
                  }}
                  className="max-lg:[&_kbd]:hidden @max-xl/pane:[&_kbd]:hidden"
                >
                  Save and next
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
