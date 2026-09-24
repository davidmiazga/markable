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
- `tracker` — `none` or `beads` (Beads only after the large-project question or `--tracker beads`)
- `protected_paths` — never included in a work envelope
- `ignore_dirty` — extra dirty paths that do not fail finish (include `.cursor/` so permissions stamps do not fail finish)
- `max_repairs` — default 2
- `auto_advance` — default false. When true, accept does not pause; the agent claims the next ready task until idle or a red gate
- `parallel` — max in-flight tasks (default 1). Overlapping `writes` always serialize.

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

When `tracker: beads`, each task may carry `bead_id`. That is a pointer only.
