---
title: "Table Formula Cells — Step 01: Pure Evaluator Module"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 01 — Pure Evaluator Module (`src/editor/table-formula.ts`)

## Goal

Create `src/editor/table-formula.ts` as a pure TypeScript module: no DOM access, no CM6 imports, no Tauri imports, no module-level mutable state. Every exported function is pure (same inputs produce same outputs). Vitest can import and test this file without a DOM or jsdom environment.

This mirrors the `src/plugins/insert-count/insert-count.logic.ts` pattern exactly.

## Prerequisite

None. This step has no upstream dependencies. Implement it first.

---

## File Location

`src/editor/table-formula.ts`

---

## Section 1: Token Types

Define a discriminated union for all token types the tokenizer can produce:

```typescript
type TokenType =
  | "NUMBER"       // numeric literal: 3, 3.14, .5
  | "CELLREF"      // cell address: A1, b3, Z99 (case-insensitive accepted, normalised to uppercase)
  | "IDENT"        // bare identifier (function name): SUM, IF, round — always uppercased by tokenizer
  | "RANGE_SEP"    // the colon in A1:B3
  | "COMMA"        // ,
  | "LPAREN"       // (
  | "RPAREN"       // )
  | "OP"           // +  -  *  /  %  ^
  | "CMP"          // >  <  >=  <=  =  <>
  | "EOF";

interface Token {
  type: TokenType;
  raw: string;     // original text as it appears in the expression
  value?: number;  // populated for NUMBER tokens
}
```

**Important:** The tokenizer outputs `IDENT` for bare letter sequences. The parser checks whether an `IDENT` is followed by `LPAREN` to distinguish a function call from a spurious identifier (which produces `#ERR`).

`CELLREF` is a letter (A–Z, case-insensitive) immediately followed by one or more digits, with no separating whitespace. The regex is `/^([A-Za-z])(\d+)$/`. The tokenizer checks each alphanumeric token against this pattern.

---

## Section 2: Tokenizer

### Function signature

```typescript
export function tokenize(expr: string): Token[]
```

### Algorithm

1. Initialise `pos = 0`. Loop while `pos < expr.length`.
2. Skip whitespace characters (space, tab only — newlines will not appear in a single cell formula).
3. Match the next token using the following priority order:

   a. **Two-character comparison operators** `>=`, `<=`, `<>` — match before single-char operators.
   b. **Single-character comparison** `>`, `<`, `=`.
   c. **Single-character arithmetic** `+`, `-`, `*`, `/`, `%`, `^`.
   d. **Single-character punctuation** `(`, `)`, `:`, `,`.
   e. **Numeric literal** — regex `/^\d*\.\d+|\d+/` (handles `.5`, `3.14`, `3`). Create `{ type: "NUMBER", raw, value: parseFloat(raw) }`.
   f. **Alphanumeric identifier** — regex `/^[A-Za-z][A-Za-z0-9]*/`. Test against `/^[A-Za-z]\d+$/` to decide `CELLREF` vs `IDENT`. For `IDENT`, uppercase the `raw` value (so `sum` becomes `SUM`). For `CELLREF`, uppercase the letter portion.
   g. **Unrecognised character** — throw `SyntaxError` (caller catches and returns `#ERR`).

4. Append an `{ type: "EOF" }` token at the end.

### Notes

- The tokenizer never sees the leading `=` — the caller strips it before calling `tokenize`.
- The tokenizer never sees modifier suffixes — `splitModifiers()` is called first (see Section 3).
- The `:` character produces a `RANGE_SEP` token.

---

## Section 3: Modifier Splitter

### Function signature

```typescript
export function splitModifiers(
  formulaBody: string
): { expr: string; modifiers: string[] }
```

### Purpose

Separates the arithmetic expression from any trailing `-ModifierName` segments before tokenisation. The result's `expr` field is passed to `tokenize()`. The `modifiers` array is passed to `applyModifiers()`.

### Algorithm

The scan proceeds **right to left**, peeling modifier suffixes one at a time:

```
remaining = formulaBody  (everything after the leading '=', already stripped)
modifiers = []

loop:
  search for the last '-' in `remaining`
  if not found: break

  candidateName = remaining.slice(lastDashIndex + 1)
  if candidateName matches /^[A-Z][a-zA-Z]+$/:
    prepend candidateName to modifiers
    remaining = remaining.slice(0, lastDashIndex)
    continue loop
  else:
    break

return { expr: remaining, modifiers }
```

