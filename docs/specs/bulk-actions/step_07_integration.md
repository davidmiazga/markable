---
title: "Step 07 — Integration into table-renderer.ts"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Step 07 — Integration into table-renderer.ts

## Goal

Wire everything into `table-renderer.ts`. This is the only step that modifies
the existing renderer. All new logic calls helper modules built in steps 03–06.
No helper logic lives in `table-renderer.ts` itself.

After this step the full feature is complete and all acceptance criteria from
`docs/requirements/active_task.md` are met.

---

## Dependency on Previous Steps

All prior steps must be complete and passing before beginning step_07:
- step_01: All four helper modules exist with correct types.
- step_02: CSS classes exist in bundle.
- step_03: YAML parser/writer working and tested.
- step_04: Checkbox DOM helpers working and tested.
- step_05: Toolbar DOM and sub-UIs working and tested.
- step_06: Operation runners working and tested.

---

## Files to Modify

### `src/plugins/file-browser/folder-view/table-renderer.ts`

There are five distinct change sites. Each is described below with the exact
function/location where the change goes.

---

### Change 1 — New imports at the top of the file

Add the following imports after the existing imports block:

```typescript
import { createSelectionState, buildCheckboxTd, buildMasterCheckboxTh }
  from "./bulk-selection";
import type { SelectionState } from "./bulk-selection";
import { buildToolbar, updateToolbar, showResult }
  from "./bulk-toolbar";
import { executeBulkMove, executeBulkDelete, executeBulkYaml, formatOperationResult }
  from "./bulk-operations";
```

---

### Change 2 — `renderFolderTable`: create SelectionState and toolbar

In `renderFolderTable`, immediately after creating `host` and before the
description block logic, add:

```typescript
// ── Bulk selection + toolbar ──────────────────────────────────────────────
const selectionState: SelectionState = createSelectionState();

const toolbarRefs = buildToolbar(
  selectionState,
  async (destDir) => {
    const result = await executeBulkMove(selectionState, destDir);
    const summary = formatOperationResult(result, "Moved");
    showResult(toolbarRefs, summary, result.failed.length > 0);
    if (result.succeeded > 0) {
      (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
    }
  },
  async () => {
    const result = await executeBulkDelete(selectionState);
    const summary = formatOperationResult(result, "Deleted");
    showResult(toolbarRefs, summary, result.failed.length > 0);
    if (result.succeeded > 0) {
      (window as any).__MARKABLE_TAB_MANAGER__?.refreshLayoutView?.();
    }
  },
  async (op, key, value) => {
    const yamlResult = await executeBulkYaml(
      selectionState, op, key, value, [...dirCards, ...fileCards],
    );
    const summary = formatOperationResult(
      yamlResult, "Processed", yamlResult.skippedCount,
    );
    showResult(toolbarRefs, summary, yamlResult.failed.length > 0);
    // FR-6: no re-render after YAML apply.
  },
);

// Toolbar is first child of host (FR-3).
host.appendChild(toolbarRefs.toolbar);
```

The `updateToolbar` function that each checkbox needs is a closure over
`toolbarRefs`:

```typescript
const syncToolbar = () => updateToolbar(toolbarRefs, selectionState);
```

Pass `syncToolbar` down to both `buildSectionTable` calls in place of the
current (absent) callback parameter.

**Note on card variable availability:** The `dirCards` and `fileCards` locals
from the body of `renderFolderTable` are already in scope at the toolbar
construction site. However, the YAML operation needs this list at invocation
time (after the user clicks Apply), not at construction time. Since `dirCards`
and `fileCards` are `const` references to arrays constructed in `renderFolderTable`
and do not change for the lifetime of this render, capturing them in the
closure is safe.

---

### Change 3 — `buildSectionTable`: accept SelectionState and syncToolbar

Update the signature of `buildSectionTable`:

```typescript
function buildSectionTable(
  title: string | null,
  cards: FolderCard[],
  config: FolderViewConfig,
  host: HTMLElement,
  isFiles: boolean,
  selectionState: SelectionState,        // NEW
  syncToolbar: () => void,               // NEW
): HTMLElement
```

