# The web UI

A React app in `ui/`, bundled by Bun on request (`src/ui.ts`; no build step) with Tailwind CSS v4. It should feel like a premium automation product: calm, dense where density helps, and always leading with what needs the owner.

## Layout of the code

| Path | What |
|---|---|
| `ui/app.tsx` | Entry: providers, the shell, the router outlet |
| `ui/styles.css` | Design tokens (`@theme`) and the few global styles. Tailwind's default palette, type scale, radii and shadows are switched off: only the tokens named here exist |
| `ui/components/ui/` | The design system. Import from `ui/components/ui` (the index). `list.tsx` is the one list system: `ListPanel`, `ListToolbar`, `ListRow`, `ListGroup`, `ListColumns`, `ListNotice`, `ListFooter`, `ListIcon`, `Narrow`/`Wide` |
| `ui/components/shell/` | Sidebar, phone tab bar, ⌘K palette, Add a posting, shortcuts |
| `ui/components/list/` | A list with a record open beside it: `useOpenRecord` (the open job in the URL, its page and "3 of 246", J/K across pages, the next job after an action, a linked job's group and page via `focus=`), `ListDetail` (column or split; full screen on a phone), `useRecordHistory` (open is a history step where it can be closed), `FilterMenu`, `GroupSegments`, `NoMatch`. |
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
| `GET /api/setup?refresh` | `SetupResult`: each setup step and its checks (`src/setup.ts`); `refresh` reads the model lists (omp and Claude Code) again |
| `GET /api/models?refresh`, `PUT /api/models/:stage` | the model catalog (omp's and Claude Code's, with `errors` per harness) and each stage's model; a PUT (`{ model }`, null for omp's default) writes `config.local.yml` (`src/models.ts`) |
| `GET /api/resume` | `ResumeState`: the stock resume (pages, compile error), the import under way and its latest steps, the notes. Pages: `/api/resume/{stock,draft}.png?page=N` and `.pdf` |
| `POST /api/resume/import` (form: `files`, `note`), `/import/{revise,accept,discard,cancel}`, `/api/resume/example` | the resume import (`src/resume-import.ts`) |

## Design rules

**Type.** One scale, defined in `styles.css`, with a second set of values on touch (a coarse pointer, or narrower than 40rem: the `touch` variant's condition), where `styles.css` redefines the tokens so no page needs `touch:text-*`:

| Token | Desktop | Touch | For |
|---|---|---|---|
| `text-2xs` | 11 | 12 | counters, kbd, the tab bar's labels |
| `text-xs` | 12 | 13 | column headers, captions, the log's facts |
| `text-sm` | 13 | 15 | UI text (the default): a row's secondary line and snippet, meta, buttons |
| `text-base` | 14 | 16 | row titles, reading text, prose, inputs |
| `text-lg` | 16 | 17 | surface and section titles |
| `text-xl` | 20 | 20 | page titles, stat values |
| `text-2xl` | 24 | 22 | the open job's title |
| `text-3xl` | 32 | 28 | headline numbers |

Nothing on a phone is under 12px. A row's title is `text-base font-medium`, its secondary line and snippet `text-sm text-fg-muted`, its meta (times, ages, places) `text-sm` or `text-xs` in `text-fg-muted`. `text-fg-subtle` is for placeholders, icons, a count beside a label and the "of" in "1 of 9": never for text a person needs to read. Weights: 400, 500 (labels, nav, buttons, row titles), 600 (headings, numbers). Never `text-[13px]`, never bold body text for emphasis.

**Headings.** Three levels, never uppercase: a page's h1 is `text-xl` (`PageHeader`, or a list column's `ListPanel`); a surface or section's h2 is `text-lg` (`ListPanel`, `CardHeader`, `Section`), with its count beside it in `font-normal text-fg-subtle`; a group is `text-sm font-semibold text-fg` with its count (a `ListGroup` band inside a list, `Subhead` anywhere else). Under a heading, prose is `text-base` and UI is `text-sm`.

**Frames.** A list is always a `ListPanel`; no rows ever sit on the bare canvas. Content groups go in a `Card` (`p-5`). Never a bordered box inside a bordered box: inside a surface, separate with space, a `divide-y` list or a `ListGroup` band, and quote with a `border-l-2 pl-3` blockquote, not a grey well. The open job's sections are unframed on its panel; the one framed block in a job is its lead (the gate, or Next steps).

**Page widths.** `Page` is one frame, `max-w-6xl`, so every page's title sits at the same x and y. `default` is for list and dashboard pages; `narrow` (reading pages: Activity, Settings, Setup, Profile, the standalone job, Resume) caps the content at `max-w-4xl` on the left of that same frame, never centred; `full` is for a list beside an open record.

**Colour.** Semantic tokens only: surfaces `bg-canvas` (app) `bg-surface` (cards, panels) `bg-subtle` (hover, wells) `bg-muted`; text `text-fg` `text-fg-muted` `text-fg-subtle`; lines `border-border` `border-border-strong`; brand `accent`, `accent-soft`, `accent-text`; status `success|warning|danger|info` each with `-soft` and `-text`. Every token has a dark value, so nothing needs `dark:`. Colour carries meaning, never decoration: accent for the one primary action and selection, warning for "waiting on you", danger for failures and destructive actions.

