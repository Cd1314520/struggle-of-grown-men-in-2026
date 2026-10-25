// Profile: the files the agents read about the owner. The list says what each is for and which still need
// filling in; the file shows rendered, with an editor behind Edit.
import { FilePen, FileText, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button, Callout, Card, ConfirmDialog, EmptyState, Markdown, Page, PageHeader, Select, Skeleton, StatusDot, Textarea } from "../../components/ui";
import { api, queryClient, refreshAll, useProfileFile, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { combo, useHotkeys } from "../../lib/hotkeys";
import { PROFILE_LABEL } from "../../lib/labels";
import { href, navigate, useRoute } from "../../lib/router";
import { CodeView } from "./code";
import { draftStore, needsFilling, PLACEHOLDER, PROFILE_DESC, PROFILE_GIST } from "./files";

const label = (file: string) => PROFILE_LABEL[file] ?? file;

function FileList({ files, current, problems }: { files: readonly string[]; current: string; problems: readonly string[] }) {
  return (
    <nav aria-label="Profile files" className="sticky top-8 hidden flex-col gap-0.5 lg:flex">
      {files.map(f => {
        const on = f === current;
        return (
          <a
            key={f}
            href={href("profile", f)}
            aria-current={on ? "page" : undefined}
            className={cn(
              "group flex flex-col gap-0.5 rounded-lg border px-3 py-2.5 transition-colors",
              on ? "border-border bg-surface shadow-xs" : "border-transparent hover:bg-subtle",
            )}
          >
            <span className="flex items-center gap-2">
              <span className={cn("flex-1 text-sm font-medium", on ? "text-fg" : "text-fg-muted group-hover:text-fg")}>{label(f)}</span>
              {needsFilling(problems, f) && <StatusDot tone="warning" />}
            </span>
            <span className="truncate text-xs text-fg-subtle">{PROFILE_GIST[f]}</span>
          </a>
        );
      })}
    </nav>
  );
}

function FileView({ file, needs }: { file: string; needs: boolean }) {
  const { data: text, isPending } = useProfileFile(file);
  const draft = useSyncExternalStore(draftStore.subscribe, () => draftStore.get(file));
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== undefined;
  const isMd = file.endsWith(".md");
  const dirty = editing && draft !== text;

  const edit = () => {
    draftStore.set(file, text ?? "");
  };
  const cancel = () => {
    draftStore.clear(file);
  };
  const save = async () => {
    if (draft === undefined || saving) return;
    setSaving(true);
    try {
      await api.saveProfile(file, draft);
      queryClient.setQueryData(["profile", file], draft);
      draftStore.clear(file);
      toast.success(`Saved ${file}`);
      void refreshAll(); // the setup notice and the nav badge follow the files
    } catch {
      // the request showed why; the words stay in the editor
    } finally {
      setSaving(false);
    }
  };
  useEffect(() => {
    if (editing) box.current?.focus();
  }, [editing]);
  useHotkeys([{ key: "mod+s", inFields: true, run: () => void save() }, !editing && text !== undefined && { key: "e", run: edit }]);

  const desc = PROFILE_DESC[file];
  const todo = !editing && !!text?.includes(PLACEHOLDER);
  return (
    <Card className="flex min-w-0 flex-col overflow-hidden">
      <div className="border-b border-border px-5 py-4">
        <div className="flex items-center gap-4">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h2 className="text-lg font-semibold text-fg">{label(file)}</h2>
            <span className="truncate font-mono text-xs text-fg-subtle">{file}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {editing ? (
              <>
                <span className="mr-1 hidden text-xs text-fg-subtle sm:inline">{dirty ? "Unsaved changes" : "No changes"}</span>
                <Button variant="ghost" onClick={cancel} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => void save()} loading={saving} disabled={!dirty || saving} shortcut={combo("S")}>
                  Save
                </Button>
              </>
            ) : (
              text?.trim() && (
                <Button icon={<Pencil />} onClick={edit} shortcut="E">
                  Edit
                </Button>
              )
            )}
          </div>
        </div>
        {desc && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{desc}</p>}
      </div>
      {todo && (
        <Callout tone="warning" icon={<TriangleAlert />} className="mx-5 mt-4">
          This file still has <code className="font-mono text-xs">{PLACEHOLDER}</code> placeholders. Replace them before the app will use it.
        </Callout>
      )}
      {isPending ? (
        <div className="space-y-3 p-5">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ) : editing ? (
        <Textarea
          ref={box}
          value={draft}
          onChange={e => {
            draftStore.set(file, e.target.value);
          }}
          onKeyDown={e => {
            if (e.key === "Escape" && !dirty) cancel();
          }}
          spellCheck={false}
          aria-label={`Edit ${file}`}
          placeholder={desc}
          className="h-[calc(100dvh-16rem)] min-h-96 resize-none rounded-none border-0 bg-surface px-5 py-3 font-mono text-xs leading-5 shadow-none hover:border-0 focus:ring-0 sm:text-xs"
        />
      ) : !text?.trim() ? (
        <EmptyState
          icon={<FileText />}
          title={`${label(file)} is empty`}
          description={needs ? "Nothing is assessed or applied until it's filled in." : "The agents read it once it has something in it."}
          action={
            <Button variant="primary" icon={<FilePen />} onClick={edit}>
              Write it
            </Button>
          }
        />
      ) : isMd ? (
        <Markdown text={text} className="max-w-3xl px-5 py-5" />
      ) : (
        <CodeView text={text} file={file} />
      )}
    </Card>
  );
}

