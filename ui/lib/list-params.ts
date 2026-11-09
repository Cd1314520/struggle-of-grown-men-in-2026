import { useEffect, useState } from "react";
import { setParams, useRoute } from "./router";

export const PAGE_SIZE = 50;

export function useListParams() {
  const { params } = useRoute();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const [seen, setSeen] = useState(q);
  if (seen !== q) {
    setSeen(q);
    setDraft(q);
  }
  useEffect(() => {
    if (draft === q) return;
    const t = setTimeout(() => {
      setParams({ q: draft, page: null });
    }, 200);
    return () => {
      clearTimeout(t);
    };
  }, [draft, q]);
  const page = Math.max(1, Number(params.get("page")) || 1);
  return {
    group: params.get("group"),
    sort: params.get("sort"),
    filters: params.getAll("filter"),
    q,
    search: draft,
    page,
    offset: (page - 1) * PAGE_SIZE,
    setSearch: setDraft,
    setGroup: (group: string | null) => {
      setParams({ group, page: null });
    },
    setSort: (sort: string | null) => {
      setParams({ sort, page: null });
    },
    toggleFilter: (key: string) => {
      const now = params.getAll("filter");
      setParams({ filter: now.includes(key) ? now.filter(f => f !== key) : [...now, key], page: null });
    },
    clear: () => {
      setDraft("");
      setParams({ q: null, filter: null, group: null, page: null });
    },
    setOffset: (offset: number) => {
      setParams({ page: offset ? String(Math.floor(offset / PAGE_SIZE) + 1) : null });
    },
  };
}
