// Questions: what the filling agent could not answer from the profile, worked through one at a time.
// The queue on the left, newest posting first; the question in focus on the right (full-screen on a phone).
import { ArrowRight, CheckCheck, CircleAlert, PanelRight } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import type { QuestionGroup } from "../../../src/questions";
import { COLUMN, ListDetail, NoMatch, useRecordHistory } from "../../components/list";
import { Button, EmptyState, ListNotice, SearchInput, Skeleton, SkeletonRows, Workspace } from "../../components/ui";
import { api, queryClient, refreshAll, useQuestions } from "../../lib/api";
import { cn } from "../../lib/cn";
import { useHotkeys } from "../../lib/hotkeys";
import { TABLET, useMedia, WIDE } from "../../lib/media";
import { navigate, useRoute } from "../../lib/router";
import { FocusPane, type Answer } from "./focus";
import { choices, drafts, elsewhere, isQuestion, matches, nextAfter } from "./model";
import { Queue } from "./queue";

// After a save moves on, picks are ignored this long: a second press meant for the last question must not answer the next.
const HOLD_MS = 600;

const open = (key: string | null) => {
  navigate(key ? `questions/${encodeURIComponent(key)}` : "questions", { replace: true });
};

// The other gates, counted, with the way to Pipeline where each is handled on its application: a line
// under the bar, read as an alert.
function Elsewhere({ groups }: { groups: readonly QuestionGroup[] }) {
  const { total, text } = elsewhere(groups);
  if (!total) return null;
  const detail = text.charAt(0).toUpperCase() + text.slice(1);
  return (
    // The link rides in the text's line rather than as the notice's action, which a phone would push onto a
    // line of its own: one line keeps the queue high. Which gates they are is on hover and in Pipeline's stages.
    <ListNotice tone="warning" icon={<CircleAlert />}>
      <span className="flex flex-wrap items-center justify-between gap-x-3">
        <span title={detail}>
          {total.toLocaleString()} more {total === 1 ? "waits" : "wait"} on you
        </span>
        <Button asChild size="sm" variant="link" className="px-0 touch:px-0">
          <a href="#pipeline?group=needs_you">
            Pipeline
            <ArrowRight />
          </a>
        </Button>
      </span>
    </ListNotice>
  );
}

const HINT = "What application forms asked that your profile can't answer.";

function Loading() {
  return (
    <div className="flex lg:h-(--app-h)">
      <div className={cn("w-full", COLUMN)}>
        <Workspace frame="column" aria-label="Questions" bar={{ title: "Questions", search: <Skeleton className="h-8 w-full touch:h-10" /> }}>
          <SkeletonRows rows={8} />
        </Workspace>
      </div>
      <div className="hidden flex-1 flex-col gap-4 bg-surface px-10 pt-24 lg:flex">
        <Skeleton className="h-7 w-3/5" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-6 h-12 w-full max-w-2xl" />
        <Skeleton className="h-12 w-full max-w-2xl" />
      </div>
    </div>
  );
}