**Critical disambiguation rule (AD-06, FR-11.2, Constraint 10):**

A trailing `-<word>` is a modifier only when `<word>` matches `/^[A-Z][a-zA-Z]+$/` exactly:
- First character must be uppercase A–Z.
- Remaining characters must be letters only (no digits, no underscores).
- Minimum total length: 2 characters (one uppercase letter + at least one more letter).

This means:
- `-CommaFormat` → modifier (passes `/^[A-Z][a-zA-Z]+$/`)
- `-AccountStyle` → modifier
- `-B1` → NOT a modifier (`B1` has a digit)
- `-b` → NOT a modifier (lowercase start)
- `-TotalFormat` → modifier but unknown → `applyModifiers()` will return `#NAME` (FR-11.6)

**EC-60 walkthrough:**

Input formula body: `A1-B1-CommaFormat`

1. Last `-` at index 5, candidate `CommaFormat` → matches → modifiers = `["CommaFormat"]`, remaining = `A1-B1`
2. Last `-` in `A1-B1` at index 2, candidate `B1` → does NOT match (has digit) → break
3. Return `{ expr: "A1-B1", modifiers: ["CommaFormat"] }`

---

## Section 4: AST Node Types

```typescript
type FormulaError = "#ERR" | "#REF" | "#DIV/0" | "#CIRC" | "#VALUE" | "#NAME";
type CellValue = number | FormulaError;

type ASTNode =
  | { type: "number"; value: number }
  | { type: "cellRef"; col: number; row: number }      // 0-based indices into RawTable
  | { type: "range"; c1: number; r1: number; c2: number; r2: number }  // 0-based, normalised ascending
  | { type: "unary"; op: "-"; operand: ASTNode }
  | { type: "binary"; op: "+" | "-" | "*" | "/" | "%" | "^"; left: ASTNode; right: ASTNode }
  | { type: "compare"; op: ">" | "<" | ">=" | "<=" | "=" | "<>"; left: ASTNode; right: ASTNode }
  | { type: "call"; name: string; args: ASTNode[] };
```

Cell reference indices in AST nodes are **0-based** (column 0 = column A, row 0 = first body row). The parser converts the user-facing 1-based notation during parsing.

---

## Section 5: Recursive Descent Parser

### Function signature

```typescript
export function parse(tokens: Token[]): ASTNode
```

Throws `SyntaxError` on any parse error. The `evaluateTableFormulas()` entry point wraps the call in a try/catch and returns `#ERR`.

### Grammar (in precedence order, lowest to highest)

```
expression   ::= comparison
comparison   ::= addition ( cmpOp addition )*
addition     ::= multiplication ( ("+" | "-") multiplication )*
multiplication ::= power ( ("*" | "/" | "%") power )*
power        ::= unary ("^" unary)*           // right-associative
unary        ::= "-" unary | primary
primary      ::= NUMBER
               | CELLREF
               | CELLREF ":" CELLREF          // range literal
               | IDENT "(" argList ")"        // function call
               | "(" expression ")"
argList      ::= expression ("," expression)*
               | ε
```

### Parser state

The parser maintains a cursor `pos` (integer index into `tokens[]`).

Helper methods:
- `peek(): Token` — returns `tokens[pos]` (or EOF if past end)
- `consume(type?: TokenType): Token` — returns `tokens[pos++]`, throws if `type` is specified and doesn't match
- `match(type: TokenType): boolean` — returns true and advances `pos` if the current token matches

### Range parsing in `primary`

When a `CELLREF` token is seen in `primary`, look ahead one token. If the next token is `RANGE_SEP`, parse the second `CELLREF` and return a `range` node with normalised (ascending) 0-based indices. Otherwise, return a `cellRef` node.

**Single-column range check deferred to `evalNode`.** The parser does not reject multi-row/multi-column ranges — it builds the `range` node regardless of shape. `evalNode` rejects rectangle ranges with `#ERR` (FR-03.2).

### Column reference validation

