---
title: "Table Formula Cells"
last-updated: "2026-04-21"
review-cadence-days: 7
status: reference
---

# Table Formula Cells Requirements Spec

## Validation Status

**VALIDATED — 2026-04-21.** Requirements approved. Ready for Software Architect.

---

## Summary

As a user, I want to type spreadsheet-style formula expressions (e.g., `=SUM(B2:B4)`, `=A1*B2`) into Markdown table cells so that Markable computes and displays their numeric results in live preview, while the raw source continues to show the formula text.

---

## Background and Motivation

The existing Advanced Tables feature (`tablePreviewField` StateField in `src/editor/live-preview.ts` + toolbar logic in `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`) renders GFM tables as HTML in live preview. Users already treat these tables like lightweight spreadsheets. The next natural step is formula evaluation: let cells contain `=<expression>` and show the computed value in the rendered table while preserving the formula in source.

This feature extends `TableWidget.toDOM()` in `live-preview.ts` to evaluate formula cells before setting `td.innerHTML`. No new CM6 `StateField` is required — the existing `tablePreviewField` already owns the table rendering lifecycle.

---

## Goals

- Allow formula expressions beginning with `=` in any body cell (not header cells) of a GFM Markdown table.
- Evaluate formulas at render time inside `TableWidget.toDOM()` using a custom mini-evaluator (no external formula library).
- Support cell references (`A1`, `B3`), range references (`B2:B4`), basic arithmetic operators, a small set of aggregate functions, and postfix output modifiers.
- Display computed results in live preview; show the raw formula in source/edit mode (cursor-on-line reveals source, consistent with existing Typora-style behavior).
- Show clearly styled error tokens (`#ERR`, `#REF`, `#DIV/0`, `#CIRC`, `#VALUE`, `#NAME`) in-cell for invalid or unresolvable formulas.
- Ship as a modification to `live-preview.ts` (core, always-on) rather than as a separate toggleable plugin, because formula cells only apply inside tables which already require `tablePreviewField` to be active.

---

## Functional Requirements

### FR-01: Formula Cell Syntax

**FR-01.1** A formula cell is any table body cell whose trimmed content begins with `=`. Header cells (first row, before the separator row) are never evaluated as formulas — their content is always rendered as literal text.

**FR-01.2** The `=` prefix is the sole trigger. A cell containing `=SUM(B2:B4)` is a formula cell; a cell containing `Sum: 10` is literal text.

**FR-01.3** The formula body (everything after the leading `=`) is parsed by the mini-evaluator. Whitespace immediately after `=` is stripped before parsing (i.e., `= A1 + B1` is equivalent to `=A1+B1`).

**FR-01.4** Formula cells may appear in any body row and any column. Multiple formula cells in the same table are independent and each evaluated separately.

### FR-02: Cell Reference Scheme

**FR-02.1** Cell addresses use **spreadsheet-style notation**: a column letter (A–Z, case-insensitive) followed by a 1-based row number. Examples: `A1`, `B3`, `Z99`.

**FR-02.2** The **row number in a cell address counts only body rows** (rows after the separator row). Row 1 is the first body row. The header row is not addressable.

**FR-02.3** The **column letter maps to the column position** in the table (A = column 1, B = column 2, ..., Z = column 26). Tables with more than 26 columns are unsupported for column references beyond Z; references past Z resolve to `#REF`.

**FR-02.4** A cell address that refers to a row or column that does not exist in the table resolves to `#REF`.

**FR-02.5** A referenced cell that is itself a formula cell is evaluated first (depth-first resolution). Circular reference detection is required (see FR-06).

**FR-02.6** A referenced cell whose content is empty resolves to `0` for numeric contexts and `""` for string contexts.

**FR-02.7** A referenced cell whose content is non-numeric and cannot be coerced to a number resolves to `#VALUE` when used in a numeric operation, and to its literal string value when used in a string context (i.e., inside a string concatenation — string concat is out of scope for v1, see Out of Scope).

### FR-03: Range References

**FR-03.1** A range is written as `StartCell:EndCell` (e.g., `B2:B4`, `A1:C1`). Ranges are only valid as arguments to aggregate functions (SUM, AVG, etc.); using a range in a bare arithmetic expression is an error resolved as `#ERR`.

