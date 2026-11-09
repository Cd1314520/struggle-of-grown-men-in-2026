import { Download, FileText, NotebookPen, Pencil } from "lucide-react";
import { Fragment, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ResumeState } from "../../../src/api-types";
import {
  Button,
  Checkbox,
  ConfirmDialog,
  Disclosure,
  EmptyState,
  Skeleton,
  Spinner,
  Textarea,
  Time,
  Workspace,
  WorkspaceBody,
  WorkspaceSection,
} from "../../components/ui";
import { api, refreshAll, useResume } from "../../lib/api";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { href } from "../../lib/router";
import { Sheets, Upload } from "./parts";

const act = async (run: () => Promise<unknown>, done?: string) => {
  try {
    await run();
    if (done) toast.success(done);
    return true;
  } catch {
    return false;
  } finally {
    void refreshAll();
  }
};

function Viewer({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-full bg-canvas px-4 py-8 sm:px-8 lg:min-h-[calc(var(--app-h)-3rem-1px)]">
      <div className="mx-auto max-w-[40rem]">{children}</div>
    </div>
  );
}

function Running({ r }: { r: ResumeState }) {
  const [busy, setBusy] = useState(false);
  const imp = r.import;
  return (
    <WorkspaceSection
      title={imp.feedback.length ? "Changing the draft" : "Converting your files"}
      description="Takes a few minutes; you can leave this page."
      actions={
        <Button
          size="sm"
          loading={busy}
          onClick={() => {
            setBusy(true);
            void act(api.cancelImport, "Import cancelled").then(() => {
              setBusy(false);
            });
          }}
        >
          Cancel
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2.5 text-sm text-fg">
          <Spinner className="text-accent-text" />
          <span className="flex-1">{imp.steps[0]?.message ?? "Starting…"}</span>
          <Time at={imp.startedAt} prefix="started " className="text-sm text-fg-muted" />
        </div>
        {imp.steps.length > 1 && (
          <ul className="space-y-1 border-l border-border pl-4">
            {imp.steps.slice(1, 6).map((st, i) => (
              <li key={i} className="truncate text-sm text-fg-muted">
                {st.message}
              </li>
            ))}
          </ul>
        )}
      </div>
    </WorkspaceSection>
  );
}

const RETRY = "The last attempt did not finish. Try again.";

function Draft({ r }: { r: ResumeState }) {
  const imp = r.import;
  const [notes, setNotes] = useState(true);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState<"accept" | "revise" | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const accept = () => {
    setBusy("accept");
    void act(() => api.acceptImport(notes), r.stock.exists ? "Your resume was replaced" : "Your resume is set").then(() => {
      setBusy(null);
    });
  };
  const revise = () => {
    if (!feedback.trim()) return;
    setBusy("revise");
    void act(() => api.reviseImport(feedback)).then(ok => {
      setBusy(null);
      if (ok) setFeedback("");
    });
  };
  const warnings = imp.warnings?.split("\n").filter(l => l.trim()) ?? [];
  const current = r.stock.exists && r.stock.pages && imp.pages && r.stock.pages !== imp.pages ? r.stock.pages : null;
  const asked = imp.feedback.filter(f => f !== RETRY);
  return (
    <>
      <WorkspaceSection title="Review the draft" description={imp.pages ? `${plural(imp.pages, "page")}${current ? ` (current: ${current})` : ""}` : undefined}>
        <div className="flex flex-col gap-4">
          {current && imp.pages && imp.pages > current && (
            <p className="text-sm text-warning-text">Longer than your current resume, so every tailored copy may run to {plural(imp.pages, "page")}.</p>
          )}
          {imp.summary && <p className="text-sm text-fg">{imp.summary}</p>}
          {warnings.length > 0 && (
            <div role="alert" className="border-l-2 border-warning pl-3 text-sm">
              <p className="font-medium text-warning-text">Check before you use it</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-fg">
                {warnings.map((w, i) => (
                  <li key={i}>{w.replace(/^[-*•]\s*/, "")}</li>
                ))}
              </ul>
            </div>
          )}
          {imp.notesChanged && (
            <label className="flex items-start gap-2.5 text-sm text-fg">
              <Checkbox
                checked={notes}
                onCheckedChange={c => {
                  setNotes(c === true);
                }}
                className="mt-0.5"
              />
              <span>Also update the resume notes</span>
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy === "accept"} disabled={!!busy} onClick={accept}>
              {r.stock.exists ? "Replace my resume" : "Use this resume"}
            </Button>
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setDiscarding(true);
              }}
            >
              Discard
            </Button>
          </div>
        </div>
      </WorkspaceSection>
      <WorkspaceSection title={<label htmlFor="resume-feedback">Ask for changes</label>}>
        <div className="flex flex-col gap-3">
          {(imp.note || asked.length > 0) && (
            <dl className="space-y-2 border-l-2 border-border pl-3 text-sm">
              {imp.note && (
                <div>
                  <dt className="text-fg-muted">Your note</dt>
                  <dd className="break-words text-fg">{imp.note}</dd>
                </div>
              )}
              {asked.length > 0 && (
                <div>
                  <dt className="text-fg-muted">Asked so far</dt>
                  {asked.map((f, i) => (
                    <dd key={i} className="break-words text-fg">
                      {f}
                    </dd>
                  ))}
                </div>
              )}
            </dl>
          )}
          <Textarea
            id="resume-feedback"
            value={feedback}
            onChange={e => {
              setFeedback(e.target.value);
            }}
            rows={3}
            placeholder="Drop the summary line, and put Projects before Education."
          />
          <Button className="self-start" loading={busy === "revise"} disabled={!feedback.trim() || !!busy} onClick={revise}>
            Ask for these changes
          </Button>
        </div>
      </WorkspaceSection>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this draft?"
        description="The uploaded files and the draft are deleted. Your current resume stays as it is."
        confirm="Discard"
        danger
        onConfirm={() => void act(api.discardImport)}
      />
    </>
  );
}

