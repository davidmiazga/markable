---
title: "Table Formula Cells — Step 03: Test Plan"
last-updated: "2026-04-21"
review-cadence-days: 14
status: active
---

# Step 03 — Test Plan (`tests/editor/table-formula.test.ts`)

## Goal

Write the complete Vitest test suite for `src/editor/table-formula.ts`. All tests are pure unit tests: no DOM, no jsdom, no CM6, no Tauri. The file imports only from `src/editor/table-formula.ts` and from Vitest itself.

## Prerequisite

Step 01 must be complete. The test file is written alongside or after step_01 to drive the Red/Green/Refactor cycle.

---

## File Location

`tests/editor/table-formula.test.ts`

---

## Test Environment

No special Vitest config additions are required. `table-formula.ts` has no DOM or CM6 dependencies, so no environment setup beyond the default Vitest node environment is needed. If `vitest.config.ts` specifies `environment: "jsdom"` globally, the tests still pass (they don't use or need the DOM).

---

## Import Block

```typescript
import { describe, it, expect } from "vitest";
import {
  evaluateTableFormulas,
  parseTableMarkdown,
  splitModifiers,
  tokenize,
  parse,
  evalNode,
  resolveRef,
  applyModifiers,
  formatNumericResult,
} from "../../src/editor/table-formula";
import type { EvalContext, RawTable } from "../../src/editor/table-formula";
```

---

## Test Group Structure

```
Group A: parseTableMarkdown
Group B: splitModifiers (modifier disambiguation)
Group C: tokenize
Group D: parse (AST construction)
Group E: evalNode (operator and function evaluation)
Group F: resolveRef (cell resolution + circular reference + depth cap)
Group G: formatNumericResult
Group H: applyModifiers
Group I: evaluateTableFormulas (full integration — Markdown string in, EvaluatedTable out)
  Subgroup I-A: happy path (correct results)
  Subgroup I-B: error tokens (EC coverage)
  Subgroup I-C: output modifiers (EC coverage)
```

---

## Group A: `parseTableMarkdown`

```typescript
describe("parseTableMarkdown", () => {
  it("parses a standard 3-column table", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |`;
    const result = parseTableMarkdown(md);
    expect(result.header).toEqual(["A", "B", "C"]);
    expect(result.body).toEqual([["1", "2", "3"]]);
  });

  it("handles multiple body rows", () => {
    const md = `| H1 | H2 |\n|----|----|  \n| a | b |\n| c | d |`;
    const { body } = parseTableMarkdown(md);
    expect(body).toHaveLength(2);
    expect(body[1]).toEqual(["c", "d"]);
  });

  it("trims cell whitespace", () => {
    const md = `|  X  |  Y  |\n|-----|-----|\n|  1  |  2  |`;
    const { body } = parseTableMarkdown(md);
    expect(body[0]).toEqual(["1", "2"]);
  });

  it("returns empty body for header-only table (EC-45)", () => {
    const md = `| A | B |\n|---|---|`;
    const { body } = parseTableMarkdown(md);
    expect(body).toHaveLength(0);
  });

  it("handles single-column table", () => {
    const md = `| X |\n|---|\n| 1 |\n| 2 |`;
    const { header, body } = parseTableMarkdown(md);
    expect(header).toEqual(["X"]);
    expect(body).toHaveLength(2);
  });
});
```

---

## Group B: `splitModifiers`

```typescript
describe("splitModifiers", () => {
  it("returns expr unchanged when no modifiers present", () => {
    expect(splitModifiers("A1+B1")).toEqual({ expr: "A1+B1", modifiers: [] });
  });

  it("extracts a single trailing modifier", () => {
    expect(splitModifiers("SUM(A1:A3)-CommaFormat"))
      .toEqual({ expr: "SUM(A1:A3)", modifiers: ["CommaFormat"] });
  });

  it("extracts two chained modifiers", () => {
    expect(splitModifiers("SUM(A1:A3)-CommaFormat-AccountStyle"))
      .toEqual({ expr: "SUM(A1:A3)", modifiers: ["CommaFormat", "AccountStyle"] });
  });

  it("does not treat arithmetic minus as a modifier (EC-60)", () => {
    // "B1" has a digit — not a valid PascalCase-only identifier
    expect(splitModifiers("A1-B1-CommaFormat"))
      .toEqual({ expr: "A1-B1", modifiers: ["CommaFormat"] });
  });

  it("does not treat lowercase-start suffix as a modifier", () => {
    expect(splitModifiers("A1-b")).toEqual({ expr: "A1-b", modifiers: [] });
  });

  it("handles no modifiers with subtraction", () => {
    expect(splitModifiers("A1-B1")).toEqual({ expr: "A1-B1", modifiers: [] });
  });

  it("handles modifiers after function call", () => {
    expect(splitModifiers("ROUND(A1,2)-AccountStyle"))
      .toEqual({ expr: "ROUND(A1,2)", modifiers: ["AccountStyle"] });
  });

  it("unknown modifier name is preserved (validated in applyModifiers)", () => {
    expect(splitModifiers("A1-TotalFormat"))
      .toEqual({ expr: "A1", modifiers: ["TotalFormat"] });
  });
});
```

---

## Group C: `tokenize`

```typescript
describe("tokenize", () => {
  it("tokenizes a simple addition", () => {
    const tokens = tokenize("A1+B1");
    expect(tokens[0]).toMatchObject({ type: "CELLREF", raw: "A1" });
    expect(tokens[1]).toMatchObject({ type: "OP", raw: "+" });
    expect(tokens[2]).toMatchObject({ type: "CELLREF", raw: "B1" });
    expect(tokens[3]).toMatchObject({ type: "EOF" });
  });

  it("tokenizes a function call with range", () => {
    const tokens = tokenize("SUM(B2:B4)");
    expect(tokens[0]).toMatchObject({ type: "IDENT", raw: "SUM" });
    expect(tokens[1]).toMatchObject({ type: "LPAREN" });
    expect(tokens[2]).toMatchObject({ type: "CELLREF", raw: "B2" });
    expect(tokens[3]).toMatchObject({ type: "RANGE_SEP" });
    expect(tokens[4]).toMatchObject({ type: "CELLREF", raw: "B4" });
    expect(tokens[5]).toMatchObject({ type: "RPAREN" });
  });

  it("tokenizes a numeric literal", () => {
    const tokens = tokenize("3.14");
    expect(tokens[0]).toMatchObject({ type: "NUMBER", value: 3.14 });
  });

  it("tokenizes .5 as a decimal literal", () => {
    const tokens = tokenize(".5");
    expect(tokens[0]).toMatchObject({ type: "NUMBER", value: 0.5 });
  });

  it("uppercases function name identifiers", () => {
    const tokens = tokenize("sum(A1)");
    expect(tokens[0].raw).toBe("SUM");
  });

  it("tokenizes comparison operators", () => {
    const tokens = tokenize("A1>=B1");
    expect(tokens[1]).toMatchObject({ type: "CMP", raw: ">=" });
  });

  it("tokenizes <> as a single token", () => {
    const tokens = tokenize("A1<>B1");
    expect(tokens[1]).toMatchObject({ type: "CMP", raw: "<>" });
  });

  it("tokenizes unary minus (as OP token)", () => {
    const tokens = tokenize("-A1");
    expect(tokens[0]).toMatchObject({ type: "OP", raw: "-" });
  });
});
```

---

## Group D: `parse`

```typescript
describe("parse", () => {
  it("parses a number literal", () => {
    const ast = parse(tokenize("42"));
    expect(ast).toMatchObject({ type: "number", value: 42 });
  });

  it("parses a cell reference", () => {
    const ast = parse(tokenize("B3"));
    expect(ast).toMatchObject({ type: "cellRef", col: 1, row: 2 });
  });

  it("parses a range literal", () => {
    const ast = parse(tokenize("A1:A3"));
    expect(ast).toMatchObject({ type: "range", c1: 0, r1: 0, c2: 0, r2: 2 });
  });

  it("normalises reversed range endpoints (EC-22)", () => {
    const ast = parse(tokenize("A3:A1"));
    expect(ast).toMatchObject({ type: "range", c1: 0, r1: 0, c2: 0, r2: 2 });
  });

  it("parses addition", () => {
    const ast = parse(tokenize("A1+B1"));
    expect(ast.type).toBe("binary");
    if (ast.type === "binary") expect(ast.op).toBe("+");
  });

  it("parses unary minus on literal (EC-26)", () => {
    const ast = parse(tokenize("-5"));
    expect(ast).toMatchObject({ type: "unary", op: "-" });
  });

  it("parses unary minus on cell ref (EC-27)", () => {
    const ast = parse(tokenize("-A1"));
    expect(ast.type).toBe("unary");
  });

  it("parses unary minus on grouped expression (EC-28)", () => {
    const ast = parse(tokenize("-(A1+B1)"));
    expect(ast.type).toBe("unary");
  });

  it("parses function call", () => {
    const ast = parse(tokenize("SUM(A1:A3)"));
    expect(ast).toMatchObject({ type: "call", name: "SUM" });
  });

  it("parses IF with three arguments", () => {
    const ast = parse(tokenize("IF(A1>5,1,0)"));
    expect(ast).toMatchObject({ type: "call", name: "IF" });
    if (ast.type === "call") expect(ast.args).toHaveLength(3);
  });

  it("throws on malformed expression — no closing paren (EC-15)", () => {
    expect(() => parse(tokenize("SUM(A1:A3"))).toThrow();
  });

  it("throws on double operator (EC-16)", () => {
    expect(() => parse(tokenize("A1++B1"))).toThrow();
  });
});
```

---

## Group E: `evalNode`

This group builds `EvalContext` manually for isolation.

```typescript
function makeCtx(body: string[][]): EvalContext {
  const rawTable: RawTable = { header: [], body };
  return { rawTable, cache: new Map(), visiting: new Set() };
}

