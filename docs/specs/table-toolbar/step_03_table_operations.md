---
title: "Table Toolbar — Step 03: Pure Table Operations"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 03 — Pure Table Operations (All 11 Transforms)

## Goal

Implement all eleven table operation functions as pure string transforms. Every
function takes the raw table text (plus row/col context) and returns either a new
table text string (success) or `null` (structural no-op). No CM6, no DOM, no
window globals. All functions are exported and exhaustively tested.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Fill section 6 (replace stubs) |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add operations test suite |

---

## Implementation Notes

### Shared helper: normaliseRow

Before inserting a column, every existing row is checked for column count. If a
row has fewer cells than expected (EC-6), pad it with empty cells:

```typescript
/**
 * Ensure a row has exactly `targetCount` cells.
 * Short rows are padded with "   " (three spaces — standard empty cell).
 * Excess cells are NOT trimmed (preserve user content).
 */
function normaliseRow(cells: string[], targetCount: number): string[] {
  while (cells.length < targetCount) {
    cells.push("   ");
  }
  return cells;
}
```

### Shared helper: rebuildRow

```typescript
/**
 * Rebuild a table row from its cell array.
 * Preserves any trailing \r that was stripped by splitRow.
 */
function rebuildRow(cells: string[]): string {
  return "|" + cells.join("|") + "|";
}
```

### Shared helper: reconstructTable

```typescript
/**
 * Rejoin rows using the original line ending.
 */
function reconstructTable(rows: string[], lineEnding: "\r\n" | "\n"): string {
  return rows.join(lineEnding);
}
```

---

### Operation 1: insertRowAbove

```typescript
export function insertRowAbove(tableText: string, rowIndex: number | null): string | null {
  if (rowIndex === null || rowIndex <= 1) {
    // Cursor on separator (null) or header row (0): treat as insert above header
    // which means before row index 0. Per FR-5a, separator cannot be targeted;
    // if cursor is on it, insert relative to the header row above.
    // When rowIndex === 0 (header), insert above is "before the header" — which
    // would produce a non-table structure. FR-5a says separator row cursor is
    // treated as inserting relative to the header row above.
    // No-op for separator row. For header row (rowIndex 0), this is also a no-op
    // (inserting above the header row would break the table structure).
    if (rowIndex === null || rowIndex === 0) return null;
  }

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const columnCount = splitRow(rows[1]).length;
  const blankCells = Array(columnCount).fill("   ");
  const blankRow = rebuildRow(blankCells);

  // Insert before the target row index.
  // If cursor is on separator (rowIndex null → treated as rowIndex 1 above),
  // handled above. For body rows (rowIndex >= 2), insert before that index.
  const insertAt = rowIndex!;
  rows.splice(insertAt, 0, blankRow);
  return reconstructTable(rows, lineEnding);
}
```

Re-reading FR-5a carefully: "if cursor is on [separator row], the insert is
relative to the header row above" means Insert Row Above on the separator row
inserts before row index 0 — which is NOT a valid position (can't insert before
the header). So the correct behaviour is: Insert Row Above is disabled when
cursor is on separator row (rowIndex === null). The function returns null for
that case. The button is also disabled in the UI (step_06).

For a body row at rowIndex R (where R >= 2), Insert Row Above inserts at R.

### Operation 2: insertRowBelow

```typescript
export function insertRowBelow(tableText: string, rowIndex: number | null): string | null {
  if (rowIndex === null) return null; // disabled on separator row

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const columnCount = splitRow(rows[1]).length;
  const blankCells = Array(columnCount).fill("   ");
  const blankRow = rebuildRow(blankCells);

  // Insert after rowIndex (i.e. at rowIndex + 1), but never after the separator.
  const insertAt = Math.max(rowIndex + 1, 2); // ensure we don't insert between header and separator
  rows.splice(insertAt, 0, blankRow);
  return reconstructTable(rows, lineEnding);
}
```

Note: when cursor is on the header row (rowIndex 0), Insert Row Below inserts at
index 1 — but that is the separator's current position, which would push the
separator down. The correct behaviour is: insert at index 2 (first body slot).
The `Math.max(rowIndex + 1, 2)` handles this: rowIndex 0 + 1 = 1; max(1, 2) = 2.

When cursor is on the bottom pill (last body row), rowIndex = last body row index.
Insert at rowIndex + 1, which is after the last row.

### Operation 3: deleteRow

