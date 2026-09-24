# Risks and debt

Prioritized for the later epic. None of these were fixed in the baseline.

| ID | Risk | Why it matters | Severity |
|---|---|---|---|
| R1 | `main.ts` + oversized plugins are the composition layer | Separate apps need a thin host; today’s host *is* Markable | High |
| R2 | Plugin IIFE + `new Function` + full DOM | Sub-apps will ship different plugin sets; there is no real sandbox | High |
| R3 | Settings and app-data keyed to `com.markable.app` | A second installable app will collide or require a migration story | High |
| R4 | CSP `null` and asset protocol `**` | Local-first today; unsafe to copy into multiple branded apps | High |
| R5 | Bridge convention is already broken | App-family work will duplicate I/O and error types | High |
| R6 | Collections tests red; view-modal timing may flake | No green baseline for PKM UI; no CI to catch drift | Medium |
| R7 | `cargo fmt --check` fails | Machine fast gates will fail until format is normalized | Medium |
| R8 | Crate-wide `allow(dead_code, unused_variables, unused_assignments)` (uncommitted) | Hides unused native surface that an app split must inventory | Medium |
| R9 | Main bundle 1.4 MB; plugins rebuild off the Vite hot path | Startup/performance budgets are undefined | Medium |
| R10 | No CI, no lint/format JS toolchain, no `docs/testing.md` until this baseline | Quality gates are tribal | Medium |
| R11 | Documentation still claims Phase 1/2 as current | Agents will implement the wrong task if they read `planning/old/` | Medium |
| R12 | Status-bar dual loading; stale `vite.plugins.config.ts` | Plugin manifests for sub-apps will be wrong if copied from either list | Medium |
| R13 | Duplicate help trees | App-specific help will fork | Low |
| R14 | Unsigned / all-platform bundle config | Distribution is unfinished; multi-app signing multiplies cost | Medium |

## Open decisions (do not invent)

1. Names, bundle IDs, and icons for each installable app
2. Which plugins are core-required vs app-default vs optional
3. Whether vault/settings migrate across apps
4. Whether users may add extra plugins to a focused app
5. Shared-core packaging (workspace crate, npm workspace, or git subtree)
6. Relative `app_folder` for `dm-software-machine` after the layout exists
