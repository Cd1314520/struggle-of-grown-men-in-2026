import { useEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import type { ListResult } from "../../../src/api-types";
import { prefetchJobs, queryClient, useJobList, type ListParams } from "../../lib/api";
import { useHotkeys } from "../../lib/hotkeys";
import { PAGE_SIZE, type useListParams } from "../../lib/list-params";
import { navigate, route, setParams, useRoute } from "../../lib/router";
import { scrollPageTop } from "../../lib/scroller";
import { useRecordHistory } from "./history";

interface Pending {
  offset: number;
  pick: "first" | "last" | number;
  after: number;
}

export interface RowLink {
  href: string;
  selected: boolean;
  tabIndex: number | undefined;
  "data-row": number;
}

export interface OpenRecordOptions {
  base: string;
  view: ListParams["view"];
  lp: ReturnType<typeof useListParams>;
  search: RefObject<HTMLInputElement | null>;
  autoOpen?: boolean;
  advance?: boolean;
  defaultGroup?: (list: ListResult) => string;
}

export function useOpenRecord({ base, view, lp, search, autoOpen = false, advance = true, defaultGroup }: OpenRecordOptions) {
  const { parts } = useRoute();
  const openId = Number(parts[base.split("/").length - 1]) || null;

  const params = { view, group: lp.group, q: lp.q, filters: lp.filters, sort: lp.sort, offset: lp.offset, limit: PAGE_SIZE } satisfies ListParams;
  const [seek, setSeek] = useState(() => (queryClient.getQueryData<ListResult>(["jobs", params])?.rows.some(r => r.id === openId) ? null : openId));
  const query = useJobList(seek === null ? params : { ...params, focus: seek });
  const data = query.data?.view === view ? query.data : undefined;
  const fresh = !!data && !query.isPlaceholderData;
  const group = lp.group ?? (data && defaultGroup ? (data.focusGroup ?? defaultGroup(data)) : null);
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
  const handOn = useRef(false);
  const onListClick = (ev: MouseEvent) => {
    handOn.current = true;
    nav.onListClick(ev);
  };

  useEffect(() => {
    if (!lp.group && group && fresh) setParams({ group }, { replace: true });
  }, [lp.group, group, fresh]);

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
        pending.current = { offset: Math.max(0, data.offset - data.limit), pick: "last", after: 0 };
        lp.setOffset(pending.current.offset);
      } else if (autoOpen) open(null);
      else close();
      return;
    }
    if (p) return;
    const changed = seenKey.current !== listKey;
    seenKey.current = listKey;
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
  const setPage = (offset: number) => {
    if (openId !== null && at >= 0) goPage(offset, "first");
    else {
      setSeek(null);
      lp.setOffset(offset);
      scrollPageTop();
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
  const before = rows[at - 1]?.id,
    after = rows[at + 1]?.id;
  useEffect(() => {
    if (present) prefetchJobs([after, before]);
  }, [present, after, before]);

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
    panel: openId === null ? null : { id: openId, position, onActed, onClose: autoOpen ? undefined : close },
  };
}
