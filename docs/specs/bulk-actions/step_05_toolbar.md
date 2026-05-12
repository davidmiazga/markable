---
title: "Step 05 — Bulk Action Toolbar"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 05 — Bulk Action Toolbar

## Goal

Implement all toolbar DOM construction and sub-UI state machine in
`bulk-toolbar.ts`. This includes:

- `buildToolbar()` — constructs the initial toolbar DOM.
- `updateToolbar()` — shows/hides toolbar and syncs count label.
- `showMoveSubUi()` — expands move destination input.
- `showDeleteSubUi()` — expands delete confirmation.
- `showYamlSubUi()` — expands YAML form.
- `hideSubUi()` — collapses any active sub-UI and restores main buttons.

The toolbar does NOT execute operations — it delegates to the operation runners
from step_06 via callbacks.

---

## Dependency on Previous Steps

- step_01: `ToolbarRefs`, `SelectionState`, `OperationResult` types.
- step_02: CSS classes for toolbar and sub-UI elements.
- step_04: `SelectionState` (for reading `paths` count).

---

## Files to Modify

### `src/plugins/file-browser/folder-view/bulk-toolbar.ts`

Replace the stub file from step_01 with a full implementation.

#### `buildToolbar(selectionState, onMove, onDelete, onYaml): ToolbarRefs`

```typescript
/**
 * Build the sticky bulk-action toolbar DOM and wire button click handlers.
 *
 * The toolbar starts hidden (display:none). Call updateToolbar() after any
 * selection change to sync visibility and count.
 *
 * @param selectionState  - Shared selection state (read-only in this fn).
 * @param onMove          - Called with (destDir: string) when Confirm Move is clicked.
 * @param onDelete        - Called with no args when Confirm Delete is clicked.
 * @param onYaml          - Called with (op, key, value) when Apply is clicked.
 *                          op is "add" | "remove"; value is "" when op is "remove".
 * @returns ToolbarRefs holding references to live DOM nodes.
 *
 * Length justification: constructs seven distinct DOM sub-trees (count label,
 * move button, delete button, yaml button, move sub-UI, delete sub-UI, yaml
 * sub-UI) each with unique wiring. Splitting into sub-functions would require
 * threading ToolbarRefs across multiple factory boundaries with no clarity gain.
 */
export function buildToolbar(
  selectionState: SelectionState,
  onMove: (destDir: string) => Promise<void>,
  onDelete: () => Promise<void>,
  onYaml: (op: "add" | "remove", key: string, value: string) => Promise<void>,
): ToolbarRefs
```

Implementation requirements:

1. Root: `<div class="fv-bulk-toolbar" role="toolbar" aria-label="Bulk actions">`.
2. Count label: `<span class="fv-bulk-toolbar__count">0 selected</span>`.
3. Main buttons container: `<div>` containing three buttons:
   - Move button: `<button class="fv-bulk-toolbar__btn">Move</button>`
   - Delete button: `<button class="fv-bulk-toolbar__btn fv-bulk-toolbar__btn--danger">Delete</button>`
   - Apply YAML button: `<button class="fv-bulk-toolbar__btn">Apply YAML</button>`
4. Sub-UI container: `<div class="fv-bulk-subui">` (hidden initially).
5. Move button click: call `showMoveSubUi(refs, selectionState, onMove)`.
6. Delete button click: call `showDeleteSubUi(refs, selectionState, onDelete)`.
7. Apply YAML button click: call `showYamlSubUi(refs, selectionState, onYaml)`.
8. Return `ToolbarRefs` with all four references.

#### `updateToolbar(refs, selectionState)`

```typescript
/**
 * Sync toolbar visibility and count label with the current selection state.
 *
 * When selectionState.paths is empty: hide toolbar (remove --visible class).
 * When non-empty: show toolbar (add --visible class), update count label.
 * Also resets any active sub-UI: calls hideSubUi() when the selection becomes
 * empty (handles EC-16 indirectly via rebuildTbody clearing selection first).
 */
export function updateToolbar(
  refs: ToolbarRefs,
  selectionState: SelectionState,
): void
```