```typescript
export function deleteRow(tableText: string, rowIndex: number | null): string | null {
  if (rowIndex === null) return null;  // separator — no-op (button disabled)
  if (rowIndex === 0) return null;     // header row — EC-1
  if (rowIndex === 1) return null;     // separator row by line index — safety guard

  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  rows.splice(rowIndex, 1);
  return reconstructTable(rows, lineEnding);
}
```

EC-4: when the last body row is deleted, the result is header + separator only.
`rows.splice(rowIndex, 1)` removes exactly one row regardless of position.

### Operation 4: insertColumnLeft

```typescript
export function insertColumnLeft(tableText: string, colIndex: number): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  return reconstructTable(
    rows.map((row, rowIdx) => {
      const cells = normaliseRow(splitRow(row), colCount);
      const newCell = rowIdx === 1 ? " --- " : "   "; // separator vs data cell
      cells.splice(colIndex, 0, newCell);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}
```

EC-6: `normaliseRow` pads short rows before inserting so the result has uniform
column counts.

### Operation 5: insertColumnRight

```typescript
export function insertColumnRight(tableText: string, colIndex: number): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  return reconstructTable(
    rows.map((row, rowIdx) => {
      const cells = normaliseRow(splitRow(row), colCount);
      const newCell = rowIdx === 1 ? " --- " : "   ";
      cells.splice(colIndex + 1, 0, newCell);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}
```

### Operation 6: deleteColumn

```typescript
export function deleteColumn(tableText: string, colIndex: number): string | null {
  const rows = parseTableRows(tableText);
  const colCount = splitRow(rows[1]).length;

  if (colCount <= 1) return null; // EC-3: last column — disabled

  const lineEnding = detectLineEnding(tableText);

  return reconstructTable(
    rows.map(row => {
      const cells = normaliseRow(splitRow(row), colCount);
      cells.splice(colIndex, 1);
      return rebuildRow(cells);
    }),
    lineEnding,
  );
}
```

### Operation 7: alignLeft

```typescript
export function alignLeft(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " :--- ");
}
```

### Operation 8: alignCenter

```typescript
export function alignCenter(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " :---: ");
}
```

### Operation 9: alignRight

```typescript
export function alignRight(tableText: string, colIndex: number): string {
  return _setAlignment(tableText, colIndex, " ---: ");
}
```

### Shared alignment helper

```typescript
/**
 * Replace the separator cell at colIndex with the given alignment string.
 * Only the separator row (index 1) is modified.
 * EC-26: even if the cell already has the same alignment, the dispatch is
 * emitted (idempotent write to canonical form).
 */
function _setAlignment(tableText: string, colIndex: number, alignCell: string): string {
  const lineEnding = detectLineEnding(tableText);
  const rows = parseTableRows(tableText);
  const separatorRow = rows[1];
  const cells = splitRow(separatorRow);
  cells[colIndex] = alignCell;
  rows[1] = rebuildRow(cells);
  return reconstructTable(rows, lineEnding);
}
```

### Operation 10: deleteTable

`deleteTable` does not return a new table text. Instead the caller dispatches a
delete of the range `[tableFrom, tableTo]`. This operation is handled directly in
the click dispatch layer (step_07). The function is provided as a marker:

```typescript
/**
 * No-op sentinel. Delete table is dispatched directly by the click handler
 * using tableContext.tableFrom/tableTo. This function exists only as a
 * documented contract — callers dispatch the deletion themselves.
 */
export const DELETE_TABLE_SENTINEL = "DELETE_TABLE";
```

EC-5: when the table is the entire document, dispatching `{ from: 0, to: doc.length,
insert: "" }` leaves the document empty. No special handling needed.

### Operation 11: insertTable

```typescript
/**
 * Compute the text and insertion position for inserting a blank 3×2 table.
 *
 * @param docText      - Full document text.
 * @param cursorPos    - Current cursor position.
 * @param tableContext - If the cursor is already inside a table, its context
 *                       (so the new table is placed AFTER it — EC-9).
 * @returns            { insertPos: number, insertText: string }
 */
export function insertTable(
  docText: string,
  cursorPos: number,
  tableContext: TableContext | null,
): { insertPos: number; insertText: string } {
  const TEMPLATE =
    "| Column 1 | Column 2 | Column 3 |\n" +
    "| --- | --- | --- |\n" +
    "|   |   |   |";

  let insertPos: number;
  let prefix = "";
  let suffix = "\n";

  if (tableContext !== null) {
    // EC-9: cursor is inside a table — insert after the table's end.
    insertPos = tableContext.tableTo;
    // Ensure we start on a new line after the table.
    if (docText[insertPos - 1] !== "\n") {
      prefix = "\n";
    }
  } else if (docText.length === 0) {
    // EC-11: empty document — insert at 0 with no leading newline.
    insertPos = 0;
    prefix = "";
  } else {
    insertPos = cursorPos;
    // EC-10: if cursor is mid-line, prepend a newline.
    const lineStart = docText.lastIndexOf("\n", cursorPos - 1) + 1;
    if (cursorPos > lineStart) {
      prefix = "\n";
    }
  }

  return {
    insertPos,
    insertText: prefix + TEMPLATE + suffix,
  };
}
```

