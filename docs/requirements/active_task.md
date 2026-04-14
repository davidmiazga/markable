---
title: "Table Toolbar Plugin"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Table Toolbar Plugin — Requirements Spec

## Summary

As a user, I want a contextual toolbar with table management controls so that I can insert, delete, and reformat Markdown table rows and columns without memorising pipe-syntax or manually editing alignment separators.

---

## Functional Requirements

### FR-1: Two Display Modes

The plugin supports exactly two mutually exclusive display modes, controlled by a persistent setting (`toolbarMode`).

| Mode | Description |
|---|---|
| `floating` | Three contextual UI elements appear around the table when the cursor is inside it. Default mode. |
| `sidebar` | A single docked panel always visible in a left or right sidebar slot. |

The active mode is stored via `api.saveSettings()` and restored via `api.loadSettings()` on plugin enable. On first enable (no saved settings), `floating` mode is used and `sidebarSide` defaults to `"left"`.

### FR-2: Floating Mode — Three UI Elements

When `toolbarMode === "floating"` and the cursor is anywhere inside a Markdown table (any `Table` node in the CM6 syntax tree), three elements are rendered:

#### FR-2a: Top Bar

A horizontal toolbar floated above the table's first line. Buttons (in display order):

| # | Label | Action |
|---|---|---|
| 1 | Insert Column Left | Insert blank column to the left of the current column |
| 2 | Insert Column Right | Insert blank column to the right of the current column |
| 3 | Align Left | Set `| :--- |` separator for current column |
| 4 | Align Center | Set `| :---: |` separator for current column |
| 5 | Align Right | Set `| ---: |` separator for current column |
| 6 | Delete Column | Remove the current column |
| 7 | Delete Table | Remove the entire table block from the document |

Position: computed via `view.coordsAtPos(tableNode.from)` anchored to the top of the table, offset upward by the toolbar height plus an 8 px gap. If insufficient space above, the bar is flipped below the last table line (see EC-15).

#### FR-2b: Row Handle

A small pill button rendered to the left of the cursor's current row. One handle is visible at a time — it tracks the active row. Clicking the handle opens a compact inline menu with three items:

| Item | Action |
|---|---|
| Insert Row Above | Insert a blank row above the current row |
| Insert Row Below | Insert a blank row below the current row |
| Delete Row | Remove the current row |

Position: computed via `view.coordsAtPos(rowNode.from)`, aligned to the vertical midpoint of the row line, offset to the left of the editor's left edge. When the header row is active, "Delete Row" is shown but is disabled/greyed out (header row is protected — see EC-1).

#### FR-2c: Bottom Pill

A small `+` button rendered below the table's last line. Clicking it always inserts a new blank row at the end of the table (equivalent to Insert Row Below on the last body row). Position: computed via `view.coordsAtPos(tableNode.to)`, offset downward by a fixed gap (8 px).

All three floating elements:
- Are appended to `document.body` using `position: fixed`.
- Are hidden (CSS `display: none` or removed) when the cursor leaves the table or the editor loses focus.
- Do not consume pointer-fall-through to the editor for non-button areas.

### FR-3: Sidebar Mode — Docked Panel

When `toolbarMode === "sidebar"`, a single panel is registered via `api.registerSidebarPanel()`. It contains the following controls:

| Button | Always Enabled? | Description |
|---|---|---|
| Insert Table | Yes | Inserts a blank 3-column × 2-row table (header + 1 body row) at cursor |
| Insert Row Above | No | Inserts blank row above cursor row |
| Insert Row Below | No | Inserts blank row below cursor row |
| Delete Row | No | Deletes cursor row (header row: no-op, button disabled) |
| Insert Column Left | No | Inserts blank column left of cursor column |
| Insert Column Right | No | Inserts blank column right of cursor column |
| Delete Column | No | Deletes cursor column (last column: no-op, button disabled) |
| Align Left | No | Sets `:---` separator for cursor column |
| Align Center | No | Sets `:---:` separator for cursor column |
| Align Right | No | Sets `---:` separator for cursor column |
| Delete Table | No | Deletes entire table block |

