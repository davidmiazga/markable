---
title: "Advanced Lists — Polish & Completion: Master Blueprint"
last-updated: "2026-04-15"
review-cadence-days: 7
status: reference
---

# Advanced Lists — Polish & Completion: Master Blueprint

## Requirements Source

`docs/requirements/active_task.md` (2026-04-15)

## Stack Decision

No new technology is introduced. This feature uses the existing stack:

- **CodeMirror 6** (TypeScript) -- editor transactions, keymaps, updateListener
- **Tauri v2** (Rust) -- native menu items with accelerators
- **Vitest** -- unit and integration tests

Rationale: all five deliverables (keybindings, menu, status bar, settings dropdown, tests) are thin integration layers over the existing list engine. No new dependencies are needed.

## High-Level Architecture

### Data Flow

1. **Keybinding / Menu event** --> `switchListStyle(view, targetStyle)` in new file `src/editor/list-style-switch.ts`
2. `switchListStyle` reads the document, calls `findListBlockRange()` + `detectListLine()` + `markerTypeForDepth()` + `generateMarker()` from `list-engine.ts` (no modifications to engine)
3. Builds a single CM6 `TransactionSpec` with all marker replacements
4. Dispatches to `view.dispatch()` -- one undo step (NFR-1)

### Status Bar Data Flow

1. CM6 `EditorView.updateListener` fires on `docChanged || selectionSet`
2. Reads cursor line, calls `findListBlockRange()` + `inferListStyle()`
3. Updates the status bar right-zone text content

### Settings Data Flow

1. User selects new style from `<select>` dropdown in settings panel
2. `updateSettings()` persists `listStyle` field immediately
3. Next Enter/Tab in a list uses `getCurrentSettings().listStyle` as fallback (existing behavior)

## Component Map

### New Files

| File | Purpose |
|---|---|
| `src/editor/list-style-switch.ts` | `switchListStyle()` function + 3 keybinding handlers + status bar updateListener factory |
| `tests/list-style-switch.test.ts` | Unit tests for switchListStyle (all edge cases) |

### Modified Files

| File | Change |
|---|---|
| `src/editor/format.ts` | Add 3 entries to `formatKeymap` array (Alt-r, Alt-n, Alt-l) + import switchListStyle handlers |
| `src-tauri/src/menu.rs` | Add "List Style" submenu with 4 items inside Format > List |
| `src/main.ts` | Add 4 case branches in `handleAction()` for `format-list-style-*` menu events; wire status bar updateListener |
| `src/settings/settings-panel.ts` | Add "List Style" `<select>` section; sync in `syncPanelToSettings()` |
| `tests/list-engine.test.ts` | Add comment-override integration tests (additive only, FR-5) |

### Unchanged Files (NFR-2)

- `src/editor/list-engine.ts` -- stable, 474 lines, no modifications
- `src/editor/list-keybindings.ts` -- stable, 182 lines, no modifications

## Implementation Roadmap

### Step 1: Core Switching Logic + Unit Tests (TDD)

**File**: `step_01_switch-logic.md`

New file `src/editor/list-style-switch.ts` with the `switchListStyle(view, targetStyle)` function. Pure CM6 transaction builder. Test file `tests/list-style-switch.test.ts` with all edge cases.

**Edge cases covered**: EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-8, EC-9, EC-10, EC-14, EC-15, EC-16, EC-17, EC-18

### Step 2: Keybindings + Menu Integration

**File**: `step_02_keybindings-menu.md`

Register Alt-r/n/l in `formatKeymap`. Add Rust menu items. Wire `handleAction()` cases.

**Edge cases covered**: EC-1 (no-op on non-list), EC-10 (undo)

### Step 3: Status Bar Indicator

**File**: `step_03_status-bar.md`

Add an `EditorView.updateListener` that writes the inferred list style name to the status bar right zone. Wire it into main.ts alongside the editor creation.

**Edge cases covered**: EC-11, EC-12, EC-16

### Step 4: Settings Panel Dropdown

**File**: `step_04_settings-dropdown.md`

Add "List Style" section to settings-panel.ts with `<select>` dropdown.

**Edge cases covered**: EC-13

### Step 5: Comment Override Verification Tests

**File**: `step_05_comment-tests.md`

Additive tests in `tests/list-engine.test.ts` for the comment-override inference chain.

**Edge cases covered**: EC-6, EC-12

## Master Checklist

- [x] Step 1: `list-style-switch.ts` + `list-style-switch.test.ts` -- core logic
- [x] Step 2: Keybindings in `format.ts` + menu items in `menu.rs` + `handleAction()` cases in `main.ts`
- [x] Step 3: Status bar indicator (updateListener + DOM update)
- [x] Step 4: Settings panel dropdown
- [x] Step 5: Comment override integration tests

## Edge Case Traceability Matrix

| EC | Description | Step |
|----|-------------|------|
| EC-1 | Cursor not on list line | Step 1, Step 2 |
| EC-2 | Single-item list | Step 1 |
| EC-3 | Deeply nested (5+ levels) | Step 1 |
| EC-4 | Empty list items | Step 1 |
| EC-5 | Mixed depths with decimal-outline | Step 1 |
| EC-6 | Comment override already present | Step 1, Step 5 |
| EC-7 | Switching to same style | Step 1 |
| EC-8 | Alpha overflow (>26 items) | Step 1 |
| EC-9 | Roman numeral ambiguity | Step 1 |
| EC-10 | Undo after style switch | Step 1, Step 2 |
| EC-11 | Status bar on non-list line | Step 3 |
| EC-12 | Status bar with comment override | Step 3, Step 5 |
| EC-13 | Settings migration -- absent listStyle | Step 4 |
| EC-14 | Decimal outline parent chain | Step 1 |
| EC-15 | Bullet markers in steps style | Step 1 |
| EC-16 | Empty document / no list block | Step 1, Step 3 |
| EC-17 | Selection spans multiple list blocks | Step 1 |
| EC-18 | List block starts with comment line | Step 1 |

## Review Request

- **Files changed**: `tests/list-engine.test.ts` (7 new test cases appended), `docs/specs/advanced-lists/00_index.md` (Step 5 checked off, status set to reference)
- **Steps completed**: step_01_switch-logic.md, step_02_keybindings-menu.md, step_03_status-bar.md, step_04_settings-dropdown.md, step_05_comment-tests.md
- **Known limitations**: None. All 5 steps are complete.
- **Edge cases covered by tests**:
  - EC-6 (comment override already present): FR-5.1a, FR-5.1b verify that comment overrides marker inference; FR-5.1e verifies preceding comment wins over first-line comment
  - EC-12 (inferListStyle respects comment when markers look like a different style): FR-5.1b directly tests roman-upper markers with a "steps" comment override returning "steps"
  - Additional coverage: FR-5.1c (first-line comment), FR-5.1d (whitespace variations), FR-5.1f (invalid style falls through), FR-5.1g (non-list comment ignored)
