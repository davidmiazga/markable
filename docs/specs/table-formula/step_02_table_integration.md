---
title: "Table Formula Cells — Step 02: TableWidget Integration"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 02 — TableWidget Integration (`live-preview.ts` + `styles.css`)

## Goal

Wire `evaluateTableFormulas()` into the existing `TableWidget.toDOM()` method in `src/editor/live-preview.ts`. Add the CSS for error token display. No other changes to `live-preview.ts`.

## Prerequisite

Step 01 must be complete and all step_03 tests must pass before this step is implemented.

---

## Change 1: Import

At the top of `src/editor/live-preview.ts`, add one import after the existing imports:

```typescript
import { evaluateTableFormulas } from "./table-formula";
import type { EvaluatedTable } from "./table-formula";
```

These are placed alongside the other local editor imports. There is no impact on the existing import list.

---

## Change 2: `TableWidget.toDOM()` replacement

### Current implementation (lines 183–217 of `live-preview.ts`)

```typescript
toDOM(): HTMLElement {
  const lines = this.markdown.split("\n").filter((l) => l.trim().length > 0);
  const isDelim = (line: string) => /^[\|\s:\-]+$/.test(line.trim());
  const parseCells = (line: string): string[] => {
    const parts = line.split("|");
    if (parts[0].trim() === "") parts.shift();
    if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
    return parts;
  };

  const table = document.createElement("table");
  table.className = "cm-live-table";
  let thead: HTMLTableSectionElement | null = null;
  let tbody: HTMLTableSectionElement | null = null;
  let inHeader = true;

  for (const line of lines) {
    if (isDelim(line)) { inHeader = false; continue; }
    const cells = parseCells(line);
    const tr = document.createElement("tr");
    for (const cell of cells) {
      const td = inHeader ? document.createElement("th") : document.createElement("td");
      td.innerHTML = marked.parseInline(cell.trim()) as string;
      tr.appendChild(td);
    }
    if (inHeader) {
      if (!thead) { thead = document.createElement("thead"); table.appendChild(thead); }
      thead.appendChild(tr);
    } else {
      if (!tbody) { tbody = document.createElement("tbody"); table.appendChild(tbody); }
      tbody.appendChild(tr);
    }
  }
  return table;
}
```

### Replacement implementation

Replace `TableWidget.toDOM()` entirely with the following. The existing `parseCells`, `isDelim`, and loop logic is removed and replaced by `EvaluatedTable` iteration.

```typescript
toDOM(): HTMLElement {
  const evaluated: EvaluatedTable = evaluateTableFormulas(this.markdown);

  const table = document.createElement("table");
  table.className = "cm-live-table";

  // Header row
  if (evaluated.header.length > 0) {
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    for (const cellText of evaluated.header) {
      const th = document.createElement("th");
      th.innerHTML = marked.parseInline(cellText) as string;
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }

  // Body rows
  if (evaluated.body.length > 0) {
    const tbody = document.createElement("tbody");
    for (const row of evaluated.body) {
      const tr = document.createElement("tr");
      for (const cellDisplay of row) {
        const td = document.createElement("td");
        if (cellDisplay.startsWith("#") && isFormulaError(cellDisplay)) {
          // Formula error token — set as text content, apply error class
          td.textContent = cellDisplay;
          td.classList.add("cm-formula-error");
        } else if (isCellFormulaResult(cellDisplay)) {
          // Computed formula result — numeric string, set as text content (safe, no HTML)
          td.textContent = cellDisplay;
        } else {
          // Non-formula cell — render Markdown inline
          td.innerHTML = marked.parseInline(cellDisplay) as string;
        }
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  return table;
}
```

### Helper functions (add near the top of the `TableWidget` class or as module-level functions before the class)

These two small helpers make the cell dispatch logic readable and keep inline conditionals minimal.

```typescript
/** Returns true if the string is a known formula error token. */
function isFormulaError(s: string): boolean {
  return s === "#ERR" || s === "#REF" || s === "#DIV/0" ||
         s === "#CIRC" || s === "#VALUE" || s === "#NAME";
}

/**
 * Returns true if the string looks like a computed formula result rather
 * than raw Markdown cell content.
 *
 * Formula results are either:
 *  - Numeric strings (integers or decimals, optionally negative)
 *  - Comma-formatted numbers: "1,234.56"
 *  - AccountStyle-wrapped: "(123)"
 *
 * This function must NOT be called for strings that start with "#" — those
 * are handled by `isFormulaError` first.
 *
 * Implementation: the evaluator always returns strings that either start
 * with "#" (error), consist of digits/sign/decimal/comma (numeric), or
 * match the AccountStyle pattern "(<digits>)". We use the EvaluatedTable
 * metadata instead — see design note below.
 */
function isCellFormulaResult(s: string): boolean {
  // Numeric: optional minus, optional AccountStyle parens, digits, commas, decimal
  return /^-?[\d,]+(\.\d+)?$/.test(s) || /^\(\d[\d,]*(\.\d+)?\)$/.test(s);
}
```