**FR-03.2** Only single-column or single-row ranges are required for v1. A multi-row, multi-column rectangle (e.g., `A1:C3`) resolves to `#ERR` in v1 (explicitly documented so the Architect does not over-engineer the range resolver).

**FR-03.3** If `StartCell` row > `EndCell` row, or `StartCell` column > `EndCell` column, the evaluator swaps them silently (normalises the range to ascending order).

**FR-03.4** A range where any endpoint falls outside the table resolves to `#REF`.

### FR-04: Supported Functions

The following functions must be implemented in the mini-evaluator. All functions take a range or a comma-separated list of cell references/literals as arguments.

| Function | Description | Example |
|---|---|---|
| `SUM` | Sum of all numeric values in range/list | `=SUM(B2:B5)` |
| `AVG` | Arithmetic mean of numeric values | `=AVG(B2:B4)` |
| `MIN` | Smallest numeric value | `=MIN(A1,A2,A3)` |
| `MAX` | Largest numeric value | `=MAX(B2:B6)` |
| `COUNT` | Count of cells containing a parseable number | `=COUNT(A1:A5)` |
| `ROUND` | Round to N decimal places: `ROUND(value, digits)` | `=ROUND(A1/B1, 2)` |
| `ABS` | Absolute value of a single numeric argument | `=ABS(A1-B1)` |
| `IF` | Conditional: `IF(condition, true_val, false_val)` — condition is an arithmetic expression; non-zero = true | `=IF(A1>10, 1, 0)` |

**FR-04.1** Function names are case-insensitive (`sum`, `SUM`, `Sum` are all valid).

**FR-04.2** Functions not in the above table resolve to `#NAME`.

**FR-04.3** `ROUND` requires exactly two arguments: a numeric expression and an integer digits count. Negative digits values are valid and round to tens, hundreds, etc. (e.g., `ROUND(123.456, -1)` → `120`), matching Excel/Google Sheets behavior via `Math.round(v * 10^d) / 10^d`. Providing wrong argument count resolves to `#ERR`.

**FR-04.4** `ABS` requires exactly one argument. Wrong argument count resolves to `#ERR`.

**FR-04.5** `IF` requires exactly three arguments. Wrong argument count resolves to `#ERR`. Conditions support numeric comparisons only; string comparisons in IF conditions are out of scope for v1.

**FR-04.6** For aggregate functions (`SUM`, `AVG`, `MIN`, `MAX`, `COUNT`), non-numeric cells within the range are silently skipped (not treated as `#VALUE`). If the range contains no numeric cells, `SUM` returns `0`, `COUNT` returns `0`, `AVG` / `MIN` / `MAX` return `#ERR` (no numeric values to aggregate).

### FR-05: Arithmetic Operators and Expressions

**FR-05.1** Supported infix operators: `+` (add), `-` (subtract), `*` (multiply), `/` (divide), `%` (modulo), `^` (exponentiation).

**FR-05.2** Supported comparison operators for `IF` conditions: `>`, `<`, `>=`, `<=`, `=` (equality), `<>` (inequality). Comparison evaluates to `1` (true) or `0` (false).

**FR-05.3** Parentheses for grouping are required in the evaluator (`=(A1+B1)*C1`).

**FR-05.4** Unary minus is supported (`=-A1`, `=-(A1+B1)`).

**FR-05.5** Division by zero (`/0` or `%0`) produces `#DIV/0`.

**FR-05.6** Exponentiation: `2^10` = 1024. Fractional exponents (e.g., `4^0.5` = 2) are allowed.

**FR-05.7** Numeric literals in formulas may be integers or decimals (`3`, `3.14`, `.5`). Scientific notation (e.g., `1e5`) is not required in v1.

### FR-06: Circular Reference Detection

**FR-06.1** Before evaluating a formula cell, the evaluator must track which cells are currently on the evaluation call stack. If a cell attempts to reference a cell that is already being evaluated (direct or transitive cycle), the evaluation for that cell returns `#CIRC`.

**FR-06.2** The circular reference check must be table-local — it does not need to span multiple tables.

**FR-06.3** All cells participating in the detected cycle display `#CIRC` (not just the cell that first triggered the detection).

