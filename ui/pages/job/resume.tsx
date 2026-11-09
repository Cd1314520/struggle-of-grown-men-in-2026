import { Download, ExternalLink, FileText, Lock } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Button, Disclosure, Section, Skeleton, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { resumeChangesOf } from "./model";

function Diff({ diff }: { diff: string }) {
  return (
    <pre className="max-h-[480px] overflow-auto rounded-lg border border-border bg-subtle/50 py-2 font-mono text-xs leading-5">
      {diff.split("\n").map((l, i) => (
        <span
          key={i}
          className={cn(
            "block px-3 whitespace-pre-wrap",
            l.startsWith("+")
              ? "bg-success-soft text-success-text"
              : l.startsWith("-")
                ? "bg-danger-soft text-danger-text"
                : l.startsWith("@@")
                  ? "text-info-text"
                  : "text-fg-muted",
          )}
        >
          {l || " "}
        </span>
      ))}
    </pre>
  );
}

function Page({ job }: { job: JobDetail }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const frame = "relative aspect-[8.5/11] w-full overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-border";
  if (!job.hasPdf || failed)
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-2 bg-subtle text-center")}>
        <FileText className="size-6 text-fg-subtle" />
        <p className="text-sm text-fg-muted">{job.hasPdf ? "The preview could not be rendered." : "No resume file for this job."}</p>
      </div>
    );
  return (
    <a href={`/api/jobs/${job.id}/resume.pdf`} target="_blank" rel="noopener noreferrer" className={cn(frame, "block transition-shadow hover:shadow-lg")}>
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <img
        src={`/api/jobs/${job.id}/resume.png?v=${job.resume_sha ?? job.updated_at}`}
        alt="First page of the tailored resume"
        className="w-full"
        onLoad={() => {
          setLoaded(true);
        }}
        onError={() => {
          setFailed(true);
        }}
      />
    </a>
  );
}

export function Resume({ job }: { job: JobDetail }) {
  const changes = resumeChangesOf(job.resume_changes);
  return (
    <div className="grid grid-cols-1 gap-8 @3xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex min-w-0 flex-col gap-8">
        <Section title="What changed" description={changes.length ? "Against your base resume, for this posting." : undefined}>
          {changes.length ? (
            <ol className="flex flex-col gap-3">
              {changes.map((c, i) => (
                <li key={c} className="flex gap-3 text-base text-fg">
                  <span className="tabular mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-subtle text-2xs font-medium text-fg-muted">
                    {i + 1}
                  </span>
                  <span className="min-w-0">{c}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-base text-fg-muted">Nothing recorded. This is your base resume.</p>
          )}
        </Section>
        {job.resumeFrozen && (
          <div className="flex items-start gap-3 text-sm">
            <Lock className="mt-0.5 size-4 shrink-0 text-fg-subtle" />
            <div className="min-w-0">
              <p className="text-fg">{job.submitted_at ? "This is the resume that was sent." : "Locked for this application."}</p>
              <p className="mt-0.5 flex flex-wrap gap-x-3 text-fg-muted">
                {job.resume_frozen_at && <Time at={job.resume_frozen_at} prefix="Frozen " />}
                {job.resume_sha && <code className="font-mono text-xs leading-5 text-fg">{job.resume_sha.slice(0, 10)}</code>}
              </p>
            </div>
          </div>
        )}
        {job.diff && (
          <Disclosure id="resume-diff" summary="Source diff against your base resume">
            <Diff diff={job.diff} />
          </Disclosure>
        )}
      </div>
      <div className="flex flex-col gap-3 @3xl:order-none">
        <Page key={`${job.id}:${job.resume_sha ?? job.updated_at}`} job={job} />
        {job.hasPdf && (
          <div className="flex gap-2">
            <Button asChild className="flex-1">
              <a href={`/api/jobs/${job.id}/resume.pdf`} target="_blank" rel="noopener noreferrer">
                <ExternalLink />
                Open
              </a>
            </Button>
            <Button asChild variant="ghost">
              <a href={`/api/jobs/${job.id}/resume.pdf`} download={job.pdfName}>
                <Download />
                Download
              </a>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
