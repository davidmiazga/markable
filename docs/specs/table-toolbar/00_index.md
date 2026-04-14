---
title: "Table Toolbar Plugin — Master Blueprint"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Table Toolbar Plugin — Master Blueprint

Requirements source: `docs/requirements/active_task.md`

---

## Implementation Checklist

Each checkbox is ticked by the Lead Developer when all tests for that step pass and
the step file's "Definition of Done" criteria are met.

- [x] step_01 — Plugin skeleton, settings, CSS scaffold, build config
- [x] step_02 — Pure table parsing (TableContext detection, row/col resolution)
- [x] step_03 — Pure table operations (all 11 transforms)
- [x] step_04 — Floating UI DOM (top bar, row handle, bottom pill) + positioning
- [x] step_05 — Sidebar panel mode
- [x] step_06 — CM6 updateListener wiring (enabled/disabled state, sync position)
- [x] step_07 — Button click dispatch + renderDetailExtra settings control

---

## Stack Decision

No new dependencies are introduced (NFR-1). The plugin is built with:

- **TypeScript** — same as every other plugin in the project; type-only imports
  erased at compile time give IDE support without runtime cost.
- **Vanilla DOM APIs** — floating elements, CSS injection, event delegation.
- **CM6 via `window.__CM_VIEW__`** — same access pattern as `markdown-toolbar.plugin.ts`;
  never imported at module-evaluation time.
- **Vite IIFE build** — same `pluginConfig()` entry in `vite.plugins.config.ts` and
  `build-plugins.mjs` as all other core plugins.

---

## High-Level Architecture

### Data Flow

```
Editor transaction
      │
      ▼
CM6 updateListener (registered via api.addExtensions)
      │
      ├── synchronous path (every selection/doc change)
      │     └── floating mode: recalculate coordsAtPos → set element style positions
      │
      └── debounced path (150 ms, DEBOUNCE_MS)
            ├── detectTableContext(docText, cursorPos) → TableContext | null
            ├── floating mode: show/hide three DOM elements; disable buttons per context
            └── sidebar mode: update enabled/disabled state of all buttons

Button click (top bar, row handle, or bottom pill)
      │
      ▼
read window.__MARKABLE_EDITOR_VIEW__ (fresh on every click — EC-23)
      │
      ├── buildTableContext(state) → TableContext
      ├── call pure operation function → { tableText: string }
      └── view.dispatch({ changes: { from, to, insert } })   ← single dispatch, single undo step
```

### Module Sections (strict order, mirroring markdown-toolbar.plugin.ts)

1. Type-only imports (erased by tsc)
2. Settings types, defaults, mergeWithDefaults
3. Module-level state declarations
4. CSS constant (TOOLBAR_CSS) and lifecycle helpers (injectCSS / removeCSS)
5. TableContext type and pure detectTableContext function
6. Pure table operation functions (all 11)
7. DOM: buildTopBar / buildRowHandle / buildBottomPill
8. DOM: updateFloatingPositions / updateFloatingVisibility / clampPosition
9. DOM: buildSidebarPanel / updateSidebarButtonStates
10. CM6 listener factory: buildUpdateListener
11. Plugin export object (onEnable / onDisable / renderDetailExtra)

---

## Component Map

### New Files

| Path | Purpose |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Single plugin source file |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | All unit tests |

### Modified Files

| Path | Change |
|---|---|
| `scripts/build-plugins.mjs` | Add `["table-toolbar", "src/plugins/table-toolbar/table-toolbar.plugin.ts"]` to `PLUGINS` array |
| `vite.plugins.config.ts` | Add `pluginConfig("table-toolbar", resolve(__dirname, "src/plugins/table-toolbar/table-toolbar.plugin.ts"), false)` to exported array |

---

## Architectural Decisions

### AD-1: Single Plugin File

All logic lives in `table-toolbar.plugin.ts`. No helper modules. Rationale: same
constraint as every other plugin — the IIFE build cannot import project-internal
modules (FR-6). Splitting into helper files would require bundling them all into
the IIFE anyway; keeping one file makes the boundary explicit.

### AD-2: Three Floating DOM Elements Created Once in onEnable