function Failed({ r }: { r: ResumeState }) {
  const imp = r.import;
  const [busy, setBusy] = useState(false);
  return (
    <WorkspaceSection tone="danger" title="The import didn't finish">
      <div role="alert" className="flex flex-col gap-3">
        <p className="text-sm break-words text-fg">{imp.error}</p>
        {imp.files.length > 0 && <p className="text-sm break-words text-fg-muted">From {imp.files.join(", ")}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            loading={busy}
            onClick={() => {
              setBusy(true);
              void act(() => api.reviseImport("The last attempt did not finish. Try again.")).then(() => {
                setBusy(false);
              });
            }}
          >
            Try again
          </Button>
          <Button variant="ghost" onClick={() => void act(api.discardImport)}>
            Discard
          </Button>
        </div>
      </div>
    </WorkspaceSection>
  );
}

const notesState = (r: ResumeState) => (r.notes.empty ? "Empty" : r.notes.example ? "Still the example" : null);

function Notes({ r }: { r: ResumeState }) {
  const state = notesState(r);
  return (
    <WorkspaceSection
      title="Resume notes"
      description={state ? undefined : "Extra bullets, projects and skills that tailoring swaps in where they fit a posting."}
      flush={!state}
      actions={
        <Button asChild size="sm">
          <a href={href("profile", "resume-notes.md")}>
            <NotebookPen />
            Edit notes
          </a>
        </Button>
      }
    >
      {state && (
        <p className="text-sm text-fg-muted">
          <span className="font-medium text-warning-text">{state}. </span>
          Tailoring can only reorder and trim the stock resume until you add notes.
        </p>
      )}
    </WorkspaceSection>
  );
}

function Meta({ r, short }: { r: ResumeState; short?: boolean }) {
  const s = r.stock;
  const imp = r.import;
  const notes = notesState(r);
  const parts: ReactNode[] = [];
  if (imp.status === "ready" && short) {
    parts.push("Draft");
  } else if (imp.status === "ready") {
    parts.push(
      <>
        Draft{imp.pages ? `, ${plural(imp.pages, "page")}` : ""}
        {imp.finishedAt && (
          <>
            , <Time at={imp.finishedAt} prefix="finished " />
          </>
        )}
      </>,
    );
  } else if (s.error) {
    parts.push(<span className="text-danger-text">Doesn&apos;t compile</span>);
  } else if (s.exists && short) {
    if (!notes)
      parts.push(
        <>
          {s.pages ? `${plural(s.pages, "page")} · ` : ""}
          <Time at={s.updatedAt} />
        </>,
      );
  } else if (s.exists) {
    parts.push(
      <>
        {s.pages ? `${plural(s.pages, "page")}, ` : ""}
        <Time at={s.updatedAt} prefix="changed " />
      </>,
    );
  }
  if (notes && (s.exists || imp.status === "ready"))
    parts.push(
      <span className="text-warning-text">{notes === "Empty" ? (short ? "No notes" : "no notes") : short ? "Example notes" : "notes still the example"}</span>,
    );
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>
          {i > 0 && " · "}
          {p}
        </Fragment>
      ))}
    </>
  );
}

