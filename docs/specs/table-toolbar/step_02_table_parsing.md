---
title: "Table Toolbar — Step 02: Pure Table Parsing"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 02 — Pure Table Parsing (TableContext Detection, Row/Col Resolution)

## Goal

Implement and test all the pure parsing logic: `detectTableContext`,
`parseTableRows`, and the column-splitting helper `splitRow`. After this step all
cursor-in-table detection and row/column indexing is fully tested with plain
strings — no CM6 or DOM required in tests.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Fill section 5 (replace stubs) |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add parsing test suite |

---

## Implementation Notes

### 1. splitRow — column splitting with escaped-pipe guard (AD-6, EC-24)

```typescript
/**
 * Split a Markdown table row string into cell content strings.
 *
 * Rules:
 *   - Split on `|` not preceded by `\` (negative lookbehind).
 *   - Discard the first and last empty segments produced by leading/trailing `|`.
 *   - Do NOT trim cell content (NFR-5, EC-25).
 *
 * @param rowText - A single table row line, e.g. "| foo | bar\\| baz |"
 * @returns Array of cell content strings, e.g. [" foo ", " bar\\| baz "]
 */
export function splitRow(rowText: string): string[] {
  // Remove optional leading/trailing whitespace for the row itself but NOT
  // the cell interiors. The row text may have a trailing `\r` (CRLF — EC-31);
  // trim the row before splitting.
  const trimmed = rowText.replace(/\r$/, "");
  const parts = trimmed.split(/(?<!\\)\|/);
  // Drop first and last empty segments (the outside of the opening and closing `|`).
  return parts.slice(1, parts.length - 1);
}
```

### 2. detectLineEnding — EC-31

```typescript
/**
 * Detect the line ending used in the table text.
 * Returns "\r\n" if the text contains any CRLF sequence, otherwise "\n".
 */
export function detectLineEnding(text: string): "\r\n" | "\n" {
  return text.includes("\r\n") ? "\r\n" : "\n";
}
```

### 3. parseTableRows — extract rows from raw table text

```typescript
/**
 * Split table text into an array of row strings (one per line).
 *
 * Splits on \n (after stripping \r so CRLF tables work — EC-31).
 * Filters out empty trailing lines.
 *
 * @param tableText - Raw table source text.
 * @returns Array of row strings (with \r stripped, so LF-only).
 */
export function parseTableRows(tableText: string): string[] {
  return tableText.split(/\r?\n/).filter(line => line.trim() !== "");
}
```

### 4. TableContext interface (Section 5)

Replace the stub with the full interface from AD-5:

```typescript
export interface TableContext {
  tableFrom:      number;       // absolute offset in document
  tableTo:        number;
  tableText:      string;       // raw text including any trailing newline
  rowIndex:       number | null; // null = cursor on separator row
  colIndex:       number;       // 0-based
  isHeaderRow:    boolean;
  isSeparatorRow: boolean;
  columnCount:    number;
  rowCount:       number;       // includes header + separator + all body rows
}
```

### 5. isSeparatorRow helper

```typescript
/**
 * Return true when the row string is a Markdown table separator row
 * (contains only `|`, `-`, `:`, and whitespace).
 */
export function isSeparatorRow(rowText: string): boolean {
  return /^[\s|:\-]+$/.test(rowText.replace(/\r$/, ""));
}
```

### 6. detectTableContext — the main detection function

This function has two call paths:

**Production path** — called inside the CM6 updateListener:
```typescript
function detectTableContextFromState(state: EditorStateType): TableContext | null
```
Uses `syntaxTree(state).resolve(state.selection.main.head)` to walk ancestors
for a `Table` node, then calls `detectTableContextFromParsed(...)`.

**Pure/testable path** (exported for tests):
```typescript
export function detectTableContext(
  docText: string,
  cursorPos: number,
  tree: SyntaxTree,
): TableContext | null
```

Both converge on the shared resolution logic below.

#### Algorithm (shared between both call paths)

Step 1 — Walk the syntax tree to find the enclosing `Table` node:

```
let node = tree.resolve(cursorPos, 1)
while node is not null:
  if node.name === "Table": found — break
  node = node.parent
if not found: return null
```

Step 2 — Extract table boundaries:

```
tableFrom = tableNode.from
tableTo   = tableNode.to
tableText = docText.slice(tableFrom, tableTo)
```

Step 3 — Determine current row: walk the same resolved node's ancestors for
`TableRow` or `TableDelimiter`:

```
let rowNode = tree.resolve(cursorPos, 1)
while rowNode is not null:
  if rowNode.name === "TableRow" || rowNode.name === "TableDelimiter": break
  rowNode = rowNode.parent
```

Step 4 — Convert row node to a row index within the table rows array:

```
rows = parseTableRows(tableText)
if rowNode is null or rowNode.name === "TableDelimiter":
  rowIndex = null        // separator row — EC-2
  isSeparatorRow = true
else:
  // find which row index this node corresponds to by line number
  cursorLine   = docText.slice(0, cursorPos).split("\n").length   // 1-based
  tableStartLine = docText.slice(0, tableFrom).split("\n").length // 1-based
  rowIndex = cursorLine - tableStartLine   // 0-based within table
  isSeparatorRow = false
```

Step 5 — Determine column index: walk ancestors for `TableCell` or `TableHeader`:

```
let cellNode = tree.resolve(cursorPos, 1)
while cellNode is not null:
  if cellNode.name === "TableCell" || cellNode.name === "TableHeader": break
  cellNode = cellNode.parent

if cellNode is null: colIndex = 0
else:
  // Count TableCell/TableHeader siblings to the left
  let sibling = cellNode.prevSibling
  let count = 0
  while sibling is not null:
    if sibling.name === "TableCell" || sibling.name === "TableHeader": count++
    sibling = sibling.prevSibling
  colIndex = count
```

Step 6 — Compute columnCount from separator row (most reliable column count source):

```
separatorRowText = rows[1]  // index 1 is always the separator
columnCount = splitRow(separatorRowText).length
```

Step 7 — Assemble and return TableContext:

```
return {
  tableFrom, tableTo, tableText,
  rowIndex,
  colIndex,
  isHeaderRow:    rowIndex === 0,
  isSeparatorRow: rowIndex === null,
  columnCount,
  rowCount: rows.length,
}
```

#### Implementation note: `EditorState` type in production path

The production `detectTableContextFromState` function calls `syntaxTree(state)`
where `syntaxTree` is obtained from `window.__CM_VIEW__` (not `@codemirror/state`
— actually `syntaxTree` lives in `@lezer/highlight` or `@codemirror/language`).
Get it from the CM view global:

```typescript
function getCmState(): typeof import("@codemirror/state") {
  return (window as any).__CM_STATE__ as typeof import("@codemirror/state");
}
function getCmLanguage(): typeof import("@codemirror/language") {
  return (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
}
```

Check `src/lib/cm-globals.ts` (or similar) to confirm what is exposed on
`window.__CM_STATE__` and `window.__CM_LANGUAGE__`. Use whatever globals are
already established in the project rather than adding new ones.

**If `syntaxTree` is not yet on a window global**: access it via
`(window as any).__CM_VIEW__.syntaxTree` if the project exports it that way,
or add it to `cm-globals.ts` following the established pattern there.

#### Lezer tree import for tests

In `tests/plugins/table-toolbar/table-toolbar.test.ts`, use `@lezer/common`
directly to create a synthetic `SyntaxTree` stub, OR use the actual
`markdown-language` parser to parse real table strings. The latter is cleaner:

```typescript
import { parser } from "@lezer/markdown";

function makeTree(text: string) {
  return parser.parse(text);
}
```

`@lezer/markdown` is already a dev-dependency of the project. Using it produces
a real tree that exercises the exact ancestor-walking logic.

---

## Test Cases (must all pass before step is done)

### splitRow

```
describe("splitRow") {
  it("splits a well-formed row") {
    // splitRow("| a | b | c |") → [" a ", " b ", " c "]
  }
  it("does not split on escaped pipe (EC-24)") {
    // splitRow("| foo\\| bar | baz |") → [" foo\\| bar ", " baz "]
  }
  it("preserves leading/trailing spaces in cells (EC-25)") {
    // splitRow("|  padded  | x |") → ["  padded  ", " x "]
  }
  it("handles CRLF row (EC-31)") {
    // splitRow("| a | b |\r") → [" a ", " b "]
  }
}
```

### isSeparatorRow

```
describe("isSeparatorRow") {
  it("identifies standard separator") {
    // isSeparatorRow("| --- | --- |") → true
  }
  it("identifies left-aligned separator") {
    // isSeparatorRow("| :--- | :--- |") → true
  }
  it("identifies center-aligned separator") {
    // isSeparatorRow("| :---: | :---: |") → true
  }
  it("identifies right-aligned separator") {
    // isSeparatorRow("| ---: | ---: |") → true
  }
  it("rejects data rows") {
    // isSeparatorRow("| hello | world |") → false
  }
  it("rejects header rows") {
    // isSeparatorRow("| Column 1 | Column 2 |") → false
  }
}
```

