// A paged job list with one job open beside or over it. The open job is the route's part after the list's
// (#review/123?sort=score, #archive/held/123), so a link opens it and Back closes it. This hook fetches the
// page, walks it with J/K across page boundaries, opens the next job when the open one is acted on and
// leaves, and pages to a linked job wherever its row is (its group tab, its page, its "3 of 246").
import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { ListResult } from "../../../src/api-types";
import { prefetchJobs, queryClient, useJobList, type ListParams } from "../../lib/api";
import { useHotkeys } from "../../lib/hotkeys";
import { PAGE_SIZE, type useListParams } from "../../lib/list-params";
import { navigate, route, setParams, useRoute } from "../../lib/router";
import { useRecordHistory } from "./history";

// A page to land on and which of its rows to open once it has loaded. `after`: only data fetched after this
// time counts, for when the page is the same one and must first refetch.
interface Pending {
  offset: number;
  pick: "first" | "last" | number;
  after: number;
}

// What a row needs to open its job, spread onto its ListRow. Beside an open job only its row is a tab stop,
// so Tab goes from the list to the job's buttons and J/K walk the list.
export interface RowLink {
  href: string;
  selected: boolean;
  tabIndex: number | undefined;
  "data-row": number;
}

export interface OpenRecordOptions {
  base: string; // the list's route: "review", "archive/held"
  view: ListParams["view"];
  lp: ReturnType<typeof useListParams>;
  search: RefObject<HTMLInputElement | null>; // `/` focuses it
  // Keep a job open whenever the list has one: the desktop queue, where the open job is the page's subject.
  // There is then nothing to close.
  autoOpen?: boolean;
  // False where an action never clears the job from the list's work (an outcome on a sent application):
  // the job stays open even when it moved to another group or page.
  advance?: boolean;
  // A view that always shows one group (Pipeline's stages): the group to show when the URL names none.
  defaultGroup?: (list: ListResult) => string;
}