**FR-06.4** Non-circular deep reference chains are capped at 50 levels. If a chain of cell-to-cell references exceeds 50 hops without forming a cycle, the evaluation returns `#REF`. This prevents pathological deep chains from causing stack overflows.

### FR-07: Error Tokens

The following error tokens are displayed in-cell when a formula cannot be evaluated:

| Token | Meaning |
|---|---|
| `#ERR` | Syntax error, parse failure, wrong argument count, unsupported range shape, or any unclassified evaluation error |
| `#REF` | Cell or range address falls outside the table, or reference chain depth exceeds 50 levels |
| `#DIV/0` | Division (or modulo) by zero |
| `#CIRC` | Circular reference detected |
| `#VALUE` | A referenced cell's value cannot be coerced to a number in a numeric context |
| `#NAME` | Unknown function name or unknown output modifier name |

**FR-07.1** Error tokens are rendered inside the `<td>` element with a CSS class `cm-formula-error` so they can be distinctly styled (e.g., red text). A single class is used for all error types — no severity differentiation.

**FR-07.2** A cell displaying an error token still occupies its normal column position in the rendered table. The error does not cause the row to collapse or misalign.

**FR-07.3** In source/edit mode (cursor on the table), the raw formula `=SUM(X1:X99)` is always shown, even if it evaluates to an error. The error display is a live-preview-only concern.

### FR-08: Result Formatting

**FR-08.1** Numeric results are rendered as JavaScript's default `Number.toString()` representation, with one exception: results that are floating-point numbers with more than 10 significant digits are rounded to 10 significant digits to prevent ugly precision noise (e.g., `0.1 + 0.2` renders as `0.3` not `0.30000000000000004`).

**FR-08.2** The implementation uses `parseFloat(result.toPrecision(10))` to strip trailing zeros (e.g., `1.50000` becomes `1.5`).

**FR-08.3** Integer results (no fractional part after floating-point arithmetic) are displayed without a decimal point (e.g., `6.0` renders as `6`).

**FR-08.4** `ROUND(value, digits)` output is formatted to exactly `digits` decimal places in the rendered cell (e.g., `ROUND(1.005, 2)` renders as `1.01`, not `1.0100000000000002`).

**FR-08.5** Default negative number display is a leading minus sign (e.g., `-5`). This can be overridden per-cell using the `-AccountStyle` output modifier (see FR-11).

### FR-09: Live Preview Integration

**FR-09.1** Formula evaluation happens inside `TableWidget.toDOM()` in `src/editor/live-preview.ts`. The `TableWidget` already receives the full raw Markdown of the table block. The evaluator receives this raw text, builds a cell-value matrix, evaluates formulas, and substitutes results before setting `td.innerHTML`.

**FR-09.2** The existing Typora-style cursor-on-line behavior in `buildTableDecorations()` already handles source reveal: when any line of the table block is the "active line," the `TableWidget` decoration is not applied and the raw Markdown is visible. No additional cursor-tracking logic is required for formula cells.

**FR-09.3** The `eq()` method of `TableWidget` compares raw Markdown strings. Since formula results are computed during `toDOM()`, the comparison remains correct — the same raw Markdown always produces the same evaluated result.

**FR-09.4** The evaluator must be a pure function: `evaluateTableFormulas(rawMarkdown: string): EvaluatedTable`. It receives the raw Markdown table string and returns a 2D array of display strings (one per cell). `TableWidget.toDOM()` uses this array to populate `td.innerHTML` instead of using raw cell text directly.

**FR-09.5** The evaluator and its types must be extracted into a separate file `src/editor/table-formula.ts` (mirroring the `insert-count.logic.ts` pattern) so that it can be unit-tested without DOM or CM6 setup.

### FR-10: Scope and Isolation

**FR-10.1** Each table is evaluated independently. A formula in Table 1 cannot reference cells in Table 2.

**FR-10.2** The mini-evaluator does not have access to the document outside the table block. There is no document-wide named range support.

**FR-10.3** Formula evaluation does not mutate the CM6 document. It is a pure read-only rendering transform.

### FR-11: Output Modifiers

Output modifiers are postfix directives appended to the formula expression using `-ModifierName` syntax. They transform how the numeric result is displayed without affecting the cell's value as seen by other formulas.

