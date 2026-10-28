import { Download, FileText, NotebookPen, Pencil } from "lucide-react";
import { useState, type ReactNode } from "react";
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
      description="An agent is reading them and writing your resume on the template. This usually takes a few minutes; you can leave this page."
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
        <p className="text-sm text-fg-muted">From {imp.files.join(", ")}</p>
      </div>
    </WorkspaceSection>
  );
}

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
  return (
    <>
      <WorkspaceSection title="Review the draft" description={imp.pages ? plural(imp.pages, "page") : undefined}>
        <div className="flex flex-col gap-4">
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
              <span>
                Also update the resume notes
                <span className="block text-fg-muted">With what didn&apos;t fit on the page, so tailoring can swap it in.</span>
              </span>
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
        <div className="flex gap-2">
          <Button
            size="sm"
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
          <Button size="sm" variant="ghost" onClick={() => void act(api.discardImport)}>
            Discard
          </Button>
        </div>
      </div>
    </WorkspaceSection>
  );
}

function Notes({ r }: { r: ResumeState }) {
  const state = r.notes.empty ? "Empty" : r.notes.example ? "Still the example" : null;
  return (
    <WorkspaceSection
      title="Resume notes"
      description="Confirmed extra material: more bullets for each job, other projects, skills. Tailoring swaps these in where they fit a posting better than the stock resume does."
    >
      <div className="flex flex-col gap-4">
        {state && (
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{state}. </span>
            Without notes, tailoring can only reorder and trim the stock resume. Importing files adds what doesn&apos;t fit on the page.
          </p>
        )}
        <Button asChild className="self-start">
          <a href={href("profile", "resume-notes.md")}>
            <NotebookPen />
            Edit notes
          </a>
        </Button>
        <Disclosure id="resume-tailoring" summary="How each resume is tailored">
          <div className="space-y-2">
            <p>
              For each job that clears assessment, an agent copies the stock resume, reorders and trims bullets so the most relevant evidence comes first, and
              swaps in entries from your notes where they fit the posting better. It mirrors the posting&apos;s words only where they truly describe your work.
            </p>
            <p>
              Nothing is added that isn&apos;t in the stock resume or the notes, and a tailored copy never runs longer than the stock one. You see each copy,
              and what changed, on the job&apos;s page before you approve it.
            </p>
          </div>
        </Disclosure>
      </div>
    </WorkspaceSection>
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
  const meta = s?.exists && (
    <>
      {s.pages ? `${plural(s.pages, "page")}, ` : ""}
      <Time at={s.updatedAt} prefix="changed " />
    </>
  );
  return (
    <Workspace
      className="max-lg:[&_div:has(>[data-lead])]:flex-1"
      bar={{
        title: "Resume",
        hint: "The stock resume every application is tailored from, and the notes tailoring may draw on.",
        meta,
        controls: s?.exists && (
          <div data-lead className="min-w-0 text-sm lg:hidden">
            {!!s.pages && <p className="truncate font-medium text-fg">{plural(s.pages, "page")}</p>}
            <p className="truncate text-fg-muted">
              <Time at={s.updatedAt} prefix="Changed " />
            </p>
          </div>
        ),
        actions: r && s?.exists && (
          <>
            {!s.error && (
              <Button asChild size="sm">
                <a href="/api/resume/stock.pdf" download={r.pdfName}>
                  <Download />
                  <span className="max-sm:sr-only">Download PDF</span>
                </a>
              </Button>
            )}
            <Button asChild variant="ghost" size="sm">
              <a href={href("profile", r.main)}>
                <Pencil />
                Edit source
              </a>
            </Button>
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
          aside={
            <div className="lg:sticky lg:top-[calc(3rem+1px)]">
              {status === "failed" && <Failed r={r} />}
              {status === "running" ? (
                <Running r={r} />
              ) : status === "ready" ? (
                <Draft r={r} />
              ) : (
                <WorkspaceSection
                  title={s.exists ? "Import from files" : "Import your resume"}
                  description={
                    s.exists
                      ? "Build a new draft from an updated resume or anything else. Your current resume stays until you accept it."
                      : "Upload whatever you have. An agent writes it on the app's Typst template, keeping every fact as your files give it, and you review the result before it is used."
                  }
                >
                  <Upload compact={s.exists} limits={r.limits} submit={s.exists ? "Convert" : "Convert to a resume"} busy={sending} onSubmit={start} />
                  {!s.exists && (
                    <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-3 text-sm text-fg-muted">
                      <FileText className="size-4 text-fg-subtle" />
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
                  )}
                </WorkspaceSection>
              )}
              <Notes r={r} />
            </div>
          }
        >
          {status === "ready" ? (
            <Viewer>
              <Sheets
                src="/api/resume/draft.png"
                pages={r.import.pages}
                version={r.import.finishedAt ?? ""}
                pdf="/api/resume/draft.pdf"
                label="The draft resume"
              />
            </Viewer>
          ) : s.error ? (
            <WorkspaceSection tone="danger" title={`${r.main} doesn't compile`}>
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