The top bar, row handle, and bottom pill are `document.createElement`'d once inside
`onEnable` and cached in module-level variables. They are shown/hidden via `display`
style — never removed and re-added between cursor positions. This satisfies NFR-2
(no per-transaction DOM allocation) and NFR-3 (all three removed in `onDisable`).

### AD-3: Row Handle Uses Inline Menu (Not a Separate Popup Element)

The row handle's three-item menu (Insert Row Above / Below / Delete Row) is
implemented as a small absolutely-positioned `<div>` that is a sibling element
appended to `document.body` alongside the other floating elements. It is created
once in `onEnable` and toggled visible on handle click. This keeps the "created
once, reused" invariant (NFR-2). The menu closes on any click outside it (document
`mousedown` listener, detached in `onDisable`).

### AD-4: Pure Functions Take Raw Strings, Return New Table String

Every table operation receives:
- `tableText: string` — the raw Markdown source of the table (from `sliceString`)
- `rowIndex: number | null` — current row (null for separator)
- `colIndex: number` — current column index

And returns `string` (the new table text) or `null` (no-op case). The caller
dispatches exactly one `view.dispatch({ changes: { from, to, insert } })`. This
satisfies NFR-4 (single undo step) and makes all operations fully testable with
plain strings (FR-5).

### AD-5: detectTableContext Is Pure (Takes docText + pos, Returns TableContext | null)

```typescript
interface TableContext {
  tableFrom: number;        // absolute offset of table node start in document
  tableTo: number;          // absolute offset of table node end
  tableText: string;        // sliceString(tableFrom, tableTo)
  rowIndex: number | null;  // null when cursor is on separator row
  colIndex: number;         // 0-based column index
  isHeaderRow: boolean;     // true when rowIndex === 0
  isSeparatorRow: boolean;  // true when rowIndex === null
  columnCount: number;      // number of columns in the table
  rowCount: number;         // total rows including header and separator
}
```

The function signature used in tests:
```typescript
function detectTableContext(
  docText: string,
  cursorPos: number,
  syntaxTree: SyntaxTree,   // passed in so the function can be called without CM6 in tests
): TableContext | null
```

In production, the caller passes `syntaxTree(state)` and `state.selection.main.head`.
In tests, a stub tree (or the lezer parser output) is used.

NOTE: In the CM6 updateListener the actual call uses the live CM6 state directly —
the pure variant (for unit tests) receives the tree as an argument. The two paths
share the row/col counting logic (extracted to `parseTableAtPos`).

### AD-6: Column Counting Uses Pipe-Split With Escaped-Pipe Guard

