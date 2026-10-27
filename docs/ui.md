# The web UI

A React app in `ui/`, bundled by Bun on request (`src/ui.ts`; no build step) with Tailwind CSS v4. It should feel like a premium automation product: calm, dense where density helps, and always leading with what needs the owner.

## Layout of the code

| Path | What |
|---|---|
| `ui/app.tsx` | Entry: providers, the shell, the router outlet |
| `ui/styles.css` | Design tokens (`@theme`) and the few global styles. Tailwind's default palette, type scale, radii and shadows are switched off: only the tokens named here exist |
| `ui/components/ui/` | The design system. Import from `ui/components/ui` (the index). `workspace.tsx` is every page's frame: `Workspace`, `WorkspaceBar`, `WorkspaceStrip`, `WorkspaceSection`, `WorkspaceBody`, `ListBody`. `list.tsx` is the one list system: `ListRow`, `ListGroup`, `ListNotice`, `ListFooter`, `ListIcon` |
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
| `GET /api/settings`, `PUT /api/settings` | every setting as `config.yml` with `config.local.yml` laid over it has it, what the latter sets, the settings read only at start (`restart`) and those saved but waiting for one (`pending`); a PUT (`{ path: [...keys], value }`, or `{ path, reset: true }` to hand it back to `config.yml`) is checked as the app would read it at start, written to `config.local.yml` and, unless read only at start, to the running config (`src/settings.ts`). A `publicUrl` that would stop answering the name the request came in under is refused unless the request comes from localhost |
| `GET /api/models?refresh`, `PUT /api/models/:stage` | the model catalog (omp's and Claude Code's, with `errors` per harness) and each stage's model; a PUT (`{ model }`, null for omp's default) writes `config.local.yml` (`src/models.ts`) |
| `GET /api/resume` | `ResumeState`: the stock resume (pages, compile error), the import under way and its latest steps, the notes. Pages: `/api/resume/{stock,draft}.png?page=N` and `.pdf` |
| `POST /api/resume/import` (form: `files`, `note`), `/import/{revise,accept,discard,cancel}`, `/api/resume/example` | the resume import (`src/resume-import.ts`) |

## Design rules

