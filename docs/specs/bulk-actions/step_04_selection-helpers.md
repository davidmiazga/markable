---
title: "Step 04 — Selection Helpers"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 04 — Selection Helpers

## Goal

Add all DOM helper functions for checkboxes to `bulk-selection.ts`. These are
pure DOM constructors — no Tauri calls, no toolbar references.

After this step the developer can build a checkbox `<td>`, build a master
checkbox `<th>`, and recalculate master checkbox state from the current
selection set.

---

## Dependency on Previous Steps

- step_01: `SelectionState` type and `createSelectionState()` must exist.
- step_02: CSS classes `.fv-th-checkbox`, `.fv-td-checkbox`, `.fv-row--selected`
  must exist in the bundle.

---

## Files to Modify

### `src/plugins/file-browser/folder-view/bulk-selection.ts`

Add the following functions after `createSelectionState`. All fit within 30
lines individually.

#### `buildCheckboxTd`

```typescript
/**
 * Build a <td> containing a row checkbox for one card.
 *
 * Clicking the cell or its checkbox:
 *   1. Stops event propagation (prevents the row click handler from firing).
 *   2. Updates selectionState.paths (adds or removes the card path).
 *   3. Updates the row's fv-row--selected class.
 *   4. Calls updateToolbar().
 *   5. Calls updateMasterCheckboxState() to sync the section master.
 *
 * @param card             - The FolderCard this row represents.
 * @param tr               - The <tr> element this cell belongs to.
 * @param selectionState   - Shared mutable selection state.
 * @param updateToolbar    - Callback to sync toolbar visibility/count.
 * @param masterCheckbox   - The section's master <input> for indeterminate sync.
 * @param sectionPaths     - All paths in this section (for master state calc).
 */
export function buildCheckboxTd(
  card: FolderCard,
  tr: HTMLTableRowElement,
  selectionState: SelectionState,
  updateToolbar: () => void,
  masterCheckbox: HTMLInputElement,
  sectionPaths: string[],
): HTMLTableCellElement
```

Implementation notes:
- Create `td` with classes `fv-td fv-td-checkbox`.
- Create `input` with `type="checkbox"`, `aria-label="Select ${card.name}"`.
- Register `kindMap` entry: `selectionState.kindMap.set(card.path, card.kind)`.
- The `change` event on `input`:
  1. `event.stopPropagation()`.
  2. If checked: `selectionState.paths.add(card.path)`.
  3. If unchecked: `selectionState.paths.delete(card.path)`.
  4. `tr.classList.toggle("fv-row--selected", input.checked)`.
  5. `updateToolbar()`.
  6. `updateMasterCheckboxState(masterCheckbox, sectionPaths, selectionState)`.
- The `click` event on `td` (not `input`): `event.stopPropagation()` only, to
  prevent the row `click` handler from opening the file when the user clicks
  the cell border. The actual checkbox toggle is handled by the `change` event.

#### `buildMasterCheckboxTh`

```typescript
/**
 * Build a <th> containing the section master checkbox.
 *
 * Clicking master-checked state: deselects all paths in sectionPaths.
 * Clicking master-unchecked or indeterminate state: selects all sectionPaths.
 *
 * @param sectionLabel   - Used for aria-label: "Select all ${sectionLabel}".
 * @param sectionPaths   - All paths in this section (determined at build time).
 * @param selectionState - Shared mutable selection state.
 * @param updateToolbar  - Callback to sync toolbar.
 * @param rowCheckboxes  - All row <input> elements in this section
 *                         (for visual sync when master is clicked).
 * @param rows           - All <tr> elements in this section
 *                         (for fv-row--selected class sync).
 * @returns Object with { th, masterInput } so the caller can
 *          pass masterInput to buildCheckboxTd calls.
 */
export function buildMasterCheckboxTh(
  sectionLabel: string,
  sectionPaths: string[],
  selectionState: SelectionState,
  updateToolbar: () => void,
  rowCheckboxes: HTMLInputElement[],
  rows: HTMLTableRowElement[],
): { th: HTMLTableCellElement; masterInput: HTMLInputElement }
```

Implementation notes:
- Create `th` with classes `fv-th fv-th-checkbox`.
- Create `input` with `type="checkbox"`, `aria-label="Select all ${sectionLabel}"`.
- The `change` event on `input`:
  1. `const selectAll = input.checked` (true = select all, false = deselect all).
  2. For each path in sectionPaths:
     - If `selectAll`: `selectionState.paths.add(path)`.
     - If `!selectAll`: `selectionState.paths.delete(path)`.
  3. Sync each row checkbox in `rowCheckboxes` to `selectAll`.
  4. Sync each row in `rows`: toggle `fv-row--selected` to `selectAll`.
  5. `input.indeterminate = false` (master is now definitively checked or unchecked).
  6. `updateToolbar()`.