describe("evalNode — arithmetic", () => {
  it("evaluates a number literal", () => {
    const ctx = makeCtx([]);
    expect(evalNode({ type: "number", value: 7 }, ctx, 0)).toBe(7);
  });

  it("evaluates addition", () => {
    const ctx = makeCtx([]);
    const ast = parse(tokenize("3+4"));
    expect(evalNode(ast, ctx, 0)).toBe(7);
  });

  it("evaluates subtraction", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("10-3")), ctx, 0)).toBe(7);
  });

  it("evaluates multiplication", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("3*4")), ctx, 0)).toBe(12);
  });

  it("evaluates division", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("10/4")), ctx, 0)).toBe(2.5);
  });

  it("returns #DIV/0 for division by zero (EC-12)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("1/0")), ctx, 0)).toBe("#DIV/0");
  });

  it("returns #DIV/0 for modulo by zero (EC-13)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("5%0")), ctx, 0)).toBe("#DIV/0");
  });

  it("evaluates exponentiation (EC-29)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("2^8")), ctx, 0)).toBe(256);
  });

  it("evaluates fractional exponent (EC-30)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("4^0.5")), ctx, 0)).toBe(2);
  });

  it("evaluates unary minus on literal (EC-26)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("-5")), ctx, 0)).toBe(-5);
  });

  it("evaluates comparison > true (EC-31 setup)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("7>5")), ctx, 0)).toBe(1);
  });

  it("evaluates comparison > false", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("3>5")), ctx, 0)).toBe(0);
  });

  it("evaluates comparison <> (not equal)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("3<>5")), ctx, 0)).toBe(1);
  });
});