"Not always enabled" buttons are visually disabled (`pointer-events: none`, greyed out) when the cursor is not inside a table. They are also individually disabled when the specific operation is structurally impossible (e.g. Delete Column when only one column exists — see EC-3).

A CM6 `updateListener` (debounced 150 ms) drives the enabled/disabled state of all buttons after each editor transaction.

### FR-4: Cursor-in-Table Detection

- Detection uses `syntaxTree(state).resolve(pos)` to walk ancestors looking for a `Table` node — same approach as `live-preview.ts`'s `buildTableDecorations`.
- Current row is determined by finding the enclosing `TableRow` (or `TableDelimiter` for the separator line) ancestor at `state.selection.main.head`.
- Current column index is determined by counting `TableCell` (or `TableHeader`) siblings to the left of the cursor's enclosing cell within the current row.
- A cursor on the separator line (the `| --- | --- |` line) is treated as "cursor is in the table" but the row index is considered `null` (separator). Row operations are disabled; column and table operations remain enabled.

### FR-5: Table Operations — Pure String Transforms

All eleven operations are pure string transforms on the Markdown source text of the table. Each operation:

1. Reads the table's raw text via `state.doc.sliceString(tableNode.from, tableNode.to)`.
2. Applies the transform to produce a new string.
3. Dispatches exactly one `view.dispatch({ changes: { from: tableNode.from, to: tableNode.to, insert: newText } })` call.

This guarantees each operation is a single undoable step (one Cmd-Z reversal).

#### FR-5a: Row Operations

**Insert Row Above** — Inserts a blank row (all cells empty, `|   |`) immediately before the current row. The separator row (row index 1) cannot be targeted; if cursor is on it, the insert is relative to the header row above.

**Insert Row Below** — Inserts a blank row immediately after the current row.

**Delete Row** — Removes the current row's line from the table string. The header row (row index 0) cannot be deleted (operation is a no-op; the button is disabled in both modes when cursor is on the header row). The separator row cannot be deleted.

#### FR-5b: Column Operations

**Insert Column Left** — Inserts a new `|   |` cell to the left of the current column in every row, and inserts a `| --- |` cell in the separator row at the same position.

**Insert Column Right** — Same as Insert Column Left but inserts to the right.

**Delete Column** — Removes the cell at the current column index from every row including the separator row. Disabled when the table has exactly one column (see EC-3).

#### FR-5c: Alignment Operations

**Align Left** — Replaces the separator cell at the current column index with ` :--- ` (colon on left).

**Align Center** — Replaces the separator cell with ` :---: ` (colons on both sides).

**Align Right** — Replaces the separator cell with ` ---: ` (colon on right).

Each alignment operation changes only the separator row; no other rows are modified.

#### FR-5d: Table-Level Operations

**Delete Table** — Removes the entire block from `tableNode.from` to `tableNode.to` (inclusive of any trailing newline) in a single dispatch. If the table is the entire document, the document becomes empty (zero-length, not a crash).

**Insert Table** — Inserts the following template at the current cursor position:

```
| Column 1 | Column 2 | Column 3 |
| --- | --- | --- |
|   |   |   |
```

A newline is prepended if the cursor is not at the start of a line, and a trailing newline is appended, so the table is always its own block. If the cursor is already inside a table (see EC-17), the insert is placed after the table's end rather than inside it.

### FR-6: Plugin Integration Contracts

- File: `src/plugins/table-toolbar/table-toolbar.plugin.ts`
- Compiled output: `src-tauri/plugins/core/table-toolbar.js`
- Plugin object fields:
  - `id: "table-toolbar"`
  - `name: "Table Toolbar"`
  - `version: "1.0.0"`
  - `description`: one-line summary
  - `detail`: multi-sentence description for the Plugins Panel
  - `sidebarPanelId: "table-toolbar"` — always set so the Plugins Panel's L/R assignment toggle is always available, even when `toolbarMode` is `"floating"` and the panel is not registered at runtime.
