---
title: "Step 04 — Pure Table Logic"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 04 — Pure Table Logic

## What to Build

Port sections 5–6 of `src/plugins/table-toolbar/table-toolbar.plugin.ts` verbatim into
the unified file. These are:

1. `TableContext` type and the pure context-detection helpers (`splitRow`, `isSeparatorRow`,
   `parseTableRows`, `detectTableContext` — lezer-tree-walking version).
2. All 11 pure table operation functions.

After this step the unified file contains the complete table manipulation logic.

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Append after section 7 (pure image logic).

---

## Precise Specification

### Section 8 — Table context type, detection helpers, and pure table operations

Copy verbatim from the original `table-toolbar.plugin.ts` sections 5–6. Do NOT copy
any functions that are already present in section 7 (specifically `detectLineEnding`).

**`TableContext` type:**
```typescript
export interface TableContext {
  tableStart: number;     // doc position of first char of header row
  tableEnd: number;       // doc position of last char of last row (inclusive)
  rows: string[];         // raw text of each row (excluding separator)
  separatorIndex: number; // index of the separator row in the original parsed rows
  activeRowIndex: number; // 0-based index of the row the cursor is on
  colCount: number;       // number of columns (from header row)
  activeColIndex: number; // 0-based index of the column the cursor is in
}
```

**Detection helpers:**
- `splitRow(row: string): string[]`
- `isSeparatorRow(row: string): boolean`
- `detectLineEnding` — DO NOT redeclare. Use the function from section 7 by reference.
- `parseTableRows(text: string): { rows: string[]; separatorIdx: number } | null`
- `detectTableContext(tree, state): TableContext | null`

**11 pure table operations:**
- `insertRowAbove(ctx, doc): string`
- `insertRowBelow(ctx, doc): string`
- `deleteRow(ctx, doc): string`
- `moveRow(ctx, doc, direction: "up" | "down"): string`
- `insertColumnLeft(ctx, doc): string`
- `insertColumnRight(ctx, doc): string`
- `deleteColumn(ctx, doc): string`
- `alignLeft(ctx, doc): string`
- `alignCenter(ctx, doc): string`
- `alignRight(ctx, doc): string`
- `insertTable(colCount: number, rowCount: number): string` — plus `DELETE_TABLE_SENTINEL` constant

Update section header to `── 8. Pure table logic ──`.

Exports required (for test file compatibility — must match what
`table-toolbar.test.ts` currently imports):
```typescript
export type { TableContext };
export {
  splitRow,
  isSeparatorRow,
  parseTableRows,
  detectTableContext,
  insertRowAbove,
  insertRowBelow,
  deleteRow,
  moveRow,
  insertColumnLeft,
  insertColumnRight,
  deleteColumn,
  alignLeft,
  alignCenter,
  alignRight,
  DELETE_TABLE_SENTINEL,
  insertTable,
};
```

Note: `detectTableContext` in this section is the pure version that receives a parsed
syntax tree as its first argument. The CM6-aware wrapper (`detectTableContextFromState`)
that reads `window.__CM_LANGUAGE__` lives in step_05.

---

## Acceptance Criteria

### AC-4.1 — All existing table-toolbar tests pass with updated import path

The pre-migration smoke test: change the import in `tests/plugins/table-toolbar/table-toolbar.test.ts`
to point at the unified file:
```typescript
from "../../../src/plugins/markdown-toolbar/markdown-toolbar.plugin"
```
All tests must pass. The test file itself is NOT committed with this change — this is a
local smoke-test only. The actual migration happens in step_09.

### AC-4.2 — detectTableContext: cursor inside table returns TableContext
Given a GFM table document parsed with `markdownLanguage.parser`, `detectTableContext`
with a cursor inside the table body returns a non-null `TableContext` with correct
`colCount`, `activeRowIndex`, `activeColIndex`.

### AC-4.3 — One-row table: deleteRow is disabled (EC-23)
A `TableContext` where `rows.length === 1` causes `deleteRow` to return the document
unchanged (or the caller disables the button — existing table-toolbar behaviour preserved).

### AC-4.4 — One-column table: deleteColumn is disabled (EC-24)
A `TableContext` where `colCount === 1` causes `deleteColumn` to return the document
unchanged (or the caller disables the button — existing behaviour preserved).

### AC-4.5 — insertRowBelow appends a row with correct column count
`insertRowBelow` on a 3-column table adds a row with 3 empty cells.

### AC-4.6 — alignCenter updates separator row
`alignCenter` on a 2-column table changes both separator cells to `:---:`.

### AC-4.7 — detectLineEnding not redeclared
```
grep -n "function detectLineEnding" src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts
```
Returns exactly one line (the definition in section 7).

### AC-4.8 — DELETE_TABLE_SENTINEL is exported and non-empty string
`typeof DELETE_TABLE_SENTINEL === "string"` and `DELETE_TABLE_SENTINEL.length > 0`.

---

## Risks and Dependencies

- **Risk**: `detectLineEnding` referenced in table operations but not redeclared. If the
  Developer accidentally copies the function definition from `table-toolbar.plugin.ts`,
  TypeScript will error on duplicate declaration. That error is the correct safeguard.
- **Risk**: `detectTableContext` in section 8 accepts a pre-parsed tree. The CM6-aware
  wrapper in step_05 calls it after obtaining the tree from `window.__CM_LANGUAGE__`.
  Keeping the pure version separate makes it testable without CM6 globals.
- **Dependency**: Step 03 must be complete. `detectLineEnding` must be defined before
  section 8 is parsed.