Update both call sites in `renderFolderTable` to pass `selectionState` and
`syncToolbar`.

---

### Change 4 — `buildSectionTable`: prepend checkbox column in thead

**In the thead construction section**, immediately before the legacy or
fields-mode icon `<th>` is added to `headerRow`, build and prepend the
master checkbox:

```typescript
// ── Checkbox column (FR-1) ────────────────────────────────────────────────
// sectionLabel is the heading for this section, used for aria-label.
const sectionLabel = (isFiles
  ? (config.filesTitle || "Files")
  : (config.foldersTitle || "Folders"));

// rowCheckboxes and sectionRows are populated as rows are built below.
const rowCheckboxes: HTMLInputElement[] = [];
const sectionRows: HTMLTableRowElement[] = [];
const sectionPaths: string[] = cards.map(c => c.path);

const { th: masterTh, masterInput } = buildMasterCheckboxTh(
  sectionLabel,
  sectionPaths,
  selectionState,
  syncToolbar,
  rowCheckboxes,
  sectionRows,
);
headerRow.appendChild(masterTh);
```

This `headerRow.appendChild(masterTh)` call happens before any other column
`<th>` is appended to `headerRow`, making the checkbox the leftmost column
(FR-1).

---

### Change 5 — `buildSectionTable`: prepend checkbox cell in each row

The `buildRow` factory is currently one of two closures:

```typescript
const buildRow = isFiles
  ? (card: FolderCard) => buildFileRow(card, config, extraFieldsForRow, resolvedFields)
  : (card: FolderCard) => buildFolderRow(card, config, resolvedFields);
```

Wrap it to inject the checkbox cell:

```typescript
const buildRow = (card: FolderCard): HTMLTableRowElement => {
  const tr = isFiles
    ? buildFileRow(card, config, extraFieldsForRow, resolvedFields)
    : buildFolderRow(card, config, resolvedFields);

  // Build checkbox cell. masterInput is captured from the thead construction
  // above. rowCheckboxes and sectionRows accumulate as rows are built.
  const checkboxInput = document.createElement("input");
  checkboxInput.type = "checkbox";
  // The full buildCheckboxTd function attaches its own input internally;
  // pass masterInput so updateMasterCheckboxState stays in sync.
  const checkboxTd = buildCheckboxTd(
    card,
    tr,
    selectionState,
    syncToolbar,
    masterInput,
    sectionPaths,
  );
  tr.insertBefore(checkboxTd, tr.firstChild);

  // Register for master-checkbox sync.
  const inputInTd = checkboxTd.querySelector<HTMLInputElement>("input[type=checkbox]")!;
  rowCheckboxes.push(inputInTd);
  sectionRows.push(tr);

  return tr;
};
```

Length justification comment for the revised `buildRow` closure: "Wraps the
legacy row builders to prepend the checkbox cell after the underlying row is
constructed. The master checkbox needs references to all row inputs and rows
in the section, accumulated here via push into the shared arrays."

---

### Change 6 — `rebuildTbody`: clear selection before rebuild (FR-7, NFR-7)

In the existing `rebuildTbody` closure (currently lines 664–668 of the original
file), add two lines at the top:

```typescript
const rebuildTbody = (): void => {
  // FR-7, NFR-7: clear selection state before any re-render.
  selectionState.paths.clear();
  syncToolbar();

  tbody.innerHTML = "";
  applySort();
  appendRowsToTbody(workingCards, tbody, buildRow, host);
};
```

---

## Files to Create

### `tests/folder-view/table-renderer-bulk.test.ts`

```typescript
/**
 * tests/folder-view/table-renderer-bulk.test.ts
 *
 * Integration tests for checkbox column wiring inside renderFolderTable.
 * Covers FR-1, FR-2, FR-7, NFR-5, NFR-6, NFR-7, EC-16, EC-20, EC-21.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderFolderTable }
  from "../../src/plugins/file-browser/folder-view/table-renderer";
import type { FolderViewConfig, FolderCard }
  from "../../src/plugins/file-browser/folder-view/types";
```

