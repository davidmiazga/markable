---
title: "Bulk Actions — Master Index"
last-updated: "2026-05-11"
review-cadence-days: 7
status: active
---

# Bulk Actions — Master Index

## Requirements Source

`docs/requirements/active_task.md` — Checkbox Selection + Bulk Actions in Folder-Table Layout

---

## Feature Summary

Add checkbox-based multi-select to the `folder-table` layout with three bulk
operations: Move, Delete, and YAML frontmatter update. Selection state lives
entirely within one `renderFolderTable()` call. A sticky toolbar appears when
items are selected and hosts the three action flows.

---

## Files to Modify

| File | Change |
|---|---|
| `src/lib/bridge.ts` | Add `deleteFile` and `moveFile` typed wrappers |
| `src/plugins/file-browser/folder-view/folder-table-css.ts` | Append `BULK_ACTION_CSS` block |
| `src/plugins/file-browser/folder-view/table-renderer.ts` | Wire checkbox column, shared selection state, toolbar, and all action flows (calls helper modules) |

## New Files to Create

| File | Purpose |
|---|---|
| `src/plugins/file-browser/folder-view/bulk-selection.ts` | `SelectionState` type, `buildCheckboxTd`, `buildMasterCheckbox`, `updateMasterCheckboxState` |
| `src/plugins/file-browser/folder-view/bulk-toolbar.ts` | `buildToolbar`, `updateToolbar`, sub-UI builders for Move / Delete / YAML forms |
| `src/plugins/file-browser/folder-view/bulk-operations.ts` | `executeBulkMove`, `executeBulkDelete`, `executeBulkYaml` sequential runners |
| `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` | `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile` |
| `tests/folder-view/bulk-selection.test.ts` | Unit tests for selection helpers and master checkbox states |
| `tests/folder-view/bulk-toolbar.test.ts` | Unit tests for toolbar visibility, label text, sub-UI transitions |
| `tests/folder-view/bulk-operations.test.ts` | Unit tests for sequential runner error handling and result summaries |
| `tests/folder-view/yaml-frontmatter.test.ts` | Unit tests for the line-oriented YAML parser / writer |
| `tests/folder-view/table-renderer-bulk.test.ts` | Integration tests for checkbox column, selection set, and rebuildTbody clearance |

---

## Architecture Decisions

### AD-1: New helper files, not a larger table-renderer.ts

`table-renderer.ts` is already ~825 lines. All new bulk-action logic lives in
four purpose-built files inside the same bundle directory. `table-renderer.ts`
imports them. All four files are within the IIFE bundle so no external imports
are required.

### AD-2: Single shared SelectionState object per renderFolderTable() call

`renderFolderTable()` creates one `SelectionState` instance (a `Set<string>`
plus a path-to-kind map for dispatch). It passes references downward to
`buildSectionTable()`, which passes them to the `buildRow` factories via
closure. Lazy-rendered rows capture the same closure references (NFR-6).

### AD-3: Toolbar is a first child of .folder-view-host

The toolbar is created by `renderFolderTable()` and inserted at
`host.prepend(toolbar)` before sections are added. `buildSectionTable()` does
not know about the toolbar — `updateToolbar` is a closure created in
`renderFolderTable()` and threaded down.

### AD-4: No toolbar "Deselect All" button

Per FR-3. Selection is cleared only by unchecking checkboxes or triggering a
re-render.

### AD-5: rebuildTbody clears selection before rebuild

Per FR-7. Every sort click calls `selectionState.clear()` then `updateToolbar()`
before clearing `tbody.innerHTML`. This prevents ghost-selected rows from
lingering in the rebuilt table.

### AD-6: YAML parser is line-oriented, no third-party library

A full YAML library cannot be bundled inside the plugin IIFE without bloat.
The parser operates line-by-line, detecting `---` delimiters and `key: value`
scalar lines. Complex YAML (arrays, nested mappings, anchors) is preserved
verbatim. The parser makes no assumptions beyond the spec in FR-6.

### AD-7: Direct __TAURI_INTERNALS__ invoke in bulk-operations.ts

