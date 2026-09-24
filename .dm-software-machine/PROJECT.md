# This project uses dm-software-machine

Install and operate from the repo root:

```bash
uv run dm-software-machine/scripts/dmsm.py init --profile tauri
# then either edit .dm-software-machine/machine.yaml or:
just sm-configure --ask
just sm-defaults
just sm-status
```

Engineer prompt: `Use sm to <one sentence>`.
Close-out: `just sm-finish <id>` then `just sm-accept <id>`.
For a feature set without pausing: `just sm-auto on`, Cursor Auto-review, then `Use sm to …`. Pause is the default (`just sm-auto off`).
The machine fills writes and done-means from `.dm-software-machine/machine.yaml`.
`APP_FOLDER` in `.env` is an optional override only.

Read `dm-software-machine/SKILL.md` before claiming a task.
