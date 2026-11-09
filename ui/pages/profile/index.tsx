import { FilePen, FileText, Pencil, TriangleAlert } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { toast } from "sonner";
import { NoMatch } from "../../components/list";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ListBody,
  ListNotice,
  Markdown,
  SearchInput,
  SectionNav,
  Skeleton,
  StatusDot,
  Textarea,
  Workspace,
  WorkspaceBody,
  WorkspaceSection,
} from "../../components/ui";
import { cn } from "../../lib/cn";
import { api, queryClient, refreshAll, useProfileFile, useSummary } from "../../lib/api";
import { combo, useHotkeys } from "../../lib/hotkeys";
import { PROFILE_LABEL } from "../../lib/labels";
import { href, navigate, useRoute } from "../../lib/router";
import { pageScroller, scrollPageTop } from "../../lib/scroller";
import { CodeView } from "./code";
import { boardsOf, useBoards, type Board } from "./companies";
import { draftStore, needsFilling, PLACEHOLDER, PROFILE_DESC } from "./files";
import { blocksOf, outline } from "./outline";
import { rubricOf, RubricView } from "./rubric";

const label = (file: string) => PROFILE_LABEL[file] ?? file;

interface Head {
  title: ReactNode;
  description: ReactNode;
  actions: ReactNode;
  notice: ReactNode;
}

const ANCHOR = 128;