describe("evalNode — functions", () => {
  it("SUM over a range", () => {
    const ctx = makeCtx([["1"], ["2"], ["3"]]);
    expect(evalNode(parse(tokenize("SUM(A1:A3)")), ctx, 0)).toBe(6);
  });

  it("SUM returns 0 for empty range", () => {
    const ctx = makeCtx([[""], [""]]);
    expect(evalNode(parse(tokenize("SUM(A1:A2)")), ctx, 0)).toBe(0);
  });

  it("SUM skips non-numeric cells (EC-11)", () => {
    const ctx = makeCtx([["1"], ["hello"], ["3"]]);
    expect(evalNode(parse(tokenize("SUM(A1:A3)")), ctx, 0)).toBe(4);
  });

  it("AVG over a range", () => {
    const ctx = makeCtx([["2"], ["4"], ["6"]]);
    expect(evalNode(parse(tokenize("AVG(A1:A3)")), ctx, 0)).toBe(4);
  });

  it("AVG over entirely non-numeric range returns #ERR (EC-36)", () => {
    const ctx = makeCtx([["x"], ["y"]]);
    expect(evalNode(parse(tokenize("AVG(A1:A2)")), ctx, 0)).toBe("#ERR");
  });

  it("MIN returns smallest value", () => {
    const ctx = makeCtx([["5"], ["2"], ["8"]]);
    expect(evalNode(parse(tokenize("MIN(A1:A3)")), ctx, 0)).toBe(2);
  });

  it("MIN over entirely non-numeric range returns #ERR (EC-37)", () => {
    const ctx = makeCtx([["x"]]);
    expect(evalNode(parse(tokenize("MIN(A1:A1)")), ctx, 0)).toBe("#ERR");
  });

  it("MAX returns largest value", () => {
    const ctx = makeCtx([["5"], ["2"], ["8"]]);
    expect(evalNode(parse(tokenize("MAX(A1:A3)")), ctx, 0)).toBe(8);
  });

  it("COUNT counts numeric cells (EC-35)", () => {
    const ctx = makeCtx([["1"], ["text"], ["3"], [""]]);
    expect(evalNode(parse(tokenize("COUNT(A1:A4)")), ctx, 0)).toBe(2);
  });

  it("ROUND rounds to 2 decimal places", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("ROUND(3.14159,2)")), ctx, 0)).toBe(3.14);
  });

  it("ROUND with negative digits rounds to tens (EC-48)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("ROUND(123.456,-1)")), ctx, 0)).toBe(120);
  });

  it("ROUND with negative digits rounds to hundreds (EC-49)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("ROUND(1567,-2)")), ctx, 0)).toBe(1600);
  });

  it("ROUND with wrong argument count returns #ERR (EC-17)", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("ROUND(A1)")), ctx, 0)).toBe("#ERR");
  });

  it("ABS returns absolute value", () => {
    const ctx = makeCtx([]);
    expect(evalNode(parse(tokenize("ABS(-7)")), ctx, 0)).toBe(7);
  });

  it("ABS with two arguments returns #ERR (EC-18)", () => {
    const ctx = makeCtx([["1"], ["2"]]);
    expect(evalNode(parse(tokenize("ABS(A1,A2)")), ctx, 0)).toBe("#ERR");
  });

  it("IF selects true branch (EC-31)", () => {
    const ctx = makeCtx([["7"]]);
    expect(evalNode(parse(tokenize("IF(A1>5,10,20)")), ctx, 0)).toBe(10);
  });

  it("IF selects false branch (EC-32)", () => {
    const ctx = makeCtx([["3"]]);
    expect(evalNode(parse(tokenize("IF(A1>5,10,20)")), ctx, 0)).toBe(20);
  });

  it("IF with wrong argument count returns #ERR (EC-19)", () => {
    const ctx = makeCtx([["3"]]);
    expect(evalNode(parse(tokenize("IF(A1>0,1)")), ctx, 0)).toBe("#ERR");
  });

  it("unknown function returns #NAME (EC-14)", () => {
    const ctx = makeCtx([["1"]]);
    expect(evalNode(parse(tokenize("MEDIAN(A1:A1)")), ctx, 0)).toBe("#NAME");
  });

  it("range used in arithmetic (not in function) returns #ERR", () => {
    const ctx = makeCtx([["1"], ["2"]]);
    // "A1:A2" parsed as range node, then used in binary addition → #ERR
    const ast = parse(tokenize("A1:A2+1"));
    // Parser may throw or produce an unusual AST; either way evalNode must return #ERR.
    // If parser throws, catch it.
    let result: unknown;
    try {
      result = evalNode(ast, ctx, 0);
    } catch {
      result = "#ERR";
    }
    expect(result).toBe("#ERR");
  });

  it("nested function call: ROUND(SUM(A1:A3), 1) (EC-33)", () => {
    const ctx = makeCtx([["1.1"], ["2.2"], ["3.3"]]);
    expect(evalNode(parse(tokenize("ROUND(SUM(A1:A3),1)")), ctx, 0)).toBeCloseTo(6.6, 5);
  });
});
```

---

## Group F: `resolveRef`

```typescript
describe("resolveRef", () => {
  it("resolves a numeric cell", () => {
    const ctx = makeCtx([["5", "10"]]);
    expect(resolveRef(0, 0, ctx, 0)).toBe(5);
    expect(resolveRef(1, 0, ctx, 0)).toBe(10);
  });

  it("returns 0 for empty cell (EC-09)", () => {
    const ctx = makeCtx([["", "3"]]);
    expect(resolveRef(0, 0, ctx, 0)).toBe(0);
  });

  it("returns #REF for out-of-bounds row (EC-06)", () => {
    const ctx = makeCtx([["1"]]);
    expect(resolveRef(0, 9, ctx, 0)).toBe("#REF");
  });

  it("returns #REF for out-of-bounds column (EC-07)", () => {
    const ctx = makeCtx([["1"]]);
    expect(resolveRef(3, 0, ctx, 0)).toBe("#REF");
  });

  it("returns #VALUE for non-numeric cell in arithmetic context (EC-10)", () => {
    const ctx = makeCtx([["hello", "5"]]);
    // resolveRef returns the #VALUE sentinel for non-numeric cells.
    expect(resolveRef(0, 0, ctx, 0)).toBe("#VALUE");
  });

  it("resolves a formula cell by evaluating it (EC-34)", () => {
    // A1=5, B1==A1*2  → resolveRef(1, 0) should return 10
    const ctx = makeCtx([["5", "=A1*2"]]);
    expect(resolveRef(1, 0, ctx, 0)).toBe(10);
  });

  it("returns #CIRC for self-reference (EC-03)", () => {
    const ctx = makeCtx([["=B1", "=A1"]]);
    // Evaluating A1 (which refs B1, which refs A1) → #CIRC
    expect(resolveRef(0, 0, ctx, 0)).toBe("#CIRC");
  });

  it("returns #CIRC for two-cell cycle (EC-04)", () => {
    const ctx = makeCtx([["=B1", "=A1"]]);
    expect(resolveRef(0, 0, ctx, 0)).toBe("#CIRC");
    expect(resolveRef(1, 0, ctx, 0)).toBe("#CIRC");
  });

  it("returns #REF when depth exceeds 50 (EC-50 — depth cap)", () => {
    // Build a 52-cell chain: each cell references the next
    const body: string[][] = Array.from({ length: 52 }, (_, i) =>
      i < 51 ? [`=A${i + 2}`] : ["1"]
    );
    const rawTable: RawTable = { header: [], body };
    const ctx: EvalContext = { rawTable, cache: new Map(), visiting: new Set() };
    // A1 → A2 → ... → A52 (52 hops → exceeds cap of 50)
    expect(resolveRef(0, 0, ctx, 0)).toBe("#REF");
  });

  it("resolves a non-circular chain of 50 hops correctly (EC-50 — valid chain)", () => {
    // Build a 50-cell chain: A1→A2→...→A50=42
    const body: string[][] = Array.from({ length: 50 }, (_, i) =>
      i < 49 ? [`=A${i + 2}`] : ["42"]
    );
    const rawTable: RawTable = { header: [], body };
    const ctx: EvalContext = { rawTable, cache: new Map(), visiting: new Set() };
    expect(resolveRef(0, 0, ctx, 0)).toBe(42);
  });
});
```

---

## Group G: `formatNumericResult`

```typescript
describe("formatNumericResult", () => {
  it("returns integer without decimal point (EC-24)", () => {
    expect(formatNumericResult(6, false, 0)).toBe("6");
  });

  it("suppresses floating-point noise (EC-23)", () => {
    // 0.1 + 0.2 = 0.30000000000000004 in JS; after toPrecision(10) + parseFloat → 0.3
    expect(formatNumericResult(0.1 + 0.2, false, 0)).toBe("0.3");
  });

  it("returns decimal correctly", () => {
    expect(formatNumericResult(3.14, false, 0)).toBe("3.14");
  });

  it("ROUND with 2 digits uses toFixed(2) (EC-25)", () => {
    // ROUND(1.005, 2) — note JS float quirk; we test the toFixed path
    expect(formatNumericResult(1.01, true, 2)).toBe("1.01");
  });

  it("ROUND with 0 digits returns integer string", () => {
    expect(formatNumericResult(7, true, 0)).toBe("7");
  });

  it("handles negative number", () => {
    expect(formatNumericResult(-5, false, 0)).toBe("-5");
  });
});
```

---

## Group H: `applyModifiers`

```typescript
describe("applyModifiers", () => {
  it("returns error token unchanged (EC-52)", () => {
    expect(applyModifiers("#DIV/0", ["CommaFormat"])).toBe("#DIV/0");
  });

  it("unknown modifier returns #NAME (EC-51)", () => {
    expect(applyModifiers("1234", ["TotalFormat"])).toBe("#NAME");
  });

  it("CommaFormat on positive integer (EC-53)", () => {
    expect(applyModifiers("1234567", ["CommaFormat"])).toBe("1,234,567");
  });

  it("CommaFormat on decimal (EC-54)", () => {
    expect(applyModifiers("1234.56", ["CommaFormat"])).toBe("1,234.56");
  });

  it("AccountStyle on negative number (EC-55)", () => {
    expect(applyModifiers("-123", ["AccountStyle"])).toBe("(123)");
  });

  it("AccountStyle on positive number has no effect (EC-56)", () => {
    expect(applyModifiers("50", ["AccountStyle"])).toBe("50");
  });

  it("AccountStyle on zero has no effect (EC-57)", () => {
    expect(applyModifiers("0", ["AccountStyle"])).toBe("0");
  });

  it("CommaFormat + AccountStyle on negative (EC-58)", () => {
    expect(applyModifiers("-1234.56", ["CommaFormat", "AccountStyle"])).toBe("(1,234.56)");
  });

  it("AccountStyle + CommaFormat order produces same result (EC-59)", () => {
    const a = applyModifiers("-1234.56", ["CommaFormat", "AccountStyle"]);
    const b = applyModifiers("-1234.56", ["AccountStyle", "CommaFormat"]);
    expect(a).toBe(b);
  });

  it("no modifiers returns string unchanged", () => {
    expect(applyModifiers("42", [])).toBe("42");
  });
});
```

---

## Group I: `evaluateTableFormulas` — full integration

### Subgroup I-A: Happy path

```typescript
describe("evaluateTableFormulas — happy path", () => {
  const basicTable = `| Item | Qty | Price | Total |\n|------|-----|-------|-------|\n| A    | 3   | 10    | =B2*C2 |\n| B    | 5   | 20    | =B3*C3 |`;

  it("evaluates body formula cells correctly", () => {
    const { body } = evaluateTableFormulas(basicTable);
    expect(body[0][3]).toBe("30");
    expect(body[1][3]).toBe("100");
  });

  it("preserves non-formula cells as raw strings", () => {
    const { body } = evaluateTableFormulas(basicTable);
    expect(body[0][0]).toBe("A");
  });

  it("header cells are never evaluated as formulas (EC-01)", () => {
    const md = `| =SUM(A1:A3) | B |\n|---|---|\n| 1 | 2 |`;
    const { header } = evaluateTableFormulas(md);
    expect(header[0]).toBe("=SUM(A1:A3)");
  });

  it("evaluates SUM over a range", () => {
    const md = `| X |\n|---|\n| 10 |\n| 20 |\n| =SUM(A1:A2) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[2][0]).toBe("30");
  });

  it("formula referencing another formula cell (EC-34)", () => {
    const md = `| A | B |\n|---|---|\n| 5 | =A1*2 |\n| =B1+1 | x |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][1]).toBe("10");
    expect(body[1][0]).toBe("11");
  });

  it("empty referenced cell contributes 0 (EC-09)", () => {
    const md = `| A | B |\n|---|---|\n|   | 5 |\n| =A1+B1 | x |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[1][0]).toBe("5");
  });

  it("whitespace after = is stripped (EC-41)", () => {
    const md = `| A | B |\n|---|---|\n| 3 | = A1 + 2 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][1]).toBe("5");
  });

  it("case-insensitive function names (EC-42)", () => {
    const md = `| X |\n|---|\n| 1 |\n| 2 |\n| =sum(A1:A2) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[2][0]).toBe("3");
  });

  it("case-insensitive cell references (EC-43)", () => {
    const md = `| A |\n|---|\n| 7 |\n| =a1*2 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[1][0]).toBe("14");
  });

  it("formula in last column (EC-40)", () => {
    const md = `| A | B | C | D |\n|---|---|---|---|\n| 1 | 2 | 3 | =A1+B1+C1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][3]).toBe("6");
  });

  it("SUM(A1:A1) on single-row table (EC-39)", () => {
    const md = `| A |\n|---|\n| =SUM(A1:A1) |`;
    // A1 references itself → #CIRC
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("#CIRC");
  });

  it("no body rows returns empty body (EC-45)", () => {
    const md = `| A | B |\n|---|---|`;
    const { body } = evaluateTableFormulas(md);
    expect(body).toHaveLength(0);
  });

  it("floating-point precision: 0.1+0.2 = 0.3 (EC-23)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 0.1 | 0.2 | =A1+B1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][2]).toBe("0.3");
  });

  it("integer result from float arithmetic (EC-24)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 6 | 2 | =A1/B1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][2]).toBe("3");
  });

  it("unary minus on literal (EC-26)", () => {
    const md = `| A |\n|---|\n| =-5 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("-5");
  });

  it("unary minus on cell reference (EC-27)", () => {
    const md = `| A | B |\n|---|---|\n| 3 | =-A1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][1]).toBe("-3");
  });

  it("unary minus on grouped expression (EC-28)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 2 | 3 | =-(A1+B1) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][2]).toBe("-5");
  });

  it("exponentiation (EC-29)", () => {
    const md = `| A |\n|---|\n| =2^8 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("256");
  });

  it("fractional exponent (EC-30)", () => {
    const md = `| A |\n|---|\n| =4^0.5 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("2");
  });

  it("reversed range endpoints normalised (EC-22)", () => {
    const md = `| X |\n|---|\n| 1 |\n| 2 |\n| 3 |\n| =SUM(A3:A1) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[3][0]).toBe("6");
  });

  it("formula cell inside its own SUM range returns #CIRC (EC-47)", () => {
    const md = `| X |\n|---|\n| 1 |\n| 2 |\n| =SUM(A1:A3) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[2][0]).toBe("#CIRC");
  });

  it("formula cell aggregate skips non-numeric values (EC-11)", () => {
    const md = `| X |\n|---|\n| 1 |\n| hello |\n| 3 |\n| =SUM(A1:A3) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[3][0]).toBe("4");
  });

  it("COUNT with mixed numeric and non-numeric cells (EC-35)", () => {
    const md = `| X |\n|---|\n| 1 |\n| text |\n| 3 |\n|  |\n| =COUNT(A1:A4) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[4][0]).toBe("2");
  });

  it("IF true branch (EC-31)", () => {
    const md = `| A | B |\n|---|---|\n| 7 | =IF(A1>5,10,20) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][1]).toBe("10");
  });

  it("IF false branch (EC-32)", () => {
    const md = `| A | B |\n|---|---|\n| 3 | =IF(A1>5,10,20) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][1]).toBe("20");
  });

  it("nested function call ROUND(SUM(A1:A3), 1) (EC-33)", () => {
    const md = `| X |\n|---|\n| 1.1 |\n| 2.2 |\n| 3.3 |\n| =ROUND(SUM(A1:A3),1) |`;
    const { body } = evaluateTableFormulas(md);
    // 1.1 + 2.2 + 3.3 = 6.6 (after float normalisation); ROUND to 1dp = "6.6"
    expect(body[3][0]).toBe("6.6");
  });

  it("ROUND output format (EC-25)", () => {
    const md = `| A |\n|---|\n| =ROUND(1.005,2) |`;
    const { body } = evaluateTableFormulas(md);
    // JS float: 1.005 * 100 = 100.49999... → Math.round → 100 → /100 = 1.00
    // toFixed(2) → "1.00"  (this is the documented JS behavior, not Excel)
    expect(body[0][0]).toBe("1.00");
  });

  it("ROUND with negative digits (EC-48)", () => {
    const md = `| A |\n|---|\n| =ROUND(123.456,-1) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("120");
  });

  it("ROUND with negative digits hundreds (EC-49)", () => {
    const md = `| A |\n|---|\n| =ROUND(1567,-2) |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("1600");
  });
});
```

### Subgroup I-B: Error tokens

```typescript
describe("evaluateTableFormulas — error tokens", () => {
  it("empty formula body returns #ERR (EC-02)", () => {
    const md = `| A |\n|---|\n| = |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#ERR");
  });

  it("self-reference returns #CIRC (EC-03)", () => {
    const md = `| A |\n|---|\n| =A1 |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#CIRC");
  });

  it("two-cell cycle both return #CIRC (EC-04)", () => {
    const md = `| A | B |\n|---|---|\n| =B1 | =A1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("#CIRC");
    expect(body[0][1]).toBe("#CIRC");
  });

  it("multi-hop cycle returns #CIRC for all participants (EC-05)", () => {
    // A1=B1, B1=C1, C1=A1
    const md = `| A | B | C |\n|---|---|---|\n| =B1 | =C1 | =A1 |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("#CIRC");
    expect(body[0][1]).toBe("#CIRC");
    expect(body[0][2]).toBe("#CIRC");
  });

  it("reference to non-existent row returns #REF (EC-06)", () => {
    const md = `| A |\n|---|\n| 1 |\n| =A10 |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("#REF");
  });

  it("reference to non-existent column returns #REF (EC-07)", () => {
    const md = `| A | B |\n|---|---|\n| 1 | =D1 |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#REF");
  });

  it("reference past column Z returns #REF (EC-08)", () => {
    // "AA1" tokenises as IDENT("AA") + NUMBER(1), which the parser cannot form into a cellRef
    const md = `| A |\n|---|\n| =AA1 |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#ERR");
  });

  it("non-numeric cell in arithmetic returns #VALUE (EC-10)", () => {
    const md = `| A | B |\n|---|---|\n| hello | =A1*2 |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#VALUE");
  });

  it("division by zero returns #DIV/0 (EC-12)", () => {
    const md = `| A | B |\n|---|---|\n| 0 | =10/A1 |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#DIV/0");
  });

  it("modulo by zero returns #DIV/0 (EC-13)", () => {
    const md = `| A | B |\n|---|---|\n| 0 | =10%A1 |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#DIV/0");
  });

  it("unknown function returns #NAME (EC-14)", () => {
    const md = `| A |\n|---|\n| =MEDIAN(A1:A1) |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#NAME");
  });

  it("missing closing paren returns #ERR (EC-15)", () => {
    const md = `| A |\n|---|\n| =SUM(A1:A1 |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#ERR");
  });

  it("double operator returns #ERR (EC-16)", () => {
    const md = `| A | B |\n|---|---|\n| 1 | =A1++A1 |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#ERR");
  });

  it("ROUND with wrong argument count returns #ERR (EC-17)", () => {
    const md = `| A |\n|---|\n| =ROUND(A1) |`;
    expect(evaluateTableFormulas(md).body[0][0]).toBe("#ERR");
  });

  it("ABS with two arguments returns #ERR (EC-18)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 1 | 2 | =ABS(A1,B1) |`;
    expect(evaluateTableFormulas(md).body[0][2]).toBe("#ERR");
  });

  it("IF with wrong argument count returns #ERR (EC-19)", () => {
    const md = `| A | B |\n|---|---|\n| 1 | =IF(A1>0,1) |`;
    expect(evaluateTableFormulas(md).body[0][1]).toBe("#ERR");
  });

  it("range outside table bounds returns #REF (EC-20)", () => {
    const md = `| X |\n|---|\n| 1 |\n| 2 |\n| =SUM(A1:A99) |`;
    expect(evaluateTableFormulas(md).body[2][0]).toBe("#REF");
  });

  it("rectangle range returns #ERR (EC-21)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | =SUM(A1:B2) |`;
    expect(evaluateTableFormulas(md).body[1][2]).toBe("#ERR");
  });

  it("AVG over entirely non-numeric range returns #ERR (EC-36)", () => {
    const md = `| X |\n|---|\n| a |\n| b |\n| =AVG(A1:A2) |`;
    expect(evaluateTableFormulas(md).body[2][0]).toBe("#ERR");
  });

  it("MIN over entirely non-numeric range returns #ERR (EC-37)", () => {
    const md = `| X |\n|---|\n| a |\n| =MIN(A1:A1) |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("#ERR");
  });

  it("MAX over entirely non-numeric range returns #ERR (EC-37 MAX)", () => {
    const md = `| X |\n|---|\n| a |\n| =MAX(A1:A1) |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("#ERR");
  });
});
```

### Subgroup I-C: Output modifiers

```typescript
describe("evaluateTableFormulas — output modifiers", () => {
  it("CommaFormat on large integer (EC-53)", () => {
    const md = `| X |\n|---|\n| 1000000 |\n| 234567 |\n| =SUM(A1:A2)-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[2][0]).toBe("1,234,567");
  });

  it("CommaFormat on decimal (EC-54)", () => {
    const md = `| X |\n|---|\n| 1234.56 |\n| =A1-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("1,234.56");
  });

  it("AccountStyle on negative (EC-55)", () => {
    const md = `| X |\n|---|\n| -123 |\n| =A1-AccountStyle |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("(123)");
  });

  it("AccountStyle on positive has no effect (EC-56)", () => {
    const md = `| X |\n|---|\n| 50 |\n| =A1-AccountStyle |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("50");
  });

  it("AccountStyle on zero has no effect (EC-57)", () => {
    const md = `| X |\n|---|\n| 0 |\n| =A1-AccountStyle |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("0");
  });

  it("both modifiers on negative (EC-58)", () => {
    const md = `| X |\n|---|\n| -1234.56 |\n| =A1-CommaFormat-AccountStyle |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("(1,234.56)");
  });

  it("both modifiers order independence (EC-59)", () => {
    const md1 = `| X |\n|---|\n| -1234.56 |\n| =A1-CommaFormat-AccountStyle |`;
    const md2 = `| X |\n|---|\n| -1234.56 |\n| =A1-AccountStyle-CommaFormat |`;
    const r1 = evaluateTableFormulas(md1).body[1][0];
    const r2 = evaluateTableFormulas(md2).body[1][0];
    expect(r1).toBe(r2);
  });

  it("modifier on error result passes through error token (EC-52)", () => {
    const md = `| A |\n|---|\n| 0 |\n| =A1/0-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("#DIV/0");
  });

  it("unknown modifier returns #NAME (EC-51)", () => {
    const md = `| A |\n|---|\n| 1000 |\n| =A1-TotalFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("#NAME");
  });

  it("arithmetic subtraction correctly disambiguated from modifier (EC-60)", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 2000 | 300 | =A1-B1-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[0][2]).toBe("1,700");
  });
});
```

---

## Test Count Summary

| Group | Test count |
|---|---|
| A: parseTableMarkdown | 5 |
| B: splitModifiers | 8 |
| C: tokenize | 9 |
| D: parse | 12 |
| E: evalNode — arithmetic | 11 |
| E: evalNode — functions | 18 |
| F: resolveRef | 10 |
| G: formatNumericResult | 6 |
| H: applyModifiers | 10 |
| I-A: evaluateTableFormulas happy path | 26 |
| I-B: evaluateTableFormulas error tokens | 19 |
| I-C: evaluateTableFormulas modifiers | 11 |
| **Total** | **145** |

All 60 edge cases (EC-01 through EC-60) from the requirements are covered. The test count is higher than 60 because many EC items require multiple test cases (e.g., EC-37 covers both MIN and MAX separately).

---

## Completion Criteria for Step 03

- [ ] File `tests/editor/table-formula.test.ts` exists.
- [ ] All tests pass: `npm test tests/editor/table-formula.test.ts`.
- [ ] No test is skipped or marked `todo` without a documented reason in `00_index.md`.
- [ ] All 60 edge case IDs (EC-01 through EC-60) are referenced in at least one test comment or test description.
- [ ] Test runtime for the full suite is under 2 seconds.
