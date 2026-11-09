import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { Dialog as D } from "radix-ui";
import { Mail, Monitor, Moon, Plus, Radar, RefreshCw, Search, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type { ListRow, ListView, Summary } from "../../../src/api-types";
import { api, refreshAll, useSummary } from "../../lib/api";
import { navigate } from "../../lib/router";
import { setTheme } from "../../lib/theme";
import { CompanyMark, Count, JobStatus, Kbd, useReturnFocus } from "../ui";
import { NAV, type NavItem } from "./nav";
import { useShell } from "./state";

const jobPath = (view: ListView, id: number) => (view === "held" || view === "rejected" ? `archive/${view}/${id}` : `${view}/${id}`);
const SEARCHED: readonly ListView[] = ["review", "pipeline", "applications", "held", "rejected"];

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => {
      setV(value);
    }, ms);
    return () => {
      clearTimeout(t);
    };
  }, [value, ms]);
  return v;
}

function Item({ onSelect, icon, children, hint, value }: { onSelect: () => void; icon: ReactNode; children: ReactNode; hint?: ReactNode; value: string }) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex min-h-9 cursor-pointer items-center gap-3 rounded-md px-2.5 text-sm text-fg outline-none select-none data-[selected=true]:bg-muted touch:min-h-11 touch:py-1.5"
    >
      <span className="flex size-6 shrink-0 items-center justify-center [&>svg]:size-4 [&>svg]:text-fg-subtle">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint && <span className="shrink-0 text-xs text-fg-subtle">{hint}</span>}
    </Command.Item>
  );
}

function GoHint({ item, summary }: { item: NavItem; summary: Summary | undefined }) {
  const badge = summary && item.badge?.(summary);
  if (!item.go && !badge?.value) return null;
  return (
    <span className="flex items-center gap-3">
      {badge && <Count value={badge.value} tone={badge.tone} />}
      {item.go && (
        <span className="flex items-center gap-1 touch:hidden">
          <Kbd>G</Kbd>
          <Kbd>{item.go.toUpperCase()}</Kbd>
        </span>
      )}
    </span>
  );
}

const groupClass =
  "[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-fg-subtle";