**FR-11.1** Modifier syntax: zero or more modifiers may be appended after the formula expression, each introduced by a `-` separator followed by a PascalCase modifier name. Example: `=SUM(A1:A3)-CommaFormat-AccountStyle`.

**FR-11.2** The `-ModifierName` suffix is parsed AFTER the formula expression is fully evaluated. The `-` introducing a modifier is syntactically distinct from arithmetic subtraction: subtraction only appears between numeric operands inside the formula expression; a modifier `-` appears at the top level of the formula body (after the closing paren of the last function call, or after the last operand).

**FR-11.3** Modifiers apply to the **display string only**. The underlying numeric result used when another formula references this cell is the unmodified numeric value. Modifiers are a presentation-layer concern.

**FR-11.4** Supported modifiers for v1:

| Modifier | Effect | Example input | Example output |
|---|---|---|---|
| `-CommaFormat` | Formats result with locale thousands separators | `1234567.89` | `1,234,567.89` |
| `-AccountStyle` | Displays negative numbers in parentheses instead of with a leading minus | `-123` | `(123)` |

**FR-11.5** Modifiers may be chained in any order. `=SUM(A1:A3)-CommaFormat-AccountStyle` and `=SUM(A1:A3)-AccountStyle-CommaFormat` produce identical output.

**FR-11.6** An unknown modifier name (any modifier not in the table above) causes the cell to render `#NAME`. This takes precedence over displaying the formula result.

**FR-11.7** If the formula result is itself an error token (e.g., `#DIV/0`), modifiers are not applied — the error token is displayed as-is.

**FR-11.8** `-CommaFormat` applied to a non-integer result preserves the decimal portion (e.g., `1234.56` → `1,234.56`).

**FR-11.9** `-AccountStyle` applied to a zero or positive result has no visible effect (the value renders normally, without parentheses).

**FR-11.10** `-AccountStyle` combined with `-CommaFormat` on a negative number produces a parenthesised, comma-formatted result (e.g., `-1234.56` → `(1,234.56)`).

### FR-12: Settings and Discoverability

**FR-12.1** Formula cell support is always active when `tablePreviewField` is active. There is no separate settings toggle for this feature.

**FR-12.2** No new Command Bar command, menu item, or keyboard shortcut is introduced by this feature.

**FR-12.3** A one-line note in the Plugins Panel detail view for the Advanced Tables feature (if one exists) is not required — this is a core rendering enhancement, not a plugin.

---

## UX / Interaction Design

### Source vs. Preview Behavior

- **Preview mode (cursor not on the table)**: formula cells show their computed result or error token. The `=` prefix and formula text are invisible. Output modifiers are applied to the display string.
- **Edit mode (cursor anywhere on the table block)**: the `tablePreviewField` decoration is suppressed; raw Markdown is visible, including the full formula text with modifiers (e.g., `=SUM(B2:B4)-CommaFormat`). This is the existing behavior of `buildTableDecorations()` — no additional work required.

### Error Display

- Error tokens (`#ERR`, `#REF`, etc.) appear inline in the cell with class `cm-formula-error`.
- Color and style are theme-governed by CSS variable `--formula-error-color` (default: a muted red that works on both light and dark themes). Fallback: `#c0392b`.

### Header Row Exclusion

- The table header row (row above the separator) never shows formula results. Header cells with `=` content are rendered as literal text (including the `=`), making it clear to the user that headers are not computed.

---

## Non-Functional Requirements

**NFR-01: Pure Evaluator** — `table-formula.ts` must be a pure module (no DOM access, no CM6 imports, no side effects). All logic is testable with plain Node/Vitest.

**NFR-02: Performance** — A table with 10 rows x 10 columns (100 cells, up to 20 formula cells each referencing ranges of up to 10 cells) must evaluate in under 5ms. Evaluation happens synchronously in `toDOM()` — no async allowed.

**NFR-03: No External Dependency** — The mini-evaluator must not import any formula/spreadsheet library. Only standard JavaScript. If the scope of supported functions later requires a library, that is a separate requirements change.

**NFR-04: Result Precision** — Floating-point noise is suppressed via `toPrecision(10)` + `parseFloat()` (FR-08.2). No special-casing of individual operations.

