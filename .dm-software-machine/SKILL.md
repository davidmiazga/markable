---
name: dm-software-machine
description: Advances one bounded coding task at a time through typed handoff envelopes and deterministic command gates. Use when the user says Use sm, sm to implement, dm-software-machine, or asks to queue, gate, review, or accept a machine task.
---

# dm-software-machine

A resumable coding-task machine. It does not autonomously finish a product. It sequences one coding task after another, carries context in envelopes, and judges known commands by exit status.

You operate the machine. You do not invent gate results, skip envelopes, or treat a cheap model as a substitute for a failed gate.

## Startup

Resolve the CLI, then install if needed.

1. Read this file.
2. CLI path: `dm-software-machine/scripts/dmsm.py` in the current repo if it exists, otherwise `scripts/dmsm.py` beside this SKILL.md. Invoke with `uv run <path>`.
3. If `.dm-software-machine/machine.yaml` is missing, run `init --profile <tauri|astro>`.
   Init vendors the package into the repo when needed, stamps a **commented** `machine.yaml`, and adds `just sm-*` recipes. It does not invent the app folder.
4. If `configured` is `false` or `app_folder` is `SET_ME`, this is first run. Ask the engineer (do not guess):
   - App folder, relative to repo root? (profile hint is often `tauri-app`)
   - Keep the default done-means, or a custom line?
   - Writes paths? (default profile source paths, not the whole app folder)
   - Is this a large complex project that would benefit from a project tracker?
     If **yes**, set `tracker: beads` and run `configure --tracker beads` (installs `bd` if needed, then `bd init --quiet`). If **no**, leave `tracker: none`.
   - Keep going through queued tasks until idle or a red gate (no pause after accept)? Default **no**.
     If **yes**, `just sm-auto on` and ask them to use Cursor Auto-review (or Run) so `.cursor/permissions.json` can run `just sm-*` without Allow prompts.
   Then write those answers into `.dm-software-machine/machine.yaml` **without stripping comments** (edit the existing keys). Set `configured: true`.
   They may instead edit that file themselves, or run `configure --ask` in a terminal.
5. If already configured, run `defaults` and `status`. Do not re-ask folder paths or done-means.
   Init stamps `.cursor/permissions.json`. That file only applies when Cursor Auto-review / Run is on.

## Engineer prompts

A complete ask looks like: `Use sm to implement a button that returns ok.`

You expand that. They should not have to name `APP_FOLDER`, write paths, or "done means".

Defaults come from `defaults` (machine.yaml + profile + optional `.env` `APP_FOLDER` / `PROJ_APP_DIR`):

- **writes** — source paths only (this repo: `tauri-app/src/`, `tauri-app/src-tauri/src/`, `tauri-app/index.html`). Not `node_modules`, `target`, or `package.json`.
- **done means** — fast gate is green and the feature is visible via the profile `dev_command`

Only override those if the engineer named different paths or a different acceptance rule.

## Protocol (every agent, every model)

Prefer `just` recipes. Do not write work/review JSON by hand.

1. `just sm-add "<their ask, one sentence>"`
2. `just sm-claim <id>`
3. Read `just sm-handoff <id>` (or `handoff --task <id> --print`) and `specs/<id>.md`.
4. Do only that task. Stay inside the task `writes` paths.
5. `just sm-finish <id>` — builds the work envelope from git, runs the fast gate, reviews that dirty files stay in writes. Does **not** accept.
6. If the gate fails, repair at most twice, then `sm-finish` again. Stop and report after two repairs.
7. `just sm-accept <id>` only when finish printed `ready to accept`.
8. If `defaults` / `status` show `auto_advance` true (or they asked to finish a feature set without pausing), immediately `just sm-next` and repeat steps 2–7 until `no ready tasks` or a gate stays red after two repairs. Otherwise stop. Do not start the next task unless they asked.

If `defaults` shows `tracker beads`, `sm-add` / `sm-accept` sync a bead (`sm:<task-id>`). Do not create or close beads by hand unless that sync failed. You may use `bd ready` only to suggest the next title; still go through `sm-add`.

`handoff --from-git` and `review --from-diff` exist if you need the steps split. `accept` refuses when the last gate failed, review is not approved, or dirty files sit outside writes.

## Rules

- Known commands are code. Run them through `gate`. Never claim tests passed from memory.
- Envelopes are the only handoff. Conversation is not state.
- Review answers "does the diff match the spec." Gates answer "does it run."
- Agent progress percentages are estimates. They never decide acceptance.
- Pause after accept unless `auto_advance` is on. Then keep going until the queue is idle or a gate fails.
- At most `parallel` tasks may be in flight. Overlapping `writes` always serialize. Worktrees are still out of scope.

## CLI

Prefer `just sm-<cmd>` after init. Equivalent: `uv run <cli-path> <cmd>`.

| just | Purpose |
|---|---|
| `sm-defaults` | Print app folder, writes, done-means, and dev command |
| `sm-init --profile tauri` | Stamp commented machine.yaml (use `--profile astro` for Astro) |
| `sm-configure --ask` | First-run questions (includes project-tracker / Beads / auto-advance) |
| `sm-configure --tracker beads` | Install `bd` if needed and `bd init` |
| `sm-auto on` / `sm-auto off` | Keep claiming after accept, or restore pause-after-accept |
| `sm-add "title"` | Queue a task (writes/done default from config) |
| `sm-claim <id>` | Claim a task (refuses if writes overlap or parallel slots are full) |
| `sm-next` | Claim the next ready task with disjoint writes |
| `sm-handoff <id>` | Print the latest envelope |
| `sm-finish <id>` | Work from git + fast gate + review from diff |
| `sm-accept <id>` | Accept only if gate passed and review approved |
| `sm-status` / `sm-watch` / `sm-tail` | Queue and events |
| `sm-gate <id>` | Re-run a gate without the rest of finish |

## Envelopes

Write JSON only. Required fields: `status`, `kind`, `task_id`, `summary`. See [references/contracts.md](references/contracts.md).

## Profiles

- `tauri` — Vite + vanilla TypeScript + Rust/Tauri 2 under `tauri-app/`
- `astro` — Astro under `astro-app/` (`astro check`, production build, plus test/lint only when those scripts exist)

Optional model adapters (Pi/OpenRouter) and Beads are not required to run the machine. See [references/adapters.md](references/adapters.md).
