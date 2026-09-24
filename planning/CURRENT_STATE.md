# Current state (verified 2026-09-22)

## Repository identity

Work from **this directory** (`markable/`). The parent `jobWorking/` folder is not a Git repository.

| Item | Value |
|---|---|
| Remote | `https://github.com/davidmiazga/markable.git` |
| GitHub `origin/main` | `7c0bcef` — *Ignore Claude local settings that may contain API keys.* |
| Local `main` | `bd95f5e` — one commit **ahead** of origin (`package-lock.json` only) |
| Dirty tree | `src-tauri/src/lib.rs` adds `#![allow(dead_code, unused_variables, unused_assignments)]` |
| Workspace siblings (not in this repo) | `jobWorking/app-icon/`, `jobWorking/com.markable.app/`, `jobWorking/FeaturesList-v1.0.md` |

Do not initialize Git at `jobWorking/`. Do not discard the local commit or the `lib.rs` suppression without an explicit decision.

## Toolchain

| Tool | Version |
|---|---|
| Node | v26.8.1 |
| npm | 11.19.0 |
| rustc / cargo | 1.98.0 (Homebrew) |
| TypeScript | ~5.6.2 (project) |
| Vite / Vitest | 6.4.3 / 4.1.3 |
| Tauri | 2.x |

## Verification matrix

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm exec -- tsc --noEmit` | Pass |
| Frontend production | `npm run build` | Pass. Main JS chunk **1,417 kB** (gzip 410 kB). Vite warns about a static+dynamic import of `collections/commands.ts`. |
| Vitest | `npm run test:run` | **4828 passed, 7 failed, 39 skipped** (163 files, 34.07s) |
| Rust fmt | `cargo fmt --check` (in `src-tauri/`) | Fail — formatting drift in many command/menu files. Not auto-fixed. |
| Rust check | `cargo check` | Pass (~1m 53s first compile) |
| Rust tests | `cargo test` | **212 passed**, 0 failed |
| Rust clippy | `cargo clippy -- -D warnings` | Fail — 18 lints (`needless_borrow`, `needless_borrows_for_generic_args`, `redundant_closure`, and similar). |
| Plugin IIFE | `npm run build:plugins` | Not re-run this session (heavy; 20 entries in `scripts/build-plugins.mjs`). |
| Signed / DMG Tauri build | `CI=true npm run tauri build` | Not run. No `signingIdentity` in `tauri.conf.json`. Phase 1 distribution scripts named in old checklists are missing. |

### Vitest failures (authoritative)

All seven failures are Collections UI tests:

- `tests/collections/css.test.ts` — catalog completeness
- `tests/collections/home-canvas.test.ts` — three popover / `+` affordance cases
- `tests/collections/renderer.test.ts` — `+Note` incremental insert
- `tests/collections/stack-panel.test.ts` — trailing `+Note` and click handler

An earlier exploratory run also failed `tests/view-modal/tab-switch.test.ts` (timing). That test **passed** on the authoritative rerun. Treat it as flaky until proven otherwise.

### npm audit (informational)

`npm install` reported 3 vulnerabilities (2 moderate, 1 high). Not investigated this milestone.

## Product metadata (inconsistent)

| Surface | Value |
|---|---|
| `package.json` / Cargo / Tauri | `0.1.0` |
| Docs / CLAUDE.md | “Markable 2.0” |
| Bundle id | `com.markable.app` |
| Cargo authors | `"you"` |
| Tauri bundle targets | `"all"` while behavior is macOS-first |

## Last-known active work (docs, not verified complete)

`docs/requirements/active_task.md` (2026-06-09): Collections Chapter/Book hierarchy, drag-into-container, composite content views. Spec handoff `docs/specs/collections-hierarchy/` is **missing**. `docs/specs/collections/00_index.md` still describes the MVP as complete and still says `status: active`.