**Type.** One scale, defined in `styles.css`, with a second set of values on touch (a coarse pointer, or narrower than 40rem: the `touch` variant's condition), where `styles.css` redefines the tokens so no page needs `touch:text-*`:

| Token | Desktop | Touch | For |
|---|---|---|---|
| `text-2xs` | 11 | 12 | counters, kbd, the tab bar's labels |
| `text-xs` | 12 | 13 | captions, hints, the log's facts |
| `text-sm` | 13 | 15 | UI text (the default): a row's second line, snippet and fact, meta, buttons |
| `text-base` | 14 | 16 | row titles, the bar's title, section titles, reading text, prose, inputs |
| `text-lg` | 16 | 17 | titles inside the open job |
| `text-xl` | 20 | 20 | the open job's numbers |
| `text-2xl` | 24 | 22 | the open job's title |
| `text-3xl` | 32 | 28 | headline numbers |

Nothing on a phone is under 12px. A row's title is `text-base font-medium`, its second line, snippet and fact `text-sm text-fg-muted`; a group label is `text-2xs` uppercase (11px, 12 on touch). `text-fg-subtle` is for placeholders, icons, a count beside a label and the "of" in "1 of 9": never for text a person needs to read. Weights: 400, 500 (labels, nav, buttons, row titles), 600 (headings, numbers). Never `text-[13px]`, never bold body text for emphasis.

**Headings.** A page's h1 is the bar's title, `text-base font-semibold`, with its count beside it in `font-normal text-fg-subtle`: the page is named quietly, the rows carry the weight. A section's h2 is `text-base font-semibold` too (`WorkspaceSection`; `Section` inside the open job is `text-lg`). A group inside a list is a `ListGroup` label: small, uppercase, `text-fg-muted`, its count `text-fg-subtle`; outside a list it is a `Subhead`. Nothing else is uppercase. Under a heading, prose is `text-base` and UI is `text-sm`.

**Frames.** Every page is one white sheet: a `Workspace` (`bg-surface`) fills the content area from the sidebar's rule to the window's right edge and from the top to the bottom. The grey canvas is only the sidebar (a rail beside the sheet) and Resume's paper viewer. No card, rounded border or shadow wraps a list or a section; only dialogs, menus, popovers and toasts float. On the sheet, parts are divided by full-bleed rules (`border-b`), never boxed: the bar's rule, a `WorkspaceStrip`'s, a `ListNotice`'s, a `WorkspaceSection`'s, the footer's. Quote with a `border-l-2 pl-3` blockquote, not a grey well. The open job's sections are unframed on its panel; the one framed block in a job is its lead (the gate, or Next steps).

- **`Workspace`** takes `frame` (`page`, or `column` beside an open record), `bar` (props, not an element, so it knows the bar's height), an optional `strip` and `notice`, the rows as children (`bodyRole="table"` and `bodyLabel` on a list page; omitted on a page that is not a list) and a `footer`. It renders a `<section aria-label>`, sets the gutter `--list-x` (16px; 24px from `sm` on a page) and `--group-top` (where `ListGroup`s stick), and is the `@container/ws` rows read.
- **The bar** (`WorkspaceBar`, from `Workspace`'s `bar`; on its own on the job page): one 48px line (`h-12`, the height of the open job's position bar and the phone's top bar), sticky from lg, `border-b`, holding `back`, the h1 `title` and its `count` (or `meta`), `tabs` (`TabsList variant="bar"`, underline on the bar's rule), `segments`, `search`, `controls` (`FilterMenu`, `Select prefix="Sort" collapse`), `actions` (`size="sm"`) and a `hint` (the page's one-line description, behind an info button: pages have no description line). The segments share the line only on a page bar of 68rem or more with no tabs; otherwise they are a second 44px line. Under 80rem of bar, `FilterMenu` and a `collapse` Select keep only their icon. In a column the bar is two lines at most: title, count, the search (filling what is left), controls and actions on the first (with a rule under it, level with the open record's position bar), then the segments.
- **`WorkspaceStrip`**: a one-line row of numbers under the bar ("Sent **431**  In process **11**"), which scrolls away. Applications on a desktop.
- **`WorkspaceSection`** (a titled part of a page that is not a list, a rule under it; `flush` when it is a list), **`WorkspaceBody`** (a page with an `aside`: a `nav`, a `rail` or a `pane`, a full-height column with a rule between from lg) and **`ListBody`** (rows with no frame, for a list inside a section, bleeding to its edges).

**Page widths.** None: the sheet is the window. Rows, rules, hovers and the bar run edge to edge. What caps is reading content: prose, forms and settings rows' text stop at `max-w-[56rem]` on the left, and a row's snippet at 72ch; the rules under them do not.

**Colour.** Semantic tokens only: surfaces `bg-canvas` (the sidebar, the paper viewer) `bg-surface` (the sheet, dialogs, menus) `bg-subtle` (hover, wells) `bg-muted`; text `text-fg` `text-fg-muted` `text-fg-subtle`; lines `border-border` `border-border-strong`; brand `accent`, `accent-soft`, `accent-text`; status `success|warning|danger|info` each with `-soft` and `-text`. Every token has a dark value, so nothing needs `dark:`. Colour carries meaning, never decoration: accent for the one primary action and selection, warning for "waiting on you", danger for failures and destructive actions.

**Hierarchy, not decoration.**
- One primary button per view. Secondary actions are `secondary` or `ghost`; rare or destructive ones go in a `⋯` menu.
- Status is a `StatusLabel` (dot + word), not a pill; the design system has no badge, only `Count` for nav and tab counters. Never a row of chips for checklist items or tags.
- `StatusLabel` is only for a record's state: a row's stage or status, the job's header. Not for setup steps, a step's "To do", or a verdict. At most one per block.
- No " · " or " — " strings joining facts. A row's second line is its `secondary` and `gist`, which `ListRow` joins with its own dash; one more fact is the row's `fact`; anything else goes in a `Properties` list, or goes.
- `WorkspaceSection` for a titled part of a page, `Section` inside the open job, `Subhead` for a group heading outside a list.
- A notice about a list or page is a one-line `ListNotice` under the bar: full bleed, a rule under it, no box and no amber fill (`alert` when it warns). `Callout` is for a notice inside the open job.
- A disabled primary button goes grey (`bg-muted`, `text-fg-subtle`), not a faded accent.
- Explanations of policy fold into a `Disclosure` ("How this works"). The screen leads with what is asked and what to do.
- Dialogs are `DialogContent` (or `ConfirmDialog`, built on it): the buttons sit in the footer band, Cancel as `secondary`, then the one primary or danger action.

**Lists.** One system, in `components/ui/list.tsx`, inside a `Workspace` (or a `ListBody`):

- **No columns, ever.** No column header row, no grid of cells, no `role=columnheader`, at any width. Every row has the same anatomy on a 1920px desktop, beside an open record and on a phone.
- **`ListRow`**: a `lead` (`CompanyMark` or `ListIcon`, 32px), a `title` (`text-base font-medium`; one line from lg with a mouse, a column too; on touch two, `titleLines` 3 for questions), one second line and ONE `fact` at the right. The second line is `secondary` (the meta, usually the company; its first child truncates, at most 45% of the line) then the `gist` behind a dash the row draws: the one thing that matters about this row (the next step, the stage, the reason, the place). It stays one truncating line beside an open record too, so a job row is two lines on a desktop wherever it is; only a phone (under 40rem of sheet below lg) gives the gist a line of its own under the meta, two lines on touch. `snippet` is for prose rows only (Blockers, Questions, Highlights), clamped to 2 lines (3 on touch) and 72ch. The `fact` is one right-aligned fact of 12 characters or fewer, `text-sm text-fg-muted`, which may carry a tone: `Asked 3d` (warning), `Waiting 6h`, `Fit 88`, `4h`, a `StatusLabel` ("Declined"). Never two facts stacked. `actions` are `icon-sm` buttons after the fact, shown on hover and focus (always on touch). With `href` the row is a link (`a[role=row]`); without, a `div` holding links or buttons of its own. `selected` tints it with an accent bar at the left. The `RowLink` props from `useOpenRecord` spread straight on. `dense` is the Full log's variant: one line, two on touch.
- **Separators are inset hairlines**: each row draws a 1px line under itself from its title's x to the window's edge (from the gutter without a lead), like Things or iOS. Rows are 64px at least (72px on touch). Hover is `bg-subtle` across the whole width.
- **`ListGroup`** is the one group label inside a list (time bands, employers, Applications' segments, days): `text-2xs font-semibold uppercase` in `text-fg-muted` with its count, on the sheet with no band and no lines, sticky under the bar (`--group-top`, set by the `Workspace`: under the phone's top bar, under a one- or two-line bar, or at the top of a column's scroll). It is a `row`, so it reads as one ("Your move 6").
- **`ListFooter`** is the slim line under the rows (`Pagination variant="footer"`, "Load older", "That's everything"), sticky to the bottom from lg, hidden on a single page.
- Use the server's paging (`useJobList` + `Pagination`, 50 a page), a `SearchInput` bound to `/`, and `Segments` for the view's groups with counts. `Pagination` shows the range ("1–50 of 334 jobs" with `noun`), a page box to jump with, and Previous/Next; under 28rem of its own width Previous/Next keep only their arrows and the noun goes, so the range is never cut off. Loading is `SkeletonRows` (the row's anatomy; `dense` for the log, `lead={false}` without marks), never a blank slab; an empty list is `EmptyState` centred on the sheet `pt-24` under the bar (no box), and a search or filter that leaves nothing is `NoMatch` (`components/list`), which says which of them narrowed the list away and clears exactly that. `Segments` too long for their space scroll sideways with the clipped edge faded; never mask them by hand. A posting's place is `place(location)`: boards list several places in one string, and a row shows the first and how many more, the whole string on hover. A short list ends at its last row; the sheet just continues below it.

**Selection.** One control for each job: `Tabs` (underlined) switch between different views; a page's tabs sit in its bar (`TabsList variant="bar"`: Archive's Held and Rejected, Activity's tabs), the job's under its header. `Segments` narrow one list to a group, in the bar (the selected one a filled `bg-muted` pill, never an outline). `SectionNav` moves between the sections of one page (Settings, Profile's files), in a `WorkspaceBody` `nav` aside: a column from lg, a sideways strip under the bar below it, the selected item `bg-subtle`. `FilterMenu` holds quick filters; `Select prefix="Sort" collapse` sorts. Nothing else selects: no KPI tiles as tabs, no Select standing in for segments.

**A list beside the open item** (Review, Questions, Pipeline, Applications and Archive with a job open) is built from `components/list`, never by hand. The list is a `Workspace frame="column"`, 380/440/500px at lg/xl/2xl with a rule at its right, titled with the page's name (h1) and its whole count; both panes are white and full height, with nothing between them. Pipeline, Applications and Archive use `ListDetail layout="split"`: until a job opens the list is the page (`Workspace frame={compact ? "column" : "page"}`), and opening one turns the same rows into the column. The open item has a 48px bar (`h-12`) with its position ("3 of 246") and `icon-sm` buttons, its rule level with the column bar's first. A sort `Select` always has `prefix="Sort"`; the fit score is called Fit everywhere. Key hints for ⌘/Ctrl combinations come from `combo()` in `lib/hotkeys.ts`.

**Why a job was set aside** reads the same everywhere: the Archive's reason (its row's gist) and the open job's header both take it from `src/reasons.ts` (`row.reason`, `setAsideOf(job)`), never from the raw note.

**Agent text.** Agents and the mailbox write notes with markdown, escaped quotes and long URLs. Where it can hold links, render it with `Linkified` (a bare URL shows as `host/path…` with the whole address on hover). Inside a row's link use `plain()`, and let the snippet clamp (a `Clamp` with its "Show more" never goes inside a link row); where a row has one line for a step or note, `brief(text, company)` gives its first clause without the employer's name the row already shows (`NextLabel` for a next step). Never render an agent's text raw.

**Spacing.** 4px grid. One gutter, `--list-x` (16px; 24px from `sm` on a page, 16px in a column), which the bar, rows, labels, rules' content and footer all read: never pad a page by hand. The bar is 48px a line, a strip 48px, a group label 36px, a row 64px (72px on touch), the footer 44px. A `WorkspaceSection` is `py-6` with its title at the gutter.

**Motion.** Short and functional: `animate-in`, `animate-pop` for overlays, `animate-slide-left` for panels. Nothing loops except spinners and the running-state dot.

**Keyboard.** `useHotkeys` for page keys: `j`/`k` move, `/` search, `a` primary action, `x` reject, `Esc` close. `?` lists them (`components/shell/shortcuts.tsx`). Beside an open record, only its row in the list is a tab stop (`tabIndex={-1}` on the rest), so Tab goes from the list to the record's buttons and J/K walk the list.

**Phone.** Everything works at 375px wide. The shell gives a top bar and a bottom tab bar (keep 72px clear at the bottom). The top bar names the page (a job on its own reads "Job": its back link, just below, names its list), so below lg the bar's h1 is for screen readers only (a column keeps its count as a line, "334 waiting for you"), the bar is not sticky, and it is the search and icon-only controls (with tabs: the tabs, then the search), then the segments. Group labels stick under the top bar. At most 160px of chrome above the first row; row titles wrap to two lines (three for questions), the gist takes its own line (two at most), prose clamps to three, and the one fact sits top-right, level with the title. `Properties` stack (the label over its value) under 28rem. The open job's decision bar drops its text when its own width leaves too little room (a container query, so a narrow panel at 1024px behaves like a phone), and its buttons share the width. A job opens full-screen over its list on a phone, and opening it from the list is a history entry: Back and its close button both return to the list. Tap targets are at least 36px: the `touch:` variant (a coarse pointer, or narrower than 40rem) grows the design system's controls; a text-sized link or button in a dense row gets `touch:-my-2 touch:py-2`, a bigger target without moving the layout. `max-sm:`/`max-lg:` are the exact complement of `sm:`/`lg:` (`styles.css` redefines them: Tailwind's own matched a 1024px window as both lg and max-lg); `useMedia` (`lib/media.ts`) switches components at the same widths. Inputs are `text-base`, 16px on touch, or iOS zooms the page when one takes focus. Key hints (`Kbd`) hide on touch by themselves.

**Accessibility.** Buttons are `<button>`, navigation is `<a href>`. Icon-only buttons have `aria-label`. Radix primitives handle focus in menus and dialogs; a dialog opened from state puts focus back where it was on close (`useReturnFocus`), so give its first field focus with `onOpenAutoFocus`, not `autoFocus`. A destructive confirmation focuses Cancel. Contrast comes from the tokens; do not lighten text further.