export function ProfilePage() {
  const { data: s } = useSummary();
  const { parts } = useRoute();
  const files = s?.profileFiles ?? [];
  const problems = s?.profileProblems ?? [];
  const file = files.find(f => f === parts[0]) ?? files.find(f => needsFilling(problems, f)) ?? files[0];
  const [leaving, setLeaving] = useState<string | null>(null);

  // A link that leaves this file while it has unsaved words asks first.
  useEffect(() => {
    const onClick = (ev: MouseEvent) => {
      const a = ev.target instanceof Element ? ev.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
      const to = a?.getAttribute("href");
      if (!file || !to || to === href("profile", file) || !draftStore.unsaved(file)) return;
      ev.preventDefault();
      ev.stopPropagation();
      setLeaving(to);
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
    };
  }, [file]);

  return (
    <Page>
      <PageHeader title="Profile" description="What the agents know about you. Every assessment, resume and application reads from these files." />
      {problems.length > 0 && (
        <Callout tone="warning" icon={<TriangleAlert />} title="Setup isn't finished" className="mb-6">
          Files marked with a dot are missing, empty or still templates. Nothing is assessed or applied until they're filled in.
        </Callout>
      )}
      {!s || !file ? (
        <Skeleton className="h-96 rounded-xl" />
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
          <FileList files={files} current={file} problems={problems} />
          <Select
            aria-label="Profile file"
            value={file}
            onValueChange={f => {
              if (draftStore.unsaved(file)) setLeaving(href("profile", f));
              else navigate(`profile/${f}`);
            }}
            options={files.map(f => ({ value: f, label: `${label(f)}${needsFilling(problems, f) ? " (to fill in)" : ""}` }))}
            className="w-full justify-between lg:hidden"
          />
          <FileView key={file} file={file} needs={needsFilling(problems, file)} />
        </div>
      )}
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={o => {
          if (!o) setLeaving(null);
        }}
        title="Discard unsaved changes?"
        description={`Your edits to ${file ?? "this file"} haven't been saved.`}
        confirm="Discard"
        danger
        onConfirm={() => {
          if (file) draftStore.clear(file);
          if (leaving) navigate(leaving);
        }}
      />
    </Page>
  );
}
