// Resume: the stock resume every application is tailored from, and the notes tailoring may draw on. Files of
// any kind can be imported: an agent writes them on the template, and the draft replaces the stock resume
// only when the owner says so.
import { CircleAlert, Download, FileText, NotebookPen, Pencil, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import type { ResumeState } from "../../../src/api-types";
import {
  Button,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  Disclosure,
  Page,
  PageHeader,
  Skeleton,
  Spinner,
  Textarea,
  Time,
} from "../../components/ui";
import { api, refreshAll, useResume } from "../../lib/api";
import { plural } from "../../lib/format";
import { href } from "../../lib/router";
import { Sheets, Upload } from "./parts";

// Every write ends the same way: the page follows the server.
const act = async (run: () => Promise<unknown>, done?: string) => {
  try {
    await run();
    if (done) toast.success(done);
    return true;
  } catch {
    return false; // the request showed why
  } finally {
    void refreshAll();
  }
};

function Running({ r }: { r: ResumeState }) {
  const [busy, setBusy] = useState(false);
  const imp = r.import;
  return (
    <Card>
      <CardHeader
        className="max-sm:px-4"
        title={imp.feedback.length ? "Changing the draft" : "Converting your files"}
        description="An agent is reading them and writing your resume on the template. This usually takes a few minutes; you can leave this page."
        actions={
          <Button
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
      />
      <div className="flex flex-col gap-4 border-t border-border px-4 sm:px-5 py-4">
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
    </Card>
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
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="rounded-xl border border-border bg-subtle p-4 shadow-xs sm:p-6">
        <Sheets src="/api/resume/draft.png" pages={imp.pages} version={imp.finishedAt ?? ""} pdf="/api/resume/draft.pdf" label="The draft resume" />
      </div>
      <Card className="lg:sticky lg:top-8">
        <CardHeader className="max-sm:px-4" title="Review the draft" description={imp.pages ? plural(imp.pages, "page") : undefined} />
        <div className="flex flex-col gap-4 border-t border-border px-4 sm:px-5 py-4">
          {imp.summary && <p className="text-sm text-fg">{imp.summary}</p>}
          {warnings.length > 0 && (
            <Callout tone="warning" icon={<TriangleAlert />} title="Check before you use it">
              <ul className="list-disc space-y-1 pl-4">
                {warnings.map((w, i) => (
                  <li key={i}>{w.replace(/^[-*•]\s*/, "")}</li>
                ))}
              </ul>
            </Callout>
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
        <div className="flex flex-col gap-3 border-t border-border px-4 sm:px-5 py-4">
          <label htmlFor="resume-feedback" className="text-sm font-medium text-fg">
            Ask for changes
          </label>
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
      </Card>
      <ConfirmDialog
        open={discarding}
        onOpenChange={setDiscarding}
        title="Discard this draft?"
        description="The uploaded files and the draft are deleted. Your current resume stays as it is."
        confirm="Discard"
        danger
        onConfirm={() => void act(api.discardImport)}
      />
    </div>
  );
}

function Failed({ r }: { r: ResumeState }) {
  const imp = r.import;
  const [busy, setBusy] = useState(false);
  return (
    <Callout tone="danger" icon={<CircleAlert />} title="The import didn't finish">
      <span className="block break-words">{imp.error}</span>
      <div className="mt-3 flex gap-2">
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
    </Callout>
  );
}

function Notes({ r }: { r: ResumeState }) {
  const state = r.notes.empty ? "Empty" : r.notes.example ? "Still the example" : null;
  return (
    <Card>
      <CardHeader
        className="max-sm:px-4"
        title="Resume notes"
        description="Confirmed extra material: more bullets for each job, other projects, skills. Tailoring swaps these in where they fit a posting better than the stock resume does."
      />
      <div className="flex flex-col gap-4 border-t border-border px-4 sm:px-5 py-4">
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
    </Card>
  );
}

function Current({ r }: { r: ResumeState }) {
  const s = r.stock;
  return (
    <Card>
      <CardHeader
        className="max-sm:px-4"
        titleAs="h2"
        title="Your resume"
        description={
          <>
            {s.pages ? `${plural(s.pages, "page")}, ` : ""}
            <Time at={s.updatedAt} prefix="changed " />
          </>
        }
        actions={
          <>
            {!s.error && (
              <Button asChild>
                <a href="/api/resume/stock.pdf" download={r.pdfName}>
                  <Download />
                  Download PDF
                </a>
              </Button>
            )}
            <Button asChild variant="ghost">
              <a href={href("profile", r.main)}>
                <Pencil />
                Edit source
              </a>
            </Button>
          </>
        }
      />
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {s.error ? (
          <Callout tone="danger" icon={<CircleAlert />} title={`${r.main} doesn't compile`}>
            <pre className="mt-1 overflow-x-auto font-mono text-xs whitespace-pre-wrap">{s.error}</pre>
          </Callout>
        ) : (
          <div className="rounded-lg bg-subtle p-4 sm:p-6">
            <Sheets src="/api/resume/stock.png" pages={s.pages} version={s.updatedAt ?? ""} pdf="/api/resume/stock.pdf" label="Your resume" />
          </div>
        )}
      </div>
    </Card>
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
  return (
    <Page>
      <PageHeader title="Resume" description="The stock resume every application is tailored from, and the notes tailoring may draw on." />
      {isPending || !r ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="aspect-[8.5/11] rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : status === "ready" ? (
        <Draft r={r} />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-6">
            {status === "failed" && <Failed r={r} />}
            {status === "running" ? (
              <Running r={r} />
            ) : r.stock.exists ? (
              <Current r={r} />
            ) : (
              <Card>
                <CardHeader
                  className="max-sm:px-4"
                  title="Import your resume"
                  description="Upload whatever you have. An agent writes it on the app's Typst template, keeping every fact as your files give it, and you review the result before it is used."
                />
                <div className="border-t border-border px-4 sm:px-5 py-5">
                  <Upload limits={r.limits} submit="Convert to a resume" busy={sending} onSubmit={start} />
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border px-4 sm:px-5 py-3 text-sm text-fg-muted">
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
              </Card>
            )}
          </div>
          <div className="flex flex-col gap-6">
            {r.stock.exists && status !== "running" && (
              <Card>
                <CardHeader
                  className="max-sm:px-4"
                  title="Import from files"
                  description="Build a new draft from an updated resume or anything else. Your current resume stays until you accept it."
                />
                <div className="border-t border-border px-4 sm:px-5 py-4">
                  <Upload compact limits={r.limits} submit="Convert" busy={sending} onSubmit={start} />
                </div>
              </Card>
            )}
            <Notes r={r} />
          </div>
        </div>
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
    </Page>
  );
}
