import {
  Ban,
  CalendarClock,
  Check,
  ChevronDown,
  ExternalLink,
  Flag,
  Mail,
  MoreHorizontal,
  NotebookPen,
  Pencil,
  Plus,
  RotateCcw,
  ThumbsDown,
  Trash2,
  Undo2,
  User,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { JobDetail } from "../../../src/api-types";
import type { Step, StepKind } from "../../../src/steps";
import {
  Button,
  ConfirmDialog,
  Field,
  Input,
  Linkified,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Select,
  StatusDot,
  Textarea,
  Time,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { shortUrl, withoutCompany } from "../../lib/format";
import { STEP_KIND } from "../../lib/labels";
import type { JobActions, StepFields } from "./actions";
import { ENDED, isOpenStep, leadOf, localInput, stepAt, stepStateOf } from "./model";

const KIND_OPTIONS = (Object.keys(STEP_KIND) as StepKind[]).map(k => ({ value: k, label: STEP_KIND[k] }));

function StepForm({ step, submit, busy, onCancel }: { step: Step | null; submit: (f: StepFields) => void; busy: boolean; onCancel: () => void }) {
  const [f, setF] = useState<StepFields>({
    kind: step?.kind ?? "assessment",
    title: step?.title ?? "",
    due: step?.due_at?.slice(0, 10) ?? "",
    link: step?.link ?? "",
    detail: step?.detail ?? "",
  });
  const set = (k: keyof StepFields) => (e: { target: { value: string } }) => {
    setF({ ...f, [k]: e.target.value });
  };
  return (
    <form
      className="@container grid animate-in grid-cols-1 gap-3 border-t border-border pt-4 @md:grid-cols-[160px_1fr]"
      onSubmit={e => {
        e.preventDefault();
        submit(f);
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-fg">Kind</span>
        <Select
          aria-label="Kind"
          value={f.kind as StepKind}
          onValueChange={v => {
            setF({ ...f, kind: v });
          }}
          options={KIND_OPTIONS}
          className="w-full justify-between"
        />
      </div>
      <Field label="What">
        <Input autoFocus value={f.title} onChange={set("title")} placeholder="HackerRank assessment, 90 min" />
      </Field>
      <Field label="Due">
        <Input type="date" value={f.due} onChange={set("due")} />
      </Field>
      <Field label="Link">
        <Input type="url" value={f.link} onChange={set("link")} placeholder="https://" />
      </Field>
      <Field label="Notes" className="@md:col-span-2">
        <Textarea rows={2} value={f.detail} onChange={set("detail")} />
      </Field>
      <div className="flex justify-end gap-2 @md:col-span-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" size="sm" loading={busy}>
          {step ? "Save changes" : "Add step"}
        </Button>
      </div>
    </form>
  );
}

function InlineForm({
  children,
  onCancel,
  submit,
  busy,
  label,
}: {
  children: ReactNode;
  onCancel: () => void;
  submit: () => void;
  busy: boolean;
  label: string;
}) {
  return (
    <form
      className="@container flex animate-in flex-col gap-3 border-l-2 border-border-strong pl-3 @md:flex-row @md:items-end"
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="min-w-0 flex-1">{children}</div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={busy}>
          {label}
        </Button>
      </div>
    </form>
  );
}

type Mode = "note" | "book" | "edit" | null;

function StepItem({ step, company, a, last }: { step: Step; company: string; a: JobActions; last: boolean }) {
  const [mode, setMode] = useState<Mode>(null);
  const [note, setNote] = useState("");
  const [at, setAt] = useState(localInput(step.scheduled_at));
  const [removing, setRemoving] = useState(false);
  const state = stepStateOf(step);
  const open = isOpenStep(step);
  const bookable = step.kind === "schedule" || step.kind === "interview";
  const busy = (op: string) => a.busy === `step:${op}:${step.id}`;
  const op = (name: string, body: Record<string, unknown> = {}) =>
    void a.step(name, { step: step.id, ...body }).then(ok => {
      if (ok) setMode(null);
    });

  const facts: [icon: ReactNode, text: ReactNode][] = [];
  if (step.scheduled_at) facts.push([<CalendarClock key="i" />, `${step.state === "scheduled" ? "" : "Booked for "}${stepAt(step.scheduled_at)}`]);
  if (step.due_at && step.state === "todo") facts.push([<Flag key="i" />, `Due ${stepAt(step.due_at)}`]);
  if (step.done_at) facts.push([<Check key="i" />, <Time key="t" at={step.done_at} prefix="Done " />]);
  facts.push([
    step.source === "mail" ? <Mail key="i" /> : <User key="i" />,
    <Time key="t" at={step.created_at} prefix={step.source === "mail" ? "From mail " : "Added by you "} />,
  ]);

  const menu: { label: string; icon: ReactNode; run: () => void; danger?: boolean }[] = open
    ? [
        ...(step.state === "todo"
          ? [
              {
                label: "Done, with a note…",
                icon: <NotebookPen />,
                run: () => {
                  setMode("note");
                },
              },
            ]
          : []),
        ...(step.state !== "todo"
          ? [
              {
                label: "Back to to-do",
                icon: <Undo2 />,
                run: () => {
                  op("todo");
                },
              },
            ]
          : []),
        {
          label: "Edit",
          icon: <Pencil />,
          run: () => {
            setMode("edit");
          },
        },
        {
          label: "Cancel step",
          icon: <Ban />,
          run: () => {
            op("cancel");
          },
        },
      ]
    : [
        {
          label: "Reopen",
          icon: <RotateCcw />,
          run: () => {
            op("todo");
          },
        },
      ];

  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span aria-hidden className="absolute top-5 bottom-1 left-[3.5px] w-px bg-border" />}
      <StatusDot tone={state.tone} className="mt-2" />
      <div className={cn("flex min-w-0 flex-1 flex-col gap-2", !open && "opacity-70")}>
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {step.kind !== "other" && <div className="mb-0.5 text-xs font-medium text-fg-muted">{STEP_KIND[step.kind]}</div>}
            <p className="text-base break-words text-fg">
              <Linkified text={withoutCompany(step.title, company)} />
            </p>
          </div>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="More step actions" className="-mt-0.5 -mr-1.5">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              {menu.map(m => (
                <MenuItem key={m.label} icon={m.icon} onSelect={m.run}>
                  {m.label}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem
                icon={<Trash2 />}
                danger
                onSelect={() => {
                  setRemoving(true);
                }}
              >
                Remove
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted [&_svg]:size-3.5 [&_svg]:text-fg-subtle">
          {step.state !== "todo" || state.tone === "danger" ? (
            <span className={state.tone === "danger" ? "text-danger-text" : "text-fg"}>{state.waiting ? `${state.label}, waiting on them` : state.label}</span>
          ) : null}
          {facts.map(([icon, text], i) => (
            <span key={i} className="inline-flex items-center gap-1.5">
              {icon}
              {text}
            </span>
          ))}
          {step.link && (
            <a
              href={step.link}
              title={step.link}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-w-0 items-center gap-1.5 text-accent-text underline-offset-2 hover:underline"
            >
              <ExternalLink className="!text-accent-text" />
              <span className="truncate">{shortUrl(step.link)}</span>
            </a>
          )}
        </div>
        {step.detail && (
          <p className="text-sm text-fg-muted">
            <Linkified text={step.detail} />
          </p>
        )}
        {step.done_note && (
          <p className="border-l-2 border-border-strong pl-3 text-sm text-fg-muted">
            <span className="font-medium">Your note </span>
            <Linkified text={step.done_note} />
          </p>
        )}

        {mode === "note" && (
          <InlineForm
            label="Save as done"
            busy={busy("done")}
            onCancel={() => {
              setMode(null);
            }}
            submit={() => {
              op("done", { note: note.trim() });
            }}
          >
            <Field label="How it went, what you sent">
              <Input
                autoFocus
                value={note}
                onChange={e => {
                  setNote(e.target.value);
                }}
              />
            </Field>
          </InlineForm>
        )}
        {mode === "book" && (
          <InlineForm
            label="Save time"
            busy={busy("book")}
            onCancel={() => {
              setMode(null);
            }}
            submit={() => {
              if (!at) {
                toast.error("Pick the time first.");
                return;
              }
              op("book", { at: new Date(at).toISOString() });
            }}
          >
            <Field label="Booked for">
              <Input
                autoFocus
                type="datetime-local"
                value={at}
                onChange={e => {
                  setAt(e.target.value);
                }}
              />
            </Field>
          </InlineForm>
        )}
        {mode === "edit" && (
          <StepForm
            step={step}
            busy={busy("edit")}
            onCancel={() => {
              setMode(null);
            }}
            submit={f => {
              if (!f.title.trim()) {
                toast.error("Say what the step is first.");
                return;
              }
              op("edit", { ...f });
            }}
          />
        )}

        {!mode && (step.state === "todo" || (open && bookable)) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {step.state === "todo" && (
              <Button
                size="sm"
                icon={<Check />}
                loading={busy("done")}
                onClick={() => {
                  op("done", { note: "" });
                }}
              >
                Done
              </Button>
            )}
            {open && bookable && (
              <Button
                size="sm"
                variant={step.state === "todo" ? "ghost" : "secondary"}
                icon={<CalendarClock />}
                onClick={() => {
                  setMode("book");
                }}
              >
                {step.state === "scheduled" ? "Change time" : "Booked for…"}
              </Button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="Remove this step?"
        description="Use this for a step entered by mistake. Cancelling the step instead keeps it in the record."
        confirm="Remove step"
        danger
        onConfirm={() => {
          op("remove");
        }}
      />
    </li>
  );
}

export function NextSteps({ job, a }: { job: JobDetail; a: JobActions }) {
  const [adding, setAdding] = useState(false);
  const ended = ENDED.includes(job.status);
  const lead = leadOf(job);
  const outcomes: { action: string; label: string; icon: ReactNode; danger?: boolean }[] = ended
    ? [{ action: "reopen_application", label: "Back in process", icon: <RotateCcw /> }]
    : [
        ...(job.status === "offer" ? [] : [{ action: "mark_offer", label: "Mark offer", icon: <Flag /> }]),
        { action: "mark_declined", label: "Mark declined", icon: <ThumbsDown /> },
        { action: "withdraw", label: "Withdraw", icon: <Undo2 />, danger: true },
      ];
  const steps = [...job.steps].sort((x, y) => Number(isOpenStep(y)) - Number(isOpenStep(x)));
  const add = !ended && !adding && (
    <Button
      variant="ghost"
      size="sm"
      icon={<Plus />}
      className="-mr-2.5 touch:-mr-3"
      onClick={() => {
        setAdding(true);
      }}
    >
      Add a step
    </Button>
  );
  return (
    <section data-decision="Next steps">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-semibold text-fg">Next steps</h3>
          <p className="mt-0.5 flex items-start gap-2 text-sm text-fg-muted">
            <StatusDot tone={lead.tone} className="mt-1.5" />
            <span className="min-w-0 break-words">
              <Linkified text={lead.text} />
            </span>
          </p>
        </div>
        {add}
      </div>
      <div className="pt-5">
        {steps.length > 0 ? (
          <ol className="flex flex-col">
            {steps.map((s, i) => (
              <StepItem key={s.id} step={s} company={job.company} a={a} last={i === steps.length - 1} />
            ))}
          </ol>
        ) : (
          !ended && (
            <p className="text-sm text-fg-muted">
              Requests from the employer show up here when the mailbox is checked. Add one yourself for anything that came another way.
            </p>
          )
        )}
        {adding && (
          <div className="mt-5">
            <StepForm
              step={null}
              busy={a.busy === "step:add:"}
              onCancel={() => {
                setAdding(false);
              }}
              submit={f => {
                if (!f.title.trim()) {
                  toast.error("Say what the step is first.");
                  return;
                }
                void a.step("add", { ...f }).then(ok => {
                  if (ok) setAdding(false);
                });
              }}
            />
          </div>
        )}
      </div>
      <div className="mt-5 flex items-center gap-2 border-t border-border pt-3 text-sm text-fg-muted">
        <span className="min-w-0 flex-1">{ended ? "Closed by mistake?" : "Heard back, or pulling out?"}</span>
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" className="-mr-2.5 touch:-mr-3">
              Outcome
              <ChevronDown />
            </Button>
          </MenuTrigger>
          <MenuContent>
            {outcomes.map(o => (
              <MenuItem key={o.action} icon={o.icon} danger={!!o.danger} onSelect={() => void a.act(o.action)}>
                {o.label}
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
      </div>
    </section>
  );
}