- `onEnable(api)`: loads settings, resolves mode, injects CSS, registers CM6 `updateListener` extension, conditionally creates floating DOM elements or registers sidebar panel.
- `onDisable(api)`: removes CM6 extension, unregisters sidebar panel if registered, removes all floating DOM elements from `document.body`, removes injected CSS `<style>` tag, resets all module-level state to initial values.
- CM6 globals access pattern: all `@codemirror/*` values accessed via `window.__CM_VIEW__` (same pattern as `markdown-toolbar.plugin.ts`). `window.__CM_VIEW__` is never accessed at module-evaluation time; only inside `onEnable` or factory functions called from `onEnable`.
- Direct editor dispatch uses `(window as any).__MARKABLE_EDITOR_VIEW__`.
- No `@codemirror/*` value imports at the module level; only `import type` annotations (erased by tsc) are permitted for IDE type support.
- No app-internal module imports (`bridge`, `settings`, `main`, `plugin-types`, etc.).

### FR-7: Build System Integration

- Add an entry to `scripts/build-plugins.mjs` `PLUGINS` array:
  ```
  ["table-toolbar", "src/plugins/table-toolbar/table-toolbar.plugin.ts"]
  ```
- Add a corresponding `pluginConfig(...)` call to `vite.plugins.config.ts`.
- Both `build-plugins.mjs` and `vite.plugins.config.ts` must be updated before the plugin can be compiled.
- The entry in both files follows the same pattern as the existing `markdown-toolbar` entry.

### FR-8: Persistent Settings

Settings object shape (stored at `plugins/table-toolbar/settings.json`):

```
{
  toolbarMode: "floating" | "sidebar",   // default "floating"
  sidebarSide: "left" | "right"          // default "left"
}
```

- `saveSettings` is called immediately whenever either setting changes.
- `loadSettings` is called in `onEnable`; on `null` return the defaults above are used.
- Missing or invalid keys fall back to their defaults without crashing (same `mergeSettings` guard as `markdown-toolbar.plugin.ts`).
- The `sidebarSide` value determines the `side` field passed to `api.registerSidebarPanel()` when `toolbarMode === "sidebar"`.

### FR-9: CSS Scoping and Injection

- All CSS class names are prefixed `.tbl-toolbar` (e.g. `.tbl-toolbar`, `.tbl-toolbar__btn`, `.tbl-toolbar__btn--disabled`, `.tbl-toolbar__row-handle`, `.tbl-toolbar__bottom-pill`).
- CSS is injected as a `<style id="__markable_tbl_toolbar_css__">` tag in `onEnable`.
- A guard (check `document.getElementById(STYLE_ID)` before inserting) prevents duplicate injection on rapid toggle cycles.
- CSS is removed in `onDisable` by removing the `<style>` element by id.
- CSS uses `var(--bg-primary)`, `var(--bg-chrome)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--accent-color)`, `var(--selection-bg)` for automatic theme adoption.

### FR-10: Position Setting in Plugins Panel

The Plugins Panel detail view for this plugin shows the same 3-way toggle as the Markdown Toolbar: **Left | Float | Right**. Selecting "Float" sets `toolbarMode: "floating"`. Selecting "Left" or "Right" sets `toolbarMode: "sidebar"` and `sidebarSide: "left"` or `"right"` accordingly. The change takes effect after `api.restartSelf()` is called (same pattern as `markdown-toolbar`).

---

## Non-Functional Requirements

### NFR-1: No New Dependencies

The plugin uses only vanilla TypeScript/DOM APIs. No third-party libraries are added to `package.json`. CM6 APIs are accessed exclusively through the `window.__CM_VIEW__` global.