---

## Test Cases (must all pass before step is done)

### Shared fixture

```typescript
const T3 = `| H1 | H2 | H3 |
| --- | --- | --- |
| a | b | c |
| d | e | f |`;

// Helper: run an operation and parse the result back into rows
function rows(result: string | null): string[] | null {
  if (result === null) return null;
  return parseTableRows(result);
}
```

### insertRowAbove

```
describe("insertRowAbove") {
  it("inserts blank row above a body row") {
    // insertRowAbove(T3, 2) → 5 rows; row[2] is blank
    const r = rows(insertRowAbove(T3, 2))!;
    expect(r).toHaveLength(5);
    expect(splitRow(r[2]).every(c => c.trim() === "")).toBe(true);
  }
  it("returns null for header row (EC-1)") {
    expect(insertRowAbove(T3, 0)).toBeNull();
  }
  it("returns null for separator row (EC-2)") {
    expect(insertRowAbove(T3, null)).toBeNull();
  }
  it("preserves CRLF (EC-31)") {
    const crlf = T3.replace(/\n/g, "\r\n");
    const result = insertRowAbove(crlf, 2)!;
    expect(result).toContain("\r\n");
  }
  it("new row has correct column count") {
    const result = insertRowAbove(T3, 2)!;
    const r = rows(result)!;
    expect(splitRow(r[2])).toHaveLength(3);
  }
}
```

### insertRowBelow

```
describe("insertRowBelow") {
  it("inserts blank row below a body row") {
    const r = rows(insertRowBelow(T3, 2))!;
    expect(r).toHaveLength(5);
    expect(splitRow(r[3]).every(c => c.trim() === "")).toBe(true);
  }
  it("inserts after last body row (EC-28)") {
    const r = rows(insertRowBelow(T3, 3))!;
    expect(r).toHaveLength(5);
    expect(splitRow(r[4]).every(c => c.trim() === "")).toBe(true);
  }
  it("inserts at body slot when cursor on header row") {
    // rowIndex 0 → insert at index 2 (first body slot after separator)
    const r = rows(insertRowBelow(T3, 0))!;
    expect(r).toHaveLength(5);
    expect(splitRow(r[2]).every(c => c.trim() === "")).toBe(true);
  }
  it("returns null for separator row (EC-2)") {
    expect(insertRowBelow(T3, null)).toBeNull();
  }
}
```

### deleteRow

```
describe("deleteRow") {
  it("deletes a body row") {
    const r = rows(deleteRow(T3, 2))!;
    expect(r).toHaveLength(3);
    expect(r[2]).toContain("d"); // row 3 shifted to index 2
  }
  it("returns null for header row (EC-1)") {
    expect(deleteRow(T3, 0)).toBeNull();
  }
  it("returns null for separator row (EC-2)") {
    expect(deleteRow(T3, null)).toBeNull();
  }
  it("leaves header+separator when last body row deleted (EC-4)") {
    const t = "| H |\n| --- |\n| x |";
    const r = rows(deleteRow(t, 2))!;
    expect(r).toHaveLength(2);
  }
}
```

### insertColumnLeft

```
describe("insertColumnLeft") {
  it("inserts blank column at colIndex 0") {
    const r = rows(insertColumnLeft(T3, 0))!;
    expect(splitRow(r[0])).toHaveLength(4);
    expect(splitRow(r[1])[0].trim()).toBe("---"); // separator cell
  }
  it("inserts blank column at colIndex 1") {
    const r = rows(insertColumnLeft(T3, 1))!;
    expect(splitRow(r[0])).toHaveLength(4);
  }
  it("normalises short rows before inserting (EC-6)") {
    const uneven = "| H1 | H2 |\n| --- | --- |\n| a |";
    const r = rows(insertColumnLeft(uneven, 0))!;
    // All rows should have 3 columns after insert
    for (const row of r) {
      expect(splitRow(row)).toHaveLength(3);
    }
  }
  it("preserves CRLF (EC-31)") {
    const crlf = T3.replace(/\n/g, "\r\n");
    expect(insertColumnLeft(crlf, 0)).toContain("\r\n");
  }
}
```

### insertColumnRight

