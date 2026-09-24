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