### NFR-2: Performance

- The CM6 `updateListener` extension is debounced at 150 ms for sidebar button state updates and for floating element show/hide decisions.
- Floating element position recalculation (coordsAtPos calls + style assignments) runs synchronously on each selection change without debounce, to keep the elements tracking the cursor without visible lag. This is cheap (two `coordsAtPos` calls + six style assignments per update).
- The floating DOM elements (top bar, row handle, bottom pill) are created once in `onEnable` and reused — not recreated per editor transaction.
- The row handle menu (if implemented as a DOM popup rather than inline buttons) is created once and repositioned, not rebuilt per row change.

### NFR-3: Toggle Cycle Correctness

The plugin must survive repeated enable/disable cycles without leaking DOM nodes, event listeners, or CM6 extensions:

- All module-level state is reset to initial values at the end of `onDisable`.
- The `<style>` tag is removed in `onDisable`.
- All three floating DOM elements are removed from `document.body` in `onDisable`.
- `api.removeExtensions()` is always called in `onDisable`.
- `api.unregisterSidebarPanel("table-toolbar")` is called in `onDisable` if and only if the panel was registered in the corresponding `onEnable`.

### NFR-4: Undo Atomicity

Every table operation must result in exactly one entry on the CM6 undo stack. No operation may call `view.dispatch` more than once. Multi-part transforms (e.g. inserting a column into N rows) must be computed as a single string substitution on the full table source and submitted in one dispatch.

### NFR-5: Table Preservation

All string transforms must preserve:
- Trailing spaces within cells as-is (no trimming of user content).
- The table's original line endings (LF or CRLF) — use whatever the document uses.
- Pipe characters within cell content that are escaped (`\|`) — do not split on them as column delimiters.

---

## Edge Case Inventory

All items below are mandatory test cases for the Code Reviewer.