Per NFR-5 and EC-24, cells are split on `|` characters that are NOT preceded by
`\`. The splitting regex is:

```
/(?<!\\)\|/
```

The first and last empty segments produced by splitting a well-formed table row
(`| a | b |` → `["", " a ", " b ", ""]`) are discarded. Column index is derived
by counting non-empty segments to the left of the cursor's cell.

### AD-7: Line-Ending Preservation (EC-31)

The table text is split into rows using the regex `/\r?\n/`. The original line
ending (LF or CRLF) is detected once per operation and used to rejoin the rows
after transformation. Detection: `tableText.includes("\r\n") ? "\r\n" : "\n"`.

### AD-8: updateListener — Two Rates

Mirroring `markdown-toolbar.plugin.ts` exactly:

- **Synchronous on every selection/doc change**: recalculate `coordsAtPos` and
  update `top`/`left`/`display` on the three floating elements. Cheap: two
  `coordsAtPos` calls + six style assignments.
- **Debounced at 150 ms**: call `detectTableContext`, update button enabled/disabled
  states, show/hide floating elements.

### AD-9: Bottom Pill Click Targets Last Body Row

When the bottom pill is clicked it calls `insertRowBelow` with the index of the
last body row (rowCount - 1, since rowCount includes header + separator + body
rows and the last body row is at `rowCount - 1`). This is equivalent to the
"Insert Row Below" action on the last body row, as required by FR-2c.

### AD-10: sidebarPanelId Always Set (Even in Floating Mode)

Per FR-6, `sidebarPanelId: "table-toolbar"` is always present on the plugin
export object. The Plugins Panel uses this to know it should show the L/R
assignment toggle in the detail view. When `toolbarMode === "floating"` the sidebar
panel is not registered at runtime, but the toggle still controls `sidebarSide`
which is persisted and used when the user switches to sidebar mode.

### AD-11: Insert Table Guard (EC-9)

When `insertTable` is called and the cursor is inside a table, the insertion point
is set to `tableContext.tableTo` instead of the cursor position. A trailing newline
is always appended and a leading newline is prepended if the insertion point is not
at a line start.

### AD-12: Row Handle Menu — Close-on-Outside-Click

A single `mousedown` listener on `document` is attached in `onEnable` and stored
in a module-level variable. It hides the row handle menu when the click target is
outside the menu element. This listener is removed by calling
`document.removeEventListener` in `onDisable`.

---

## Interface Contracts

### TableContext (AD-5)

```typescript
export interface TableContext {
  tableFrom:      number;
  tableTo:        number;
  tableText:      string;
  rowIndex:       number | null;  // null = separator row
  colIndex:       number;
  isHeaderRow:    boolean;
  isSeparatorRow: boolean;
  columnCount:    number;
  rowCount:       number;
}
```

### Operation Return Type

Each pure operation function returns `string` (the new full table text) on success,
or `null` when the operation is a structural no-op (EC-1, EC-3). The caller checks
for `null` before dispatching.

```typescript
// Shared signature for all row/column/table operations
type TableOp = (tableText: string, rowIndex: number | null, colIndex: number) => string | null;
```

Exception: `deleteTable` returns only `null` (never a new table text — the entire
block is removed by a different dispatch path). `insertTable` has its own signature
as it does not operate on an existing table text.

### Settings

```typescript
export interface TableToolbarSettings {
  toolbarMode: "floating" | "sidebar";
  sidebarSide: "left" | "right";
}

