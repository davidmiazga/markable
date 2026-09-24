# Testing

Recorded 2026-09-22 from this machine. Do not copy counts from `planning/old/`.

## Frontend

```bash
npm exec -- tsc --noEmit
npm run test:run
npm run test:run -- tests/settings/window-defaults.test.ts
```

**Baseline:** 163 files, **4828 passed / 7 failed / 39 skipped** (Vitest 4.1.3, happy-dom).

Known red: `tests/collections/{css,home-canvas,renderer,stack-panel}.test.ts` (7 tests). Possibly flaky: `tests/view-modal/tab-switch.test.ts`.

Config: `vitest.config.ts` includes `tests/**/*.test.ts`.

Use `npm exec -- tsc`, not `npx tsc` (npx may download the dummy `tsc` npm package).

## Rust

```bash
cd src-tauri
cargo fmt --check    # currently fails (style only; do not auto-fix in baseline)
cargo check
cargo test
cargo clippy -- -D warnings
```

Source currently contains **212** `#[test]` items. Confirm with `cargo test` after the first compile finishes.

## Plugins

`src/plugins/**/*.ts` changes do not hot-reload.

```bash
npm run build:plugins && npm run sync:plugins
```

## Window size invariant

```bash
npm run test:run -- tests/settings/window-defaults.test.ts
```

If the window still launches wrong, on-disk `settings.json` overrides defaults. See `docs/specs/invariants/window-size-defaults.md`.