**Hierarchy, not decoration.**
- One primary button per view. Secondary actions are `secondary` or `ghost`; rare or destructive ones go in a `⋯` menu.
- Status is a `StatusLabel` (dot + word), not a pill; the design system has no badge, only `Count` for nav and tab counters. Never a row of chips for checklist items or tags.
- `StatusLabel` is only for a record's state: a row's stage or status, the job's header. Not for setup steps, a step's "To do", or a verdict. At most one per block.
- No " · " strings joining facts. Put facts on a row's secondary line (separate spans, `gap-2`), in its trail or cells, in a `Properties` list, or drop the ones that do not help the decision on this screen.
- `Section`/`CardHeader` for titled blocks, `Subhead` for a group heading outside a list.
- A notice about a list is a one-line `ListNotice` in its panel's header (no amber fill; `alert` when it warns); `Callout` is for a page-level notice (the Overview welcome, a setup alert).
- A disabled primary button goes grey (`bg-muted`, `text-fg-subtle`), not a faded accent.
- Explanations of policy fold into a `Disclosure` ("How this works"). The screen leads with what is asked and what to do.
- Dialogs are `DialogContent` (or `ConfirmDialog`, built on it): the buttons sit in the footer band, Cancel as `secondary`, then the one primary or danger action.

**Lists.** One system, in `components/ui/list.tsx`:

