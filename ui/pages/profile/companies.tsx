import { useMemo, useState } from "react";
import { isMap, isSeq, parseDocument } from "yaml";
import { FilterMenu, NoMatch } from "../../components/list";
import { ListRow, Pagination, SearchInput } from "../../components/ui";
import { scrollPageTop } from "../../lib/scroller";

export interface Board {
  name: string;
  ats: string;
  slug: string;
  search?: string;
  at: number;
}

const PAGE = 100;
const DROPPED: Record<string, string> = { lever: "hCaptcha, dropped" };

export function boardsOf(text: string): Board[] | null {
  try {
    const doc = parseDocument(text);
    if (doc.errors.length) return null;
    const list = doc.get("companies", true);
    if (!isSeq(list)) return null;
    return list.items.flatMap(item => {
      if (!isMap(item)) return [];
      const c = item.toJSON() as Record<string, unknown>;
      const name = c["name"];
      if (typeof name !== "string") return [];
      const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
      const search = text(c["search"]);
      return [{ name, ats: text(c["ats"]), slug: text(c["slug"]), ...(search ? { search } : {}), at: item.range?.[0] ?? 0 }];
    });
  } catch {
    return null;
  }
}

export function useBoards(boards: readonly Board[]) {
  const [q, setQ] = useState("");
  const [ats, setAts] = useState<string[]>([]);
  const [offset, setOffset] = useState(0);
  const groups = useMemo(() => {
    const n = new Map<string, number>();
    for (const b of boards) n.set(b.ats, (n.get(b.ats) ?? 0) + 1);
    return [...n].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count, label: DROPPED[key] ? `${key} (${DROPPED[key]})` : key }));
  }, [boards]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return boards.filter(b => (!ats.length || ats.includes(b.ats)) && (!needle || `${b.name} ${b.ats} ${b.slug}`.toLowerCase().includes(needle)));
  }, [boards, q, ats]);
  const search = (v: string) => {
    setQ(v);
    setOffset(0);
  };
  const filter = (next: string[]) => {
    setAts(next);
    setOffset(0);
  };
  return {
    count: shown.length,
    search: <SearchInput value={q} onValueChange={search} placeholder="Search companies" aria-label="Search companies" />,
    filter: (
      <FilterMenu
        filters={groups}
        active={ats}
        onToggle={k => {
          filter(ats.includes(k) ? ats.filter(a => a !== k) : [...ats, k]);
        }}
        onClear={() => {
          filter([]);
        }}
      />
    ),
    rows: shown.length ? (
      shown.slice(offset, offset + PAGE).map((b, i) => (
        <ListRow
          key={`${b.ats}:${b.slug}:${i}`}
          data-at={b.at}
          title={b.name}
          titleLines={1}
          secondary={b.search && <span>only “{b.search}”</span>}
          fact={
            <span
              title={DROPPED[b.ats] ? `${b.ats}/${b.slug}: ${DROPPED[b.ats]}` : `${b.ats}/${b.slug}`}
              className={DROPPED[b.ats] ? "text-sm text-fg-subtle" : "text-sm text-fg-muted"}
            >
              {b.ats}
            </span>
          }
        />
      ))
    ) : (
      <NoMatch
        noun="companies"
        q={q}
        filtered={ats.length > 0}
        onClear={() => {
          search("");
          filter([]);
        }}
      />
    ),
    footer: (
      <Pagination
        variant="footer"
        offset={offset}
        limit={PAGE}
        total={shown.length}
        noun="companies"
        onChange={o => {
          setOffset(o);
          scrollPageTop();
        }}
      />
    ),
  };
}