**NFR-05: Theme Compatibility** — Error token CSS uses `--formula-error-color` CSS variable. No hardcoded hex except as `var()` fallback.

**NFR-06: No CM6 Extension Overhead** — This feature adds no new CM6 `StateField`, `ViewPlugin`, or extension. It only modifies `TableWidget.toDOM()` and adds a pure helper module.

---

## Integration Points

| System | Integration | Notes |
|---|---|---|
| `src/editor/live-preview.ts` | Modify `TableWidget.toDOM()` to call `evaluateTableFormulas()` | Primary integration point |
| `src/editor/table-formula.ts` | New file — pure evaluator module including modifier parsing | Extracted for testability |
| `tests/editor/table-formula.test.ts` | New Vitest test file | Unit tests for evaluator and modifier pipeline (no DOM) |
| Existing `buildTableDecorations()` | No changes needed | Source-reveal behavior already correct |
| CSS (existing theme files) | Add `--formula-error-color` variable and `.cm-formula-error` rule | Theme-compatible error styling |

---

## Out of Scope (v1)

1. **String concatenation in formulas** — Formula cells produce numeric results only. String operations (`=A1 & " items"`) are not supported.
2. **Multi-row, multi-column rectangle ranges** — Only single-row or single-column ranges (e.g., `A1:A5` or `A1:E1`) are required. `A1:C3` is `#ERR`.
3. **Columns beyond Z (AA, AB…)** — Only A–Z column addressing. Tables with more than 26 columns work normally; columns past Z are not addressable in formulas.
4. **Formula auto-fill / drag-fill** — No UI for extending a formula across a range of cells.
5. **Named ranges** — No support for naming a cell or range.
6. **Cross-table references** — A formula in one table cannot reference a cell in another table.
7. **Date/time arithmetic** — No date functions or date-typed cells.
8. **Sorting and filtering** — Deferred to a follow-on feature. The user's original request mentioned sorting/filtering; that is explicitly a separate increment.
9. **Formula bar UI** — No dedicated formula input bar outside the table cell. Formulas are typed directly into the cell in source mode.
10. **Undo isolation** — Formula re-evaluation happens at render time; it does not interact with the undo stack (no document mutations occur).
11. **Scientific notation literals** — `1e5` as a literal in a formula is not required in v1.
12. **String comparisons in IF conditions** — `IF` only evaluates numeric comparisons. `=IF(A1="yes", 1, 0)` is not supported in v1.
13. **Additional output modifiers** — Only `-CommaFormat` and `-AccountStyle` are supported in v1. New modifiers (e.g., `-Percent`, `-Currency`) require a separate requirements change.

### Known Limitation

**Escaped pipes in table cells**: The GFM table parser does not support escaped pipe characters (`\|`) inside cell content. A formula or cell value containing a literal `|` will break the table column parsing. This is a pre-existing limitation of the Markdown table format and is explicitly out of scope for this feature.

---

## Edge Case Inventory

The following edge cases are the mandatory test checklist for the Code Reviewer. Every item must be covered by a Vitest test in `tests/editor/table-formula.test.ts` or a documented manual verification step.

**EC-01: Formula in header cell** — A cell in the header row (row 0, before the separator) contains `=SUM(A1:A3)`. Expected: rendered as literal text `=SUM(A1:A3)`, not evaluated. Header cells must never be treated as formulas.

**EC-02: Empty formula body** — A cell contains `=` with nothing after it (or only whitespace). Expected: renders `#ERR`. The evaluator must handle an empty expression without crashing.

**EC-03: Self-reference** — Cell `B2` contains `=B2`. Expected: renders `#CIRC`. Direct self-reference is a degenerate circular reference.

**EC-04: Two-cell cycle** — `A1` contains `=B1` and `B1` contains `=A1`. Expected: both cells render `#CIRC`.

**EC-05: Multi-hop cycle** — `A1 = B1`, `B1 = C1`, `C1 = A1`. Expected: all three render `#CIRC`.

**EC-06: Reference to non-existent row** — Table has 3 body rows. A formula references `A10`. Expected: renders `#REF`.

**EC-07: Reference to non-existent column** — Table has 3 columns. A formula references `D1`. Expected: renders `#REF`.

**EC-08: Reference to column beyond Z** — Formula uses `AA1`. Expected: renders `#REF` (unsupported in v1).

