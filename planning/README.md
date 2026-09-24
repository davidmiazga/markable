# Planning

This directory is the canonical internal planning root for Markable.

Stale session trackers, completed requirement snapshots, and historical handoffs live in [`old/`](old/README.md). Feature execution specs remain in [`docs/specs/`](../docs/specs/) as implementation archaeology; do not treat their `status: active` front matter as current.

| Document | Role |
|---|---|
| [CURRENT_STATE.md](CURRENT_STATE.md) | Verified repo identity, commands, and test/build results |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Implemented system, seams, and coupling |
| [RISKS.md](RISKS.md) | Debt and constraints for the next epic |
| [APP_FAMILY.md](APP_FAMILY.md) | Separate-installable-app target and readiness |
| [EXECUTION.md](EXECUTION.md) | Deferred `dm-software-machine` + Beads contract |
| [old/README.md](old/README.md) | Archive index |

Last-known product requirement (not yet implemented as a spec): [`docs/requirements/active_task.md`](../docs/requirements/active_task.md) — Collections hierarchy / composite views (2026-06-09). The referenced `docs/specs/collections-hierarchy/` directory does not exist.

End-user help stays in `src-tauri/help/`. Operator notes stay in [`docs/build-notes/`](../docs/build-notes/) and [`docs/testing.md`](../docs/testing.md).