In the `primary` rule, when converting a `CELLREF` token to a `cellRef` AST node:
- Column letter(s): only single A–Z letters are valid. If the CELLREF's column portion has more than one character (which cannot happen given the tokenizer regex `/^[A-Za-z]\d+$/` — the tokenizer only produces single-letter CELLREF), no special handling is needed.
- Convert column letter to 0-based index: `col = letter.toUpperCase().charCodeAt(0) - 65`.
- Convert row number to 0-based index: `row = parseInt(rowStr, 10) - 1`.

Note: `AA1` would be tokenised as `IDENT("AA")` followed by `NUMBER(1)` — the parser will fail to match a `primary` production for this combination and throw `SyntaxError` → `#ERR`. This correctly handles EC-08.

### IF special handling

`IF` has exactly three arguments: a comparison expression, a true-branch expression, and a false-branch expression. The parser treats `IF` identically to other functions at parse time (3-arg function call). The evaluator enforces the exact argument count (FR-04.5).

---

## Section 6: Evaluator

### Evaluation context

```typescript
interface RawTable {
  header: string[];
  body: string[][];
}

interface EvalContext {
  rawTable: RawTable;
  cache: Map<string, CellValue>;    // key: "C:R" (0-based), value: resolved CellValue
  visiting: Set<string>;            // cycle detection: currently-being-evaluated cell keys
}
```

### `resolveRef` — cell value resolution

```typescript
export function resolveRef(
  col: number,
  row: number,
  ctx: EvalContext,
  depth: number
): CellValue
```

Algorithm:

1. Bounds check: if `col` or `row` is out of range for `ctx.rawTable`, return `"#REF"`.
2. Depth check: if `depth > 50`, return `"#REF"` (FR-06.4).
3. Cache check: if `ctx.cache.has(key)`, return cached value.
4. Cycle check: if `ctx.visiting.has(key)`, return `"#CIRC"`.
5. Get raw cell string: `ctx.rawTable.body[row][col].trim()`.
6. If raw is empty: cache and return `0` (FR-02.6).
7. If raw starts with `=`: this is a formula cell — evaluate it recursively.
   - Add `key` to `ctx.visiting`.
   - Call `evaluateCellFormula(raw.slice(1), ctx, depth + 1)`.
   - Remove `key` from `ctx.visiting`.
   - Cache the `CellValue` result (note: store the numeric result, not the display string).
   - Return the result.
8. If `parseFloat(raw)` is not `NaN` and `String(parseFloat(raw)) === raw.trim()` or the raw value is a valid numeric string: cache and return the parsed number.
9. Otherwise: cache and return the sentinel `null` (to be converted to `#VALUE` by the arithmetic evaluator). Actually — return the string `"#VALUE"` to signal a non-numeric cell when used in arithmetic contexts. Aggregate functions will handle this by skipping (FR-04.6).

**Note on step 8 numeric parsing:** Use `isNumericString(raw)`:

```typescript
function isNumericString(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed) return false;
  return !isNaN(Number(trimmed)) && trimmed !== "";
}
```

This accepts `"3"`, `"3.14"`, `".5"`, `"-3"`. It rejects `""`, `"hello"`, `"#ERR"`.

### `evalNode` — AST node evaluator

```typescript
export function evalNode(
  node: ASTNode,
  ctx: EvalContext,
  depth: number
): CellValue
```

#### Case: `number`
Return `node.value`.

#### Case: `cellRef`
Call `resolveRef(node.col, node.row, ctx, depth)`.

#### Case: `range`
Ranges are only valid as direct arguments inside function calls. If `evalNode` is called directly on a `range` node (i.e., used in arithmetic), return `"#ERR"`.

#### Case: `unary`
Evaluate `operand`. If it is a `FormulaError`, return it. Otherwise return `-operand`.

#### Case: `binary`
Evaluate `left` and `right`. If either is a `FormulaError`, return it (left takes precedence).

Operator dispatch:
- `+`: `left + right`
- `-`: `left - right`
- `*`: `left * right`
- `/`: if `right === 0` return `"#DIV/0"`, else `left / right`
- `%`: if `right === 0` return `"#DIV/0"`, else `left % right`
- `^`: `Math.pow(left, right)`

#### Case: `compare`
Evaluate `left` and `right`. If either is a `FormulaError`, return it.

Operator dispatch (returns `1` for true, `0` for false):
- `>`: `left > right ? 1 : 0`
- `<`: `left < right ? 1 : 0`
- `>=`: `left >= right ? 1 : 0`
- `<=`: `left <= right ? 1 : 0`
- `=`: `left === right ? 1 : 0`
- `<>`: `left !== right ? 1 : 0`

