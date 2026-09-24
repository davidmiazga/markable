# Optional adapters

The required path is the CLI + envelopes. Nothing below is needed to run a test.

## Model providers

Pi/OpenRouter (or any other host) may claim a task and return envelopes. Enable per task or role when a different model is useful. Do not make provider keys a setup prerequisite.

## Beads

Asked at first run: "Is this a large complex project that would benefit from a project tracker?"

- **no** (default) — `tracker: none`. `Use sm to …` is the inbox.
- **yes** — `tracker: beads`. Init/configure installs `bd` (`brew install beads`, else `npm install -g @beads/bd`) and runs `bd init --quiet --role maintainer` if `.beads/` is missing.

A bead may point at a machine `run_id` and task id. Beads does not store gate logs, envelopes, or phase state. Non-interactive: `init --tracker beads` or `configure --tracker beads`.

When `tracker: beads`:

- `task-add` runs `bd create` with `--external-ref sm:<task-id>` and stores `bead_id` on the task
- `accept` runs `bd close <bead-id>` after sm acceptance
- Create failure refuses the add. Close failure does not un-accept the sm task.

## Parallel work

`parallel` in machine.yaml is the max in-flight count (claimed through reviewed). Default `1` (pause after the first claim).

`task-next` / `task-claim` refuse a second task when:

- in-flight count is already `parallel`, or
- declared `writes` overlap an in-flight task (missing writes count as overlap)

`--force` overrides both. Isolated worktrees are still deferred: two claimed tasks share the same tree, so only raise `parallel` when you really have disjoint paths and two agents.
