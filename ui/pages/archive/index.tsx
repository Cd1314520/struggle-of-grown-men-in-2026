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
  Pagination,
  SearchInput,
  Select,
  SkeletonRows,
  Tabs,
  TabsList,
  TabsTrigger,
  Workspace,
} from "../../components/ui";
import { api, refreshAll, useSummary } from "../../lib/api";
import { num, plural } from "../../lib/format";
import { useListParams } from "../../lib/list-params";
import { useMedia, WIDE } from "../../lib/media";
import { navigate, setParams, useRoute } from "../../lib/router";
import { JobDetail } from "../job/detail";
import { ArchiveRow } from "./row";
import { thresholdOf } from "../job/model";

type View = "held" | "rejected";

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
  const compact = useMedia(WIDE) && openId !== null;

  const counts = summary?.counts ?? {};
  const held = counts["held"] ?? 0;
  const rows = record.rows;
  const filters = (list?.filters ?? []).filter(f => !(view === "held" && f.key === "top"));
  const sorts = SORTS[view];
  const segmented = !!list && list.groups.length > 1 && list.total > 0;
  const [emptyTitle, emptyText] = EMPTY[view];
  const first = rows[0]?.reason?.label;
  const uniform = rows.length > 1 && !!first && rows.every(r => r.reason?.label === first);
  const tools = list?.all !== 0;

  const panel = (
    <Tabs
      value={view}
      onValueChange={v => {
        navigate(`archive/${v}`);
      }}
      className="contents"
    >
      <Workspace
        frame={compact ? "column" : "page"}
        aria-label="Archive"
        bodyRole="table"
        bodyLabel={view === "held" ? "Held jobs" : "Rejected jobs"}
        aria-rowcount={list?.total}
        loading={query.isPlaceholderData}
        bar={{
          title: "Archive",
          hint: "Jobs set aside: held back from applying, or turned down.",
          tabs: (
            <TabsList variant="bar">
              {(["held", "rejected"] as const).map(v => (
                <TabsTrigger key={v} value={v} count={counts[v]}>
                  {v === "held" ? "Held" : "Rejected"}
                </TabsTrigger>
              ))}
            </TabsList>
          ),
          actions: view === "held" && held > 0 && <ReleaseHeld count={held} />,
          ...(tools && {
            search: (
              <SearchInput
                ref={search}
                value={lp.search}
                onValueChange={lp.setSearch}
                placeholder="Search"
                aria-label={`Search ${view} jobs by title, company, place or reason`}
              />
            ),
            controls: (
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
            ),
            segments: segmented && <GroupSegments label="Fit" groups={list.groups} value={lp.group} onChange={lp.setGroup} />,
          }),
        }}
        notice={
          uniform && (
            <p className="flex min-h-10 items-center border-b border-border px-(--list-x) py-2 text-sm text-fg-muted">
              All {num(rows.length)}
              {list && list.total > rows.length && " on this page"}: {first}.
            </p>
          )
        }
        footer={list && <Pagination variant="footer" noun="jobs" offset={list.offset} limit={list.limit} total={list.total} onChange={record.setPage} />}
      >
        {list?.all === 0 ? (
          <EmptyState icon={<Archive />} title={emptyTitle} description={emptyText} className="pt-24" />
        ) : !list ? (
          <SkeletonRows rows={12} />
        ) : rows.length === 0 ? (
          <NoMatch noun="jobs" q={lp.q} filtered={lp.filters.length > 0 || !!lp.group} onClear={lp.clear} />
        ) : (
          rows.map(job => <ArchiveRow key={job.id} job={job} threshold={thresholdOf(job.rubric, summary)} uniform={uniform} link={record.rowProps(job.id)} />)
        )}
      </Workspace>
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
      {panel}
    </ListDetail>
  );
}

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
            () => undefined,
          );
        }}
      />
    </>
  );
}
