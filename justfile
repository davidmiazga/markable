set dotenv-load
set positional-arguments

# ── dm-software-machine ─────────────────────────────────────────────────────
sm := "uv run dm-software-machine/scripts/dmsm.py"

sm-init *ARGS:
    {{sm}} init "$@"

sm-configure *ARGS:
    {{sm}} configure "$@"

sm-defaults:
    {{sm}} defaults

sm-scope:
    {{sm}} scope

sm-status:
    {{sm}} status

sm-watch:
    {{sm}} watch

sm-tail *ARGS:
    {{sm}} tail "$@"

sm-add *ARGS:
    {{sm}} task-add --title "$@"

sm-brief *ARGS:
    {{sm}} task-brief --title "$@"

sm-ticket *ARGS:
    {{sm}} task-ticket --title "$@"

sm-ready TASK:
    {{sm}} task-ready {{TASK}}

sm-claim TASK:
    {{sm}} task-claim {{TASK}}

sm-next *ARGS:
    {{sm}} task-next "$@"

sm-handoff TASK:
    {{sm}} handoff --task {{TASK}} --print

sm-finish TASK KIND="fast":
    {{sm}} finish --task {{TASK}} --kind {{KIND}}

sm-accept TASK:
    {{sm}} accept --task {{TASK}}

sm-gate TASK KIND="fast":
    {{sm}} gate --task {{TASK}} --kind {{KIND}}

sm-auto MODE:
    {{sm}} auto {{MODE}}

# ── Flavor dev ──────────────────────────────────────────────────────────────
markable *ARGS:
    node scripts/tauri-flavor.mjs markable {{ARGS}}

remarkable *ARGS:
    npm run dev:plugins
    node scripts/tauri-flavor.mjs remarkable {{ARGS}}

pkm *ARGS:
    node scripts/tauri-flavor.mjs pkm {{ARGS}}

project *ARGS:
    node scripts/tauri-flavor.mjs project {{ARGS}}

diary *ARGS:
    node scripts/tauri-flavor.mjs diary {{ARGS}}

quicknote *ARGS:
    node scripts/tauri-flavor.mjs quicknote {{ARGS}}

book *ARGS:
    node scripts/tauri-flavor.mjs book {{ARGS}}

# Rebuild per-flavor Tauri icon sets from the 1024 SVG masters.
icons:
    node scripts/build-app-icons.mjs

# Local unsigned .app for one flavor: just bundle markable
bundle FLAVOR:
    node scripts/tauri-flavor.mjs {{FLAVOR}} build --bundles app

sm-export *ARGS:
    {{sm}} export "$@"

sm-board *ARGS:
    {{sm}} board "$@"

[positional-arguments]
sm-board-serve *ARGS:
    {{sm}} board --serve "$@"

sm-overrides-import *ARGS:
    {{sm}} overrides-import "$@"
sm-overrides-export *ARGS:
    {{sm}} overrides-export "$@"

[positional-arguments]
sm-prime *ARGS:
    {{sm}} prime "$@"
[positional-arguments]
sm-note TASK +TEXT:
    {{sm}} task-note {{TASK}} "${@:2}"

sm-rebase TASK:
    {{sm}} rebase --task {{TASK}}
sm-doctor:
    {{sm}} doctor

sm-test:
    #!/usr/bin/env bash
    set -euo pipefail
    root="$(pwd)"
    scripts="$root/dm-software-machine/scripts"
    for t in test_export.py test_brief.py test_worktrees.py test_unattended.py; do
      echo "=== $t ==="
      uv run "$scripts/$t"
    done
    echo "unit suite ok (astro live: uv run dm-software-machine/scripts/test_astro.py)"

[positional-arguments]
sm-update *ARGS:
    {{sm}} task-update "$@"

[positional-arguments]
sm-milestone-add *ARGS:
    {{sm}} milestone-add "$@"

sm-milestone-list:
    {{sm}} milestone-list

[positional-arguments]
sm-reclaim *ARGS:
    {{sm}} reclaim "$@"