export function CommandPalette() {
  const { paletteOpen, setPaletteOpen, setAddOpen } = useShell();
  const [q, setQ] = useState("");
  const { data: summary } = useSummary();
  const term = useDebounced(q.trim(), 160);
  const { data: jobs, isFetching } = useQuery({
    queryKey: ["search", term],
    enabled: paletteOpen && term.length >= 2,
    queryFn: async () => {
      const lists = await Promise.all(SEARCHED.map(view => api.list({ view, q: term, limit: 6 })));
      return lists.flatMap(l => l.rows.map(row => ({ row, view: l.view }))).slice(0, 12);
    },
    placeholderData: prev => prev,
  });
  const [selected, setSelected] = useState("");
  const searching = q.trim() !== term || isFetching;
  const jobValue = (id: number, title: string, company: string) => `job ${id} ${title} ${company} ${term}`;
  const first = term.length >= 2 && jobs?.[0] ? jobValue(jobs[0].row.id, jobs[0].row.title, jobs[0].row.company) : null;
  const [landed, setLanded] = useState<string | null>(null);
  if (first !== landed) {
    setLanded(first);
    if (first) setSelected(first);
  }
  const focus = useReturnFocus();
  const close = () => {
    setPaletteOpen(false);
    setQ("");
  };
  const go = (to: string) => {
    close();
    navigate(to);
  };
  const run = (what: "scan" | "track" | "discover", done: string) => {
    close();
    api.run(what).then(
      () => {
        toast.success(done);
        void refreshAll();
      },
      () => undefined,
    );
  };
  return (
    <D.Root
      open={paletteOpen}
      onOpenChange={o => {
        if (!o) close();
        else setPaletteOpen(true);
      }}
    >
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 animate-in bg-overlay backdrop-blur-[2px]" />
        <D.Content
          {...focus}
          className="fixed top-[14vh] left-1/2 z-50 w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 animate-pop overflow-hidden rounded-xl border border-border bg-surface shadow-lg outline-none"
        >
          <D.Title className="sr-only">Search and commands</D.Title>
          <D.Description className="sr-only">Search jobs and pages, or run a command</D.Description>
          <Command label="Search and commands" shouldFilter={true} loop value={selected} onValueChange={setSelected}>
            <div className="flex items-center gap-3 border-b border-border px-4">
              <span className="flex size-6 shrink-0 items-center justify-center">
                <Search className="size-4 text-fg-subtle" />
              </span>
              <Command.Input
                value={q}
                onValueChange={setQ}
                placeholder="Search jobs, companies, pages…"
                className="h-12 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-fg-subtle touch:text-lg"
              />
            </div>
            <Command.List className="max-h-[min(60vh,420px)] overflow-y-auto p-1.5">
              <Command.Empty className="px-3 py-8 text-center text-sm text-fg-muted">
                {q.trim().length < 2 ? "Type to search." : searching ? "Searching…" : "No matches."}
              </Command.Empty>
              {!!jobs?.length && term.length >= 2 && (
                <Command.Group heading="Jobs" className={groupClass}>
                  {jobs.map(({ row, view }: { row: ListRow; view: ListView }) => (
                    <Item
                      key={row.id}
                      value={jobValue(row.id, row.title, row.company)}
                      onSelect={() => {
                        go(jobPath(view, row.id));
                      }}
                      icon={<CompanyMark name={row.company} size="sm" />}
                      hint={<JobStatus status={row.status} />}
                    >
                      <span className="flex min-w-0 flex-col sm:flex-row sm:items-baseline sm:gap-2">
                        <span className="truncate text-fg">{row.title}</span>
                        <span className="truncate text-fg-subtle max-sm:text-xs">{row.company}</span>
                      </span>
                    </Item>
                  ))}
                </Command.Group>
              )}
              <Command.Group heading="Actions" className={groupClass}>
                <Item
                  value="add a posting url"
                  icon={<Plus />}
                  onSelect={() => {
                    close();
                    setAddOpen(true);
                  }}
                >
                  Add a posting
                </Item>
                <Item
                  value="scan job boards now"
                  icon={<RefreshCw />}
                  onSelect={() => {
                    run("scan", "Scan started");
                  }}
                >
                  Scan job boards now
                </Item>
                <Item
                  value="check mail for replies inbox"
                  icon={<Mail />}
                  onSelect={() => {
                    run("track", "Checking mail");
                  }}
                >
                  Check mail for replies
                </Item>
                <Item
                  value="find new companies to watch discover"
                  icon={<Radar />}
                  onSelect={() => {
                    run("discover", "Looking for new companies");
                  }}
                >
                  Find new companies to watch
                </Item>
              </Command.Group>
              <Command.Group heading="Go to" className={groupClass}>
                {NAV.map(n => (
                  <Item
                    key={n.page}
                    value={`go ${n.label}`}
                    icon={<n.icon strokeWidth={1.75} />}
                    onSelect={() => {
                      go(n.page);
                    }}
                    hint={<GoHint item={n} summary={summary} />}
                  >
                    {n.label}
                  </Item>
                ))}
              </Command.Group>
              {q.trim() && (
                <Command.Group heading="Theme" className={groupClass}>
                  {(
                    [
                      ["light", "Light theme", Sun],
                      ["dark", "Dark theme", Moon],
                      ["system", "System theme", Monitor],
                    ] as const
                  ).map(([t, label, Icon]) => (
                    <Item
                      key={t}
                      value={`theme ${label}`}
                      icon={<Icon />}
                      onSelect={() => {
                        setTheme(t);
                        close();
                      }}
                    >
                      {label}
                    </Item>
                  ))}
                </Command.Group>
              )}
            </Command.List>
          </Command>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