**EC-09: Empty referenced cell** — Formula `=A1+B1` where `A1` is empty. Expected: empty cell contributes `0`; result is `B1`'s value.

**EC-10: Non-numeric referenced cell in arithmetic** — Formula `=A1*2` where `A1` contains `"hello"`. Expected: renders `#VALUE`.

**EC-11: Non-numeric cell in aggregate range** — `=SUM(A1:A3)` where `A2` contains `"hello"`. Expected: `A2` is silently skipped; SUM returns `A1 + A3`.

**EC-12: Division by zero** — `=A1/0` or `=10/B1` where `B1=0`. Expected: renders `#DIV/0`.

**EC-13: Modulo by zero** — `=A1%0`. Expected: renders `#DIV/0`.

**EC-14: Unknown function** — `=MEDIAN(A1:A3)`. Expected: renders `#NAME`.

**EC-15: Malformed function call — no closing paren** — `=SUM(A1:A3`. Expected: renders `#ERR` (parse error, not a crash).

**EC-16: Malformed expression — double operator** — `=A1++B1`. Expected: renders `#ERR`.

**EC-17: ROUND with wrong argument count** — `=ROUND(A1)` (missing digits). Expected: renders `#ERR`.

**EC-18: ABS with two arguments** — `=ABS(A1, B1)`. Expected: renders `#ERR`.

**EC-19: IF with wrong argument count** — `=IF(A1>0, 1)` (missing false branch). Expected: renders `#ERR`.

**EC-20: Range outside table** — `=SUM(A1:A99)` when the table has only 3 body rows. Expected: renders `#REF`.

**EC-21: Multi-column/multi-row rectangle range** — `=SUM(A1:C3)`. Expected: renders `#ERR` (unsupported range shape in v1).

**EC-22: Reversed range endpoints** — `=SUM(A3:A1)`. Expected: evaluator normalises to ascending order and returns the correct sum (`A1+A2+A3`). No `#REF`.

**EC-23: Floating-point precision** — `=0.1+0.2`. Expected: renders `0.3`, not `0.30000000000000004` (NFR-04 precision suppression).

**EC-24: Integer result from float arithmetic** — `=6.0/2.0`. Expected: renders `6`, not `6.0`.

**EC-25: ROUND output format** — `=ROUND(1.005, 2)`. Expected: renders a two-decimal result (implementation note: JavaScript `toPrecision` rounding — the Architect must document the exact floating-point behavior and whether it deviates from Excel).

**EC-26: Unary minus on literal** — `=-5`. Expected: renders `-5`.

**EC-27: Unary minus on cell reference** — `=-A1` where `A1=3`. Expected: renders `-3`.

**EC-28: Unary minus on expression** — `=-(A1+B1)` where `A1=2`, `B1=3`. Expected: renders `-5`.

**EC-29: Exponentiation** — `=2^8`. Expected: renders `256`.

**EC-30: Fractional exponent** — `=4^0.5`. Expected: renders `2`.

**EC-31: Comparison in IF** — `=IF(A1>5, 10, 20)` where `A1=7`. Expected: renders `10`.

**EC-32: IF false branch** — `=IF(A1>5, 10, 20)` where `A1=3`. Expected: renders `20`.

**EC-33: Nested function call** — `=ROUND(SUM(A1:A3), 1)`. Expected: evaluates the inner SUM first, then applies ROUND.

**EC-34: Formula referencing another formula cell** — `B1 = =A1*2` (where `A1=5`), `C1 = =B1+1`. Expected: `C1` renders `11` (B1 resolves to `10`).

**EC-35: COUNT with mixed numeric and non-numeric cells** — `=COUNT(A1:A4)` where `A1=1`, `A2="text"`, `A3=3`, `A4=""`. Expected: renders `2` (only `A1` and `A3` are numeric; empty cell and "text" are not counted).

**EC-36: AVG over entirely non-numeric range** — `=AVG(A1:A2)` where both cells contain text. Expected: renders `#ERR` (no numeric values to average).

**EC-37: MIN/MAX over entirely non-numeric range** — Same as EC-36 for MIN and MAX.

