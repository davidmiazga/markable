---
title: "Insert Count Plugin — Master Blueprint"
last-updated: "2026-04-20"
review-cadence-days: 14
status: active
---

# Insert Count Plugin (FC2 #15) — Architecture Blueprint

## Overview

Insert Count is a toggleable core plugin that inserts an auto-incrementing numeric sequence at multiple cursor positions or across selected lines in a single CM6 transaction. It is a purely imperative command plugin — no CM6 extensions are registered. All behavior is triggered by the `"edit-insert-count"` action dispatched through `handleAction()`.

---

## Requirement Source

`docs/requirements/active_task.md` — validated 2026-04-20.

---

## Keyboard Shortcut Conflict Check

`Cmd-Shift-3` was searched across `src/keybindings/keybindings-panel.ts` and `src-tauri/src/menu.rs`.

- `Cmd-3` is bound to `tab-3` (switch to Tab 3), but `Cmd-Shift-3` is not bound.
- No conflict found in the COMMANDS array or in the Rust menu construction.
- `Cmd-Shift-3` is confirmed free. The assignment in FR-07.1 is approved.

---

## Architecture Decisions

### AD-01: No CM6 Extensions
The plugin does not call `api.addExtensions()`. All logic is imperative, triggered on command invocation. This satisfies NFR-03 and keeps the compartment clean when the feature is unused.

### AD-02: Inline Overlay Dialog (not centered modal)
The Count Dialog is an absolutely positioned `<div>` appended to `document.body`, anchored near the cursor using `view.coordsAtPos(view.state.selection.main.head)`. This matches the resolved decision UK-01 and is consistent with the VS Code inline palette pattern.

### AD-03: Global Registration Pattern
Mirrors `__MARKABLE_COMMAND_BAR_OPEN__`. On `onEnable`, the plugin writes `window.__MARKABLE_INSERT_COUNT_OPEN__ = openDialog`. On `onDisable`, it sets this to `null`. `handleAction` in `main.ts` delegates through this global.

### AD-04: Single-Transaction Insertion
All insertions for one invocation are collected into a `changes` array and applied in a single `view.dispatch({ changes })` call. CM6's `ChangeSet` handles offset collision for multi-cursor same-line cases (EC-23) — no manual offset arithmetic is required.

### AD-05: Three Insertion Modes
Mode resolution priority: Multi-cursor (A) → Selection spanning multiple lines (B) → Single cursor / single-line selection (C). Mode B uses cursor column alignment per FR-03.3 (resolved decision UK-02).

### AD-06: Settings Persistence
Three keys: `{ start: number, step: number, wrap: string }`. Loaded in `onEnable`, saved on successful Insert only (not on Cancel). Null from `loadSettings` triggers hardcoded defaults: start=1, step=1, wrap="".

### AD-07: Wrap-String Substitution
Uses `String.prototype.replaceAll("__COUNTER__", value)`. If the wrap string contains no `__COUNTER__` token, the number is appended: `wrap + value`. If wrap is empty, bare number string only. Implemented per FR-03.6 and EC-12.

### AD-08: Focus Trap
Tab key cycles between the three inputs and the two buttons only while the dialog is open. Escape always closes/cancels (EC-18). Focus returns to the editor on close via `__MARKABLE_EDITOR_VIEW__.focus()`.

### AD-09: Post-Insertion Cursor
After insertion, the selection is collapsed to immediately after the last inserted string (FR-03.5). Implemented by including a `selection` property in the dispatch call.

---

## System Decomposition

### New Files

| File | Purpose |
|---|---|
| `src/plugins/insert-count/insert-count.plugin.ts` | Main plugin IIFE entry point |
| `tests/plugins/insert-count/insert-count.test.ts` | Vitest unit tests |

### Modified Files

| File | Change |
|---|---|
| `src/keybindings/keybindings-panel.ts` | Add `edit-insert-count` to COMMANDS array |
| `src/main.ts` | Add `"edit-insert-count"` case in `handleAction` switch |
| `src-tauri/src/menu.rs` | Add "Insert Count..." item in Edit menu |
| `scripts/build-plugins.mjs` | Add `insert-count` to PLUGINS array |

---

## Data Flow

