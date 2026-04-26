---
title: "Auto-Save Plugin — Architecture Blueprint"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Auto-Save Plugin — Architecture Blueprint

## Overview

The Auto-Save plugin is a self-contained IIFE core plugin that saves the active tab
automatically on a user-configurable trigger. It reuses the existing save infrastructure
(`__MARKABLE_TAB_MANAGER__.saveActiveTab()`) with no new Rust commands. The plugin
is **disabled by default** and exposes all configuration through `renderDetailExtra`
in the Plugins Panel detail view.

The design is intentionally the simplest possible plugin that satisfies the requirements:
no StateField, no sidebar panel, no status bar indicator (FR-07.1 explicitly out of scope).
The debounce timer lives entirely in plugin-private module state. The blur handler is a
named function stored in a module-level `let` variable so `removeEventListener` can
remove exactly the instance attached in `onEnable`.

---

## Stack Decision

No new technology decisions required. The plugin uses:

- **TypeScript + Vite IIFE build** — consistent with all other core plugins.
- **CM6 `EditorView.updateListener`** — the same primitive used by `word-count.plugin.ts`
  for debounce-on-document-change. Proven pattern in this codebase.
- **`window "blur"` event** — standard DOM API; no library needed.
- **`api.loadSettings()` / `api.saveSettings()`** — existing plugin settings API.
- **`api.restartSelf()`** — existing mechanism for mode-change teardown/rebuild.

---

## Data Flow

```
[User types]
    → CM6 transaction (docChanged) fires updateListener
    → clearTimeout(pendingTimer); pendingTimer = setTimeout(attemptSave, delay)
    → [delay ms of inactivity]
    → attemptSave()
        → getActiveTab() → null? skip (EC-07, EC-15)
        → filePath === null? skip (EC-01, FR-04.3)
        → isDirty === false? skip (EC-02, FR-04.4)
        → __MARKABLE_TAB_MANAGER__.saveActiveTab()

[Window loses focus]
    → blurHandler()
    → (same attemptSave logic as above)
```

---

## Component Map

### New Files

| File | Purpose |
|---|---|
| `src/plugins/auto-save/auto-save.plugin.ts` | Plugin entry point (IIFE scaffold, onEnable, onDisable, renderDetailExtra) |
| `tests/plugins/auto-save/auto-save.test.ts` | Vitest unit tests |

### Modified Files

| File | Change |
|---|---|
| `vite.plugins.config.ts` | Add `pluginConfig("auto-save", ...)` entry to the exported array |

### No Rust Changes

No Tauri commands are added. The plugin calls `__MARKABLE_TAB_MANAGER__.saveActiveTab()`
which routes through the existing `write_file` command in `src-tauri/src/commands/files.rs`.

---

## Module-Level State (private to the IIFE closure)

```typescript
// Settings (populated in onEnable, kept in sync by UI handlers)
let _settings: AutoSaveSettings = { triggerMode: "both", debounceDelayMs: 2000 };

// Runtime guards
let _active = false;                     // EC-10: async onEnable continuation guard
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _blurHandler: (() => void) | null = null;  // named ref for removeEventListener

// Plugin API reference (needed by blurHandler which closes over it at onEnable time)
let _api: MarkablePluginAPI | null = null;
```

---

## Key Design Decisions

**AD-1: `_active` flag placement** — Set to `true` at the top of `onEnable` (before
the `await loadSettings()`) and to `false` at the top of `onDisable`. After `await`,
the continuation checks `_active` before attaching any listener or timer. This covers
EC-10 without any additional bookkeeping.

**AD-2: Named blur handler stored in `_blurHandler`** — The blur handler is constructed
fresh in each `onEnable` call (it reads `_settings` and `_api` via closure), stored as
`_blurHandler`, and the same reference is passed to both `addEventListener` and
`removeEventListener`. This satisfies the constraint in `active_task.md` (named function
reference) while accommodating the fact that the handler needs to close over state that
does not exist at module evaluation time.

