// Archive: the jobs set aside, held back or rejected, as a library to browse rather than a queue to clear.
// Until a job opens the list is the page; open one and the same rows become the column beside it.
import { Archive, Ellipsis, RotateCcw } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FilterMenu, GroupSegments, ListDetail, NoMatch, useOpenRecord } from "../../components/list";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ListPanel,
  ListToolbar,
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
  Tabs,
  TabsList,
  TabsTrigger,
} from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { num, plural } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { useMedia, WIDE } from "../../lib/media";
import { navigate, setParams, useRoute } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { ArchiveColumns, ArchiveRow } from "./row";

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
  const compact = useMedia(WIDE) && openId !== null;

  const counts = summary?.counts ?? {};
  const held = counts["held"] ?? 0;
  const rows = record.rows;
  // Score 80+ is the Strong match group under another name: the segments already offer it.
  const filters = (list?.filters ?? []).filter(f => !(view === "held" && f.key === "top"));
  const sorts = SORTS[view];
  const segmented = !!list && list.groups.length > 1 && list.total > 0;
  const [emptyTitle, emptyText] = EMPTY[view];
  // A reason every row on the page shares is said once, over them, rather than down every row.
  const first = rows[0]?.reason?.label;
  const uniform = rows.length > 1 && !!first && rows.every(r => r.reason?.label === first);
  const when = view === "held" ? "Held" : "Rejected";

  const panel = (
    <Tabs
      value={view}
      onValueChange={v => {
        navigate(`archive/${v}`);
      }}
      // No box of its own, so the column's panel fills the column.
      className="contents"
    >
      <ListPanel
        frame={compact ? "column" : "page"}
        tabs={
          <TabsList>
            {(["held", "rejected"] as const).map(v => (
              <TabsTrigger key={v} value={v} count={counts[v]}>
                {v === "held" ? "Held" : "Rejected"}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        actions={view === "held" && held > 0 && <ReleaseHeld count={held} />}
        toolbar={
          list?.all !== 0 && (
            <ListToolbar
              segments={segmented && <GroupSegments label="Fit" groups={list.groups} value={lp.group} onChange={lp.setGroup} />}
              search={
                <SearchInput
                  ref={search}
                  value={lp.search}
                  onValueChange={lp.setSearch}
                  placeholder="Search"
                  aria-label={`Search ${view} jobs by title, company, place or reason`}
                />
              }
              controls={
                <>
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
                    collapse
                    value={lp.sort ?? sorts[0]?.value ?? ""}
                    onValueChange={v => {
                      lp.setSort(v === sorts[0]?.value ? null : v);
                    }}
                    options={sorts}
                  />
                </>
              }
            />
          )
        }
        notice={
          uniform && (
            <p className="px-[var(--list-x)] pb-3 text-sm text-fg-muted">
              All {num(rows.length)}
              {list && list.total > rows.length && " on this page"}: {first}.
            </p>
          )
        }
        columns={!!rows.length && <ArchiveColumns when={when} uniform={uniform} />}
        footer={list && <Pagination variant="footer" noun="jobs" offset={list.offset} limit={list.limit} total={list.total} onChange={record.setPage} />}
        loading={query.isPlaceholderData}
        bodyLabel={view === "held" ? "Held jobs" : "Rejected jobs"}
        aria-rowcount={list?.total}
      >
        {list?.all === 0 ? (
          <EmptyState size="sm" icon={<Archive />} title={emptyTitle} description={emptyText} />
        ) : !list ? (
          <SkeletonRows rows={12} />
        ) : rows.length === 0 ? (
          <NoMatch noun="jobs" q={lp.q} filtered={lp.filters.length > 0 || !!lp.group} onClear={lp.clear} />
        ) : (
          rows.map(job => <ArchiveRow key={job.id} job={job} threshold={threshold} uniform={uniform} link={record.rowProps(job.id)} />)
        )}
      </ListPanel>
    </Tabs>
  );

  return (
    <ListDetail
      layout="split"
      label="Open job"
      open={openId !== null}
      onListClick={record.onListClick}
      detail={record.panel && <JobDetail key={record.panel.id} layout="panel" {...record.panel} />}
    >
      {compact ? (
        <>
          {/* Beside a job the tabs head the column; the page still has its title. */}
          <h1 className="sr-only">Archive</h1>
          {panel}
        </>
      ) : (
        <Page>
          <PageHeader title="Archive" description="Jobs set aside: held back from applying, or turned down." descriptionOnPhone={false} />
          {panel}
        </Page>
      )}
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
          {/* Its 40px touch target overhangs the tab row rather than heightening it, so the tabs sit at the same
              height on Held, which has the menu, and on Rejected, which doesn't. */}
          <Button variant="secondary" size="icon" aria-label="More actions" className="touch:-my-1">
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