#### `updateMasterCheckboxState`

```typescript
/**
 * Recalculate and set the visual state of the master checkbox after any
 * individual row checkbox change.
 *
 * Sets:
 *   - checked + not indeterminate → all section paths are in selectionState.paths
 *   - unchecked + not indeterminate → no section paths are in selectionState.paths
 *   - indeterminate → some but not all section paths are selected (FR-1)
 */
export function updateMasterCheckboxState(
  masterCheckbox: HTMLInputElement,
  sectionPaths: string[],
  selectionState: SelectionState,
): void
```

Implementation notes:
- Count how many of `sectionPaths` are in `selectionState.paths`.
- `selectedCount === 0`: `masterCheckbox.checked = false; masterCheckbox.indeterminate = false`.
- `selectedCount === sectionPaths.length`: `masterCheckbox.checked = true; masterCheckbox.indeterminate = false`.
- Otherwise: `masterCheckbox.checked = false; masterCheckbox.indeterminate = true`.

---

## Files to Create

### `tests/folder-view/bulk-selection.test.ts`

```typescript
/**
 * tests/folder-view/bulk-selection.test.ts
 *
 * Unit tests for SelectionState helpers.
 * Covers FR-1, FR-2, and checkbox propagation behavior.
 */

import { describe, it, expect, vi } from "vitest";
import {
  createSelectionState,
  buildCheckboxTd,
  buildMasterCheckboxTh,
  updateMasterCheckboxState,
} from "../../src/plugins/file-browser/folder-view/bulk-selection";
import type { FolderCard } from "../../src/plugins/file-browser/folder-view/types";
```

Tests to implement:

**createSelectionState:**

| Test ID | Description |
|---|---|
| SS-01 | Returns object with empty Set and empty Map |

**buildCheckboxTd:**

| Test ID | Description |
|---|---|
| SS-02 | Returns a `<td>` with classes `fv-td fv-td-checkbox` |
| SS-03 | Contains an `<input type="checkbox">` with `aria-label="Select noteName"` |
| SS-04 | Checking the input adds the path to selectionState.paths |
| SS-05 | Unchecking the input removes the path from selectionState.paths |
| SS-06 | Checking adds `fv-row--selected` to the `<tr>` |
| SS-07 | Unchecking removes `fv-row--selected` from the `<tr>` |
| SS-08 | Checking calls updateToolbar() |
| SS-09 | Click event on the `<td>` does NOT propagate (stopPropagation) |
| SS-10 | buildCheckboxTd registers card.kind in selectionState.kindMap |

**buildMasterCheckboxTh:**

| Test ID | Description |
|---|---|
| SS-11 | Returns `th` with classes `fv-th fv-th-checkbox` |
| SS-12 | Checking master adds all sectionPaths to selectionState.paths |
| SS-13 | Unchecking master removes all sectionPaths from selectionState.paths |
| SS-14 | Checking master sets all rowCheckboxes to checked=true |
| SS-15 | Unchecking master sets all rowCheckboxes to checked=false |
| SS-16 | Checking master adds `fv-row--selected` to all rows |
| SS-17 | Checking master calls updateToolbar() |
| SS-18 | masterInput has `aria-label="Select all Folders"` when sectionLabel is "Folders" |

**updateMasterCheckboxState:**

| Test ID | Description |
|---|---|
| SS-19 | 0 of N selected → checked=false, indeterminate=false |
| SS-20 | N of N selected → checked=true, indeterminate=false |
| SS-21 | k of N selected (0 < k < N) → checked=false, indeterminate=true |

---

## Acceptance Criteria

1. All tests in `tests/folder-view/bulk-selection.test.ts` pass.
2. `buildCheckboxTd` stops `click` propagation at the cell level.
3. `buildCheckboxTd` stops `change` propagation on the checkbox (does not
   bubble to the row).
4. `updateMasterCheckboxState` sets `indeterminate=true` for partial selection.
5. Master checkbox change selects/deselects all paths, syncs all row visuals,
   and calls `updateToolbar()`.
6. `npm run test:run -- tests/folder-view/bulk-selection.test.ts` passes.

---

## Required Import in bulk-selection.ts

```typescript
import type { FolderCard } from "./types";
```

This is the only external import needed. `FolderCard` is in the same bundle
directory.