**AD-3: Debounce timer is plugin-global, not per-tab** — FR-03.4 requires a single
timer. Each `docChanged` event clears the previous timer and starts a fresh one. This
naturally satisfies EC-03 (rapid typing resets debounce) and EC-04 (manual Cmd-S leaves
the tab clean so the timer fires and skips).

**AD-4: `attemptSave()` is a shared helper** — Both the debounce timer callback and the
blur handler call the same `attemptSave()` function. This eliminates duplication and
ensures both paths apply identical guards (filePath, isDirty).

**AD-5: Delay change does not require restart** — `_settings.debounceDelayMs` is updated
in-memory immediately when the user changes the input. The next `clearTimeout /
setTimeout` call in the updateListener reads the current value of `_settings`. No restart
is needed for delay-only changes (FR-06.4, FR-03.4).

**AD-6: `renderDetailExtra` reads current `_settings`** — Because the container is
freshly created each time the detail panel is opened, the controls are always seeded
from the current in-memory `_settings`. No stale-value problem.

**AD-7: Debounce delay input clamping** — Clamping happens in `clampDelay()`, a pure
helper. It is called when reading from settings (load path) and when reading user input
(change handler path). EC-12 requirement: the UI input is corrected on blur (the change
handler fires on `"change"`, not `"input"`, so it only fires when the user commits the
value, i.e., on blur or Enter).

---

## Implementation Steps

- [x] **Step 1 — Plugin scaffold**: Create `auto-save.plugin.ts` with full IIFE
      structure, plugin descriptor, settings type, defaults, `onEnable` / `onDisable`
      stubs (no logic yet), and `renderDetailExtra` stub. Update `vite.plugins.config.ts`.
      Verify `npm run build:plugins` succeeds with the new entry.

- [x] **Step 2 — Core logic**: Implement `attemptSave()`, the CM6 `updateListener`
      extension, the `blurHandler`, and the full `onEnable` / `onDisable` bodies
      including the `_active` flag guard, timer cleanup, and listener cleanup.

- [x] **Step 3 — Settings UI**: Implement `renderDetailExtra` with the trigger dropdown
      and debounce delay numeric input. Wire `api.restartSelf()` on mode change and
      in-memory + persisted update on delay change. Apply `--ui-font` CSS variable.

- [x] **Step 4 — Tests**: Write `tests/plugins/auto-save/auto-save.test.ts` covering
      all EC numbers. Export the pure helpers (`attemptSave`, `clampDelay`,
      `loadAndMergeSettings`) from the plugin module for isolated unit testing.

---

## Dependency Notes

- `vite.plugins.config.ts` must be updated before step 1 is considered done; the build
  must pass before step 2 begins.
- Steps 2, 3, and 4 are independent once step 1 is complete; they may be implemented
  in any order, though 2 then 3 then 4 is the natural sequence.
- No changes to `src/plugins/index.ts` or `src-tauri/src/commands/plugins.rs` are needed.
  `copy_core_plugins` already cleans up stale `.js` files; `auto-save.js` will simply
  appear in the core plugins directory after the first `npm run build:plugins`.

---

## Known Limitations / Exceptions

1. **EC-14 (app quit with pending timer)**: The Tauri `CloseRequested` handler in
   `TabManager` already presents a "Save / Don't Save / Cancel" dialog. The debounce
   timer has not fired yet at quit time (the OS typically kills the process immediately
   after the user confirms quit), so the existing quit-time confirmation remains intact.
   No special handling is needed in the plugin.

2. **EC-16 (blur from native dialog)**: Opening a Save-As dialog fires `window "blur"`.
   For a named dirty tab this produces a redundant `saveActiveTab()` call, which is
   atomic and idempotent. Acceptable for v1 per the requirements doc.

3. **EC-08 (save write failure)**: The plugin does not add its own error UI. The existing
   `alert()` inside `TabManager.saveActiveTab()` surfaces write errors. This is by design.

4. **No status bar indicator**: FR-07.1 explicitly removes a status bar indicator from v1
   scope. The plugin does not call `api.ensureStatusBar()` or `api.registerStatusBarDependent()`.

---

## Review Request