```
User invokes Cmd-Shift-3 (or Edit menu / Command Bar)
  → resolveAction() matches "edit-insert-count"
  → handleAction("edit-insert-count")
  → window.__MARKABLE_INSERT_COUNT_OPEN__()
  → openDialog() — builds overlay DOM, positions near cursor
  → User fills Start / Step / Wrap, clicks Insert or presses Enter
  → validateInputs() — returns InsertCountConfig if valid
  → api.saveSettings({ start, step, wrap })
  → resolveInsertionPositions(view.state) → InsertionPosition[]
  → buildChanges(positions, config) → ChangeSpec[]
  → view.dispatch({ changes, selection })
  → closeDialog() → view.focus()
```

---

## Key Types (defined in plugin file)

```typescript
interface InsertCountSettings {
  start: number;   // default: 1
  step: number;    // default: 1
  wrap: string;    // default: ""
}

interface InsertionPosition {
  offset: number;  // document offset at which to insert
  index: number;   // 0-based sequence index (formatted value = start + index * step)
}
```

---

## Implementation Phases

| Step | File | Contents | Edge Cases Covered |
|---|---|---|---|
| 01 | `step_01_plugin-scaffold.md` | Plugin file skeleton, lifecycle hooks, settings load/save, CSS injection, global registration | EC-25, EC-26, EC-20 |
| 02 | `step_02_dialog-ui.md` | Count Dialog DOM construction, positioning, validation, focus trap, keyboard handling | EC-08, EC-13 through EC-19 |
| 03 | `step_03_insertion-logic.md` | Three insertion modes, change collection, single-dispatch, post-insertion cursor | EC-03 through EC-07, EC-22 through EC-24, EC-27 |
| 04 | `step_04_integration.md` | handleAction case, Edit menu item, COMMANDS entry, build-plugins entry | EC-01, EC-02 |
| 05 | `step_05_tests.md` | Full Vitest test suite covering all 27 edge cases | All EC-01 through EC-27 |

---

## Implementation Checklist

### Step 01 — Plugin Scaffold
- [x] Create `src/plugins/insert-count/insert-count.plugin.ts`
- [x] Define `InsertCountSettings` type
- [x] Implement `onEnable`: load settings, inject CSS, register global
- [x] Implement `onDisable`: close open dialog, remove CSS, null global
- [x] Verify CSS style tag injection is idempotent (guarded by element ID)
- [x] Verify `window.__MARKABLE_INSERT_COUNT_OPEN__` is set/cleared correctly

### Step 02 — Dialog UI
- [x] Implement `openDialog(view)` — builds overlay DOM, appends to `document.body`
- [x] Implement cursor-relative positioning via `view.coordsAtPos(...)`
- [x] Implement three labelled inputs: "Start at", "Count by", "Wrap with"
- [x] Implement inline validation errors for Start (non-integer, empty) and Step (non-integer, zero)
- [x] Implement Insert button disabled state when validation fails
- [x] Implement focus trap (Tab cycles inputs + buttons)
- [x] Implement Escape → cancel (EC-18)
- [x] Implement Enter → submit (EC-17)
- [x] Implement click-outside → cancel
- [x] Implement double-open guard via `__MARKABLE_INSERT_COUNT_OPEN__` flag (EC-19)
- [x] All CSS uses CSS variables; no hardcoded hex (NFR-04)

### Step 03 — Insertion Logic
- [x] Implement `resolveInsertionPositions(state)` returning `InsertionPosition[]` sorted by `offset` ascending
- [x] Mode A: multiple selection ranges — one position per range `from`
- [x] Mode B: single selection spanning multiple lines — one position per covered line at cursor column (or line end if shorter)
- [x] Mode C: single cursor — one position at cursor
- [x] Implement `formatValue(start, step, wrap, index)` using `replaceAll`
- [x] Implement `buildChanges(positions, config)` returning CM6 `ChangeSpec[]`
- [x] Single `view.dispatch({ changes, selection })` call
- [x] Post-insertion: selection collapsed after last inserted string
- [x] Read-only guard: check `view.state.readOnly` before dispatching (EC-27)

### Step 04 — Integration
- [x] Add `"edit-insert-count"` case to `handleAction` in `src/main.ts`
- [x] Add alert fallback when `__MARKABLE_INSERT_COUNT_OPEN__` is null (EC-02)
- [x] Add `{ id: "edit-insert-count", label: "Insert Count", defaultKey: "Cmd-Shift-3", section: "Edit" }` to COMMANDS in `src/keybindings/keybindings-panel.ts`
- [x] Add `MenuItem::with_id(handle, "edit-insert-count", "Insert Count...", true, Some("CmdOrCtrl+Shift+3"))` to Edit menu in `src-tauri/src/menu.rs`
- [x] Add `["insert-count", "src/plugins/insert-count/insert-count.plugin.ts"]` to PLUGINS in `scripts/build-plugins.mjs`
- [x] Verify Cmd-Shift-3 shortcut displays correctly in Edit menu (macOS accelerator format)