Per NFR-1. The operations file calls
`window.__TAURI_INTERNALS__?.invoke?.(commandName, args)` directly. No imports
from outside the plugin bundle.

### AD-8: CSS in existing folder-table-css.ts

A `BULK_ACTION_CSS` constant is appended to `FOLDER_TABLE_CSS` within
`folder-table-css.ts`. No new CSS file is needed. All colors use CSS custom
properties (FR-9, NFR-5).

---

## Key Interfaces (defined in step_01)

```typescript
// bulk-selection.ts
interface SelectionState {
  paths: Set<string>;
  kindMap: Map<string, "file" | "directory">;
}

// bulk-toolbar.ts
type ToolbarRefs = {
  toolbar: HTMLDivElement;
  countLabel: HTMLSpanElement;
  mainButtons: HTMLDivElement;
  subUi: HTMLDivElement;
};

// bulk-operations.ts
interface OperationResult {
  succeeded: number;
  failed: { path: string; error: string }[];
}

// yaml-frontmatter.ts
interface ParsedFile {
  hasFrontmatter: boolean;
  frontmatterLines: string[];   // lines between ---  delimiters, not including delimiters
  bodyLines: string[];          // lines after closing --- (or all lines when no frontmatter)
}
```

---

## Step Files

| Step | File | What it delivers |
|---|---|---|
| 01 | `step_01_types-and-bridge.md` | Types in new helper files + bridge.ts wrappers |
| 02 | `step_02_css.md` | Bulk-action CSS block |
| 03 | `step_03_yaml-parser.md` | yaml-frontmatter.ts — parser + writer + tests |
| 04 | `step_04_selection-helpers.md` | bulk-selection.ts — checkbox DOM helpers + tests |
| 05 | `step_05_toolbar.md` | bulk-toolbar.ts — toolbar DOM + all sub-UI + tests |
| 06 | `step_06_operations.md` | bulk-operations.ts — sequential runners + tests |
| 07 | `step_07_integration.md` | Wiring into table-renderer.ts + integration tests |

---

## Implementation Checklist

- [x] step_01 — Types and bridge wrappers
- [x] step_02 — CSS block
- [x] step_03 — YAML parser + writer + tests (EC-08 through EC-24)
- [x] step_04 — Selection helpers + tests (FR-1, FR-2)
- [x] step_05 — Toolbar + sub-UIs + tests (FR-3 through FR-6, States 1–8)
- [x] step_06 — Operations runners + tests (EC-01 through EC-07, EC-15, EC-19)
- [x] step_07 — Integration into table-renderer.ts + integration tests (FR-7, NFR-5, NFR-6, NFR-7, EC-16, EC-20, EC-21)
- [x] All tests pass: `npm run test:run` (3 pre-existing smart-folders failures excluded)
- [x] Plugin rebuilt: `npm run build:plugins && npm run sync:plugins`

---

## Edge Case Coverage Map

| EC | Covered in step |
|---|---|
| EC-01 (empty selection guard) | step_06 |
| EC-02 (file deleted externally) | step_06 |
| EC-03 (dest dir missing) | step_06 |
| EC-04 (name collision on move) | step_06 |
| EC-05 (move directory via rename_file) | step_06 |
| EC-06 (cross-volume dir move) | step_06 |
| EC-07 (dir delete, open tabs) | step_06 (graceful via existing tab manager) |
| EC-08 (YAML add, no existing frontmatter) | step_03 |
| EC-09 (YAML remove, key absent) | step_03 |
| EC-10 (malformed frontmatter) | step_03 |
| EC-11 (YAML on non-.md) | step_06 |
| EC-12 (YAML on directory) | step_06 |
| EC-13 (YAML value with colon) | step_03 |
| EC-14 (empty key input) | step_05 |
| EC-15 (mixed selection delete dispatch) | step_06 |
| EC-16 (sort during confirmation) | step_07 |
| EC-17 (file watcher re-render) | step_07 (by design — re-render resets all state) |
| EC-18 (zero eligible .md files for YAML) | step_06 |
| EC-19 (all items fail) | step_06 |
| EC-20 (lazily-rendered rows) | step_07 |
| EC-21 (both sections selected) | step_07 |
| EC-22 (YAML summary skipped vs failed) | step_06 |
| EC-23 (empty frontmatter after remove) | step_03 |
| EC-24 (value contains ---) | step_03 |