export function ResumePage() {
  const { data: r, isPending } = useResume();
  const [sending, setSending] = useState(false);
  const [example, setExample] = useState(false);
  const start = (files: File[], note: string) => {
    setSending(true);
    void act(() => api.importResume(files, note)).then(() => {
      setSending(false);
    });
  };
  const status = r?.import.status;
  const s = r?.stock;
  const ready = status === "ready";
  const lead = status === "running" || status === "ready" || status === "failed";
  const shown = !!s && (s.exists || ready);
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: "Resume",
        hint: "The stock resume every application is tailored from, and the notes tailoring may draw on.",
        meta: r && shown && <Meta r={r} />,
        controls: r && shown && (
          <p data-lead className="min-w-0 truncate text-sm text-fg-muted lg:hidden">
            <Meta r={r} short />
          </p>
        ),
        actions: r && s && shown && (
          <>
            {ready ? (
              <Button asChild size="sm">
                <a href="/api/resume/draft.pdf" download={r.pdfName.replace(/(\.pdf)?$/i, "-draft.pdf")}>
                  <Download />
                  <span>
                    <span className="max-sm:hidden">Download draft</span>
                    <span className="sm:hidden">Draft PDF</span>
                  </span>
                </a>
              </Button>
            ) : (
              !s.error && (
                <Button asChild size="sm">
                  <a href="/api/resume/stock.pdf" download={r.pdfName}>
                    <Download />
                    <span>
                      <span className="max-sm:hidden">Download </span>PDF
                    </span>
                  </a>
                </Button>
              )
            )}
            {s.exists && (
              <Button asChild variant="ghost" size="sm">
                <a href={href("profile", r.main)}>
                  <Pencil />
                  Edit source
                </a>
              </Button>
            )}
          </>
        ),
      }}
    >
      {isPending || !r || !s ? (
        <WorkspaceBody asideWidth="pane" aside={<Skeleton className="m-(--list-x) h-64" />}>
          <Viewer>
            <Skeleton className="aspect-[8.5/11] rounded-sm" />
          </Viewer>
        </WorkspaceBody>
      ) : (
        <WorkspaceBody
          asideWidth="pane"
          className={cn(lead && "max-lg:[&>aside]:order-first max-lg:[&>aside]:border-t-0")}
          aside={
            <div className="lg:sticky lg:top-[calc(3rem+1px)] lg:max-h-[calc(var(--app-h)-3rem-1px)] lg:overflow-y-auto">
              {status === "failed" ? (
                <Failed r={r} />
              ) : status === "running" ? (
                <Running r={r} />
              ) : ready ? (
                <Draft r={r} />
              ) : s.exists ? (
                <>
                  <Notes r={r} />
                  <div className="border-b border-border px-(--list-x) py-4">
                    <Disclosure id="resume-import" summary="Import from files" inset={false}>
                      <div className="pt-2">
                        <Upload compact limits={r.limits} submit="Convert" busy={sending} onSubmit={start} />
                      </div>
                    </Disclosure>
                  </div>
                </>
              ) : (
                <WorkspaceSection
                  title="Import your resume"
                  description="Upload whatever you have. An agent writes it on the app's Typst template, keeping every fact as your files give it, and you review the result before it is used."
                >
                  <Upload limits={r.limits} submit="Convert to a resume" busy={sending} onSubmit={start} />
                  <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-4 text-sm text-fg-muted">
                    <FileText className="size-4 shrink-0 text-fg-subtle" />
                    <span>Rather write Typst yourself?</span>
                    <Button
                      variant="link"
                      onClick={() => {
                        setExample(true);
                      }}
                    >
                      Start from the example
                    </Button>
                  </div>
                </WorkspaceSection>
              )}
              {(lead || !s.exists) && (
                <div className={cn(lead && "max-lg:hidden")}>
                  <Notes r={r} />
                </div>
              )}
            </div>
          }
        >
          {ready ? (
            <Viewer>
              <p className="mb-3 text-sm font-medium text-fg-muted">Draft, not in use yet</p>
              <Sheets
                src="/api/resume/draft.png"
                pages={r.import.pages}
                version={r.import.finishedAt ?? ""}
                pdf="/api/resume/draft.pdf"
                label="The draft resume"
              />
            </Viewer>
          ) : s.error ? (
            <WorkspaceSection
              tone="danger"
              title={`${r.main} doesn't compile`}
              actions={
                <Button asChild variant="primary" size="sm">
                  <a href={href("profile", r.main)}>
                    <Pencil />
                    Edit source
                  </a>
                </Button>
              }
            >
              <pre role="alert" className="max-w-[56rem] overflow-x-auto font-mono text-xs whitespace-pre-wrap text-fg">
                {s.error}
              </pre>
            </WorkspaceSection>
          ) : s.exists ? (
            <Viewer>
              <Sheets src="/api/resume/stock.png" pages={s.pages} version={s.updatedAt ?? ""} pdf="/api/resume/stock.pdf" label="Your resume" />
            </Viewer>
          ) : (
            <Viewer>
              <EmptyState icon={<FileText />} title="No resume yet" description="Import what you have, or start from the example. Its pages show here." />
            </Viewer>
          )}
          {lead && (
            <div className="border-t border-border lg:hidden">
              <Notes r={r} />
            </div>
          )}
        </WorkspaceBody>
      )}
      <ConfirmDialog
        open={example}
        onOpenChange={setExample}
        title="Start from the example resume?"
        description={`The example is copied to ${r?.main ?? "main.typ"} for you to edit on the Profile page. Replace every detail in it before the app uses it.`}
        confirm="Copy the example"
        onConfirm={() =>
          void act(api.exampleResume).then(ok => {
            if (ok) location.hash = href("profile", r?.main ?? "main.typ");
          })
        }
      />
    </Workspace>
  );
}
