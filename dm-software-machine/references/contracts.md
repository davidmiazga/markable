# Contracts

Four surfaces. Change them together.

## Machine config

`.dm-software-machine/machine.yaml`

- `version` — machine package version
- `profile` — profile id (`tauri` or `astro`)
- `configured` — `true` after first-run questions or a hand edit of the SET_ME fields
- `app_folder` — project app directory (overridable by `.env` `APP_FOLDER` / `PROJ_APP_DIR`)
- `writes` — default paths a task may change (Tauri: app `src/`, `src-tauri/src/`, `index.html`; Astro: app `src/`, `public/`)
- `never_write` — directory names that are never in a work envelope (`node_modules`, `target`, `dist`)
- `done_means` — default acceptance line (fast gate + visible in dev)
- `tracker` — must be `none` (built-in store + board)
- `protected_paths` — never included in a work envelope
- `ignore_dirty` — extra dirty paths that do not fail finish (include `.cursor/` so permissions stamps do not fail finish)
- `max_repairs` — default 2. Over-repair moves the task to `failed` (not `blocked`) with a reason
- `auto_advance` — default false. When true, accept does not pause; the agent claims the next ready task until idle or a red gate
- `parallel` — max in-flight tasks (default 1; clamp to 1 when `worktrees` is false). Exact-file and directory `writes` scopes always serialize.
- `worktrees` — default true. Claim creates `.dm-software-machine/worktrees/<id>/` on branch `sm/<id>`. Gates/finish use that checkout. Accept commits write-scoped dirty files, merges into the main checkout, then removes the worktree. Merge conflicts refuse accept. Reclaim removes the worktree. Set `false` to keep the old single-tree behavior.
- `claim_lease_hours` — default 24. Stale `claimed` tasks are released on `task-claim` / `task-next` / `reclaim`

`init` also stamps `.cursor/permissions.json` from `templates/permissions.json` (Cursor Auto-review allow/block for `just sm-*`, uv CLI, npm/cargo in the app folder). It does not turn Auto-review on; the engineer still picks Run / Auto-review in Cursor.

`init` copies `templates/machine.yaml` with comments intact. It must not dump YAML (that strips comments). `defaults` and `task-add` refuse until `configured` is true and `app_folder` is not `SET_ME`.

## Profile

`dm-software-machine/profiles/<id>.yaml` copied into `.dm-software-machine/profile.yaml`

- `detect` — files that identify the project
- `scaffold` — optional argv + dest dir
- `checks.fast|full|package` — list of `{name, cwd, argv, timeout_seconds}`
- `checks[].when.package_script` — run that check only if `package.json` has a real script (placeholder `npm test` is skipped). Missing optional checks are skipped, never faked as pass.
- `app_dir` — project subdirectory

Every check is an argv list. Exit 0 is pass. Missing commands fail closed. `npm` in argv is rewritten to pnpm/yarn/bun when those lockfiles exist.

## Envelopes

Stored at `.dm-software-machine/runs/<run-id>/tasks/<task-id>/envelopes/<kind>.json`

Shared fields:

```json
{
  "status": "success",
  "kind": "intent|handoff|work|review|quality|acceptance",
  "task_id": "t-ab12",
  "summary": "one sentence",
  "artifacts": [],
  "notes_for_next": "",
  "changed_files": [],
  "writes": []
}
```

Kind extras:

- `work`: `changed_files`, `commit_message`
- `review`: `approved` (bool), `blocking` (list of strings)
- `quality`: `passed` (bool), `failures` (list of strings), `log_paths` (list of strings)
- `acceptance`: `accepted` (bool)

`status=fail` on a work/review/quality envelope is a valid report. It does not advance the task to accepted.

## Adapter

Any agent:

1. claims one task
2. reads the latest envelope
3. publishes checkpoints
4. returns a valid envelope
5. lets the CLI run gates and acceptance

The CLI owns sequencing, retries, and verdicts. The agent owns judgment inside one task.

`finish` is the required close-out: work envelope from `git status` (files inside `writes` only), then the named gate, then review from that same scope. It never accepts. Dirty files outside `writes` fail closed unless they match `protected_paths`, `ignore_dirty`, `specs/`, or `.dm-software-machine/`.

## Project store and export

Durable task records live in `.dm-software-machine/project-tasks.json` (gitignored). Run state under `runs/<run_id>/` still holds envelopes, logs, and the active queue; each `save_state` upserts that run’s tasks into the project store without wiping tasks from earlier runs.

`export` (just `sm-export`) writes an atomic snapshot to `.dm-software-machine/export.json` (or `-o <path>`). Schema `0.5-smdm`. Canonical status names match the CLI (`briefing` / `queued` … `accepted` / `blocked` / `failed`). Export also includes board aliases (`state`, `deps`, `retries`), PM fields (`priority`, `milestone`, `owner`, `description`, `labels`), append-only `notes`, computed `waiting_on` / `blocks`, nesting (`kind`, `parent`), `writes`, `spec_path`, `external_ref`, `claim`, `reason`, and `latest_envelope` / `envelope_path`. `evidence.acceptance` is `accepted` only when `status` is `accepted`.

`prime` (just `sm-prime`) prints an agent resume dump: layout, in-flight, ready, queued, briefing, stuck, unmet dependency edges, and next-step commands. Use after compaction or handoff to a new agent.

`board` (just `sm-board`) runs export, then embeds it into
`dm-software-machine/board/project-board.html` → `.dm-software-machine/board.html`.

Each card links to its `specs/<id>.md` and the editor shows that file. `board --serve` writes the spec on Save. `overrides-import` also writes a `spec` string in a card patch to that same file, and only under `specs/`. The board may edit cards locally and download `board-overrides.json`. `overrides-import` merges those patches into the durable store (and current run), including `labels` and append-only `note`/`add_note`. Top-level `settings` (`worktrees`, `parallel`) updates `.dm-software-machine/machine.yaml` with comments preserved. Board `done`/`accepted` is ignored — acceptance stays with `sm-accept`. Gate evidence from the board is recorded as a reason note only. `overrides-export` writes the current PM/detail skeleton plus settings. Last import is audited at `.dm-software-machine/board-overrides.json` (gitignored).

Export includes `settings.worktrees` / `settings.parallel` for the board header controls. Claimed tasks may show `worktree_path` on cards.

Cross-machine sync is intentional out of scope: copy `export.json` / re-run `sm-board` if a human needs a portable snapshot. The live authority stays the project’s local store.

`milestone-add` / `milestone-list` manage project milestones. `task-update` sets priority/milestone/owner/title/description/kind/parent/reason. `reclaim` releases stale claims. `task-claim --force` on `failed`/`blocked` requeues the task.