#### `showMoveSubUi(refs, selectionState, onMove)`

```typescript
/**
 * Replace main buttons with the move destination input sub-UI.
 *
 * Sub-UI contains:
 *   - A text input placeholder "Absolute destination folder path"
 *   - "Confirm Move" button (disabled until input is non-empty)
 *   - "Cancel" button
 *
 * Confirm Move click:
 *   1. Disable all buttons (State 7 — operation in progress).
 *   2. Call onMove(destDir).
 *   3. On return: re-enable buttons (caller shows result summary).
 *
 * Cancel click: call hideSubUi(refs).
 */
function showMoveSubUi(
  refs: ToolbarRefs,
  selectionState: SelectionState,
  onMove: (destDir: string) => Promise<void>,
): void
```

Implementation notes:
- Hide `refs.mainButtons` (`display:none` or remove from DOM temporarily via
  visibility class).
- Build sub-UI in `refs.subUi`: clear it, add `--visible` class.
- The input's `input` event: enable/disable Confirm Move based on value.
- Confirm Move: reads `input.value.trim()`, calls `onMove(value)`.
- After `onMove` resolves: re-enable buttons, clear sub-UI state.

#### `showDeleteSubUi(refs, selectionState, onDelete)`

```typescript
/**
 * Replace main buttons with delete confirmation sub-UI.
 *
 * Sub-UI contains:
 *   - Label: "Delete N item(s)? This cannot be undone."
 *   - "Confirm Delete" button (danger style)
 *   - "Cancel" button
 *
 * Confirm Delete click:
 *   1. Disable all buttons.
 *   2. Call onDelete().
 *   3. On return: re-enable buttons.
 *
 * Cancel click: call hideSubUi(refs).
 */
function showDeleteSubUi(
  refs: ToolbarRefs,
  selectionState: SelectionState,
  onDelete: () => Promise<void>,
): void
```

#### `showYamlSubUi(refs, selectionState, onYaml)`

```typescript
/**
 * Replace main buttons with YAML frontmatter form sub-UI.
 *
 * Sub-UI contains:
 *   - <select> with options "Add / update key" (value "add") and "Remove key"
 *     (value "remove").
 *   - Key <input> (plain text). Apply button disabled when empty (EC-14).
 *   - Value <input>: visible when op is "add", hidden when op is "remove".
 *   - "Apply" button (disabled when key input is empty).
 *   - "Cancel" button.
 *
 * The select's change event:
 *   - Shows/hides the value input.
 *   - Updates the disabled state of Apply if key is empty.
 *
 * Key input's input event:
 *   - Enables/disables Apply when key is non-empty / empty.
 *
 * Apply click:
 *   1. Disable all buttons.
 *   2. Call onYaml(op, key, value).
 *   3. On return: re-enable, restore main buttons.
 *
 * Cancel click: call hideSubUi(refs).
 */
function showYamlSubUi(
  refs: ToolbarRefs,
  selectionState: SelectionState,
  onYaml: (op: "add" | "remove", key: string, value: string) => Promise<void>,
): void
```

#### `hideSubUi(refs)`

```typescript
/**
 * Clear the sub-UI container and restore main buttons.
 *
 * Removes --visible class from subUi, clears its innerHTML,
 * and restores mainButtons visibility.
 */
function hideSubUi(refs: ToolbarRefs): void
```

#### `showResult(refs, summary, isError)`

```typescript
/**
 * Display an operation result summary in the toolbar sub-UI area.
 *
 * Creates a <div class="fv-bulk-result [fv-bulk-result--error]"> with the
 * summary text set via .textContent. Appended to refs.subUi.
 * Does NOT hide or modify mainButtons — the caller controls that.
 *
 * @param summary  - Human-readable result string (may be multi-line).
 * @param isError  - true → adds fv-bulk-result--error class.
 */
export function showResult(
  refs: ToolbarRefs,
  summary: string,
  isError: boolean,
): void
```