---

## Review Request

- **Files changed**:
  - `src/lib/bridge.ts` — Added `deleteFile` and `moveFile` typed wrappers
  - `src/plugins/file-browser/folder-view/folder-table-css.ts` — Appended `BULK_ACTION_CSS` block
  - `src/plugins/file-browser/folder-view/table-renderer.ts` — Wired checkbox column, shared selection state, toolbar, and all action flows
  - `src/plugins/file-browser/folder-view/bulk-selection.ts` — NEW: `SelectionState` type, `createSelectionState`, `buildCheckboxTd`, `buildMasterCheckboxTh`, `updateMasterCheckboxState`
  - `src/plugins/file-browser/folder-view/bulk-toolbar.ts` — NEW: `buildToolbar`, `updateToolbar`, `showResult`, and all sub-UI builders
  - `src/plugins/file-browser/folder-view/bulk-operations.ts` — NEW: `executeBulkMove`, `executeBulkDelete`, `executeBulkYaml`, `formatOperationResult`
  - `src/plugins/file-browser/folder-view/yaml-frontmatter.ts` — NEW: `parseYamlFrontmatter`, `applyYamlKey`, `removeYamlKey`, `reconstructFile`
  - `tests/folder-view/bulk-selection.test.ts` — NEW: 21 tests
  - `tests/folder-view/bulk-toolbar.test.ts` — NEW: 27 tests
  - `tests/folder-view/bulk-operations.test.ts` — NEW: 27 tests
  - `tests/folder-view/yaml-frontmatter.test.ts` — NEW: 25 tests
  - `tests/folder-view/table-renderer-bulk.test.ts` — NEW: 19 integration tests
  - `tests/folder-view/table-renderer.test.ts` — Updated 4 column-count assertions to account for the new checkbox column (regression guard)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07

- **Known limitations**:
  - EC-06 (cross-volume directory move): the `rename_file` command will return an OS error for cross-device renames. This is documented in the spec and handled by the per-item error catcher in `executeBulkMove`; the error surfaces in the result summary.
  - The Move sub-UI accepts a raw absolute path. No folder picker dialog is provided in this phase.

- **Edge cases covered by tests**:
  - EC-01 (empty selection guard): BM-01, BD-01, BY-01
  - EC-02/EC-03/EC-04 (move failures): BM-05, BM-06
  - EC-05 (move directory via rename_file): BM-03
  - EC-07 (dir delete, open tabs): BD-03 — delete_directory dispatched; tab manager cleanup is handled by existing tab-manager watcher
  - EC-08 (YAML add, no existing frontmatter): BY-05 with a no-frontmatter body; `executeBulkYaml` sets `hasFrontmatter=true` when adding to files with no frontmatter
  - EC-09 (YAML remove, key absent): BY-08, R-02
  - EC-10 (malformed frontmatter): BY-07, P-04
  - EC-11 (YAML on non-.md): BY-03
  - EC-12 (YAML on directory): BY-02
  - EC-13 (YAML value with colon): A-03
  - EC-14 (empty key input): T-18
  - EC-15 (mixed selection delete dispatch): BD-02 (file), BD-03 (directory)
  - EC-16 (sort during confirmation): I-11
  - EC-17 (file watcher re-render): by design — re-render calls `renderFolderTable` fresh, resetting all state
  - EC-18 (zero eligible .md files): BY-09, FR-05
  - EC-19 (all items fail): BM-07, BD-04, FR-03
  - EC-20 (lazily-rendered rows): I-19
  - EC-21 (both sections selected): I-12
  - EC-22 (YAML summary skipped vs failed): BY-10, FR-04
  - EC-23 (empty frontmatter after remove): RC-02
  - EC-24 (value contains ---): P-05, A-06