- **Files changed**:
  - `src/plugins/auto-save/auto-save.plugin.ts` (created)
  - `tests/plugins/auto-save/auto-save.test.ts` (created)
  - `scripts/build-plugins.mjs` (modified — auto-save entry added to PLUGINS array)
  - `vite.plugins.config.ts` (modified — auto-save entry added; this file is a legacy config that is not invoked by the build system but is kept in sync for reference)
  - `docs/specs/auto-save/00_index.md` (this file — steps checked off)

- **Steps completed**:
  - `step_01_plugin_scaffold.md` — IIFE scaffold, settings types, module-level state, pure helpers, stubs, build entry
  - `step_02_core_logic.md` — `attemptSave`, `autoSaveListener`, full `onEnable`/`onDisable` with `_active` guard
  - `step_03_settings_ui.md` — `renderDetailExtra`, `buildTriggerRow`, `buildDelayRow`, CSS inject/remove
  - `step_04_tests.md` — 39 tests, all passing

- **Known limitations**:
  - `clampDelay(null)` spec: the spec states "non-numeric input falls back to 2000" but `Number(null) === 0` which is technically finite. Implementation adds an explicit `null`/`undefined` guard before the `Number()` conversion to satisfy the spec intent. Documented in the function's JSDoc comment.
  - Steps 1–3 were implemented together (scaffold + full logic + settings UI in one pass) rather than strictly sequentially, because all three implementation phases were well-specified and the stubs were replaced during the same implementation session. The build was verified after the initial scaffold, before the logic was filled in.
  - EC-14 (app quit with pending timer), EC-16 (blur from native dialog), and EC-08 (write failure) are not unit-testable and are documented in "Known Limitations / Exceptions" above.
  - EC-06 test added in Group 6 (re-review fix): blur fires via `window.dispatchEvent(new Event("blur"))` in "both" mode; verifies exactly one save and that a subsequent timer advance finds `isDirty: false` and skips.
  - `vite.plugins.config.ts` re-synced with `scripts/build-plugins.mjs` (re-review fix): 14 plugins, no stale entries.

- **Edge cases covered by tests**:
  - EC-01: Group 3 — "skips when tab is untitled (filePath === null)"
  - EC-02: Group 3 — "skips when tab is clean (isDirty === false)"
  - EC-03: Group 5 — rapid series of attemptSave calls + timer reset pattern
  - EC-04: Group 5 — "save is skipped when tab becomes clean between timer start and fire"
  - EC-05: Group 6 — "onDisable calls removeExtensions"
  - EC-06: Group 6 — "blur fires while debounce pending — saves once, timer finds clean tab and skips" (tests blur handler integration in "both" mode + isDirty guard preventing double-write)
  - EC-07: Group 3 — "skips when getActiveTab returns null"
  - EC-08: n/a — delegated to TabManager; no plugin test needed
  - EC-09: Group 2 + Group 6 — "returns full defaults when raw is null"; "onEnable loads settings with defaults on null"
  - EC-10: Group 6 — "EC-10: onDisable called before settings load resolves — no listeners attached"
  - EC-11: Group 6 — mode routing tests (debounce / focus-loss / both variants)
  - EC-12: Group 1 — "clamps to 500 when input is below minimum"; boundary tests at 499, 500, 30000
  - EC-13: Group 6 — "rapid enable/disable cycles leave no stale blur listeners"; reference equality check
  - EC-14: n/a — OS-level quit behaviour; not unit-testable
  - EC-15: Group 3 — "warns and skips when __MARKABLE_TAB_MANAGER__ is undefined/null"
  - EC-16: n/a — acceptable v1 behaviour; no test required

---

## Review Sign-off

- **Date**: 2026-04-21
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 2 Low — both Low items are documentation clarity notes, no code changes required; accepted
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified. FR-01 through FR-08, NFR-01 through NFR-05 all satisfied by the implementation.
- **Edge case coverage**: All EC-01 through EC-16 items covered by tests or documented as not unit-testable (EC-08, EC-14, EC-16) with written rationale in Known Limitations.
- **Status**: Approved for Merge