| # | Scenario | Expected Behaviour |
|---|---|---|
| EC-1 | Cursor is on the header row; Delete Row triggered | Operation is a no-op. Button is disabled (greyed out, pointer-events: none) in both floating and sidebar modes. No dispatch is emitted. |
| EC-2 | Cursor is on the separator line (`| --- | --- |`) | Cursor-in-table detection returns `true`. Row index is treated as `null`. All row operations (Insert Row Above/Below, Delete Row) are disabled. Column and table operations remain enabled. |
| EC-3 | Table has exactly one column; Delete Column triggered | Operation is a no-op. Delete Column button is disabled in both modes. No dispatch is emitted. |
| EC-4 | Table has exactly one body row; Delete Row triggered on that body row | The body row is deleted. The table is left with only the header row and separator. The result is a valid (if minimal) Markdown table. |
| EC-5 | Delete Table when table is the only content in the document | The document becomes empty (length 0). No crash. Cursor is placed at position 0. |
| EC-6 | Insert Column Left/Right on a table with mismatched column counts across rows | The operation inserts a cell into every row using the detected column count, normalising any short rows by appending empty cells as needed before inserting. The resulting table has uniform column counts. |
| EC-7 | Undo after any table operation | A single Cmd-Z reverts the entire operation (header, separator, and all body rows restored simultaneously). Only one undo step consumed. |
| EC-8 | Rapid successive operations (column insert, then align, then row delete) | Each produces a separate undo step. Three Cmd-Z presses are required to fully revert all three. |
| EC-9 | Insert Table when cursor is already inside a table | The new table is inserted after the existing table's last line, not inside it. The cursor's enclosing `Table` node's `to` position is used as the insertion point. |
| EC-10 | Insert Table when cursor is mid-line (not at line start) | A newline is prepended before the table template so the table starts on its own line. |
| EC-11 | Insert Table when document is empty | Template is inserted at position 0 with no leading newline. |
| EC-12 | Cursor moves from inside table to outside (e.g. arrow key past last row) | All three floating elements are hidden within one debounce cycle (≤ 150 ms). No stale elements remain visible. |
| EC-13 | Editor loses focus (window blur or click outside editor) | All floating elements are hidden immediately. |
| EC-14 | Floating top bar would render above the viewport top edge | Bar is flipped to render below the table's last line instead of above the first line. |
| EC-15 | Floating top bar near left or right viewport edge | Bar is clamped horizontally so it remains fully within the viewport. |
| EC-16 | Row handle would render outside the visible scroll area | Row handle is hidden (or clamped) when the active row is scrolled out of the editor's visible rect. |
| EC-17 | Plugin disabled while floating elements are visible | All three DOM elements are removed from `document.body` immediately in `onDisable`. No dangling elements after disable. |
| EC-18 | Plugin disabled while sidebar panel is registered | `api.unregisterSidebarPanel("table-toolbar")` is called. `SidebarManager` cleans up without error. |
| EC-19 | Rapid toggle (enable/disable/enable in quick succession) | No duplicate `<style>` tags, no orphaned DOM elements, no stale CM6 extensions, no duplicate sidebar panels. |
| EC-20 | `loadSettings()` returns `null` (first run) | Defaults used: `toolbarMode: "floating"`, `sidebarSide: "left"`. No crash. |
| EC-21 | `loadSettings()` returns a partial object (e.g. only `toolbarMode` present) | Missing key filled from defaults. No crash. Settings not corrupted. |
| EC-22 | `window.__MARKABLE_EDITOR_VIEW__` is `undefined` when a button is clicked | The click handler is a no-op. No uncaught exception. The plugin does not crash. |
| EC-23 | A new tab is opened while the plugin is enabled (editor view replaced) | `__MARKABLE_EDITOR_VIEW__` is read fresh on each button click and each `updateListener` call — never cached at enable-time. All operations target the current tab's editor view. |
| EC-24 | Table cell contains a pipe character escaped as `\|` | Column split logic does not treat `\|` as a column delimiter. Column count and indexing remain correct. |
| EC-25 | Table cell content includes leading/trailing spaces | Cell content is preserved verbatim. No trimming is applied by any transform. |
| EC-26 | Align operation when the separator row cell already has the same alignment | The dispatch is still emitted (idempotent write). The separator cell is normalised to the canonical form (e.g. ` :--- ` with consistent spacing). |
| EC-27 | Delete Column on the last remaining column when the table also has a header-only row | Covered by EC-3; Delete Column is disabled. |
| EC-28 | Insert Row Above/Below when cursor is on the last body row | Row is inserted at the correct position relative to the last row. The bottom pill still renders below the (now updated) last row. |
| EC-29 | Bottom pill clicked when cursor is not inside the table (pill somehow still visible) | Operation is a no-op. The pill hides itself and the cursor is not moved. |
| EC-30 | Sidebar mode — Insert Table clicked when `__MARKABLE_EDITOR_VIEW__` is null | No-op; no crash. Button click is silently ignored. |
| EC-31 | Table has CRLF line endings | All transforms preserve CRLF. The reconstructed table string uses the same line endings as the original. |
| EC-32 | Build: `table-toolbar` entry missing from `build-plugins.mjs` | `npm run build:plugins` does not produce `table-toolbar.js`. CI catches the omission. |
| EC-33 | Build: `table-toolbar` entry missing from `vite.plugins.config.ts` | `npm run build:plugins` (via vite.plugins.config.ts path) does not include the plugin. Both files must be updated. |

---

## Out of Scope (v1.0)

- Drag-and-drop column reordering.
- Multi-column alignment (applying alignment to a range of columns at once).
- Table formatting / pretty-printing (normalising cell widths to align pipes).
- Keyboard shortcuts for individual table operations.
- Live mode-switch (floating to sidebar) without plugin restart.
- Support for HTML `<table>` elements (operates only on Markdown pipe-tables).
- Merge/split cells (not representable in Markdown pipe-table syntax).