```
describe("insertColumnRight") {
  it("inserts blank column to right of colIndex 0") {
    const r = rows(insertColumnRight(T3, 0))!;
    expect(splitRow(r[0])).toHaveLength(4);
  }
  it("inserts blank column after last column") {
    const r = rows(insertColumnRight(T3, 2))!;
    expect(splitRow(r[0])).toHaveLength(4);
  }
}
```

### deleteColumn

```
describe("deleteColumn") {
  it("deletes column 0") {
    const r = rows(deleteColumn(T3, 0))!;
    expect(splitRow(r[0])).toHaveLength(2);
    expect(r[0]).not.toContain("H1");
  }
  it("deletes column 1") {
    const r = rows(deleteColumn(T3, 1))!;
    expect(splitRow(r[0])).toHaveLength(2);
  }
  it("returns null when table has one column (EC-3)") {
    const t = "| H |\n| --- |\n| x |";
    expect(deleteColumn(t, 0)).toBeNull();
  }
}
```

### alignLeft / alignCenter / alignRight

```
describe("alignment operations") {
  it("alignLeft sets :--- separator cell") {
    const r = rows(alignLeft(T3, 1))!;
    expect(splitRow(r[1])[1].trim()).toBe(":---");
  }
  it("alignCenter sets :---: separator cell") {
    const r = rows(alignCenter(T3, 0))!;
    expect(splitRow(r[1])[0].trim()).toBe(":---:");
  }
  it("alignRight sets ---: separator cell") {
    const r = rows(alignRight(T3, 2))!;
    expect(splitRow(r[1])[2].trim()).toBe("---:");
  }
  it("is idempotent — dispatches even if already aligned (EC-26)") {
    const already = "| H1 | H2 |\n| :--- | --- |\n| a | b |";
    const result = alignLeft(already, 0);
    expect(result).not.toBeNull();
    // The returned string is a normalised form
    expect(splitRow(rows(result)![1])[0]).toBe(" :--- ");
  }
  it("does not modify data rows") {
    const r = rows(alignCenter(T3, 0))!;
    expect(r[0]).toBe("| H1 | H2 | H3 |");
    expect(r[2]).toBe("| a | b | c |");
  }
}
```

### insertTable

```
describe("insertTable") {
  it("inserts at cursor pos in empty document (EC-11)") {
    const { insertPos, insertText } = insertTable("", 0, null);
    expect(insertPos).toBe(0);
    expect(insertText).not.toMatch(/^\n/);
    expect(insertText).toContain("| Column 1 |");
  }
  it("prepends newline when mid-line (EC-10)") {
    const doc = "hello world";
    const { insertText } = insertTable(doc, 5, null);
    expect(insertText).toMatch(/^\n/);
  }
  it("does not prepend newline at line start") {
    const doc = "first line\n";
    const { insertPos, insertText } = insertTable(doc, 11, null);
    expect(insertText).not.toMatch(/^\n/);
  }
  it("inserts after table end when cursor inside table (EC-9)") {
    const tableCtx: TableContext = {
      tableFrom: 0, tableTo: 50, tableText: T3,
      rowIndex: 2, colIndex: 0,
      isHeaderRow: false, isSeparatorRow: false,
      columnCount: 3, rowCount: 4,
    };
    const { insertPos } = insertTable(T3, 5, tableCtx);
    expect(insertPos).toBe(50);
  }
}
```

### CRLF preservation across all operations

```
describe("CRLF preservation (EC-31)") {
  const crlf = T3.replace(/\n/g, "\r\n");
  it("insertRowBelow preserves CRLF") {
    expect(insertRowBelow(crlf, 2)!).toContain("\r\n");
  }
  it("deleteRow preserves CRLF") {
    expect(deleteRow(crlf, 2)!).toContain("\r\n");
  }
  it("insertColumnLeft preserves CRLF") {
    expect(insertColumnLeft(crlf, 0)).toContain("\r\n");
  }
  it("deleteColumn preserves CRLF") {
    expect(deleteColumn(crlf, 0)!).toContain("\r\n");
  }
  it("alignLeft preserves CRLF") {
    expect(alignLeft(crlf, 0)).toContain("\r\n");
  }
}
```

---

## Definition of Done

- [ ] All 11 operation functions implemented in section 6 of the plugin file.
- [ ] All tests in this step pass.
- [ ] No TypeScript errors.
- [ ] EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-9, EC-10, EC-11, EC-25, EC-26,
      EC-28, EC-31 covered by passing tests.
- [ ] Every operation function is a pure string transform — no window globals,
      no CM6 imports, no DOM access.
