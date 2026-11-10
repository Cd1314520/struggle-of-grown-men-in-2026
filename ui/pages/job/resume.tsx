import { Download, ExternalLink, FileText } from "lucide-react";
import { useState } from "react";
import type { JobDetail } from "../../../src/api-types";
import { Button, Disclosure, Section, Skeleton, Time } from "../../components/ui";
import { cn } from "../../lib/cn";
import { resumeChangesOf } from "./model";
import { AtsPanel } from "./ats";

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
  if (failed)
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center">
        <FileText className="size-6 text-fg-subtle" />
        <p className="text-sm text-fg-muted">The preview could not be rendered.</p>
      </div>
    );
  return (
    <a
      href={`/api/jobs/${job.id}/resume.pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className="relative block aspect-[8.5/11] w-full overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-border transition-shadow hover:shadow-lg"
    >
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
    <div className={cn("grid grid-cols-1 gap-8", job.hasPdf && "@3xl:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="flex min-w-0 flex-col gap-8">
        {job.resumeFrozen && (
          <p className="text-sm text-fg-muted" title={job.resume_sha ?? undefined}>
            {job.submitted_at ? "This is the resume that was sent" : "Locked for this application"}
            {job.resume_frozen_at && (
              <>
                , <Time at={job.resume_frozen_at} prefix="frozen " />
              </>
            )}
          </p>
        )}
        {job.hasPdf && !job.resumeFrozen && <AtsPanel jobId={job.id} version={job.resume_sha ?? job.updated_at} frozen={false} />}
        <Section title="What changed">
          {changes.length ? (
            <ul className="flex list-disc flex-col gap-2 pl-5 text-base text-fg marker:text-fg-subtle">
              {changes.map(c => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : (
            <p className="text-base text-fg-muted">Nothing recorded. This is your base resume.</p>
          )}
          {!job.hasPdf && <p className="mt-4 text-sm text-fg-muted">{job.resumeFrozen ? "No PDF on file." : "No PDF yet."}</p>}
        </Section>
        {job.hasPdf && job.resumeFrozen && <AtsPanel jobId={job.id} version={job.resume_sha ?? job.updated_at} frozen />}
      </div>
      {job.hasPdf && (
        <div className="flex flex-col gap-3 @3xl:mt-1">
          <Page key={`${job.id}:${job.resume_sha ?? job.updated_at}`} job={job} />
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
        </div>
      )}
      {job.diff && (
        <div className={cn("min-w-0", job.hasPdf && "@3xl:col-span-2")}>
          <Disclosure id="resume-diff" summary="Source diff against your base resume" inset={false}>
            <Diff diff={job.diff} />
          </Disclosure>
        </div>
      )}
    </div>
  );
}
