import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Clock, CornerDownRight, Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnswerScope, QuestionGroup } from "../../../src/questions";
import { Button, Checkbox, CompanyMark, Disclosure, Kbd, Linkified, Select, Separator, Spinner, Subhead, Textarea, Time, Tooltip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { combo, typing, useHotkeys } from "../../lib/hotkeys";
import { WIDE } from "../../lib/media";
import { href } from "../../lib/router";
import { whyLabel } from "../../lib/why";
import { choices, contextText, drafts, MAX_KEYED, questionText } from "./model";

export interface Answer {
  gateId: string;
  answer: string;
  scope: AnswerScope;
  via: number | "text";
}

const SAVE_KEY = combo("↵");

function FormContext({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 5;
  return (
    <div className="flex flex-col gap-2">
      <Subhead>On the form</Subhead>
      <blockquote
        className={cn(
          "border-l-2 border-border pl-3 text-base break-words text-fg-muted",
          long && !open && "line-clamp-4",
          long && open && "max-h-[45vh] overflow-y-auto pr-2",
        )}
      >
        <Linkified text={long && !open ? text.replace(/\n{2,}/g, "\n") : text} />
      </blockquote>
      {long && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="ml-3 self-start text-sm font-medium text-fg-muted hover:text-fg touch:-my-2 touch:py-2"
        >
          {open ? "Show less" : `Show full text (${plural(text.split(/\s+/).length, "word")})`}
        </button>
      )}
    </div>
  );
}

function Asking({ group, gateId, onGateId }: { group: QuestionGroup; gateId: string; onGateId: (id: string) => void }) {
  if (group.jobs.length < 2) return null;
  const titles = group.jobs.map(j => j.title);
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-subtle/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-fg">Answer for</span>
        <Select
          aria-label="Answer for"
          value={gateId}
          onValueChange={onGateId}
          className="max-w-full min-w-0"
          options={group.jobs.map(j => ({
            value: j.gateId,
            label: titles.filter(t => t === j.title).length > 1 ? `${j.title} (#${j.id})` : j.title,
          }))}
        />
      </div>
      <Disclosure summary={`${plural(group.jobs.length, "application")} ask this`}>
        <ul className="flex flex-col gap-2">
          {group.jobs.map(j => (
            <li key={j.gateId} className="flex items-center gap-3">
              <a href={href("pipeline", j.id)} className="min-w-0 flex-1 truncate text-fg hover:underline">
                {j.title}
              </a>
              <Time at={j.askedAt} prefix="asked " className="shrink-0 text-sm text-fg-muted" />
            </li>
          ))}
        </ul>
      </Disclosure>
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
      {keyed && <Kbd className="group-hover:border-accent/30 group-hover:text-accent-text">{n}</Kbd>}
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
  const [keep, setKeep] = useState(group.kind === "question");
  const box = useRef<HTMLTextAreaElement>(null);
  const opts = choices(group),
    keyed = opts.length <= MAX_KEYED,
    job = group.jobs.find(j => j.gateId === gateId) ?? group.jobs[0],
    many = group.jobs.length > 1,
    context = contextText(group),
    why = whyLabel(group.why),
    after = Math.max(0, ...group.jobs.map(j => j.queuedAfter)),
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3 lg:px-6">
        <a
          href={href("questions")}
          aria-label="Back to all questions"
          onClick={ev => {
            ev.preventDefault();
            onBack();
          }}
          className="-ml-1 flex size-9 items-center justify-center rounded-md text-fg-muted hover:bg-subtle hover:text-fg lg:hidden"
        >
          <ArrowLeft className="size-4.5" />
        </a>
        {job && (
          <a href={href("pipeline", job.id)} className="group flex min-w-0 flex-1 items-center gap-2.5 self-stretch">
            <CompanyMark name={job.company} size="sm" />
            <span className="min-w-0 truncate text-sm font-medium text-fg">{job.company}</span>
            <ArrowUpRight className="size-3.5 shrink-0 text-fg-subtle opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        )}
        <span className="tabular shrink-0 text-sm text-fg-muted">
          {index + 1} <span className="text-fg-subtle">of</span> {total}
        </span>
        <div className="flex shrink-0 items-center">
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
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div key={group.key} className="mx-auto flex w-full max-w-2xl animate-in flex-col gap-7 px-4 pt-6 pb-8 lg:px-10 lg:pt-10">
          <div className="flex flex-col gap-2">
            <h2 className={cn("font-semibold tracking-[-0.01em] break-words text-fg", group.text.length > 180 ? "text-lg" : "text-xl")}>
              {questionText(group.text)}
            </h2>
            {job && (
              <p className="text-base break-words">
                <span className="font-medium text-fg">{job.company}</span>
                <span className="ml-2 text-fg-muted">{many ? plural(group.jobs.length, "application") : job.title}</span>
              </p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-fg-muted">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                <Time at={group.createdAt} prefix="Asked " />
              </span>
              {why && (
                <span className="inline-flex items-center gap-1.5">
                  <Info className="size-3.5" />
                  {why}
                </span>
              )}
              {after > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <CornerDownRight className="size-3.5" />
                  {plural(after, "more question")} from this application next
                </span>
              )}
            </div>
            {group.missing && <p className="text-sm break-words text-fg-muted">Missing: {group.missing}</p>}
          </div>

          {context && <FormContext text={context} />}

          <Asking group={group} gateId={gateId} onGateId={setGateId} />

          <div className="flex flex-col gap-3">
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
                  className="max-lg:[&_kbd]:hidden"
                >
                  Save and next
                </Button>
              </div>
            </div>
            {group.kind === "question" && (
              <label className="flex cursor-pointer items-start gap-2.5 px-0.5 pt-1 text-sm text-fg">
                <Checkbox
                  className="mt-0.5"
                  checked={keep}
                  disabled={busy}
                  onCheckedChange={v => {
                    setKeep(v === true);
                  }}
                />
                <span>{many ? `Answer all ${group.jobs.length} listed applications, and add` : "Also add"} it to your answers for future applications</span>
              </label>
            )}
          </div>

          <Separator />
          <Disclosure id="questions-policy" summary="How answers are reused">
            <p className="max-w-prose">
              An answer goes to the chosen application, which then resumes. Ticked, it also goes to every listed application asking exactly this, and an agent
              adds it to your answers (Profile, answers.md): it works out what the answer says beyond this form and widens an entry or adds one. Parked
              questions your answers then settle, in any wording and at any employer, are answered for you. Untick it for an answer that holds only here. Cover
              letters, submit confirmations and browser hand-offs are handled one application at a time, from Pipeline.
            </p>
          </Disclosure>
        </div>
      </div>

      <footer className="hidden h-10 shrink-0 items-center gap-5 overflow-hidden border-t border-border px-6 text-xs whitespace-nowrap text-fg-muted lg:flex touch:hidden">
        <span className="flex items-center gap-1.5">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          Move
        </span>
        {opts.length > 0 && keyed && (
          <span className="flex items-center gap-1.5">
            <Kbd>1</Kbd>
            {opts.length > 1 && (
              <>
                –<Kbd>{opts.length}</Kbd>
              </>
            )}
            Pick
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          Type
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>{SAVE_KEY}</Kbd>
          Save
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd>
          Leave the box
        </span>
      </footer>
    </div>
  );
}