---

## Files to Create

### `tests/folder-view/bulk-toolbar.test.ts`

```typescript
/**
 * tests/folder-view/bulk-toolbar.test.ts
 *
 * Unit tests for buildToolbar(), updateToolbar(), and sub-UI transitions.
 * Covers FR-3, FR-4, FR-5, FR-6, States 1–8, EC-14.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildToolbar, updateToolbar, showResult } from
  "../../src/plugins/file-browser/folder-view/bulk-toolbar";
import { createSelectionState } from
  "../../src/plugins/file-browser/folder-view/bulk-selection";
```

Tests to implement:

| Test ID | Description |
|---|---|
| T-01 | Toolbar root has `role="toolbar"` and `aria-label="Bulk actions"` |
| T-02 | Toolbar is hidden when selectionState.paths is empty |
| T-03 | updateToolbar: hidden → visible when one path added to selection |
| T-04 | updateToolbar: count label shows "1 selected" for 1 item |
| T-05 | updateToolbar: count label shows "3 selected" for 3 items |
| T-06 | updateToolbar: toolbar hidden when paths cleared |
| T-07 | Main buttons: Move, Delete, Apply YAML all present |
| T-08 | Clicking Move shows destination input sub-UI |
| T-09 | Move sub-UI: Confirm Move is disabled when input is empty |
| T-10 | Move sub-UI: Confirm Move enabled after typing in input |
| T-11 | Move sub-UI: Cancel restores main buttons |
| T-12 | Move sub-UI: Confirm Move calls onMove with input value |
| T-13 | Delete sub-UI: shown when Delete clicked |
| T-14 | Delete sub-UI: label says "Delete N item(s)? This cannot be undone." |
| T-15 | Delete sub-UI: Cancel restores main buttons |
| T-16 | Delete sub-UI: Confirm Delete calls onDelete |
| T-17 | YAML sub-UI: shown when Apply YAML clicked |
| T-18 | YAML sub-UI: Apply disabled when key input is empty (EC-14) |
| T-19 | YAML sub-UI: Apply enabled after typing a key |
| T-20 | YAML sub-UI: value input hidden when "Remove key" selected |
| T-21 | YAML sub-UI: value input visible when "Add / update key" selected |
| T-22 | YAML sub-UI: Cancel restores main buttons |
| T-23 | YAML sub-UI: Apply calls onYaml with correct (op, key, value) |
| T-24 | showResult: creates .fv-bulk-result element with text content |
| T-25 | showResult: adds fv-bulk-result--error when isError=true |
| T-26 | Buttons disabled during operation (before onDelete/onMove resolves) |
| T-27 | Toolbar uses .textContent for count label (NFR-4 — no innerHTML) |

---

## Acceptance Criteria

1. All tests in `tests/folder-view/bulk-toolbar.test.ts` pass.
2. Toolbar root has `role="toolbar"` and `aria-label="Bulk actions"` (FR-8).
3. Toolbar is hidden (`display:none`) when selection is empty and visible when
   non-empty.
4. Count label correctly reflects `selectionState.paths.size`.
5. Sub-UI transitions correctly show/hide `mainButtons` and `subUi`.
6. Apply YAML button is disabled when key input is empty (EC-14).
7. All user-controlled text (count, result summary) uses `.textContent` (NFR-4).
8. `npm run test:run -- tests/folder-view/bulk-toolbar.test.ts` passes.

---

## Visibility Technique

Use CSS class toggling rather than direct `style.display` assignment for the
toolbar's shown/hidden state.  This avoids fighting with inline styles and
keeps the CSS rule authoritative.

- Hidden: `toolbar.classList.remove("fv-bulk-toolbar--visible")`.
- Visible: `toolbar.classList.add("fv-bulk-toolbar--visible")`.

The CSS rule (from step_02) renders `display:none` by default and
`display:flex` when `--visible` is present.

For `mainButtons` and `subUi`, direct `style.display` toggling is acceptable
since these are internal sub-components that never have external CSS applied.