**EC-38: Large table — performance** — A table with 10 rows x 10 columns, 20 formula cells each referencing ranges of 10 cells, evaluates in under 5ms (NFR-02). Manual timing test acceptable.

**EC-39: Table with one body row** — Formula `=SUM(A1:A1)` on a single-row table. Expected: evaluates to the value of `A1`.

**EC-40: Formula in last column** — Table has 4 columns; formula `=A1+B1+C1` is in column D. Expected: evaluates correctly.

**EC-41: Whitespace around `=`** — Cell content is `= A1 + B1` (space after `=`, spaces around operator). Expected: whitespace is normalised; evaluates as `=A1+B1`.

**EC-42: Case-insensitive function names** — `=sum(A1:A3)`, `=Sum(A1:A3)`, `=SUM(A1:A3)` all produce the same result.

**EC-43: Case-insensitive cell references** — `=a1+b1` is equivalent to `=A1+B1`.

**EC-44: Formula cell referenced by aggregate** — `=SUM(A1:A3)` where `A2` itself contains `=5*2`. Expected: `A2` resolves to `10` and is included in the SUM.

**EC-45: Table with no body rows (header + separator only)** — No formula evaluation occurs. `evaluateTableFormulas()` returns an empty body array. No crash.

**EC-46: Single-column table** — Formula `=SUM(A1:A3)` is placed in column A of a 1-column table. Expected: evaluates to the sum of the three values in that column (excluding the formula cell itself, which resolves as `0` for the purpose of the range — or `#CIRC` if the formula cell is within the range).

**EC-47: Formula cell inside its own SUM range** — `A3 = =SUM(A1:A3)` where the formula's own cell is within the range. Expected: renders `#CIRC` (the cell references itself transitively).

**EC-48: ROUND with negative digits** — `=ROUND(123.456, -1)`. Expected: renders `120` (rounds to tens place). Standard Excel/Google Sheets behavior.

**EC-49: ROUND with negative digits — hundreds** — `=ROUND(1567, -2)`. Expected: renders `1600`.

**EC-50: Reference chain at depth limit** — A chain of 50 non-circular cell references (A1→A2→...→A50 each pointing to the next). Expected: the chain resolves correctly. A chain of 51 hops returns `#REF` (depth cap).

**EC-51: Unknown modifier name** — `=SUM(A1:A3)-TotalFormat`. Expected: renders `#NAME` (unrecognised modifier).

**EC-52: Modifier on error result** — `=A1/0-CommaFormat`. Expected: renders `#DIV/0` (modifier not applied to error token).

**EC-53: CommaFormat on positive integer** — `=SUM(A1:A3)-CommaFormat` where result is `1234567`. Expected: renders `1,234,567`.

**EC-54: CommaFormat on decimal** — `=SUM(A1:A3)-CommaFormat` where result is `1234.56`. Expected: renders `1,234.56`.

**EC-55: AccountStyle on negative number** — `=A1-AccountStyle` where `A1=-123`. Expected: renders `(123)`.

**EC-56: AccountStyle on positive number** — `=A1-AccountStyle` where `A1=50`. Expected: renders `50` (no effect on positive values).

**EC-57: AccountStyle on zero** — `=A1-AccountStyle` where `A1=0`. Expected: renders `0` (no parentheses).

**EC-58: Both modifiers — negative result** — `=SUM(A1:A3)-CommaFormat-AccountStyle` where result is `-1234.56`. Expected: renders `(1,234.56)`.

**EC-59: Both modifiers — order independence** — `=SUM(A1:A3)-AccountStyle-CommaFormat` produces the same output as `=SUM(A1:A3)-CommaFormat-AccountStyle` for all inputs.

**EC-60: Modifier on formula with arithmetic subtraction inside** — `=A1-B1-CommaFormat` where `A1=2000`, `B1=300`. Expected: evaluator correctly distinguishes the arithmetic `-` (between operands) from the postfix modifier `-` (at the top-level boundary after the last operand). Result: `1700` formatted as `1,700`.

---

## Resolved Decisions

**AD-01 — Core feature, not a plugin**: Formula evaluation is implemented as a modification to `live-preview.ts` + a new pure helper `table-formula.ts`, not as a toggleable IIFE plugin. Rationale: it cannot function without `tablePreviewField`, which is a core always-on feature.