### Step 05 — Tests
- [x] EC-01 through EC-27 covered (see step_05_tests.md for per-case breakdown)
- [x] `formatValue` pure function — unit tested in isolation
- [x] `resolveInsertionPositions` — unit tested with mocked CM6 state
- [x] Dialog validation — DOM-based tests with jsdom
- [x] Single-transaction assertion (changes array length)
- [x] All tests pass: `npm test` with no skipped cases in this suite

---

## Review Request

- **Files changed**:
  - `src/plugins/insert-count/insert-count.logic.ts` (new) — pure logic functions and shared types
  - `src/plugins/insert-count/insert-count.plugin.ts` (new) — IIFE plugin: scaffold, dialog UI, lifecycle hooks
  - `tests/plugins/insert-count/insert-count.test.ts` (new) — 44 Vitest tests across 6 groups
  - `src/keybindings/keybindings-panel.ts` (modified) — added `edit-insert-count` to COMMANDS array
  - `src/main.ts` (modified) — added `"edit-insert-count"` case in handleAction switch
  - `src-tauri/src/menu.rs` (modified) — added "Insert Count..." item in Edit menu
  - `scripts/build-plugins.mjs` (modified) — added `insert-count` to PLUGINS array

- **Steps completed**: step_01_plugin-scaffold.md, step_02_dialog-ui.md, step_03_insertion-logic.md, step_04_integration.md, step_05_tests.md

- **Known limitations**:
  - EC-17 (Enter key), EC-18 (Escape), EC-19 (double-open guard), EC-20 (disable while open), EC-21 (tab switch), EC-25 (null settings) are covered by code review / structural analysis rather than DOM-based tests. The spec (step_05) marks these as "Manual" — no automated DOM-interaction tests were requested for the dialog event handlers.
  - EC-02 (plugin disabled alert) is verified by code review of the handleAction case; no automated test exists for the alert() path per step_05.

- **Edge cases covered by tests**:

| EC | Test(s) |
|---|---|
| EC-01 | Group F: "returns immediately when view is null" |
| EC-02 | Manual — handleAction case in main.ts shows alert when global is null |
| EC-03 | Group B: "Mode C: single bare cursor returns one position" |
| EC-04 | Group B: "Mode A: 3 cursors return 3 positions sorted ascending" |
| EC-05 | Group F: "calls dispatch exactly once regardless of cursor count" |
| EC-06 | Group B: "Mode B: 4 lines" + "Mode B: inserts at cursor column" |
| EC-07 | Group B: "Mode C: single-line selection treated as single cursor" |
| EC-08 | Group E: "reports error for step=0" |
| EC-09 | Group A: "handles negative step correctly" + Group E: "accepts negative step" |
| EC-10 | Group A: "appends number after wrap string when no __COUNTER__ token" |
| EC-11 | Group A: "replaces __COUNTER__ token with number" |
| EC-12 | Group A: "replaces ALL occurrences of __COUNTER__ (replaceAll)" |
| EC-13 | Group E: "reports error for non-integer start" |
| EC-14 | Group E: "reports error for non-integer step" |
| EC-15 | Group E: "reports 'Required' for empty start" |
| EC-16 | Group F: structural guarantee documented — applyInsertions not called on cancel |
| EC-17 | Manual — dialog keydown listener calls doInsert() on Enter key |
| EC-18 | Manual — dialog keydown listener calls closeDialog(false) on Escape |
| EC-19 | Manual — openDialog() returns early and focuses existing dialog when dialogOpen is true |
| EC-20 | Manual — onDisable() calls closeDialog(false) when dialogEl is non-null |
| EC-21 | Manual — dialog is fixed-position on document.body, independent of tab DOM |
| EC-22 | Group C: "produces 200 change specs for 200 positions without error" + Group F: "handles 200 cursor positions in a single transaction" |
| EC-23 | Group B: "Mode A: two cursors on same line produce two positions" |
| EC-24 | Group A: "handles very large start values without truncation" |
| EC-25 | Manual — onEnable null-safety checks verified by code review |
| EC-26 | Group F: "dispatch is called even when saveSettings rejects" |
| EC-27 | Group F: "skips dispatch for read-only editor" |
