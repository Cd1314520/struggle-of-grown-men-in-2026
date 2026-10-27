// Profile: the files the agents read about the owner. The list says what each is for and which still need
// filling in; the file shows rendered, with an editor behind Edit.
import { FilePen, FileText, Pencil, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Button,
  Callout,
  ConfirmDialog,
  EmptyState,
  ListNotice,
  ListPanel,
  ListToolbar,
  Markdown,
  Page,
  PageHeader,
  SectionNav,
  Select,
  Skeleton,
  StatusDot,
  Textarea,
} from "../../components/ui";
import { api, queryClient, refreshAll, useProfileFile, useSummary } from "../../lib/api";
import { combo, useHotkeys } from "../../lib/hotkeys";
import { PROFILE_LABEL } from "../../lib/labels";
import { href, navigate, useRoute } from "../../lib/router";
import { CodeView } from "./code";
import { boardsOf, useBoards, type Board } from "./companies";
import { draftStore, needsFilling, PLACEHOLDER, PROFILE_DESC, PROFILE_GIST } from "./files";

const label = (file: string) => PROFILE_LABEL[file] ?? file;

// The file's panel head: its name, what it is for, and Edit (or Save and Cancel).
interface Head {
  title: ReactNode;
  description: ReactNode;
  actions: ReactNode;
  notice: ReactNode;
}

function Companies({ boards, head }: { boards: readonly Board[]; head: Head }) {
  const b = useBoards(boards);
  return (
    <ListPanel frame="card" {...head} count={b.count} bodyLabel="Companies" toolbar={<ListToolbar search={b.search} />} footer={b.footer}>
      {b.rows}
    </ListPanel>
  );
}

// A markdown file's first heading, when it only repeats the panel's title ("# Targets").
const withoutTitle = (text: string, title: string) =>
  text.replace(/^\s*#\s+(.+)\n+/, (line, h: string) => (h.trim().toLowerCase() === title.toLowerCase() ? "" : line));

function FileView({ file, needs }: { file: string; needs: boolean }) {
  const { data: text, isPending } = useProfileFile(file);
  const draft = useSyncExternalStore(draftStore.subscribe, () => draftStore.get(file));
  const [saving, setSaving] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== undefined;
  const isMd = file.endsWith(".md");
  const dirty = editing && draft !== text;
  const boards = useMemo(() => (file === "companies.yml" && text ? boardsOf(text) : null), [file, text]);

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
  const head: Head = {
    title: label(file),
    description: (
      <>
        <code className="mr-1.5 font-mono text-xs text-fg">{file}</code>
        {desc}
      </>
    ),
    actions: editing ? (
      <>
        <span className="mr-1 hidden text-sm text-fg-muted sm:inline">{dirty ? "Unsaved changes" : "No changes"}</span>
        <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || saving} shortcut={combo("S")}>
          Save
        </Button>
      </>
    ) : (
      text?.trim() && (
        <Button size="sm" icon={<Pencil />} onClick={edit} shortcut="E">
          Edit
        </Button>
      )
    ),
    notice: todo && (
      <ListNotice tone="warning" icon={<TriangleAlert />}>
        This file still has <code className="font-mono text-xs">{PLACEHOLDER}</code> placeholders. Replace them before the app will use it.
      </ListNotice>
    ),
  };
  if (boards && !editing) return <Companies boards={boards} head={head} />;
  return (
    <ListPanel frame="card" {...head} bodyRole="none">
      {/* Its line is the header's, so the body never doubles it. */}
      <div className="border-t border-border">
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
            className="block h-[calc(100dvh-16rem)] min-h-96 resize-none rounded-none rounded-b-xl border-0 bg-surface px-(--list-x) py-3 font-mono text-sm shadow-none hover:border-0 focus:ring-0"
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
          <Markdown text={withoutTitle(text, label(file))} className="max-w-3xl px-(--list-x) py-5" />
        ) : (
          <CodeView text={text} file={file} />
        )}
      </div>
    </ListPanel>
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
          <SectionNav
            label="Profile files"
            className="max-lg:hidden"
            value={file}
            items={files.map(f => ({
              key: f,
              href: href("profile", f),
              label: (
                <span className="flex items-center gap-2">
                  {label(f)}
                  {needsFilling(problems, f) && <StatusDot tone="warning" />}
                </span>
              ),
              hint: PROFILE_GIST[f],
            }))}
          />
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
          <div className="min-w-0 flex-1">
            <FileView key={file} file={file} needs={needsFilling(problems, file)} />
          </div>
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
