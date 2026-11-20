# Optional adapters

The required path is the CLI + envelopes. Nothing below is needed to run a test.

## Model providers

Pi/OpenRouter (or any other host) may claim a task and return envelopes. Enable per task or role when a different model is useful. Do not make provider keys a setup prerequisite.

## Built-in store + board

Always on. Durable tasks live in `.dm-software-machine/project-tasks.json`.
`sm-export` / `sm-board` write the JSON snapshot and HTML board. That is the
tracker. The machine may call `bd` only to convert existing Beads issues
into that store. It does not init Beads, and it does not keep `tracker: beads`.

## Parallel work

`parallel` in machine.yaml is the max in-flight count (claimed through reviewed). Default `1` (pause after the first claim).

`task-next` / `task-claim` refuse a second task when:

- in-flight count is already `parallel`, or
- declared `writes` overlap an in-flight task (missing writes count as overlap)

`--force` overrides both. With `worktrees: true`, each claim gets its own git
worktree so agents do not share a dirty tree. Still only raise `parallel`
when write paths are disjoint — overlap remains serialized.

Claim leases (`claim_lease_hours`, default 24) release abandoned `claimed` tasks on `task-claim` / `task-next` / `reclaim`. Over-repair sets status `failed` with a reason; `task-claim --force` requeues it.

`sm-accept` merges the task worktree into main, then re-runs the fast gate on
main when an app tree is present. A red post-merge gate refuses accept (merge
may already be on main); fix on main, then `sm-gate` + `sm-accept`.
