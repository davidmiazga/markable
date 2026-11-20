---
name: dm-software-machine
description: >-
  Installs and runs dm-software-machine (sm) in a repo: bounded coding tasks,
  typed envelopes, deterministic gates, built-in project store, and HTML board.
  Use when the user says Use sm, sm to implement, dm-software-machine, init sm,
  project board, sm-export, sm-board, sm-prime, multi-agent, or asks to queue,
  gate, review, or accept a machine task. Use when require_brief is on and they
  ask to implement or change product, UX, or app behavior.
---

# dm-software-machine

A resumable coding-task machine you **add to an existing repo** (or a fixture).
It sequences one coding task at a time, carries context in envelopes, and
judges known commands by exit status. Built-in project store, board, and
optional git worktrees are the tracker — not Beads.

You operate the machine. You do not invent gate results, skip envelopes, or
treat a cheap model as a substitute for a failed gate.

## What lands in a repo

After `init`:

| Path | Role |
|---|---|
| `dm-software-machine/` | Vendored package (CLI, profiles, board template) |
| `.dm-software-machine/machine.yaml` | Config (comments kept) |
| `.dm-software-machine/profile.yaml` | Profile checks |
| `just sm-*` | Recipes |
| `.cursor/permissions.json` | Auto-review allowlist stamp |
| `specs/` | Task briefs (created as you add work) |
| `.dm-software-machine/runs/` | Runtime (gitignored) |
| `.dm-software-machine/project-tasks.json` | Durable store (gitignored) |
| `.dm-software-machine/export.json` / `board.html` | Snapshots (gitignored) |

## Startup

1. Read this file.
2. CLI: `dm-software-machine/scripts/dmsm.py` in the repo if present, else
   `scripts/dmsm.py` beside this SKILL.md. Invoke with `uv run <path>`.
3. If `.dm-software-machine/machine.yaml` is missing:
   `uv run <cli> init --profile <tauri|astro>` (or `just sm-init --profile …`
   after recipes exist). Init vendors the package, stamps config, just
   recipes, and permissions. It does not invent the app folder and does
   **not** scaffold by default — pass `--scaffold` only for a greenfield
   fixture that should create `tauri-app` / `astro-app`. To refresh an
   existing install: `just sm-init --upgrade --profile <tauri|astro>`.
4. If `configured` is `false` or `app_folder` is `SET_ME`, ask (do not guess):
   - App folder relative to repo root? (often `tauri-app` / `astro-app`)
   - Keep default done-means, or a custom line?
   - Writes paths? (profile source paths only — not `node_modules` / `target`)
   - Keep going after accept until idle or a red gate? Default **no**.
     If yes: `just sm-auto on` and Cursor Auto-review/Run so permissions apply.
   Leave `tracker: none` (built-in store + board). Do not set up Beads.
   The machine may call `bd` only to convert existing Beads issues into the
   project store. After that, work stays on the store and the HTML board.
   Write answers into `.dm-software-machine/machine.yaml` **without stripping
   comments**. Set `configured: true`. Or `configure --ask` / `--accept-defaults`.
5. If already configured: `just sm-prime` (or `sm-defaults` + `sm-status`).
   Prefer `sm-prime` after compaction or when a new agent takes over. Do not
   re-ask layout questions.

## Engineer prompts

`Use sm to implement a button that returns ok.`

Defaults come from `defaults` (machine.yaml + profile + optional `.env`
`APP_FOLDER` / `PROJ_APP_DIR`). Prefer `just sm-*`. Do not hand-write envelopes.

### When `require_brief` is true

1. `just sm-ticket "<one sentence>"` — briefing ticket + fill template; stop.
2. Engineer fills `specs/<id>.md` (no TODO/TBD). Then `just sm-ready <id>`.
3. `just sm-claim <id>` → handoff → implement inside `writes` → `sm-finish` →
   `sm-accept` when ready. Fan out agents only on disjoint files inside one claim.

### When `require_brief` is false

1. `just sm-add "<one sentence>"`
2. `just sm-claim <id>` → handoff → implement → `sm-finish` → `sm-accept`
3. If `auto_advance`, `sm-next` until idle or a red gate after two repairs.

## Project store and board

Always available (no Beads required):

| Command | Purpose |
|---|---|
| `just sm-prime` | Agent resume dump (queue, deps, worktrees, next steps) |
| `just sm-export` | Write `.dm-software-machine/export.json` (schema 0.5-smdm) |
| `just sm-board` | Export + build `.dm-software-machine/board.html` |
| `just sm-board-serve` | Serve that board. Card Save writes `specs/<id>.md` |
| `just sm-milestone-add` / `sm-milestone-list` | Milestones |
| `just sm-update <id>` | Priority / milestone / owner / labels / depends / … |
| `just sm-note <id> "…"` | Append an agent/human note on a task |
| `just sm-overrides-import -f board-overrides.json` | Apply board card edits + settings into the store |
| `just sm-overrides-export` | Skeleton overrides JSON (includes worktrees/parallel) |

Board header shows **Worktrees** and **Parallel**. Change them, download
Overrides JSON, then `sm-overrides-import` to write `machine.yaml`.

Board UI may edit cards locally and download overrides. Import merges into the
durable store. Board cannot force `accepted`/`done` — that stays with
`sm-accept`. Gate evidence from the board is advisory (reason note only).

## Rules

- Gates are code. Never claim tests passed from memory.
- Envelopes are the only handoff. Conversation is not state.
- At most `parallel` in-flight tasks (`parallel > 1` needs `worktrees: true`).
  Overlapping `writes` serialize (exact files and directory scopes).
- With `worktrees: true` (default), `sm-claim` creates
  `.dm-software-machine/worktrees/<id>/`. **Edit only there.** Gates run in
  that tree; `sm-accept` commits write-scoped changes and merges the task
  branch (conflicts refuse accept).
- Pause after accept unless `auto_advance` is on.
- Repair a red gate at most twice, then stop and report.

## CLI (just ↔ uv)

| just | Purpose |
|---|---|
| `sm-init --profile tauri` | Stamp machine into this repo |
| `sm-configure --ask` | First-run questions |
| `sm-defaults` / `sm-status` / `sm-prime` / `sm-scope` | Layout, queue, resume |
| `sm-add` / `sm-ticket` / `sm-ready` / `sm-claim` / `sm-next` | Queue and claim |
| `sm-handoff` / `sm-finish` / `sm-accept` / `sm-gate` | Work and close |
| `sm-note` / `sm-update` | Notes, labels, deps, PM fields |
| `sm-export` / `sm-board` / `sm-board-serve` | Store snapshot, HTML board, spec save |
| `sm-overrides-import` / `sm-overrides-export` | Board ↔ store |
| `sm-reclaim` / `sm-rebase` / `sm-doctor` | Leases, merge recovery, health |
| `sm-auto` / `sm-watch` / `sm-tail` | Unattended + live view |

Equivalent: `uv run dm-software-machine/scripts/dmsm.py <cmd>`.

## Profiles

- `tauri` — Vite + TS + Rust/Tauri 2 under `tauri-app/`
- `astro` — Astro under `astro-app/`

Contracts: [references/contracts.md](references/contracts.md).
Adapters (optional model hosts): [references/adapters.md](references/adapters.md).
