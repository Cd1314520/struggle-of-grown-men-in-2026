// The controls over a job list: quick filters folded into one menu, and the view's groups as segments.
import { Check, ListFilter, SearchX } from "lucide-react";
import type { ListGroup } from "../../../src/api-types";
import { Button, EmptyState, Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger, Segments } from "../ui";
import { cn } from "../../lib/cn";

// One button rather than a row of chips. It names the filter when one is on, so what narrows the list
// stays in sight without a second row. In a Workspace bar narrower than 80rem it keeps only
// its icon, with an accent dot while a filter is on; the name stays for screen readers.
export function FilterMenu({
  filters,
  active,
  onToggle,
  onClear,
}: {
  filters: readonly ListGroup[];
  active: readonly string[];
  onToggle: (key: string) => void;
  onClear: () => void;
}) {
  const on = filters.filter(f => active.includes(f.key));
  if (!filters.length) return null;
  const label = on.length === 0 ? "Filter" : on.length === 1 ? (on[0]?.label ?? "Filter") : `${on.length} filters`;
  return (
    <Menu modal={false}>
      <MenuTrigger asChild>
        <Button
          variant="secondary"
          icon={
            <span className="relative flex">
              <ListFilter />
              {on.length > 0 && <span className="absolute -top-0.5 -right-0.5 hidden size-1.5 rounded-full bg-accent @max-[80rem]/bar:block" />}
            </span>
          }
          className={cn(
            "max-w-48 min-w-0 @max-[80rem]/bar:w-8 @max-[80rem]/bar:px-0 touch:@max-[80rem]/bar:w-10",
            on.length && "border-accent/25 bg-accent-soft text-accent-text hover:border-accent/40 hover:bg-accent-soft",
          )}
        >
          <span className="truncate @max-[80rem]/bar:sr-only">{label}</span>
        </Button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuLabel>Show only</MenuLabel>
        {filters.map(f => {
          const checked = active.includes(f.key);
          return (
            <MenuItem
              key={f.key}
              role="menuitemcheckbox"
              aria-checked={checked}
              icon={<Check className={cn(checked ? "text-accent-text opacity-100" : "opacity-0")} />}
              shortcut={f.count.toLocaleString()}
              onSelect={e => {
                // Several can be on at once: keep the menu open.
                e.preventDefault();
                onToggle(f.key);
              }}
            >
              {f.label}
            </MenuItem>
          );
        })}
        {on.length > 0 && (
          <>
            <MenuSeparator />
            <MenuItem onSelect={onClear}>Clear filters</MenuItem>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}

// The view's groups with their counts, after "All". A group with nothing in it is left out unless chosen.
export function GroupSegments({
  groups,
  value,
  onChange,
  label,
  className,
}: {
  groups: readonly ListGroup[];
  value: string | null;
  onChange: (group: string | null) => void;
  label: string;
  className?: string;
}) {
  const total = groups.reduce((n, g) => n + g.count, 0);
  const segments = [
    { value: "all", label: "All", count: total },
    ...groups.filter(g => g.count > 0 || g.key === value).map(g => ({ value: g.key, label: g.label, count: g.count })),
  ];
  return (
    <Segments
      aria-label={label}
      value={value ?? "all"}
      onValueChange={v => {
        onChange(v === "all" ? null : v);
      }}
      segments={segments}
      {...(className ? { className } : {})}
    />
  );
}

// A search or filter that leaves nothing: says which one narrowed the list away, and undoes exactly that.
export function NoMatch({ noun, q, filtered, onClear }: { noun: string; q: string; filtered: boolean; onClear: () => void }) {
  const q1 = q.trim();
  return (
    <EmptyState
      size="sm"
      icon={<SearchX />}
      title={`No ${noun} match`}
      description={q1 ? `Nothing matches “${q1}”${filtered ? " with these filters" : ""}.` : "Nothing fits these filters."}
      action={<Button onClick={onClear}>{q1 && filtered ? "Clear search and filters" : q1 ? "Clear search" : "Clear filters"}</Button>}
    />
  );
}