#### Case: `call` — function dispatch

First, uppercase `node.name`. Then dispatch:

##### SUM
- Args: exactly one `range` node, or one or more `cellRef`/`number` nodes.
- Collect numeric values (using `collectRangeValues()` helper for `range` nodes; `resolveRef()` for `cellRef`; literal for `number`).
- Non-numeric cells are skipped (no `#VALUE`).
- Return sum. If no numeric values, return `0`.

##### AVG
- Same collection as SUM.
- If no numeric values: return `"#ERR"` (FR-04.6).
- Otherwise: return `sum / count`.

##### MIN
- Same collection.
- If no numeric values: return `"#ERR"`.
- Otherwise: return `Math.min(...values)`.

##### MAX
- Same collection.
- If no numeric values: return `"#ERR"`.
- Otherwise: return `Math.max(...values)`.

##### COUNT
- Same collection, but count cells that `isNumericString()` accepts (not formula errors).
- Return count as a number.

##### ROUND
- Exactly 2 args required (FR-04.3). Wrong count → `"#ERR"`.
- Eval arg 0 (value) and arg 1 (digits). Both must be numbers.
- Implementation: `Math.round(value * Math.pow(10, digits)) / Math.pow(10, digits)`.
- Store a flag on the return path: `ROUND` results use `toFixed(digits)` in the formatter (FR-08.4). See `formatNumericResult()` in Section 7.
- **Design note:** `evalNode` returns a plain `CellValue` (number). The ROUND-specific display formatting is handled by a wrapper in `evaluateCellFormula()` that detects when the top-level AST node is a ROUND call and passes `{ isRound: true, digits: N }` to `formatNumericResult()`. The internal numeric value stored in the cache is the unformatted result.

##### ABS
- Exactly 1 arg required (FR-04.4). Wrong count → `"#ERR"`.
- Eval arg 0. Must be a number.
- Return `Math.abs(value)`.

##### IF
- Exactly 3 args required (FR-04.5). Wrong count → `"#ERR"`.
- Eval arg 0 (condition). Must be a number.
- If condition !== 0 (truthy): return eval(arg 1).
- Else: return eval(arg 2).

##### Unknown function name
- Return `"#NAME"` (FR-04.2).

---

### `collectRangeValues` helper

```typescript
function collectRangeValues(
  node: { type: "range"; c1: number; r1: number; c2: number; r2: number },
  ctx: EvalContext,
  depth: number
): CellValue[]
```

1. Single-column check: `c1 === c2` (same column, multiple rows). OK.
2. Single-row check: `r1 === r2` (same row, multiple columns). OK.
3. Rectangle (both differ): return `["#ERR"]` (FR-03.2, EC-21).
4. Bounds check: if any endpoint is out of table bounds, return `["#REF"]` (FR-03.4).
5. Iterate over the range cells. Call `resolveRef()` for each. Collect all results.
6. Return the raw array (callers filter non-numeric values themselves).

---

## Section 7: Result Formatter

### Function signature

```typescript
export function formatNumericResult(
  value: number,
  isRoundCall: boolean,
  roundDigits: number
): string
```

Algorithm:
1. If `isRoundCall && roundDigits >= 0`: return `value.toFixed(roundDigits)` (FR-08.4). This guarantees exactly `roundDigits` decimal places.
2. If `isRoundCall && roundDigits < 0`: the ROUND result is an integer-scale value. Apply standard formatting (step 3).
3. Standard formatting:
   - `const normalised = parseFloat(value.toPrecision(10))` (NFR-04, FR-08.2).
   - If `Number.isInteger(normalised)`: return `String(normalised)` (FR-08.3 — no decimal point).
   - Otherwise: return `String(normalised)`.

---

## Section 8: Modifier Application

### Function signature

```typescript
export function applyModifiers(
  displayStr: string,
  modifiers: string[]
): string
```

Algorithm:

1. If `displayStr.startsWith("#")`: return `displayStr` unchanged (FR-11.7 — error tokens bypass modifiers).
2. Unknown modifier check: for each modifier in `modifiers`, if it is not in the supported set (`"CommaFormat"`, `"AccountStyle"`), return `"#NAME"` immediately (FR-11.6).
3. Apply modifiers in a two-pass style (order-independence per FR-11.5):

   - Parse `displayStr` to a number: `const num = parseFloat(displayStr)`. If `NaN`, return `displayStr` unchanged (defensive — should not occur for a non-error result).
   - Determine `isNegative = num < 0`.
   - Determine absolute display value: `const absStr = String(Math.abs(parseFloat(displayStr)))` — re-parse from string to preserve decimal format if `ROUND` was used (pass through the string as-is if it contains a decimal).

   **Implementation detail for order independence:** Rather than applying modifiers sequentially (which would be order-dependent for `AccountStyle` + `CommaFormat`), apply them in a defined canonical order regardless of input order:

   Step A — `-CommaFormat` if present:
   - Split `absStr` into integer and decimal parts on `.`.
   - Apply `Number.toLocaleString("en-US")` on the integer part (or use a manual thousands-separator insertion).
   - Rejoin with decimal part if present.

   Step B — `-AccountStyle` if present:
   - If `isNegative`: wrap the formatted string in parentheses, omit the leading minus sign.
   - If `num >= 0`: no change (FR-11.9).

4. Return the final string.

**`-CommaFormat` implementation note:** Using `Number.toLocaleString("en-US")` is locale-sensitive. A safer implementation that avoids locale issues in test environments:

```typescript
function applyCommaFormat(absStr: string): string {
  const [intPart, decPart] = absStr.split(".");
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart !== undefined ? `${formatted}.${decPart}` : formatted;
}
```

This regex approach is deterministic and locale-independent, making tests reliable on any machine.

---

## Section 9: Table Markdown Parser

### Function signature

```typescript
export function parseTableMarkdown(rawMarkdown: string): RawTable
```

Algorithm:

1. Split `rawMarkdown` by `"\n"`. Filter out empty lines.
2. `isDelim(line)` helper: `/^[\|\s:\-]+$/.test(line.trim())` — same logic as `TableWidget.toDOM()`.
3. `parseCells(line)` helper: split on `"|"`, strip leading/trailing empty parts (same logic as `TableWidget.toDOM()`). Trim each cell.
4. Walk lines:
   - First non-delim line → `header`.
   - First delim line sets `inHeader = false`.
   - Subsequent non-delim lines → body rows.
5. Return `{ header, body }`.

**Important:** `parseTableMarkdown` must produce cell strings that exactly match what `TableWidget.toDOM()` uses for display — trimmed, pipe-split, outer empties stripped. This ensures formula references map to the same cell values that appear in rendered output.

---

## Section 10: Cell Formula Evaluator (internal)

```typescript
function evaluateCellFormula(
  rawFormulaBody: string,   // everything after '=', not yet modifier-stripped
  ctx: EvalContext,
  depth: number
): CellValue
```

This is the internal function called by `resolveRef()` and `evaluateTableFormulas()` for each formula cell.

Algorithm:

1. `const { expr, modifiers } = splitModifiers(rawFormulaBody)`.
2. If `expr.trim() === ""`: return `"#ERR"` (EC-02 — empty formula body).
3. Try block:
   - `const tokens = tokenize(expr.trim())`.
   - `const ast = parse(tokens)`.
   - Detect if top-level AST is a ROUND call for formatting: `const isRound = ast.type === "call" && ast.name === "SUM" ... ` — actually detect `ast.type === "call" && ast.name === "ROUND"`.
   - `const value = evalNode(ast, ctx, depth)`.
   - Return `value` (numeric or error token). The modifiers and formatting are applied in `evaluateTableFormulas()`, not here, because `resolveRef()` needs the raw numeric value.
4. Catch `SyntaxError`: return `"#ERR"`.
5. Catch any other error: return `"#ERR"`.

**ROUND formatting note:** The `isRound` flag and `roundDigits` are needed for the display formatter but NOT for the cached cell value. The separation works as follows: `resolveRef()` caches the raw `CellValue` returned by `evaluateCellFormula()`. `evaluateTableFormulas()` calls its own path for the display-layer formula evaluation where it additionally tracks whether the AST root was ROUND.

---

## Section 11: Entry Point

### Function signature

```typescript
export function evaluateTableFormulas(rawMarkdown: string): EvaluatedTable
```

```typescript
interface EvaluatedTable {
  header: string[];
  body: string[][];
}
```

Algorithm:

1. `const rawTable = parseTableMarkdown(rawMarkdown)`.
2. Initialise `ctx: EvalContext = { rawTable, cache: new Map(), visiting: new Set() }`.
3. Build `body: string[][]`:
   - For each body row `r` (0-based), for each cell `c` (0-based):
     - `const raw = rawTable.body[r][c].trim()`.
     - If `raw.startsWith("=")`:
       - `const formulaBody = raw.slice(1)`.
       - `const { expr, modifiers } = splitModifiers(formulaBody)`.
       - If `expr.trim() === ""`: `displayStr = "#ERR"`.
       - Else:
         - Try: tokenize, parse, detect ROUND, evalNode.
         - If `CellValue` is a `FormulaError` string: `displayStr = value`.
         - Else: `displayStr = formatNumericResult(value, isRound, roundDigits)`.
         - Catch → `displayStr = "#ERR"`.
       - `displayStr = applyModifiers(displayStr, modifiers)`.
     - Else: `displayStr = marked.parseInline(raw)` — wait, no. `evaluateTableFormulas` is a pure module with no `marked` import. It returns raw strings for non-formula cells. `TableWidget.toDOM()` applies `marked.parseInline()` for non-formula cells.
     - So: for non-formula cells, return the raw trimmed string. `TableWidget.toDOM()` handles all Markdown rendering (including for non-formula cells).
   - Collect into `body[r][c]`.
4. Return `{ header: rawTable.header, body }`.

**Important clarification on Markdown rendering in cells:** `table-formula.ts` is a pure module and must NOT import `marked`. The `EvaluatedTable.body` contains either:
- A formula display string (the computed result or error token) for formula cells.
- The raw trimmed cell string for non-formula cells.

`TableWidget.toDOM()` in `live-preview.ts` applies `marked.parseInline()` to non-formula cells and sets `innerHTML` directly for formula cells. The integration in step_02 handles this distinction.

---

## Section 12: ROUND Detection for Formatter

To pass `isRound` and `roundDigits` to `formatNumericResult()` from the entry point (while still returning only a `CellValue` from `resolveRef()`), use this approach in `evaluateTableFormulas()`:

```typescript
// In the entry-point body loop only (not in resolveRef):
let isRound = false;
let roundDigits = 0;

const ast = parse(tokens);  // may throw → caught below

if (ast.type === "call" && ast.name === "ROUND" && ast.args.length === 2) {
  isRound = true;
  // Evaluate the digits argument to get the static digit count for formatting.
  // This is safe because ROUND's second arg is typically a literal number.
  const digitsResult = evalNode(ast.args[1], ctx, 0);
  if (typeof digitsResult === "number") roundDigits = Math.trunc(digitsResult);
}

const value = evalNode(ast, ctx, 0);
```

This keeps `resolveRef()` clean while giving the display formatter the information it needs.

---

## Section 13: Export Checklist

The following must be exported from `table-formula.ts` for direct Vitest testing:

- `EvaluatedTable` (interface)
- `RawTable` (interface)
- `EvalContext` (interface)
- `FormulaError` (type)
- `CellValue` (type)
- `ASTNode` (type)
- `Token` (interface)
- `TokenType` (type)
- `evaluateTableFormulas` (function)
- `parseTableMarkdown` (function)
- `splitModifiers` (function)
- `tokenize` (function)
- `parse` (function)
- `evalNode` (function)
- `resolveRef` (function)
- `applyModifiers` (function)
- `formatNumericResult` (function)

Internal helpers (`isNumericString`, `collectRangeValues`, `applyCommaFormat`, `evaluateCellFormula`) do not need to be exported — they are tested indirectly through the public functions.

---

## Size Budget

The complete `table-formula.ts` must stay under 300 lines of substantive code (excluding comments and blank lines). If it grows beyond this, split the tokenizer into a separate non-exported helper section within the same file — do not create a second file.

---

## Completion Criteria for Step 01

- [ ] File `src/editor/table-formula.ts` exists and compiles with `tsc --noEmit`.
- [ ] All exported functions have JSDoc comments.
- [ ] No DOM, CM6, or Tauri imports anywhere in the file.
- [ ] No module-level mutable variables.
- [ ] Running `npm test tests/editor/table-formula.test.ts` (step_03) passes all tests.
- [ ] No `TODO` comments in the file.