export function QuestionsPage() {
  const { parts } = useRoute();
  const routeKey = parts[0] ?? null;
  const wide = useMedia(WIDE),
    tablet = useMedia(TABLET);
  const { data, isPending, isError, refetch } = useQuestions();
  const groups = useMemo(() => (data ?? []).filter(isQuestion), [data]);
  const [search, setSearch] = useState("");
  const searchBox = useRef<HTMLInputElement>(null);
  // What the queue shows and J/K walks: all of it, or what the search matches.
  const shown = useMemo(() => (search.trim() ? groups.filter(g => matches(g, search)) : groups), [groups, search]);

  // The open question: the one in the URL, else the one at the place the last one was (it was answered or
  // went away), else the first.
  const found = routeKey ? shown.findIndex(g => g.key === routeKey) : -1;
  const [lastIndex, setLastIndex] = useState(0);
  if (found >= 0 && found !== lastIndex) setLastIndex(found);
  const index = found >= 0 ? found : Math.max(0, Math.min(lastIndex, shown.length - 1));
  const current = shown[index];

  const [sending, setSending] = useState<Answer["via"] | null>(null);
  const [focusNext, setFocusNext] = useState<string | null>(null); // the question whose box gets the cursor when it opens
  const [saves, setSaves] = useState(0); // remounts the form when the same question stays open after a save
  const holdUntil = useRef(0);
  // Side by side a question is always open, so only a phone's is closed.
  const { onListClick, close } = useRecordHistory({ isOpen: !!routeKey, closable: !wide, list: () => "questions", rows: "a[data-question]" });

  const move = (by: 1 | -1) => {
    const next = shown[Math.min(shown.length - 1, Math.max(0, index + by))];
    if (next && next !== current) open(next.key);
  };
  const skip = () => {
    open(shown[(index + 1) % shown.length]?.key ?? null);
  };

  useHotkeys([
    {
      key: "j",
      run: () => {
        move(1);
      },
    },
    {
      key: "k",
      run: () => {
        move(-1);
      },
    },
    {
      key: "/",
      run: () => {
        searchBox.current?.focus();
      },
    },
  ]);

  const answer = async (a: Answer, group: QuestionGroup) => {
    const before = shown.map(g => g.key);
    setSending(a.via);
    try {
      // Checked against the server's list, not the one rendered: it may have been answered elsewhere since.
      const latest = await queryClient.query({ queryKey: ["questions"], queryFn: api.questions, staleTime: 0 });
      if (!latest.some(g => g.jobs.some(j => j.gateId === a.gateId))) {
        void refreshAll();
        toast("This question has already changed.");
        return;
      }
      const result = await api.answer(a.gateId, a.answer, a.scope);
      drafts.delete(group.key);
      await refreshAll();
      const left = (queryClient.getQueryData<QuestionGroup[]>(["questions"]) ?? []).filter(g => isQuestion(g) && matches(g, search));
      const next = nextAfter(group, before, left);
      const n = result.jobIds.length;
      // A question found on the same page opens next instead of the application resuming.
      const followUp = next && !before.includes(next.key);
      toast.success(n > 1 ? `Saved, ${n} applications queued` : followUp ? "Saved, it asks one more question" : "Saved, application queued");
      holdUntil.current = Date.now() + HOLD_MS;
      // A typed question gets the cursor in its box; one with options leaves the keys free to pick.
      setFocusNext(next && !choices(next).length && matchMedia(WIDE).matches ? next.key : null);
      setSaves(s => s + 1);
      open(next?.key ?? null);
    } catch {
      // The server's refusal was shown; show what is true now.
      void refreshAll();
    } finally {
      setSending(null);
    }
  };

  if (isPending) return <Loading />;
  if (isError)
    return (
      <Workspace bar={{ title: "Questions", hint: HINT }}>
        <EmptyState
          className="pt-24"
          icon={<CircleAlert />}
          title="Couldn't load the questions"
          action={
            <Button
              onClick={() => {
                void refetch();
              }}
            >
              Try again
            </Button>
          }
        />
      </Workspace>
    );

  if (!groups.length)
    return (
      <Workspace aria-label="Questions" bar={{ title: "Questions", count: 0, hint: HINT }} notice={<Elsewhere groups={data} />}>
        <EmptyState
          className="pt-24"
          icon={<CheckCheck />}
          title="All caught up"
          description="Nothing is waiting on an answer. When an application asks something your profile can't answer, it lands here."
        />
      </Workspace>
    );

  return (
    <ListDetail
      layout="column"
      label="Open question"
      open={!!routeKey && !!current}
      onListClick={onListClick}
      detail={
        current && (
          <FocusPane
            key={`${current.key}:${saves}`}
            group={current}
            index={index}
            total={shown.length}
            sending={sending}
            autoFocus={focusNext === current.key}
            canAnswer={() => Date.now() >= holdUntil.current}
            onAnswer={(a, g) => void answer(a, g)}
            onMove={move}
            onSkip={skip}
            onBack={close}
          />
        )
      }
      empty={<EmptyState icon={<PanelRight />} title="No question open" description="Pick a question from the queue to answer it." className="h-full" />}
    >
      {/* The count's own line is a tablet's: a phone's tab bar badge counts the questions, so the queue starts
          right under the search and the notice. */}
      <Workspace
        frame="column"
        aria-label="Questions"
        bodyRole="none"
        bar={{
          title: "Questions",
          count: groups.length,
          ...(tablet && { noun: "to answer" }),
          search: (
            <SearchInput ref={searchBox} value={search} onValueChange={setSearch} placeholder="Filter by question or employer" aria-label="Filter questions" />
          ),
        }}
        notice={<Elsewhere groups={data} />}
      >
        {current ? (
          <Queue groups={shown} selected={current.key} desktopOnly={!routeKey} />
        ) : (
          <NoMatch
            noun="questions"
            q={search}
            filtered={false}
            onClear={() => {
              setSearch("");
            }}
          />
        )}
      </Workspace>
    </ListDetail>
  );
}
