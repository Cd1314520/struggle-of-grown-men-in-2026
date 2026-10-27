// companies.yml, read: the boards each scan reads, as a list to search rather than 5,000 lines of YAML.
import { useMemo, useState } from "react";
import { parse } from "yaml";
import { NoMatch } from "../../components/list";
import { CompanyMark, ListRow, Pagination, SearchInput } from "../../components/ui";
import { scrollPageTop } from "../../lib/scroller";

export interface Board {
  name: string;
  ats: string;
  slug: string;
  search?: string;
}

const PAGE = 100;

// The boards in the file, or null when it isn't the shape the scanner reads (it then shows as YAML).
export function boardsOf(text: string): Board[] | null {
  try {
    const companies = (parse(text) as { companies?: unknown } | null)?.companies;
    if (!Array.isArray(companies)) return null;
    return companies.filter((c): c is Board => typeof c === "object" && c !== null && typeof (c as Board).name === "string");
  } catch {
    return null;
  }
}

// The search, the rows and the paging of the list, for the file's panel to place.
export function useBoards(boards: readonly Board[]) {
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? boards.filter(b => `${b.name} ${b.ats} ${b.slug}`.toLowerCase().includes(needle)) : boards;
  }, [boards, q]);
  const search = (v: string) => {
    setQ(v);
    setOffset(0);
  };
  return {
    count: shown.length,
    search: <SearchInput value={q} onValueChange={search} placeholder="Search companies" aria-label="Search companies" />,
    rows: shown.length ? (
      shown.slice(offset, offset + PAGE).map((b, i) => (
        <ListRow
          key={`${b.ats}:${b.slug}:${i}`}
          lead={<CompanyMark name={b.name} />}
          title={b.name}
          titleLines={1}
          secondary={
            <span>
              {b.ats} <span className="ml-1 font-mono text-xs">{b.slug}</span>
              {b.search && <span className="ml-2">only “{b.search}”</span>}
            </span>
          }
        />
      ))
    ) : (
      <NoMatch
        noun="companies"
        q={q}
        filtered={false}
        onClear={() => {
          search("");
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