**AD-02 — Custom mini-evaluator, no external library**: HyperFormula and similar libraries add 300KB+ to the bundle. The required function set (8 functions, 7 operators) is small enough to implement with a recursive descent parser. If future requirements add statistical functions (MEDIAN, STDEV, etc.) this decision should be revisited.

**AD-03 — Row addressing counts only body rows**: Headers are excluded from the row-number scheme. `A1` is always the first body row, regardless of how many header rows exist (GFM only supports one header row anyway).

**AD-04 — Floating-point normalisation via toPrecision(10)**: This handles `0.1+0.2` and similar cases. It may introduce small rounding on very large or very precise numbers, which is acceptable for a Markdown editor (not a financial calculator).

**AD-05 — Aggregate functions skip non-numeric cells**: Consistent with Excel/Google Sheets behavior for SUM/AVG/MIN/MAX/COUNT. Non-numeric cells in arithmetic (non-aggregate) expressions produce `#VALUE`.

**AD-06 — Postfix modifier syntax uses `-ModifierName`**: Modifiers are appended after the formula expression at the top level. The parser must distinguish a top-level `-` followed by a PascalCase identifier (modifier) from an arithmetic `-` between operands. The disambiguating rule: a top-level `-` that is not preceded by a numeric operand, closing paren, or cell reference is unary minus; a top-level `-` that IS preceded by one of those and is followed by a PascalCase identifier starting with an uppercase letter is a modifier delimiter.

**AD-07 — Modifiers affect display only, not cell value**: A formula cell's resolved numeric value (used when referenced by other formulas) is the raw result before modifier application. This is consistent with how Excel cell formatting works.

**AD-08 — Negative number default is leading minus**: `-5` is the default. `-AccountStyle` overrides to `(5)`. No global setting; override is per-cell in the formula.

**AD-09 — IF conditions are numeric comparisons only in v1**: String equality (e.g., `IF(A1="yes", ...)`) is out of scope. All comparison operands are evaluated as numbers.

**AD-10 — ROUND with negative digits is valid**: `ROUND(123, -1)` = `120`. Implemented via `Math.round(v * Math.pow(10, d)) / Math.pow(10, d)` which handles negative `d` correctly. This matches Excel/Google Sheets behavior.

**AD-11 — Reference chain depth cap is 50**: Chains exceeding 50 non-circular hops return `#REF`. This is a safety guardrail against accidental very-deep chains. It is distinct from `#CIRC` (which applies only to actual cycles).

---

## Proposed Constraints

1. `table-formula.ts` must be a pure module — no DOM, no CM6, no side effects. All exported functions are pure (same inputs → same outputs). Enforced via Vitest unit tests without a DOM environment.
2. The evaluator must detect and break circular references within a single `evaluateTableFormulas()` call. Detection uses a `Set<string>` of in-progress cell addresses passed through the call stack.
3. Aggregate functions (`SUM`, `AVG`, etc.) silently skip non-numeric values; arithmetic expressions produce `#VALUE` for non-numeric operands. This asymmetry matches Excel convention and must be preserved.
4. Header cells must never be evaluated as formulas, even if they begin with `=`. The row-0 exclusion must be enforced before the evaluator is invoked.
5. The formula evaluator must not mutate the CM6 document or any module-level state. It is a pure read-only rendering transform.
6. Error tokens (`#ERR`, `#REF`, `#DIV/0`, `#CIRC`, `#VALUE`, `#NAME`) must be plain ASCII strings so they render correctly without any HTML encoding concerns.
7. Rectangle range references (`A1:C3`) must explicitly return `#ERR` in v1, not silently flatten or partially evaluate.
8. Output modifier parsing occurs after formula evaluation. Modifiers never affect the numeric value used in cross-cell references. Modifier errors (`#NAME` for unknown modifiers) take precedence over displaying the formula result.
9. Reference chain depth must be tracked as a counter passed through recursive evaluation calls. When the counter exceeds 50, return `#REF` immediately without further recursion.
10. The modifier delimiter `-` must be disambiguated from arithmetic subtraction at the top level of the formula parser. The rule: a `-` at expression top level followed by a PascalCase identifier (first character uppercase A-Z) is treated as a modifier delimiter, not as a subtraction operator.