function lookingAt(root: HTMLElement | null, md: { heads: readonly number[]; hits: readonly number[] } | null, narrowed: boolean): number {
  if (!root) return 0;
  const sc = pageScroller();
  const main = sc === document.getElementById("main");
  const top = (main ? sc.getBoundingClientRect().top : 0) + Math.max(ANCHOR, (main ? sc.clientHeight : innerHeight) * 0.3);
  if (!narrowed && root.getBoundingClientRect().top > top - 48) return 0;
  if (md) {
    const hs = [...root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")];
    if (narrowed) {
      const i = md.hits.find(n => (hs[n]?.getBoundingClientRect().bottom ?? 0) > top - ANCHOR / 2) ?? md.hits[0];
      return i === undefined ? 0 : (md.heads[i] ?? 0);
    }
    let pick = -1;
    hs.forEach((h, i) => {
      if (h.getBoundingClientRect().top <= top) pick = i;
    });
    return md.heads[pick] ?? 0;
  }
  const edge = (main ? sc.getBoundingClientRect().top : 0) + ANCHOR * 0.75;
  for (const el of root.querySelectorAll<HTMLElement>("[data-at]")) if (el.getBoundingClientRect().bottom > edge) return Number(el.dataset["at"]) || 0;
  return 0;
}

function Companies({ boards, head, edit }: { boards: readonly Board[]; head: Head; edit: (at: (root: HTMLElement | null) => number) => void }) {
  const b = useBoards(boards);
  const body = useRef<HTMLDivElement>(null);
  const narrowed = b.count < boards.length;
  const here = () => {
    edit(() => lookingAt(body.current, null, narrowed));
  };
  useHotkeys([{ key: "e", run: here }]);
  return (
    <WorkspaceSection
      flush
      title={head.title}
      count={b.count}
      description={head.description}
      className="border-b-0"
      actions={
        <>
          <div className="w-56 max-sm:w-auto max-sm:max-w-44 max-sm:min-w-0 max-sm:flex-1 [&_input]:h-7 [&_input]:touch:h-9">{b.search}</div>
          {b.filter}
          <Button size="sm" icon={<Pencil />} onClick={here} shortcut="E">
            Edit
          </Button>
        </>
      }
    >
      <div ref={body} className="border-t border-border">
        {head.notice}
        <ListBody label="Companies">{b.rows}</ListBody>
      </div>
      {b.footer}
    </WorkspaceSection>
  );
}

function PhaseLine({ file }: { file: string }) {
  const { data: s } = useSummary();
  if (!s || (file !== "targets.md" && file !== "rubric.yml")) return null;
  const held = s.targets.holdBack;
  const what = held
    ? `Practice phase: targets are held, so the Practice ${file === "targets.md" ? "sections apply" : "rubric applies"}.`
    : "Real phase: targets use Real, other employers Practice.";
  return (
    <span className="ml-1.5">
      {what}{" "}
      <a href={href("settings")} className="text-accent-text underline-offset-2 hover:underline">
        Settings
      </a>
    </span>
  );
}

function FileView({ file }: { file: string }) {
  const { data: text, isPending } = useProfileFile(file);
  const { data: s } = useSummary();
  const draft = useSyncExternalStore(draftStore.subscribe, () => draftStore.get(file));
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const jump = useRef(0);
  const editing = draft !== undefined;
  const isMd = file.endsWith(".md");
  const dirty = editing && draft !== text;
  const boards = useMemo(() => (file === "companies.yml" && text ? boardsOf(text) : null), [file, text]);
  const rubric = useMemo(() => (file === "rubric.yml" && text ? rubricOf(text) : null), [file, text]);
  const blocks = useMemo(() => (isMd && text ? blocksOf(text) : null), [isMd, text]);
  const searchable = !!blocks && blocks.filter(b => b.level > 0).length > 3;
  const view = useMemo(() => (blocks ? outline(blocks, searchable ? q : "", label(file)) : null), [blocks, q, searchable, file]);

  const edit = (at: (root: HTMLElement | null) => number = () => 0) => {
    jump.current = at(body.current);
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
      void refreshAll();
    } catch {
    } finally {
      setSaving(false);
    }
  };
  const editHere = () => {
    edit(root => lookingAt(root, view, searchable && !!q.trim()));
  };
  useEffect(() => {
    const ta = box.current;
    if (!editing || !ta) return;
    const at = jump.current;
    jump.current = 0;
    if (at > 0) {
      scrollPageTop();
      const full = ta.value;
      const { height, minHeight } = ta.style;
      ta.style.minHeight = "0";
      ta.style.height = "0";
      ta.value = full.slice(0, at);
      const h = ta.scrollHeight;
      ta.value = full;
      ta.style.height = height;
      ta.style.minHeight = minHeight;
      const line = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.focus({ preventScroll: true });
      ta.setSelectionRange(at, at);
      ta.scrollTop = Math.max(0, h - line * 3);
    } else ta.focus();
  }, [editing]);
  useHotkeys([{ key: "mod+s", inFields: true, run: () => void save() }, !editing && text !== undefined && !boards && { key: "e", run: editHere }]);

  const desc = PROFILE_DESC[file];
  const todo = !editing && !!text?.includes(PLACEHOLDER);
  const head: Head = {
    title: label(file),
    description: (
      <>
        <code className="font-mono text-xs text-fg-muted">{file}</code>
        {!editing && <PhaseLine file={file} />}
      </>
    ),
    actions: editing ? (
      <>
        <Button variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={() => void save()} loading={saving} disabled={!dirty || saving} shortcut={combo("S")}>
          Save
        </Button>
      </>
    ) : (
      text?.trim() && (
        <>
          {searchable && (
            <div className="w-56 max-sm:flex-1 [&_input]:h-7 [&_input]:touch:h-9">
              <SearchInput
                value={q}
                onValueChange={setQ}
                placeholder={`Search ${label(file).toLowerCase()}`}
                aria-label={`Search ${label(file).toLowerCase()}`}
              />
            </div>
          )}
          <Button size="sm" icon={<Pencil />} onClick={editHere} shortcut="E">
            Edit
          </Button>
        </>
      )
    ),
    notice: todo && (
      <ListNotice tone="warning" icon={<TriangleAlert />}>
        Still has <code className="font-mono text-xs">{PLACEHOLDER}</code> placeholders.
      </ListNotice>
    ),
  };
  if (boards && !editing) return <Companies boards={boards} edit={edit} head={head} />;
  return (
    <WorkspaceSection
      flush
      title={head.title}
      count={!editing && searchable && q.trim() ? view?.count : undefined}
      description={head.description}
      actions={head.actions}
      className={cn("border-b-0", editing && "flex h-full flex-col [&>div:last-child]:flex [&>div:last-child]:flex-1 [&>div:last-child]:flex-col")}
    >
      <div ref={body} className="flex flex-1 flex-col border-t border-border">
        {head.notice}
        {isPending ? (
          <div className="max-w-[56rem] space-y-3 px-(--list-x) py-4">
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
            className={cn(
              "block min-h-[max(24rem,calc(100dvh-20rem))] flex-1 resize-none rounded-none border-0 bg-surface py-4 font-mono text-sm shadow-none hover:border-0 focus:ring-0",
              isMd ? "px-(--list-x)" : "pr-(--list-x) pl-[calc(var(--list-x)+3ch+1rem)]",
            )}
          />
        ) : !text?.trim() ? (
          <EmptyState
            icon={<FileText />}
            title={`${label(file)} is empty`}
            description={desc}
            action={
              <Button
                variant="primary"
                icon={<FilePen />}
                onClick={() => {
                  edit();
                }}
              >
                Write it
              </Button>
            }
            className="pt-16"
          />
        ) : view ? (
          view.count === 0 ? (
            <NoMatch
              noun="entries"
              q={q}
              filtered={false}
              onClear={() => {
                setQ("");
              }}
            />
          ) : (
            <Markdown
              text={view.text}
              className="max-w-[56rem] px-(--list-x) py-4 [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_h4]:text-sm [&>:first-child]:mt-0"
            />
          )
        ) : rubric ? (
          <RubricView phases={rubric} fallback={s?.thresholds ?? null} />
        ) : (
          <CodeView text={text} file={file} />
        )}
      </div>
    </WorkspaceSection>
  );
}

