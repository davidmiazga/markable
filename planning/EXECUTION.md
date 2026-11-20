# Execution contract

`dm-software-machine` is initialized in this repository.

## Configured defaults (2026-09-23)

| Key | Value |
|---|---|
| profile | tauri |
| app_folder | `.` (this repo is the app; do not use `tauri-app/`) |
| tracker | none (built-in project store and HTML board) |
| auto_advance | true |
| done_means | fast gate green and the feature is visible via `npm run tauri dev` |
| writes | `src/`, `src-tauri/src/`, `index.html`, `flavors/`, `scripts/`, `src-tauri/tauri.conf.json`, `planning/` |

Gate cwd paths in `.dm-software-machine/profile.yaml` were rewritten from `tauri-app/` to `.` / `src-tauri`. Re-running `init --profile tauri` will try to scaffold a dummy `tauri-app/` — delete it if that happens.

Prompt: `Use sm to <one sentence>`. Close-out: `just sm-finish <id>` then `just sm-accept <id>`.

## Tracker

Tasks live in `.dm-software-machine/project-tasks.json`. `just sm-board` writes the HTML board.

## Writes caution

The Tauri profile defaults writes to `<app>/src/`, `<app>/src-tauri/src/`, and `<app>/index.html`. Planning, plugin IIFE build scripts, `tauri.conf.json`, and `package.json` sit **outside** those paths. App-family work will need explicit write-path overrides per task, or the machine will refuse legitimate packaging edits.

## Baseline work is outside the machine

Documentation moves, quality-gate recording, and layout design are not `sm-add` tasks until the machine has a real `app_folder`.