export function useOpenRecord({ base, view, lp, search, autoOpen = false, advance = true, defaultGroup }: OpenRecordOptions) {
  const { parts } = useRoute();
  const openId = Number(parts[base.split("/").length - 1]) || null;

  // A job opened by a link rather than from the rows on screen: ask the server for the page that holds it.
  const params = { view, group: lp.group, q: lp.q, filters: lp.filters, sort: lp.sort, offset: lp.offset, limit: PAGE_SIZE } satisfies ListParams;
  const [seek, setSeek] = useState(() => (queryClient.getQueryData<ListResult>(["jobs", params])?.rows.some(r => r.id === openId) ? null : openId));
  const query = useJobList(seek === null ? params : { ...params, focus: seek });
  // Switching views keeps the last one's page on screen while the next loads; never show it as this one's.
  const data = query.data?.view === view ? query.data : undefined;
  const fresh = !!data && !query.isPlaceholderData;
  const group = lp.group ?? (data && defaultGroup ? (data.focusGroup ?? defaultGroup(data)) : null);
  // Before a one-group view has its group in the URL, the page holds every group's rows.
  const rows = (data?.rows ?? []).filter(r => !defaultGroup || r.group === group);
  const at = rows.findIndex(r => r.id === openId);

  const [seen, setSeen] = useState(openId);
  if (seen !== openId) {
    setSeen(openId);
    setSeek(openId !== null && at < 0 ? openId : null);
  }

  const hrefOf = (id: number | null) => {
    const q = route().params.toString();
    return `#${base}${id ? `/${id}` : ""}${q ? `?${q}` : ""}`;
  };
  const open = (id: number | null) => {
    navigate(hrefOf(id), { replace: true });
  };
  const nav = useRecordHistory({
    isOpen: openId !== null,
    closable: !autoOpen,
    list: () => hrefOf(null),
  });
  const close = nav.close;
  // The row with focus may unmount (the list narrows beside the job, or the acted-on job leaves it): focus
  // then goes on to the next open row.
  const handOn = useRef(false);
  const onListClick = (ev: MouseEvent) => {
    handOn.current = true;
    nav.onListClick(ev);
  };

  // A one-group view names its group in the URL as soon as it knows it: the linked job's, else the default.
  useEffect(() => {
    if (!lp.group && group && fresh) setParams({ group }, { replace: true });
  }, [lp.group, group, fresh]);

  // The linked job's page has come: put its page number in the URL, with the page cached under both keys so
  // nothing loads twice. When the group tab hides it on arrival, switch to its group. While it stays open the
  // list stays on it (a new search pages to it too); turning a page, opening another job or acting ends that.
  const answered = useRef<number | null>(null);
  useEffect(() => {
    if (seek === null || !data || !fresh || (defaultGroup && !lp.group)) return;
    const first = answered.current !== seek;
    answered.current = seek;
    if (data.focusIndex === null && first && lp.group !== null && data.focusGroup !== null && data.focusGroup !== lp.group)
      setParams({ group: data.focusGroup, page: null });
    else if (data.focusIndex !== null && data.offset !== lp.offset) {
      const landed = { ...params, offset: data.offset };
      queryClient.setQueryData(["jobs", landed], data);
      queryClient.setQueryData(["jobs", { ...landed, focus: seek }], data);
      lp.setOffset(data.offset);
    }
  });

  // Turning a page from the keyboard or after an action, and keeping a job open on the queue.
  const pending = useRef<Pending | null>(null);
  const listKey = [lp.q, lp.group, lp.sort, ...lp.filters].join("|");
  const seenKey = useRef(listKey);
  useEffect(() => {
    if (!data || !fresh) return;
    const p = pending.current;
    if (p?.offset === data.offset && query.dataUpdatedAt > p.after) {
      pending.current = null;
      const i = p.pick === "first" ? 0 : p.pick === "last" ? rows.length - 1 : Math.min(p.pick, rows.length - 1);
      const row = rows[i];
      if (row) open(row.id);
      else if (data.offset > 0) {
        // The last job on the last page went: step back a page.
        pending.current = { offset: Math.max(0, data.offset - data.limit), pick: "last", after: 0 };
        lp.setOffset(pending.current.offset);
      } else if (autoOpen) open(null);
      else close();
      return;
    }
    if (p) return;
    const changed = seenKey.current !== listKey;
    seenKey.current = listKey;
    // A linked job outside the list stays open, unless the owner changed the list under it.
    if (!autoOpen || (openId !== null && !(changed && at < 0))) return;
    const first = rows[0]?.id ?? null;
    if (first !== openId) open(first);
  });

  const goPage = (offset: number, pick: Pending["pick"]) => {
    pending.current = { offset, pick, after: 0 };
    setSeek(null);
    lp.setOffset(offset);
  };
  const step = (by: 1 | -1) => {
    if (!data) return;
    const row = at < 0 ? (by === 1 ? rows[0] : rows.at(-1)) : rows[at + by];
    if (row) open(row.id);
    else if (at >= 0 && by > 0 && data.offset + data.limit < data.total) goPage(data.offset + data.limit, "first");
    else if (at >= 0 && by < 0 && data.offset > 0) goPage(Math.max(0, data.offset - data.limit), "last");
  };
  // Pagination: beside an open job, a new page opens its first row, as J past the end does.
  const setPage = (offset: number) => {
    if (openId !== null && at >= 0) goPage(offset, "first");
    else {
      setSeek(null);
      lp.setOffset(offset);
      scrollTo({ top: 0 });
    }
  };

  useHotkeys([
    {
      key: "j",
      run: () => {
        step(1);
      },
    },
    {
      key: "k",
      run: () => {
        step(-1);
      },
    },
    {
      key: "/",
      run: () => {
        search.current?.focus();
      },
    },
  ]);

  // Keep the open row in sight as J/K walk the list, and a linked job's in the middle of it. Focus on a row
  // follows the open one, so the list keeps its one tab stop.
  const present = at >= 0,
    linked = seek !== null && seek === openId;
  useEffect(() => {
    const row = document.querySelector<HTMLElement>(`a[data-row="${openId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: linked ? "center" : "nearest" });
    const now = document.activeElement;
    if (now !== row && (now?.matches("a[data-row]") || (now === document.body && handOn.current))) row.focus({ preventScroll: true });
    handOn.current = false;
  }, [openId, present, linked]);
  // The jobs either side load ahead, so J/K lands on a job rather than a skeleton.
  const before = rows[at - 1]?.id,
    after = rows[at + 1]?.id;
  useEffect(() => {
    if (present) prefetchJobs([after, before]);
  }, [present, after, before]);

  // The open job was acted on and leaves the list: open the one after it, which then takes its place, so the
  // place in the list holds. The last row of a page waits for the refetch to pull up the next page's first.
  const onActed = () => {
    setSeek(null);
    if (!advance || !data || at < 0) return;
    handOn.current = !!document.activeElement?.matches("a[data-row]");
    const next = rows[at + 1];
    if (next) open(next.id);
    else if (data.offset + data.limit < data.total) pending.current = { offset: data.offset, pick: at, after: query.dataUpdatedAt };
    else {
      const prev = rows[at - 1];
      if (prev) open(prev.id);
      else pending.current = { offset: data.offset, pick: 0, after: query.dataUpdatedAt };
    }
  };

  const index = data && at >= 0 ? data.offset + at : -1;
  const position =
    data && index >= 0
      ? {
          index,
          total: data.total,
          prev:
            index > 0
              ? () => {
                  step(-1);
                }
              : undefined,
          next:
            index + 1 < data.total
              ? () => {
                  step(1);
                }
              : undefined,
        }
      : undefined;

  return {
    query,
    data,
    rows,
    group,
    openId,
    rowProps: (id: number): RowLink => ({
      href: hrefOf(id),
      selected: id === openId,
      tabIndex: openId !== null && id !== openId ? -1 : undefined,
      "data-row": id,
    }),
    setPage,
    onListClick,
    // The props of the open job's panel (JobDetail with layout "panel").
    panel: openId === null ? null : { id: openId, position, onActed, onClose: autoOpen ? undefined : close },
  };
}