function SetupNotice({ problems, files }: { problems: readonly string[]; files: readonly string[] }) {
  const named = problems.map(p => (p === "resume" ? (files.find(f => f.endsWith(".typ")) ?? "main.typ") : p));
  return (
    <ListNotice tone="warning" icon={<TriangleAlert />}>
      <span className="font-medium">Setup isn&apos;t finished:</span>{" "}
      {named.map((f, i) => (
        <Fragment key={f}>
          {i > 0 && (i === named.length - 1 ? " and " : ", ")}
          <a href={href("profile", f)} className="font-medium text-accent-text underline-offset-2 hover:underline">
            {label(f)}
          </a>
        </Fragment>
      ))}{" "}
      {named.length === 1 ? "needs" : "need"} filling in. Nothing is assessed or applied until then.
    </ListNotice>
  );
}

export function ProfilePage() {
  const { data: s } = useSummary();
  const { parts } = useRoute();
  const files = s?.profileFiles ?? [];
  const problems = s?.profileProblems ?? [];
  const file = files.find(f => f === parts[0]) ?? files.find(f => needsFilling(problems, f)) ?? files[0];
  const [leaving, setLeaving] = useState<string | null>(null);
  const nav = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const on = nav.current?.querySelector<HTMLElement>("[aria-current]");
    const strip = on?.parentElement;
    if (!on || !strip || strip.scrollWidth <= strip.clientWidth) return;
    const left = on.offsetLeft - strip.offsetLeft;
    if (left < strip.scrollLeft || left + on.offsetWidth > strip.scrollLeft + strip.clientWidth)
      strip.scrollLeft = left - (strip.clientWidth - on.offsetWidth) / 2;
  }, [file, files.length]);

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

  const fileNav = (
    <div ref={nav}>
      <SectionNav
        label="Profile files"
        value={file ?? null}
        items={files.map(f => ({
          key: f,
          href: href("profile", f),
          label: (
            <span className="flex items-center gap-2">
              {label(f)}
              {needsFilling(problems, f) && <StatusDot tone="warning" />}
            </span>
          ),
        }))}
      />
    </div>
  );

  return (
    <Workspace
      className="max-lg:[&>:first-child]:border-b-0"
      bar={{ title: "Profile" }}
      notice={problems.length > 0 && <SetupNotice problems={problems} files={files} />}
    >
      <WorkspaceBody asideSide="left" asideWidth="nav" aside={fileNav}>
        {!s || !file ? (
          <div className="space-y-3 px-(--list-x) py-6">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-64 w-full max-w-[56rem]" />
          </div>
        ) : (
          <FileView key={file} file={file} />
        )}
      </WorkspaceBody>
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
    </Workspace>
  );
}