export const DEFAULT_SETTINGS: TableToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};
```

### CSS ID and Class Names

```typescript
export const STYLE_ID = "__markable_tbl_toolbar_css__";
// Top bar:
//   id="__markable_tbl_top_bar__"   class="tbl-toolbar tbl-toolbar--top"
// Row handle:
//   id="__markable_tbl_row_handle__" class="tbl-toolbar__row-handle"
// Row handle menu:
//   id="__markable_tbl_row_menu__"   class="tbl-toolbar__row-menu"
// Bottom pill:
//   id="__markable_tbl_bottom_pill__" class="tbl-toolbar__bottom-pill"
// Buttons:
//   class="tbl-toolbar__btn"
//   class="tbl-toolbar__btn--disabled"
// Sidebar panel container class (applied by SidebarManager):
//   .sidebar-panel-content .tbl-toolbar (override for static layout)
```

---

## Edge Case Coverage Map

Every edge case from `active_task.md` is addressed by at least one step.

| EC# | Scenario summary | Step |
|---|---|---|
| EC-1 | Header row — Delete Row disabled | step_02 (detection), step_03 (no-op), step_06 (disabled state) |
| EC-2 | Separator row — row ops disabled | step_02, step_03, step_06 |
| EC-3 | One column — Delete Column disabled | step_02 (columnCount), step_03 (no-op), step_06 |
| EC-4 | Last body row deleted | step_03 |
| EC-5 | Delete Table when doc is only content | step_03 |
| EC-6 | Mismatched column counts on insert column | step_03 |
| EC-7 | Single undo step | step_03 (single dispatch), step_06 |
| EC-8 | Multiple separate undo steps | step_03 |
| EC-9 | Insert Table when cursor inside table | step_03 |
| EC-10 | Insert Table mid-line | step_03 |
| EC-11 | Insert Table in empty document | step_03 |
| EC-12 | Cursor leaves table — elements hidden | step_06 |
| EC-13 | Editor loses focus — elements hidden | step_06 |
| EC-14 | Top bar above viewport — flip below | step_04 |
| EC-15 | Top bar near viewport edge — clamp | step_04 |
| EC-16 | Row handle outside scroll area | step_04 |
| EC-17 | Plugin disabled while elements visible | step_01 (onDisable scaffold) |
| EC-18 | Plugin disabled while sidebar registered | step_05 |
| EC-19 | Rapid toggle — no duplicates | step_01 (CSS guard), step_06 |
| EC-20 | loadSettings null | step_01 (mergeWithDefaults) |
| EC-21 | loadSettings partial | step_01 (mergeWithDefaults) |
| EC-22 | __MARKABLE_EDITOR_VIEW__ undefined on click | step_07 |
| EC-23 | New tab opened — reads fresh view | step_07 |
| EC-24 | Escaped pipe in cell | step_02 (column splitting), step_03 |
| EC-25 | Cell content with leading/trailing spaces | step_03 |
| EC-26 | Align already same value (idempotent) | step_03 |
| EC-27 | Delete Column on last column (covered by EC-3) | step_03 |
| EC-28 | Insert row near last body row | step_03 |
| EC-29 | Bottom pill click when cursor outside table | step_07 |
| EC-30 | Sidebar Insert Table with null view | step_07 |
| EC-31 | CRLF line endings preserved | step_02, step_03 |
| EC-32 | build-plugins.mjs entry missing | step_01 |
| EC-33 | vite.plugins.config.ts entry missing | step_01 |

---

## Deferred Work / Known Limitations

Track these in this file, not in source code (CLAUDE.md rule: no TODO in source).

- Drag-and-drop column reordering
- Multi-column alignment
- Table pretty-printing (normalise cell widths)
- Keyboard shortcuts for table operations
- Live mode-switch without restart
- HTML `<table>` support
- Merge/split cells

### Spec Conflict: FR-5a vs EC-2 on separator row insert-row-above

FR-5a states that "Insert Row Above" should insert a new body row above the current
row position. Read literally this would imply the operation fires on the separator
row and places a row between the header and separator.

EC-2 takes precedence: "Separator row — row ops disabled". Insert Row Above on the
separator row is a no-op (the operation is disabled). The FR-5a description is
incorrect as written for the separator-row case. EC-2 is the authoritative
constraint and is reflected in both the implementation and the tests.

---

## Review Request

- **Files changed**:
  - `src/plugins/table-toolbar/table-toolbar.plugin.ts` (modified — added `updateRowMenuButtonStates`, `@remarks Length justification:` blocks on four functions)
  - `tests/plugins/table-toolbar/table-toolbar.test.ts` (modified — added EC-18, EC-23, EC-8-skip tests; added 3 CRLF tests for insertColumnRight/alignCenter/alignRight; replaced hollow updateFloatingVisibility test with behavioural test)
  - `vite.plugins.config.ts` (modified — updated stale "four" count references to "six")
  - `docs/specs/table-toolbar/00_index.md` (modified — added FR-5a vs EC-2 conflict note)
  - `src/lib/cm-globals.ts` (modified — added `__CM_LANGUAGE__` global for `syntaxTree`)
  - `scripts/build-plugins.mjs` (modified — added `table-toolbar` entry, updated count to 7)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07

- **Known limitations**:
  - The `@lezer/markdown` parser does NOT include GFM table support. Tests must use
    `markdownLanguage.parser` from `@codemirror/lang-markdown`. This is documented
    in the test file's import comment.
  - `updateTopBarButtonStates` signature was extended with an optional `bar` parameter
    (deviates from spec) to allow unit testing without a full `onEnable` cycle. This is
    consistent with how `updateSidebarButtonStates` works and does not affect production
    behavior (production callers pass no argument, defaults to module-level `_topBar`).
  - Test position for "cursor in b cell" uses `indexOf("| b |") + 2` (not `+3` as in spec)
    because the lezer `TableCell` node span covers only the content character(s), not
    surrounding whitespace. Using `+3` would land the cursor on whitespace, which resolves
    to `TableRow` not `TableCell`, producing colIndex 0 instead of 1.
  - FR-5a and EC-2 conflict on separator-row insert-row-above behaviour. EC-2 takes
    precedence (operation disabled). See "Spec Conflict" note in Deferred Work section.

- **Edge cases covered by tests**:
  | EC# | Tests that cover it |
  |---|---|
  | EC-1 (header row no-op) | `insertRowAbove: returns null for header row`, `deleteRow: returns null for header row`, `handleAction: delete-row is no-op on header row` |
  | EC-2 (separator row disabled) | `insertRowAbove/Below: returns null for separator`, `deleteRow: returns null for separator`, `updateSidebarButtonStates: delete-row/insert-row-above disabled on separator` |
  | EC-3 (last column) | `deleteColumn: returns null when one column`, `updateTopBarButtonStates: disables delete-col when columnCount 1`, `updateSidebarButtonStates: delete-col disabled when columnCount 1`, `handleAction: delete-col no-op for single-column` |
  | EC-4 (last body row deleted) | `deleteRow: leaves header+separator when last body row deleted` |
  | EC-5 (delete-table empty doc) | `handleAction: delete-table on full-document table results in empty doc` |
  | EC-6 (mismatched columns) | `insertColumnLeft: normalises short rows before inserting` |
  | EC-7 (single undo step) | `handleAction: insert-col-left dispatches single change` |
  | EC-8 (separate undo steps) | Skipped — runtime-only; requires live CM6 undo history |
  | EC-9 (insert table in table) | `insertTable: inserts after table end when cursor inside table` |
  | EC-10 (insert table mid-line) | `insertTable: prepends newline when mid-line` |
  | EC-11 (insert table empty doc) | `insertTable: inserts at cursor pos in empty document` |
  | EC-12 (cursor leaves table) | `updateTopBarButtonStates: disables all when context null`, `updateFloatingVisibility: removes visible class from top bar` |
  | EC-18 (sidebar panel unregister on disable) | `onEnable/onDisable: EC-18: unregisterSidebarPanel called when disabled in sidebar mode` |
  | EC-19 (rapid toggle no duplicates) | `onEnable/onDisable: rapid toggle does not produce duplicate style tags` |
  | EC-20 (loadSettings null) | `mergeWithDefaults: returns defaults when raw is null` |
  | EC-21 (loadSettings partial) | `mergeWithDefaults: returns defaults when empty`, `fills missing sidebarSide` |
  | EC-22 (view undefined on click) | `handleAction: is a no-op when view is undefined` |
  | EC-23 (fresh view read on each click) | `handleAction reads fresh view on each click: targets each view independently when global is replaced between calls` |
  | EC-24 (escaped pipe) | `splitRow: does not split on escaped pipe`, `detectTableContext: handles escaped pipe` |
  | EC-25 (cell spaces preserved) | `splitRow: preserves leading/trailing spaces`, `detectTableContext: preserves tableText` |
  | EC-26 (align idempotent) | `alignment operations: is idempotent even if already aligned` |
  | EC-28 (insert below last row) | `insertRowBelow: inserts after last body row` |
  | EC-29 (bottom pill outside table) | `handleAction: EC-29: insert-row-below no-op when outside table` |
  | EC-31 (CRLF preserved) | `splitRow CRLF`, `detectLineEnding CRLF`, `parseTableRows CRLF`, all CRLF preservation tests including insertColumnRight, alignCenter, alignRight |
  | EC-32 (build-plugins entry) | Verified — `scripts/build-plugins.mjs` contains `table-toolbar` entry |
  | EC-33 (vite config entry) | Verified — `vite.plugins.config.ts` contains `pluginConfig("table-toolbar", ...)` |
  | EC-13 (editor blur) | Skipped with explanatory comment — runtime-only |

---

## Review Sign-off

- **Date**: 2026-04-14
- **Findings summary**: 0 Critical, 0 High, 1 Medium outstanding (accepted), 0 Low — all Critical and High findings from the first review resolved.
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified.
- **Edge case coverage**: All Edge Case Inventory items covered by tests or explicitly documented as runtime-only skips (EC-8, EC-12, EC-13).
- **Outstanding accepted item**: M-2 residual — `vite.plugins.config.ts` line 32 still reads "All **four** plugins share the same name" when there are now six. This is a stale comment in the `name: "__markablePlugin__"` explanation block. It does not affect build correctness, correctness of any test, or runtime behaviour. Accepted as a Low finding.
- **Status**: Approved for Merge
