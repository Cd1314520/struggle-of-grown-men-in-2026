# auto-apply

Local job scanner, resume tailor and application filler with two manual gates. A small Bun app owns state and scheduling; every piece of agent work is an `omp --mode rpc` process that reports back through host tools.

## Start here

```bash
bun install                 # dependencies, and the pre-commit hook
bun run check               # typecheck, lint, format check, tests
systemctl --user status auto-apply
```

| | |
|---|---|
| [docs/setup.md](docs/setup.md) | prerequisites, installing the service, the profile, Gmail, who can reach the app |
| [docs/operations.md](docs/operations.md) | auto apply, parked applications and Questions, the daily digest, the observation journal, Workday recovery |
| [docs/pipeline.md](docs/pipeline.md) | sources and scanning, duplicates, freshness, resumes |
| [docs/browser.md](docs/browser.md) | the browsers, the pacing proxy, and the fingerprint audit |
| [docs/database.md](docs/database.md) | schema and migrations, backups, status history, fill state, retention |

Settings live in [`config.yml`](config.yml), with what identifies you or this machine in an untracked `config.local.yml` laid over it; both are checked when the app starts. The documentation names the keys and leaves the values to the file.

## Flow

`found → triaged → prepping → awaiting_approval (gate 1) → approved → filling → awaiting_submit (gate 2) → submitted → interview / offer / rejected_by_company`

Side exits: `needs_input` (agent asked a question), `needs_manual` (agent could not get past a CAPTCHA or block), `failed`, `skipped`, `rejected`.

Triage first drops, without a model, postings abroad and senior-level titles (senior, staff, principal, lead, manager and above; `src/screen.ts`), then uses the model named in `models.triage`, up to 50 postings per call, in sequential batches until the found backlog is drained.

| Worker | Built-in omp tools | Host tools |
|---|---|---|
| triage | read, write | `triage_result` |
| discover | + web_search | `add_company`, `save_job` |
| prep | + edit, bash (typst) | `finish_prep` |
| fill | read, write, eval (browser) | `get_account`, `gmail_*`, `ask_user`, `confirm_submit`, `need_manual`, `verify_status`, `report_result` |
| track | read, write | `gmail_*`, `update_application`, `note` |

## Checks

`bun run check` runs the typecheck, the linter, the format check and the tests. `bun run format` rewrites the TypeScript the way Prettier wants it (`.prettierrc.json`). CI (`.github/workflows/check.yml`) runs the same command on every push. A pre-commit hook (`.githooks/pre-commit`) runs it before every commit; `bun install` enables the hook by pointing `core.hooksPath` at `.githooks`.

## Layout

- `src/scheduler.ts`: what runs when. A `Scheduler` holds the state that only exists while the process is up (running workers, which job has which browser) and takes the agent runner and the browser functions as constructor arguments, so it can be driven without either.
- One module per worker: `src/scan.ts` (sources, triage, discovery), `src/locate.ts`, `src/prep.ts`, `src/fill.ts`, `src/track.ts`. `src/fill-session.ts` is a fill worker's hold on a job and a browser; `src/fill-tools.ts` is the host tools it is given. `src/worker-tools.ts` is what the workers share.
- `src/server.ts`: the HTTP API. `createHandler(scheduler)` answers requests; `main()` starts the server, the proxies and the scheduler, and only runs when the file is the entry point.
- `src/omp.ts`: RPC client. `prompts/`: one prompt per worker.
- `src/schema.ts`: database migrations and how a connection is opened. `src/db.ts`: jobs, status history, events and kv.
- `src/status.ts`: the job statuses, their groups, and what each move between them writes. Every status change goes through `to`. `src/fill-state.ts`: where an application stands between approval and a recorded outcome.
- `src/config.ts`: reads `config.yml`; `src/config-check.ts` is what the file must look like. `src/template.ts`: fills a prompt's placeholders.
- `deploy/systemd/`: the service and timer units. `docs/`: everything this page links to.
- `data/`: SQLite DB, per-job resume copies, omp sessions, Chrome profile (git-ignored; holds site passwords and Gmail tokens).