### detectLineEnding

```
describe("detectLineEnding") {
  it("detects LF") {
    // detectLineEnding("| a |\n| b |") → "\n"
  }
  it("detects CRLF (EC-31)") {
    // detectLineEnding("| a |\r\n| b |") → "\r\n"
  }
}
```

### parseTableRows

```
describe("parseTableRows") {
  it("splits a 3-row table") {
    const t = "| a | b |\n| --- | --- |\n| c | d |";
    // parseTableRows(t) → 3 elements
  }
  it("handles CRLF tables (EC-31)") {
    const t = "| a | b |\r\n| --- | --- |\r\n| c | d |";
    // parseTableRows(t) → 3 elements
  }
  it("ignores empty trailing line") {
    const t = "| a |\n| --- |\n| b |\n";
    // parseTableRows(t) → 3 elements, not 4
  }
}
```

### detectTableContext — with real lezer tree

Use a helper:

```typescript
const TABLE_3COL = `| Col1 | Col2 | Col3 |
| --- | --- | --- |
| a | b | c |
| d | e | f |`;

function ctx(text: string, pos: number): TableContext | null {
  return detectTableContext(text, pos, parser.parse(text));
}
```

```
describe("detectTableContext") {
  it("returns null when cursor is outside table") {
    const doc = "hello world";
    expect(ctx(doc, 5)).toBeNull();
  }

  it("detects cursor on header row") {
    const pos = TABLE_3COL.indexOf("Col1") + 1;
    const result = ctx(TABLE_3COL, pos);
    expect(result).not.toBeNull();
    expect(result!.rowIndex).toBe(0);
    expect(result!.isHeaderRow).toBe(true);
    expect(result!.isSeparatorRow).toBe(false);
    expect(result!.colIndex).toBe(0);
    expect(result!.columnCount).toBe(3);
  }

  it("detects cursor on separator row (EC-2)") {
    const separatorLine = "| --- | --- | --- |";
    const pos = TABLE_3COL.indexOf(separatorLine) + 2;
    const result = ctx(TABLE_3COL, pos);
    expect(result).not.toBeNull();
    expect(result!.isSeparatorRow).toBe(true);
    expect(result!.rowIndex).toBeNull();
  }

  it("detects cursor column 1 on body row") {
    // cursor in "Col2" cell of row 3 (0-based row 2 = first body row)
    const pos = TABLE_3COL.indexOf("| b |") + 3; // inside "b" cell
    const result = ctx(TABLE_3COL, pos);
    expect(result!.colIndex).toBe(1);
    expect(result!.rowIndex).toBe(2);
  }

  it("returns correct tableFrom and tableTo boundaries") {
    const pos = TABLE_3COL.indexOf("Col1") + 1;
    const result = ctx(TABLE_3COL, pos)!;
    expect(result.tableFrom).toBe(0);
    expect(result.tableTo).toBe(TABLE_3COL.length);
  }

  it("returns correct columnCount (EC-3 guard)") {
    // single-column table
    const t = "| A |\n| --- |\n| x |";
    const pos = t.indexOf("x") ;
    const result = ctx(t, pos)!;
    expect(result.columnCount).toBe(1);
  }

  it("handles escaped pipe in cell content (EC-24)") {
    const t = "| a\\|b | c |\n| --- | --- |\n| x | y |";
    const pos = t.indexOf("x");
    const result = ctx(t, pos)!;
    // cursor in first cell of body row — colIndex should be 0
    expect(result.columnCount).toBe(2);
  }

  it("preserves tableText for round-trip (EC-25)") {
    const pos = TABLE_3COL.indexOf("d") ;
    const result = ctx(TABLE_3COL, pos)!;
    expect(result.tableText).toBe(TABLE_3COL);
  }

  it("returns correct rowCount") {
    const pos = TABLE_3COL.indexOf("d");
    const result = ctx(TABLE_3COL, pos)!;
    expect(result.rowCount).toBe(4); // header + separator + 2 body rows
  }
}
```

---

## Definition of Done

- [ ] `splitRow`, `isSeparatorRow`, `detectLineEnding`, `parseTableRows` implemented.
- [ ] `TableContext` interface defined (not a stub).
- [ ] `detectTableContext` implemented (pure function accepting docText + pos + SyntaxTree).
- [ ] All tests in this step pass.
- [ ] No TypeScript errors (`npx tsc --noEmit`).
- [ ] EC-2, EC-24, EC-25, EC-31 are covered by passing tests.