- **`ListPanel`** holds every list: its title and count (or `tabs` in their place), `actions` on the right, a `ListToolbar`, an optional one-line `ListNotice`, the rows, and a footer (`Pagination variant="footer"` or `ListFooter`). Three frames: `page` (a card on the canvas; edge to edge below `sm`), `column` (the list beside an open record: from lg the header stays, the rows scroll, the footer is pinned; below lg it is the page, its h1 for screen readers only and its count read as "334 waiting for you") and `card` (a short list among other cards, which stays a rounded card on a phone). Rows, headers, toolbars and footers share one gutter, `--list-x` (16px; 20px from `sm` in `page` and `card`, matching a `Card`'s `p-5`). Never put `overflow-hidden` on a panel: it breaks the sticky group bands. A short list ends at its last row: no filler, and no footer on one page.
- **`ListToolbar`**: `search`, `controls` (`FilterMenu`, `Select prefix="Sort" collapse`) and `segments`. Narrow (every phone and every list column) it is the search and controls, then the segments under them; from 48rem one row, segments left, search and controls always right. Under 28rem `FilterMenu` and a `collapse` Select keep only their icon. On a phone the chrome from the top bar to the first row is at most 160px.
- **`ListRow`**: a `lead` (`CompanyMark` or `ListIcon`, 32px), a body (`title`, which wraps to `titleLines`, 2 by default; one `secondary` line, whose first child truncates; an optional prose `snippet`, clamped to 2 lines, 3 on touch) and a `trail` of at most two short facts, stacked: each 6 characters or fewer (`100`, `3h`, `12:11 AM`). Phrases ("Asked 3d ago", "In process", a reason, a next step) never go in the trail: they go on the secondary line or in the snippet. With `href` the row is a link (`a[role=row]`); without, a `div` holding links or buttons of its own. `selected` tints it with an accent bar at the left. The `RowLink` props from `useOpenRecord` spread straight on. `dense` is the Full log's variant: one line of cells then the message on a desktop, two lines on touch.
- **Columns only when the panel is wide.** A row shows `cells` (tracks in `columns`, shared with a `ListColumns` header) only when its panel is at least 56rem wide (`@4xl/list`): a `page` list on a desktop. Below that the same row stacks, so there are no table columns on a phone, beside an open record or in a 1024px window. A list has a `ListColumns` header if and only if it shows cells. A fact that is the same on every row on screen is not a column: drop it, or show it only when the rows differ (Pipeline's stage, Applications' status). `Narrow` and `Wide` wrap what changes place with the width (Archive's reason: the snippet when narrow, a cell when wide).
- **`ListGroup`** is the one group heading inside a list (time bands, employers, Applications' segments, days, Settings' sub-groups): a `bg-subtle` band, `text-sm font-semibold` with its count, sticky under the top bar (from lg, at the top of the list's scroll). It is a `row`, so it reads as one ("Just opened 6").
- Use the server's paging (`useJobList` + `Pagination`, 50 a page), a `SearchInput` bound to `/`, and `Segments` for the view's groups with counts. `Pagination` shows the range ("1–50 of 334 jobs" with `noun`), a page box to jump with, and Previous/Next; under 28rem of its own width Previous/Next keep only their arrows and the noun goes, so the range is never cut off. Loading is `SkeletonRows` inside the panel (`dense` for the log, `lead={false}` without marks), never a blank slab; empty is `EmptyState size="sm"` inside the panel, under the toolbar when a search, filter or segment caused it, and without the toolbar when the view itself is empty. A search or filter that leaves nothing is `NoMatch` (`components/list`), which says which of them narrowed the list away and clears exactly that. `Segments` too long for their space scroll sideways with the clipped edge faded; never mask them by hand. A posting's place is `place(location)`: boards list several places in one string, and a row shows the first and how many more, the whole string on hover.

**Selection.** One control for each job: `Tabs` (underlined) switch between different views, and head their panel (Archive's Held and Rejected, Activity's tabs, the job's tabs); `Segments` narrow one list to a group, in its toolbar (the selected one a filled `bg-muted` pill, never an outline, which vanishes on the panel's surface); `SectionNav` moves between the sections of one page (Settings, Profile's files): a sticky list from lg, a sticky strip that scrolls below it, the selected item styled like the sidebar's; `FilterMenu` holds quick filters; `Select prefix="Sort" collapse` sorts. Nothing else selects: no KPI tiles as tabs, no Select standing in for segments.

**A list beside the open item** (Review, Questions, Pipeline, Applications and Archive with a job open) is built from `components/list`, never by hand. The list is a `ListPanel frame="column"`, 380/440/500px at lg/xl/2xl, titled with the page's name (h1) and its whole count. Pipeline, Applications and Archive use `ListDetail layout="split"`: until a job opens the list is the page (`Page` + `PageHeader descriptionOnPhone={false}` + `ListPanel frame="page"`, titled with what is listed); open one and the same rows become the column. The open item has a 48px bar (`h-12`) with its position ("3 of 246") and `icon-sm` buttons. A sort `Select` always has `prefix="Sort"`; the fit score is called Fit everywhere. Key hints for ⌘/Ctrl combinations come from `combo()` in `lib/hotkeys.ts`.

**Why a job was set aside** reads the same everywhere: the Archive's reason (its snippet, or its Reason cell when wide) and the open job's header both take it from `src/reasons.ts` (`row.reason`, `setAsideOf(job)`), never from the raw note.

**Agent text.** Agents and the mailbox write notes with markdown, escaped quotes and long URLs. Where it can hold links, render it with `Linkified` (a bare URL shows as `host/path…` with the whole address on hover). Inside a row's link use `plain()`, and let the snippet clamp (a `Clamp` with its "Show more" never goes inside a link row); where a row has one line for a step or note, `brief(text, company)` gives its first clause without the employer's name the row already shows (`NextLabel` for a next step). Never render an agent's text raw.

**Spacing.** 4px grid. Pages use `Page` + `PageHeader` (the title's 32px row sits 16px down, level with a list pane's title row); cards `p-5`; gaps between sections `gap-8` (page) or `gap-5` (inside a panel). Rows are at least 56px tall (64px on touch), with the list's gutter at the sides.

**Motion.** Short and functional: `animate-in`, `animate-pop` for overlays, `animate-slide-left` for panels. Nothing loops except spinners and the running-state dot.

**Keyboard.** `useHotkeys` for page keys: `j`/`k` move, `/` search, `a` primary action, `x` reject, `Esc` close. `?` lists them (`components/shell/shortcuts.tsx`). Beside an open record, only its row in the list is a tab stop (`tabIndex={-1}` on the rest), so Tab goes from the list to the record's buttons and J/K walk the list.

**Phone.** Everything works at 375px wide. The shell gives a top bar and a bottom tab bar (keep 72px clear at the bottom). The top bar names the page (a job on its own reads "Job": its back link, just below, names its list), so below lg `PageHeader` keeps its title for screen readers only and leads with the description, as a list column leads with its count; a list page passes `descriptionOnPhone={false}` and goes straight to its panel. Lists bleed edge to edge with at most 160px of chrome above the first row; row titles wrap to two lines (three for questions), prose clamps to three, and there are no columns and no phrases at the right of a row. `Properties` stack (the label over its value) under 28rem. The open job's decision bar drops its text when its own width leaves too little room (a container query, so a narrow panel at 1024px behaves like a phone), and its buttons share the width. A job opens full-screen over its list on a phone, and opening it from the list is a history entry: Back and its close button both return to the list. Tap targets are at least 36px: the `touch:` variant (a coarse pointer, or narrower than 40rem) grows the design system's controls; a text-sized link or button in a dense row gets `touch:-my-2 touch:py-2`, a bigger target without moving the layout. `max-sm:`/`max-lg:` are the exact complement of `sm:`/`lg:` (`styles.css` redefines them: Tailwind's own matched a 1024px window as both lg and max-lg); `useMedia` (`lib/media.ts`) switches components at the same widths. Inputs are `text-base`, 16px on touch, or iOS zooms the page when one takes focus. Key hints (`Kbd`) hide on touch by themselves.

**Accessibility.** Buttons are `<button>`, navigation is `<a href>`. Icon-only buttons have `aria-label`. Radix primitives handle focus in menus and dialogs; a dialog opened from state puts focus back where it was on close (`useReturnFocus`), so give its first field focus with `onOpenAutoFocus`, not `autoFocus`. A destructive confirmation focuses Cancel. Contrast comes from the tokens; do not lighten text further.