Reuse `makeConfig`, `makeFileCard`, `makeDirCard`, `makeContainer` helpers
from `table-renderer.test.ts` (copy them into this test file or extract to a
shared fixture — whichever keeps total line count lower).

Tests to implement:

| Test ID | Description | Req |
|---|---|---|
| I-01 | Checkbox `<th>` is first column in both section theads | FR-1 |
| I-02 | Each data row has a checkbox `<td>` as first child | FR-1 |
| I-03 | Toolbar element exists in DOM as first child of .folder-view-host | FR-3 |
| I-04 | Toolbar has `display:none` (via no --visible class) on initial render | FR-3 |
| I-05 | Checking a file row checkbox: toolbar becomes visible | FR-2, FR-3 |
| I-06 | Count label shows "1 selected" after one check | FR-2 |
| I-07 | Checking all rows in files section: master checkbox checked (not indeterminate) | FR-1 |
| I-08 | Checking some rows: master checkbox indeterminate | FR-1 |
| I-09 | Clicking checkbox cell does NOT call openFileInTab | FR-1 (click stops propagation) |
| I-10 | Clicking row body DOES call openFileInTab (checkbox cell stopPropagation is scoped) | FR-1 |
| I-11 | Sort click (name header): selection cleared, toolbar hidden | FR-7, NFR-7, EC-16 |
| I-12 | Both sections: checking items in both sections accumulates in shared toolbar count | EC-21 |
| I-13 | Master checkbox for Folders section has `aria-label="Select all Folders"` | FR-8 |
| I-14 | Row checkboxes have `aria-label="Select <name>"` | FR-8 |
| I-15 | Toolbar root has `role="toolbar"` and `aria-label="Bulk actions"` | FR-8 |
| I-16 | Fields mode: checkbox column still appears as leftmost column | NFR-5 |
| I-17 | Legacy mode: checkbox column still appears as leftmost column | NFR-5 |
| I-18 | Row fv-row--selected class applied when checkbox checked | FR-9 |
| I-19 | Checking file rows with >50 cards (lazy): newly rendered row checkboxes work correctly | EC-20 |

For I-19, trigger IntersectionObserver manually:
```typescript
vi.stubGlobal("IntersectionObserver", class {
  private _cb: Function;
  constructor(cb: Function) { this._cb = cb; }
  observe = vi.fn();
  disconnect = vi.fn();
  triggerIntersect() {
    this._cb([{ isIntersecting: true }]);
  }
});
```

---

## Acceptance Criteria

1. All tests in `tests/folder-view/table-renderer-bulk.test.ts` pass.
2. All tests in `tests/folder-view/table-renderer.test.ts` still pass
   (no regression on existing sort, click, column visibility tests).
3. Checkbox `<th>` is the first `<th>` in every `<thead>`.
4. Checkbox `<td>` is the first `<td>` in every data row.
5. Sort column click clears selection and hides toolbar.
6. Checking a checkbox in one section does not interfere with the other
   section's master checkbox.
7. `npm run test:run` passes for all test files.
8. Plugin rebuilt: `npm run build:plugins && npm run sync:plugins`.

---

## Regression Guard

After all tests pass, run the full test suite once:

```bash
npm run test:run
```

Then rebuild the plugin bundle:

```bash
npm run build:plugins && npm run sync:plugins
```

If `npm run test:run` shows any failure in `tests/folder-view/table-renderer.test.ts`
(the original test file, not the new `*-bulk.test.ts`), a regression has been
introduced. The checkbox column must be added as the first child of every row
in both legacy and fields mode without disturbing any other cell. The `buildRow`
wrapper in Change 5 uses `tr.insertBefore(checkboxTd, tr.firstChild)` to
guarantee this.

---

## Column Order Contract

The final column order in every row, both sections, both rendering modes:

```
[checkbox] [icon] [name] [...other columns per mode]
```

The icon `<td>` is always rendered first by `buildFolderRow`/`buildFileRow`.
The `insertBefore(checkboxTd, tr.firstChild)` call in the wrapper prepends the
checkbox before the icon, making checkbox column 0 and icon column 1 in the
final DOM. This matches the `<thead>` order because `masterTh` is appended to
`headerRow` before any other `<th>`.
