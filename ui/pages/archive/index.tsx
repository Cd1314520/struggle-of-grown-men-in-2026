// Archive: the jobs set aside, held back or rejected, as a library to browse rather than a queue to clear.
// A job opens in a panel over the right of the table, which stays live beside it.
import { Archive, Ellipsis, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FilterMenu, GroupSegments, ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
  Page,
  PageHeader,
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  Table,
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { cn } from "../../lib/cn";
import { plural } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { navigate, setParams, useRoute } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { ArchiveHeader, ArchiveRow } from "./row";

type View = "held" | "rejected";

// The first sort of each is the server's default, so it is left out of the URL.
const SORTS: Record<View, readonly { value: string; label: string }[]> = {
  held: [
    { value: "score", label: "Best fit" },
    { value: "newest", label: "Newest" },
    { value: "company", label: "Company" },
  ],
  rejected: [
    { value: "updated", label: "Recently rejected" },
    { value: "score", label: "Best fit" },
    { value: "company", label: "Company" },
  ],
};

const EMPTY: Record<View, [title: string, description: string]> = {
  held: ["Nothing held", "Jobs kept back by you or by the phase rules collect here."],
  rejected: ["Nothing rejected", "Jobs you turn down, and applications cleared as stuck, collect here."],
};

export function ArchivePage() {
  const { parts } = useRoute();
  const view: View = parts[0] === "rejected" ? "rejected" : "held";
  const lp = useListParams();
  const search = useRef<HTMLInputElement>(null);
  const record = useOpenRecord({ base: `archive/${view}`, view, lp, search });
  const { data: list, query, openId } = record;
  const { data: summary } = useSummary();
  const threshold = summary?.threshold ?? null;

  const counts = summary?.counts ?? {};
  const held = counts["held"] ?? 0;
  const rows = record.rows;
  // Score 80+ is the Strong match group under another name: the segments already offer it.
  const filters = (list?.filters ?? []).filter(f => !(view === "held" && f.key === "top"));
  const sorts = SORTS[view];
  const segmented = !!list && list.groups.length > 1 && list.total > 0;
  const [emptyTitle, emptyText] = EMPTY[view];

  return (
    <ListDetail
      layout="overlay"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      <Page>
        <PageHeader
          title="Archive"
          description="Jobs set aside: held back from applying, or turned down."
          actions={view === "held" && held > 0 && <ReleaseHeld count={held} />}
        >
          <Tabs
            value={view}
            onValueChange={v => {
              navigate(`archive/${v}`);
            }}
          >
            <TabsList>
              {(["held", "rejected"] as const).map(v => (
                <TabsTrigger key={v} value={v}>
                  {v === "held" ? "Held" : "Rejected"}
                  {counts[v] !== undefined && <span className="tabular text-xs font-normal text-fg-subtle">{counts[v].toLocaleString()}</span>}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </PageHeader>

        {list?.all === 0 ? (
          <EmptyState icon={<Archive />} title={emptyTitle} description={emptyText} />
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
              {segmented && <GroupSegments label="Fit" groups={list.groups} value={lp.group} onChange={lp.setGroup} className="-mx-1 min-w-0 px-1" />}
              {/* Beside segments the tools sit right; alone they start the row, clear of a job open over its right side. */}
              <div className={cn("flex items-center gap-2", segmented && "md:ml-auto")}>
                <SearchInput
                  ref={search}
                  value={lp.search}
                  onValueChange={lp.setSearch}
                  placeholder="Search"
                  aria-label={`Search ${view} jobs by title, company, place or reason`}
                  className="min-w-0 flex-1 md:w-64 md:flex-none"
                />
                <FilterMenu
                  filters={filters}
                  active={lp.filters}
                  onToggle={lp.toggleFilter}
                  onClear={() => {
                    setParams({ filter: null, page: null });
                  }}
                />
                <Select
                  prefix="Sort"
                  value={lp.sort ?? sorts[0]?.value ?? ""}
                  onValueChange={v => {
                    lp.setSort(v === sorts[0]?.value ? null : v);
                  }}
                  options={sorts}
                />
              </div>
            </div>

            <Table aria-label={view === "held" ? "Held jobs" : "Rejected jobs"} aria-rowcount={list?.total}>
              <ArchiveHeader when={view === "held" ? "Held" : "Rejected"} />
              {!list ? (
                <SkeletonRows rows={12} />
              ) : rows.length === 0 ? (
                <NoMatch noun="jobs" q={lp.q} filtered={lp.filters.length > 0 || !!lp.group} onClear={lp.clear} />
              ) : (
                <div className={query.isPlaceholderData ? "opacity-60 transition-opacity" : undefined}>
                  {rows.map(job => (
                    <ArchiveRow key={job.id} job={job} threshold={threshold} link={record.rowProps(job.id)} />
                  ))}
                </div>
              )}
            </Table>
            {list && <Pagination offset={list.offset} limit={list.limit} total={list.total} onChange={record.setPage} />}
          </>
        )}
      </Page>
    </ListDetail>
  );
}

// Every held job back through triage, after a confirmation: each is assessed again, which costs model time.
function ReleaseHeld({ count }: { count: number }) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Menu modal={false}>
        <MenuTrigger asChild>
          <Button variant="secondary" size="icon" aria-label="More actions">
            <Ellipsis />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            icon={<RotateCcw />}
            onSelect={() => {
              setConfirming(true);
            }}
          >
            Release all held jobs…
          </MenuItem>
        </MenuContent>
      </Menu>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Release all held jobs?"
        description={`Send all ${count.toLocaleString()} held jobs back through triage? Each one is assessed again.`}
        confirm={`Release ${plural(count, "job")}`}
        danger
        onConfirm={() => {
          api.run("release_held").then(
            () => {
              toast.success("Held jobs released");
              void refreshAll();
            },
            // The request has already shown the server's refusal.
            () => undefined,
          );
        }}
      />
    </>
  );
}