**Design note on `isCellFormulaResult`:** A cleaner alternative is to return a richer type from `evaluateTableFormulas` that includes a `isFormula: boolean` flag per cell. However, this couples `EvaluatedTable` more tightly to the rendering layer and complicates tests. The regex approach is sufficient for v1 because formula results are always numeric strings or AccountStyle-formatted strings — they never look like arbitrary Markdown. If future modifiers produce strings that could be confused with Markdown, this approach should be revisited in a requirements change.

**Alternatively (and more robustly):** Extend `EvaluatedTable` to carry a parallel `bodyIsFormula: boolean[][]` matrix. This is the preferred approach if the pattern becomes ambiguous. The step_01 spec already exposes the `EvaluatedTable` interface, so extend it there if chosen.

**For v1, the regex approach is acceptable and simpler to implement.** Choose one approach and be consistent.

---

### Key differences from the original implementation

| Aspect | Original | Replacement |
|---|---|---|
| Cell parsing | `parseCells()` + `isDelim()` inline | Delegated entirely to `parseTableMarkdown()` in `table-formula.ts` |
| Formula evaluation | None | `evaluateTableFormulas()` called once per `toDOM()` invocation |
| Header cells | `marked.parseInline(cell.trim())` | `marked.parseInline(cellText)` — header cells still go through marked |
| Body cells | `marked.parseInline(cell.trim())` for all cells | Formula results: `textContent = cellDisplay`; non-formula: `marked.parseInline(cellDisplay)` |
| Error styling | N/A | `cm-formula-error` class on error token cells |

---

### What does NOT change in `live-preview.ts`

- `buildTableDecorations()` — zero changes.
- `tablePreviewField` StateField — zero changes.
- `TableWidget.eq()` — zero changes (still compares `this.markdown`).
- `TableWidget.ignoreEvent()` — zero changes.
- All other widget classes and handler functions — zero changes.

The only modification to `live-preview.ts` is:
1. Two new import lines at the top.
2. The `TableWidget.toDOM()` method body.
3. Two small helper functions (`isFormulaError`, `isCellFormulaResult`) added near `TableWidget`.

---

## Change 3: CSS additions to `src/styles.css`

Locate the existing `Live Preview -- Table` section (currently at approximately line 521). Add the following immediately after the `.cm-live-table th` block:

```css
/* Formula error tokens */
.cm-formula-error {
  color: var(--formula-error-color, #c0392b);
  font-style: italic;
  font-size: 0.9em;
}
```

Additionally, add `--formula-error-color` to the `:root` block if one exists in `styles.css`. If the `:root` block does not exist or is managed elsewhere, add it as a new rule:

```css
:root {
  --formula-error-color: #c0392b;
}
```

Search for an existing `:root {` block in `styles.css` before adding a new one — do not create duplicate `:root` blocks. If a `:root` block already exists, add `--formula-error-color: #c0392b;` as a new line inside it.

---

## Verification Steps (manual, after implementation)

1. Create a Markdown document with the following table and open it in Markable:

```markdown
| Item | Qty | Price | Total |
|------|-----|-------|-------|
| A    | 3   | 10    | =B2*C2 |
| B    | 5   | 20    | =B3*C3 |
| Sum  |     |       | =SUM(D2:D3) |
```

Expected: In live preview, the Total column shows `30`, `100`, `130`.

2. Test an error token:

```markdown
| A | B |
|---|---|
| 5 | =A1/0 |
```

Expected: cell B2 shows `#DIV/0` in italic red text.

3. Test source reveal:

Place the cursor anywhere on the table. Expected: the raw Markdown becomes visible, showing `=B2*C2`, `=B3*C3`, etc.

4. Test cursor-away re-render:

Move the cursor away from the table. Expected: formula results return immediately.

5. Test a table with no formulas:

Expected: identical rendered output to the pre-change behaviour.

---

## Completion Criteria for Step 02

- [ ] `live-preview.ts` imports `evaluateTableFormulas` and `EvaluatedTable` from `./table-formula`.
- [ ] `TableWidget.toDOM()` uses `EvaluatedTable` for cell population.
- [ ] Formula result cells use `textContent`, not `innerHTML`.
- [ ] Error token cells have class `cm-formula-error`.
- [ ] Non-formula cells still pass through `marked.parseInline()`.
- [ ] `.cm-formula-error` rule exists in `src/styles.css`.
- [ ] `--formula-error-color` CSS variable is defined (no duplicate `:root` blocks).
- [ ] `tsc --noEmit` passes on `src/editor/live-preview.ts`.
- [ ] No `TODO` comments in modified files.
- [ ] All five manual verification steps pass visually.
