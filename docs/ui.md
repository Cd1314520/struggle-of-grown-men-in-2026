# The web UI

A React app in `ui/`, bundled by Bun on request (`src/ui.ts`; no build step) with Tailwind CSS v4. It should feel like a premium automation product: calm, dense where density helps, and always leading with what needs the owner.

## Layout of the code

| Path | What |
|---|---|
| `ui/app.tsx` | Entry: providers, the shell, the router outlet |
| `ui/styles.css` | Design tokens (`@theme`) and the few global styles. Tailwind's default palette, type scale, radii and shadows are switched off: only the tokens named here exist |
| `ui/components/ui/` | The design system. Import from `ui/components/ui` (the index) |
| `ui/components/shell/` | Sidebar, phone tab bar, ⌘K palette, Add a posting, shortcuts |
| `ui/components/list/` | A list with a record open beside or over it: `useOpenRecord` (the open job in the URL, its page and "3 of 246", J/K across pages, the next job after an action, a linked job's group and page via `focus=`), `ListDetail` (column, split or overlay; full screen on a phone) and `ListHeader`, `useRecordHistory` (open is a history step where it can be closed), `FilterMenu`, `GroupSegments`, `NoMatch`, and the row pieces `RoleCell` and `CompactRow` |
| `ui/lib/` | `api.ts` (fetchers and React Query hooks), `router.ts` (hash routes), `list-params.ts` (a list's URL state), `hotkeys.ts`, `media.ts` (`useMedia` and the breakpoints that switch components), `format.ts`, `labels.ts` (how every status, gate, cause and step kind reads), `live.ts` (SSE refetch) |
| `ui/pages/<page>/` | One folder per page. `index.tsx` exports `<Name>Page` |

Data: every query refetches when `/api/stream` says something changed, so pages never poll. After a write, call `refreshAll()`.

Routes are hash based: `#review/123?sort=score&filter=remote`. A list keeps group, sort, filters, search and page in the params (`useListParams`).

## API the UI reads

| Route | Returns |
|---|---|
| `GET /api/summary` | `Summary`: counts, `attention` (what waits on the owner, by kind), settings and system state. Small; the nav badges read it |
| `GET /api/jobs?view=&group=&q=&filter=&sort=&offset=&limit=&focus=` | `ListResult`: one page of a view (`review`, `pipeline`, `applications`, `held`, `rejected`), each row with its `group`, open `gate` kind, `appliedThere`, `companyCount` (the employer's jobs in the view) and, when held or rejected, its `reason`; group and filter counts; true totals (`src/listing.ts`). `focus=<id>`: the page holding that job instead of `offset`, with `focusIndex` (its place in `total`, null when the search, filters or group leave it out) and `focusGroup` (its group in the view, to switch tabs to) |
| `GET /api/jobs/:id` | `JobDetail` |
| `GET /api/questions` | open question groups |
| `GET /api/activity?feed=highlights\|all&kind=&before=` | one page of the event log |
| `GET /api/blockers` | every stop, newest first |
| `GET /api/stats` | aggregates for the Overview (`src/stats.ts`) |

## Design rules

**Type.** One scale, defined in `styles.css`: `text-2xs` 11 (counters, kbd), `text-xs` 12 (overlines, table headers, captions), `text-sm` 13 (UI text: rows, meta, buttons — the default), `text-base` 14 (reading text, inputs, prose), `text-lg` 16 (card and panel titles), `text-xl` 20 (page titles), `text-2xl` 24 (the open job's title, stat values), `text-3xl` 32 (headline numbers). Weights: 400, 500 (labels, nav, buttons), 600 (titles, numbers). Never `text-[13px]`, never bold body text for emphasis.

**Colour.** Semantic tokens only: surfaces `bg-canvas` (app) `bg-surface` (cards, panels) `bg-subtle` (hover, wells) `bg-muted`; text `text-fg` `text-fg-muted` `text-fg-subtle`; lines `border-border` `border-border-strong`; brand `accent`, `accent-soft`, `accent-text`; status `success|warning|danger|info` each with `-soft` and `-text`. Every token has a dark value, so nothing needs `dark:`. Colour carries meaning, never decoration: accent for the one primary action and selection, warning for "waiting on you", danger for failures and destructive actions.

**Hierarchy, not decoration.**
- One primary button per view. Secondary actions are `secondary` or `ghost`; rare or destructive ones go in a `⋯` menu.
- Status is a `StatusLabel` (dot + word), not a pill; the design system has no badge, only `Count` for nav and tab counters. Never a row of chips for checklist items or tags.
- No " · " strings joining facts. Put facts in their own columns, or in a `Properties` list, or drop the ones that do not help the decision on this screen.
- Overlines (`Overline`) for small group headings; `Section`/`CardHeader` for titled blocks.
- Explanations of policy fold into a `Disclosure` ("How this works"). The screen leads with what is asked and what to do.
- Dialogs are `DialogContent` (or `ConfirmDialog`, built on it): the buttons sit in the footer band, Cancel as `secondary`, then the one primary or danger action.

**Lists of hundreds.** Use the server's paging (`useJobList` + `Pagination`, 50 a page), `Segments` for the view's groups with counts, a `SearchInput` bound to `/`, a sort `Select` and quick-filter toggles. Rows are `TableRow` links with a column grid shared with `TableHeader`; a row that holds links or buttons of its own is a `TableItem` (same frame, not a link). `Pagination` shows the range, a page box to jump with, and Previous/Next. On a phone the grid collapses (the row wraps): put the title first and keep the rest short. Empty and loading states use `EmptyState` (`size="sm"` inside a card) and `SkeletonRows`; a search or filter that leaves nothing is `NoMatch` (`components/list`), which says which of them narrowed the list away and clears exactly that. `Segments` too long for their space scroll sideways with the clipped edge faded; never mask them by hand. A posting's place is `place(location)`: boards list several places in one string, and a row shows the first and how many more, the whole string on hover.

**A list beside the open item** (Review, Questions, Pipeline and Applications with a job open; Archive opens it over its table instead) is built from `components/list`, never by hand. The list is one column: 380/440/500px at lg/xl/2xl, a 16px-padded header with the title, its count in `text-fg-subtle` and the controls, then `TableRow` rows under sticky `TableGroup` headings. The open item has a 48px bar (`h-12`) with its position ("3 of 246") and `icon-sm` buttons. A sort `Select` always has `prefix="Sort"`; the fit score is called Fit everywhere. Key hints for ⌘/Ctrl combinations come from `combo()` in `lib/hotkeys.ts`.

**Why a job was set aside** reads the same everywhere: the Archive's Reason column and the open job's bar both take it from `src/reasons.ts` (`row.reason`, `setAsideOf(job)`), never from the raw note.

**Agent text.** Agents and the mailbox write notes with markdown, escaped quotes and long URLs. Where it can hold links, render it with `Linkified` (a bare URL shows as `host/path…` with the whole address on hover). Inside a row's link use `plain()`; where a row has one line for a step or note, `brief(text, company)` gives its first clause without the employer's name the row already shows (`NextLabel` for a next step). Never render an agent's text raw.

**Spacing.** 4px grid. Pages use `Page` + `PageHeader` (the title's 32px row sits 16px down, level with a list pane's title row); cards `p-5`; gaps between sections `gap-8` (page) or `gap-5` (inside a panel). Rows are at least 56px tall with 16px side padding.

**Motion.** Short and functional: `animate-in`, `animate-pop` for overlays, `animate-slide-left` for panels. Nothing loops except spinners and the running-state dot.

**Keyboard.** `useHotkeys` for page keys: `j`/`k` move, `/` search, `a` primary action, `x` reject, `Esc` close. `?` lists them (`components/shell/shortcuts.tsx`). Beside an open record, only its row in the list is a tab stop (`tabIndex={-1}` on the rest), so Tab goes from the list to the record's buttons and J/K walk the list.

**Phone.** Everything works at 375px wide. The shell gives a top bar and a bottom tab bar (keep 72px clear at the bottom). The top bar names the page, so below lg `PageHeader` keeps its title for screen readers only and leads with the description, as a list pane leads with its count. The open job's decision bar drops its text when its own width leaves too little room (a container query, so a narrow panel at 1024px behaves like a phone), and its buttons share the width. A job opens full-screen over its list on a phone, and opening it from the list is a history entry: Back and its close button both return to the list. Tap targets are at least 36px: the `touch:` variant (a coarse pointer, or narrower than `sm`) grows the design system's controls; a text-sized link or button in a dense row gets `touch:-my-2 touch:py-2`, a bigger target without moving the layout. Inputs are 16px on touch, or iOS zooms the page when one takes focus. Key hints (`Kbd`) hide on touch.

**Accessibility.** Buttons are `<button>`, navigation is `<a href>`. Icon-only buttons have `aria-label`. Radix primitives handle focus in menus and dialogs; a dialog opened from state puts focus back where it was on close (`useReturnFocus`), so give its first field focus with `onOpenAutoFocus`, not `autoFocus`. A destructive confirmation focuses Cancel. Contrast comes from the tokens; do not lighten text further.
