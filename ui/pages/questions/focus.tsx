// One question in focus: what is asked, for which application, and the ways to answer it.
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronUp, Clock, CornerDownRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AnswerScope, QuestionGroup } from "../../../src/questions";
import {
  Button,
  Checkbox,
  CompanyMark,
  ConfirmDialog,
  Disclosure,
  Kbd,
  Linkified,
  Overline,
  Properties,
  Select,
  Separator,
  Spinner,
  Textarea,
  Time,
  Tooltip,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { combo, typing, useHotkeys } from "../../lib/hotkeys";
import { WIDE } from "../../lib/media";
import { href } from "../../lib/router";
import { choices, contextText, drafts, MAX_KEYED, questionText } from "./model";

export interface Answer {
  gateId: string;
  answer: string;
  scope: AnswerScope;
  via: number | "text"; // the option picked, or the typed box: which control shows the spinner
}

const SAVE_KEY = combo("↵");

// The form's own wording, folded to a few lines when long: some carry a whole arbitration agreement.
function FormContext({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 5;
  return (
    <div className="flex flex-col gap-2">
      <Overline>On the form</Overline>
      <div
        className={cn(
          "border-l-2 border-border pl-4 text-sm text-fg-muted",
          long && !open && "line-clamp-4",
          long && open && "max-h-[45vh] overflow-y-auto pr-2",
        )}
      >
        <Linkified text={long && !open ? text.replace(/\n{2,}/g, "\n") : text} />
      </div>
      {long && (
        <button
          type="button"
          onClick={() => {
            setOpen(!open);
          }}
          className="ml-4 self-start text-sm font-medium text-accent-text underline-offset-2 hover:underline"
        >
          {open ? "Show less" : `Show full text (${plural(text.split(/\s+/).length, "word")})`}
        </button>
      )}
    </div>
  );
}

// When several applications ask: which one this answer is for, and the list of them. One is named in the header.
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
              <Time at={j.askedAt} prefix="asked " className="text-xs text-fg-subtle" />
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
  onBack: () => void; // a phone's way back to the queue
}) {
  const [draft, setDraft] = useState(() => drafts.get(group.key) ?? "");
  const [gateId, setGateId] = useState(group.jobs[0]?.gateId ?? "");
  const [standing, setStanding] = useState(false); // opt-in per answer
  const [confirming, setConfirming] = useState<Answer | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const opts = choices(group),
    keyed = opts.length <= MAX_KEYED,
    job = group.jobs.find(j => j.gateId === gateId) ?? group.jobs[0],
    many = group.jobs.length > 1,
    context = contextText(group),
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
    const a: Answer = { gateId, answer: text, scope: standing ? "standing" : "application", via };
    if (standing) setConfirming(a);
    else onAnswer(a, group);
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
      // Enter still activates a focused link or button; anywhere else it starts a typed answer.
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
        // On a phone the question covers the queue: Esc closes it, as it does an open job.
        else if (!matchMedia(WIDE).matches) onBack();
      },
    },
  ]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The open job's panel bar: same height and button size. */}
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
            <span className="min-w-0 truncate text-sm">
              <span className="font-medium text-fg">{job.company}</span>
              <span className="ml-2 hidden text-fg-muted sm:inline">{many ? plural(group.jobs.length, "application") : job.title}</span>
            </span>
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
        <div key={group.key} className="mx-auto flex max-w-2xl animate-in flex-col gap-7 px-4 pt-6 pb-8 lg:px-10 lg:pt-10">
          <div className="flex flex-col gap-3">
            <h2 className={cn("font-semibold tracking-[-0.01em] break-words text-fg", group.text.length > 180 ? "text-lg" : "text-xl")}>
              {questionText(group.text)}
            </h2>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-fg-subtle">
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-3.5" />
                <Time at={group.createdAt} prefix="Asked " />
              </span>
              {after > 0 && (
                <span className="inline-flex items-center gap-1.5">
                  <CornerDownRight className="size-3.5" />
                  {plural(after, "more question")} from this application next
                </span>
              )}
            </div>
          </div>

          {context && <FormContext text={context} />}

          <Asking group={group} gateId={gateId} onGateId={setGateId} />

          <div className="flex flex-col gap-3">
            {opts.length > 0 && (
              <div className={cn("grid gap-2", opts.length % 2 === 0 && opts.length <= 4 && opts.every(o => o.length <= 28) && "sm:grid-cols-2")}>
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
            )}
            {/* A composer: the typed answer and the button that saves it, in one frame. */}
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
            {group.standingAllowed && job && (
              <label className="flex cursor-pointer items-start gap-2.5 px-0.5 pt-1 text-sm text-fg">
                <Checkbox
                  className="mt-0.5"
                  checked={standing}
                  disabled={busy}
                  onCheckedChange={v => {
                    setStanding(v === true);
                  }}
                />
                <span>
                  {many ? `Use for all ${group.jobs.length} listed and future` : "Also use for future"} {job.company} applications asking exactly this
                </span>
              </label>
            )}
          </div>

          <Separator />
          <Disclosure id="questions-policy" summary="How answers are reused">
            <p className="max-w-prose">
              An answer goes to the chosen application only, which then resumes. Ticking “Also use for future…” approves a standing answer: it is reused only
              when the same employer asks the exact same prompt with the same context and options, never as a general profile answer. Cover letters, submit
              confirmations and browser hand-offs are handled one application at a time, from Pipeline.
            </p>
          </Disclosure>
        </div>
      </div>

      <footer className="hidden h-10 shrink-0 items-center gap-5 border-t border-border px-6 text-xs text-fg-subtle lg:flex">
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

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={o => {
          if (!o) setConfirming(null);
        }}
        title="Approve a standing answer?"
        confirm="Approve and save"
        description={`This requeues ${
          group.jobs.length === 1 ? "the matching open application" : `all ${group.jobs.length} matching open applications`
        } and allows future reuse only for this exact employer/prompt/context/options scope.`}
        onConfirm={() => {
          if (confirming) onAnswer(confirming, group);
        }}
      >
        {confirming && (
          <Properties
            className="mt-4 rounded-lg border border-border bg-subtle/60 p-4"
            items={[
              ["Answer", <span className="font-medium">{confirming.answer}</span>],
              ["Scope", group.scopeLabel],
            ]}
          />
        )}
      </ConfirmDialog>
    </div>
  );
}
