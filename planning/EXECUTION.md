# Execution contract (deferred)

`dm-software-machine` (`sm`) is **not** installed in this repository yet.

## When to initialize

After the shared-core / app-family directory layout is designed and the relative app folder is stable. Then:

1. Read the `dm-software-machine` skill
2. `init --profile tauri`
3. Set `tracker: beads` and run `configure --tracker beads`
4. Keep `auto_advance: false` (pause after each accepted task)
5. Keep default done-means: fast gate green and the feature visible via the Tauri dev command
6. Ask for the new relative `app_folder` — do not assume `.` or `tauri-app/`

## Why Beads

This is a large project: many bounded tasks, dependencies, and a multi-app split. Beads track the graph; the machine still claims **one** task at a time.

## Writes caution

The Tauri profile defaults writes to `<app>/src/`, `<app>/src-tauri/src/`, and `<app>/index.html`. Planning, plugin IIFE build scripts, `tauri.conf.json`, and `package.json` sit **outside** those paths. App-family work will need explicit write-path overrides per task, or the machine will refuse legitimate packaging edits.

## Baseline work is outside the machine

Documentation moves, quality-gate recording, and layout design are not `sm-add` tasks until the machine has a real `app_folder`.
