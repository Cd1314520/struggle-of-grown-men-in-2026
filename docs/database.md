# Database

`data/app.db` is SQLite. Its schema is the ordered list of migrations in `src/schema.ts`; `PRAGMA user_version` records how many have been applied. The app applies whatever is pending when it starts, each migration in one transaction with its version bump, and logs each upgrade of an existing database to Activity. It refuses to start on a database newer than the code.

To change the schema, append a migration to `MIGRATIONS` and never edit one that has shipped. A migration is written for exactly the schema the previous one leaves behind; only the baseline (version 1, which adopted databases from before versions were tracked) tolerates things already existing. Changing a constraint or column type means creating the new table, copying the rows, dropping the old one and renaming, inside the one migration. Give each statement its own call (`runEach` in `src/schema.ts`): `bun:sqlite` reports a failure only in the first statement of a longer string and runs the rest, so a migration that copies and then deletes could lose what it meant to move.

```bash
bun run migrate --status              # version and pending migrations; changes nothing
bun run migrate                       # upgrade data/app.db without starting the app
bun run migrate --db <path>           # the same for another file, such as a restored backup
```

The journal and reassessment scripts open a database by path and never change its schema: they stop with a message naming `bun run migrate` if it is not at the version the code expects.

SQL lives with the module that owns the table: `jobs`, `job_sources`, `status_changes`, `events` and `kv` in `src/db.ts`, `accounts` in `src/accounts.ts`, gates and answers in `src/questions.ts`, `fill_state` in `src/fill-state.ts`, `application_steps` in `src/steps.ts`, the digest ledger in `src/digest.ts`. Other modules call their functions. Values are always bound as parameters; a list is bound as one JSON array and read with `json_each`. `tests/db.test.ts` checks both by scanning the source: it catches statements outside the owning modules and values spliced into SQL template strings, not SQL assembled by string concatenation.

The current schema in full is recorded in `tests/__snapshots__/schema.test.ts.snap`. Adding a migration changes it deliberately (`bun test -u`); a change without a new migration means a shipped migration was edited.

`bun test` runs against throwaway state: `tests/setup.ts` (loaded through `bunfig.toml` when run from the repository root) points `AUTO_APPLY_DATA` at a temporary directory before anything loads. Run from anywhere else, `src/db.ts` refuses to open a database at all under `bun test` unless `AUTO_APPLY_DATA` is set, so a test run cannot migrate or write to the live database.

## Before an upgrade

A database that already holds something is copied to `<file>.v<N>.bak` (for the app, `data/app.db.v1.bak`) before a migration changes it, under the same lock as the migration; `N` is the version it was at. An upgrade that cannot be backed up does not run. To undo an upgrade, stop the service, check out the older code, and put the copy back in place of `app.db` (remove `app.db-wal` and `app.db-shm` with it). The copies are never deleted for you.

## Job status

A job's `status` changes only through `moveJob` in `src/db.ts` (bulk moves through `moveWhere` there). Each move names the status it expects the job to be in and the new one; it changes the row only if the job is still where expected, and returns whether it did, so two workers cannot both move the same job. A move that `TRANSITIONS` in `src/status.ts` does not allow throws, as does a move to `held` without a `hold_reason`; `writeJob` and `updateJob` refuse a `status` field. When a job moves to anything other than a parked status (`needs_input`, `awaiting_submit`, `needs_manual`), its open gates are closed and any browser reservation is released in the same transaction. Triggers on `jobs` reject a status that is not one of `STATUSES`, whatever writes it.

Facts about a job that used to live in `kv` or in its note are columns on `jobs`: `hold_reason` (`triage`, `target`, `review` or `user`; why a held job is held), `feedback` (your words on a redo, read by the next assessment), `hand_picked` (you asked for the job yourself, so screening does not skip it), `locate_tries` (lookups of an aggregator posting on the employer's site) and `deferred_at` (when it was left waiting for the auto-approval daily cap). Version 9 moved the old `feedback.<id>`, `locate.tries.<id>` and `auto.deferred.<id>` keys into them and deleted the keys.

Each row of `blockers` names the gate it was recorded under (`gate_id`; rows from before version 9 were matched to a gate opened within a minute of them, or left blank).

## Status history

`status_changes` holds every change of a job's status: where it was, where it went, the note written with the change, who approved it on a move to `approved`, and when. Triggers on `jobs` write it, so a bulk update or a script working on the file directly leaves a row like anything else. A job's page returns it as `history` (`GET /api/jobs/<id>`). History starts with the first change after version 2; that row's `from_status` says where the job stood before.

```sql
SELECT at, from_status, to_status, approved_by, note FROM status_changes WHERE job_id = ? ORDER BY id;
```

## Fill state

`fill_state` has one row per application that has reached a browser: its `phase`, the browser that last held it (`slot`), and the gate under which you reserved that browser (`manual_gate`). Everything that reads or changes it is in `src/fill-state.ts`; each change only applies from the phases listed, so a stale caller changes nothing.

| Phase | Meaning | Entered from |
| --- | --- | --- |
| `idle` | no submit authorized, nothing queued | `draft_recovery` when the resumed attempt starts; any phase when an outcome is recorded |
| `submitting` | final submit authorized, no outcome recorded | `idle` (`confirm_submit`) |
| `ambiguous` | parked without knowing whether it was sent (always set when a `submission_ambiguous` gate parks) | any other phase |
| `verify_queued` | a verification-only worker is queued | `ambiguous`, `verifying` |
| `verifying` | that worker is running | `verify_queued` when it starts |
| `draft_recovery` | the next attempt resumes the draft | `idle`; `ambiguous`, `verify_queued` or `verifying` once it is known not to have been sent |

`submitting`, `ambiguous`, `verify_queued` and `verifying` all keep submission protection.

## Digest deliveries

`question_digest_deliveries` holds each digest email: its `state` (`sending`, `uncertain`, `failed`, `sent`, `abandoned`), how many times it was sent (`attempts`) and when last (`attempt_at`). Only one may be neither `sent` nor `abandoned` at a time.

## Application steps

`application_steps` has one row per thing an employer asked for after an application was sent: its kind (`questionnaire`, `assessment`, `schedule`, `interview`, `info_request`, `other`), a title, the deadline (`due_at`, a day or a time), the booked time (`scheduled_at`), the link from the mail, and where it came from (`mail` with its Gmail message id, or `user`). Its `state` says whose move it is: `todo` is yours, `done` and a `scheduled` time that has passed wait on the employer, a future `scheduled` time is upcoming, and `closed`, `expired` and `cancelled` are settled. Adding the first step moves an application from `submitted` to `interview`; an offer or a rejection closes the open steps, a withdrawal cancels them. A message read twice adds nothing: `(job_id, message_id, kind)` is unique. Version 5 turned each application then in `interview` into one `todo` step titled with its note. An `interview` step also carries the agent's prep brief (`brief`, markdown; `brief_at`) and `brief_tries`, how many times the interview worker has been run for it: the worker picks steps with no brief and fewer than 2 tries, and a run counts when it starts. **Refresh prep** on the step clears the brief and the count so the worker writes it again; nothing else rewrites a brief.

## What is kept, and for how long

Agents' step-by-step records in `events` (kinds `step`, `tool` and `agent`) are removed once a day when they are older than `retention.chatterDays` in `config.yml` (30 if unset; 0 keeps them). Approvals, gates, errors, mail, your own actions and the status history are never removed. The stall journal reads steps and tool calls to attribute failures; it checkpoints what it has seen, so retention only limits how far back a first run on a fresh state file can look.
