// The pieces of the Resume page: a resume's pages, framed as the sheets they are, and the upload form.
import { ExternalLink, FileText, FileUp, X } from "lucide-react";
import { useRef, useState } from "react";
import { Button, Field, Skeleton, Textarea } from "../../components/ui";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";

// Each page as an image. `version` changes whenever the PDF does, so a new one is fetched.
export function Sheets({ src, pages, version, pdf, label }: { src: string; pages: number | null; version: string; pdf: string; label: string }) {
  return (
    <div className="flex flex-col gap-4">
      {Array.from({ length: Math.max(1, pages ?? 1) }, (_, i) => (
        <Sheet key={`${version}-${i}`} src={`${src}?page=${i + 1}&v=${encodeURIComponent(version)}`} pdf={pdf} alt={`${label}, page ${i + 1}`} />
      ))}
    </div>
  );
}

function Sheet({ src, pdf, alt }: { src: string; pdf: string; alt: string }) {
  const [loaded, setLoaded] = useState(false); // rendered on the server the first time: shimmer until it arrives
  const [failed, setFailed] = useState(false);
  const frame = "relative aspect-[8.5/11] w-full overflow-hidden rounded-sm bg-white shadow-md ring-1 ring-border";
  if (failed)
    return (
      <div className={cn(frame, "flex flex-col items-center justify-center gap-2 bg-subtle text-center")}>
        <FileText className="size-6 text-fg-subtle" />
        <p className="text-sm text-fg-muted">The preview could not be rendered.</p>
      </div>
    );
  return (
    <a href={pdf} target="_blank" rel="noopener noreferrer" className={cn(frame, "block transition-shadow hover:shadow-lg")}>
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      {/* A phone can't read the page at this size: the sheet says what a tap does. */}
      <span
        aria-hidden
        className="absolute right-3 bottom-3 z-10 hidden h-8 items-center gap-1.5 rounded-md bg-surface px-3 text-sm font-medium text-fg shadow-md ring-1 ring-border touch:inline-flex"
      >
        <ExternalLink className="size-3.5" />
        Open PDF
      </span>
      <img
        src={src}
        alt={alt}
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

const size = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

// Files of any kind, dropped or chosen, and a note for the agent. `onSubmit` sends them.
export function Upload({
  limits,
  submit,
  busy,
  onSubmit,
  compact,
}: {
  limits: { files: number; bytes: number };
  submit: string;
  busy: boolean;
  onSubmit: (files: File[], note: string) => void;
  compact?: boolean;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [note, setNote] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) => {
    if (!list) return;
    const names = new Set(files.map(f => `${f.name}:${f.size}`));
    setFiles([...files, ...[...list].filter(f => !names.has(`${f.name}:${f.size}`))].slice(0, limits.files));
  };
  const total = files.reduce((n, f) => n + f.size, 0);
  const tooBig = total > limits.bytes;
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={e => {
        e.preventDefault();
        if (files.length && !tooBig) onSubmit(files, note);
      }}
    >
      <label
        onDragOver={e => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => {
          setOver(false);
        }}
        onDrop={e => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 text-center transition-colors focus-within:border-accent focus-within:ring-3 focus-within:ring-accent/15",
          compact ? "py-6" : "py-12",
          over ? "border-accent bg-accent-soft" : "border-border-strong bg-subtle/50 hover:bg-subtle",
        )}
      >
        <span className="flex size-10 items-center justify-center rounded-lg bg-surface text-fg-subtle shadow-xs ring-1 ring-border">
          <FileUp className="size-5" />
        </span>
        <span className="text-sm font-medium text-fg touch:hidden">Drop files here, or choose them</span>
        <span className="hidden text-sm font-medium text-fg touch:inline">Choose files</span>
        <span className="max-w-sm text-sm text-fg-muted">
          An old resume in any format, a LinkedIn PDF, a list of projects: anything that says what you have done. Up to {limits.files} files.
        </span>
        <input
          ref={input}
          type="file"
          multiple
          className="sr-only"
          onChange={e => {
            add(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="divide-y divide-border border-y border-border">
          {files.map(f => (
            <li key={`${f.name}:${f.size}`} className="flex min-h-11 items-center gap-3 px-3">
              <FileText className="size-4 shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{f.name}</span>
              <span className="text-sm text-fg-muted tabular">{size(f.size)}</span>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label={`Remove ${f.name}`}
                onClick={() => {
                  setFiles(files.filter(x => x !== f));
                }}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {tooBig && (
        <p className="text-sm text-danger-text">
          These come to {size(total)}; the limit is {size(limits.bytes)} together.
        </p>
      )}
      <Field
        label="Anything the agent should know"
        hint="Optional. For example: keep it to one page; lead with the backend work; leave out the 2019 internship."
      >
        <Textarea
          value={note}
          onChange={e => {
            setNote(e.target.value);
          }}
          rows={compact ? 2 : 3}
        />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" icon={<FileUp />} loading={busy} disabled={!files.length || tooBig || busy}>
          {submit}
        </Button>
        {files.length > 0 && <span className="text-sm text-fg-muted">{plural(files.length, "file")}</span>}
      </div>
    </form>
  );
}
