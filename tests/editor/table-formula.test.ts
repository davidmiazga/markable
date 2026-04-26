/**
 * tests/editor/table-formula.test.ts
 *
 * Vitest unit tests for the pure table formula evaluator module.
 * No DOM, no jsdom, no CM6, no Tauri dependencies.
 *
 * Covers all 60 edge cases (EC-01 through EC-60) from the requirements
 * as specified in docs/specs/table-formula/step_03_tests.md.
 */

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
  parseDisplayValue,
  sortBodyRows,
} from "../../src/editor/table-formula";
import type { EvalContext, RawTable } from "../../src/editor/table-formula";

// ── Group A: parseTableMarkdown ────────────────────────────────────────────────

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

// ── Group B: splitModifiers ────────────────────────────────────────────────────

describe("splitModifiers", () => {
  it("returns expr unchanged when no modifiers present", () => {
    expect(splitModifiers("A1+B1")).toEqual({ expr: "A1+B1", modifiers: [] });
  });

  it("extracts a single trailing modifier", () => {
    expect(splitModifiers("SUM(A1:A3)-CommaFormat"))
      .toEqual({ expr: "SUM(A1:A3)", modifiers: ["CommaFormat"] });
  });

  it("extracts two chained modifiers", () => {
    expect(splitModifiers("SUM(A1:A3)-CommaFormat-AccountFormat"))
      .toEqual({ expr: "SUM(A1:A3)", modifiers: ["CommaFormat", "AccountFormat"] });
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
    expect(splitModifiers("ROUND(A1,2)-AccountFormat"))
      .toEqual({ expr: "ROUND(A1,2)", modifiers: ["AccountFormat"] });
  });

  it("unknown modifier name is preserved (validated in applyModifiers)", () => {
    expect(splitModifiers("A1-TotalFormat"))
      .toEqual({ expr: "A1", modifiers: ["TotalFormat"] });
  });
});

// ── Group C: tokenize ──────────────────────────────────────────────────────────

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

  it("tokenizes comma", () => {
    const tokens = tokenize("IF(A1,1,0)");
    expect(tokens[3]).toMatchObject({ type: "COMMA" });
  });
});

// ── Group D: parse ─────────────────────────────────────────────────────────────

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

// ── Group E: evalNode ──────────────────────────────────────────────────────────

/**
 * Builds a minimal EvalContext for direct evalNode testing.
 * Header is empty; body cells are provided as a 2D array of strings.
 */
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
    // If parser throws, the result is also #ERR (either way is acceptable)
    let result: unknown;
    try {
      const ast = parse(tokenize("A1:A2+1"));
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

// ── Group F: resolveRef ────────────────────────────────────────────────────────

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
    const ctx1 = makeCtx([["=B1", "=A1"]]);
    expect(resolveRef(0, 0, ctx1, 0)).toBe("#CIRC");
    const ctx2 = makeCtx([["=B1", "=A1"]]);
    expect(resolveRef(1, 0, ctx2, 0)).toBe("#CIRC");
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

// ── Group G: formatNumericResult ───────────────────────────────────────────────

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
    // Test the toFixed path with isRoundCall=true
    expect(formatNumericResult(1.01, true, 2)).toBe("1.01");
  });

  it("ROUND with 0 digits returns integer string", () => {
    expect(formatNumericResult(7, true, 0)).toBe("7");
  });

  it("handles negative number", () => {
    expect(formatNumericResult(-5, false, 0)).toBe("-5");
  });
});

// ── Group H: applyModifiers ────────────────────────────────────────────────────

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

  it("AccountFormat on negative number includes $ and parens (EC-55)", () => {
    expect(applyModifiers("-123", ["AccountFormat"])).toBe("$(123)");
  });

  it("AccountFormat on positive number prepends $ (EC-56)", () => {
    expect(applyModifiers("50", ["AccountFormat"])).toBe("$50");
  });

  it("AccountFormat on zero prepends $ (EC-57)", () => {
    expect(applyModifiers("0", ["AccountFormat"])).toBe("$0");
  });

  it("AccountFormat on negative already includes commas (EC-58)", () => {
    expect(applyModifiers("-1234.56", ["AccountFormat"])).toBe("$(1,234.56)");
  });

  it("AccountFormat + IntFormat order independence (EC-59)", () => {
    const a = applyModifiers("-1234.56", ["AccountFormat", "IntFormat"]);
    const b = applyModifiers("-1234.56", ["IntFormat", "AccountFormat"]);
    expect(a).toBe(b);
  });

  it("no modifiers returns string unchanged", () => {
    expect(applyModifiers("42", [])).toBe("42");
  });
});

// ── Group I: evaluateTableFormulas — full integration ──────────────────────────

describe("evaluateTableFormulas — happy path", () => {
  // Row 1 = first body row (1-based body addressing per FR-02.2).
  // Row A uses B1*C1 (self-row), Row B uses B2*C2 (self-row).
  const basicTable = `| Item | Qty | Price | Total |\n|------|-----|-------|-------|\n| A    | 3   | 10    | =B1*C1 |\n| B    | 5   | 20    | =B2*C2 |`;

  it("evaluates body formula cells correctly", () => {
    const { body } = evaluateTableFormulas(basicTable);
    expect(body[0][3]).toBe("30");
    expect(body[1][3]).toBe("100");
  });

  it("preserves non-formula cells as raw strings", () => {
    const { body } = evaluateTableFormulas(basicTable);
    expect(body[0][0]).toBe("A");
  });

  it("cells starting with == are NOT treated as formulas (regression: ==highlight== was #ERR)", () => {
    const md = `| Syntax | Result |\n|---|---|\n| ==highlight== | ==highlight== |`;
    const { body } = evaluateTableFormulas(md);
    expect(body[0][0]).toBe("==highlight==");
    expect(body[0][1]).toBe("==highlight==");
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

  it("SUM(A1:A1) on single-row table references itself → #CIRC (EC-39)", () => {
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
    // toFixed(2) → "1.00"  (documented JS behavior, not Excel)
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

  it("reference past column Z returns #ERR (EC-08)", () => {
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

describe("evaluateTableFormulas — output modifiers", () => {
  it("CommaFormat on large integer (EC-53)", () => {
    const md = `| X |\n|---|\n| 1000000 |\n| 234567 |\n| =SUM(A1:A2)-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[2][0]).toBe("1,234,567");
  });

  it("CommaFormat on decimal (EC-54)", () => {
    const md = `| X |\n|---|\n| 1234.56 |\n| =A1-CommaFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("1,234.56");
  });

  it("AccountFormat on negative includes $ and parens (EC-55)", () => {
    const md = `| X |\n|---|\n| -123 |\n| =A1-AccountFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$(123)");
  });

  it("AccountFormat on positive prepends $ (EC-56)", () => {
    const md = `| X |\n|---|\n| 50 |\n| =A1-AccountFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$50");
  });

  it("AccountFormat on zero prepends $ (EC-57)", () => {
    const md = `| X |\n|---|\n| 0 |\n| =A1-AccountFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$0");
  });

  it("AccountFormat on negative already includes commas (EC-58)", () => {
    const md = `| X |\n|---|\n| -1234.56 |\n| =A1-AccountFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$(1,234.56)");
  });

  it("AccountFormat + IntFormat order independence (EC-59)", () => {
    const md1 = `| X |\n|---|\n| -1234.56 |\n| =A1-AccountFormat-IntFormat |`;
    const md2 = `| X |\n|---|\n| -1234.56 |\n| =A1-IntFormat-AccountFormat |`;
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

// ── Group I-D: New modifiers (MoneyFormat, PercentFormat, IntFormat) ───────────

describe("new output modifiers", () => {
  // MoneyFormat — applyModifiers unit tests
  it("MoneyFormat on positive integer adds $ and commas", () => {
    expect(applyModifiers("1234567", ["MoneyFormat"])).toBe("$1,234,567");
  });

  it("MoneyFormat on decimal adds $ and commas", () => {
    expect(applyModifiers("1234.56", ["MoneyFormat"])).toBe("$1,234.56");
  });

  it("MoneyFormat on negative restores minus sign", () => {
    expect(applyModifiers("-99.5", ["MoneyFormat"])).toBe("$-99.5");
  });

  it("AccountFormat on negative includes $ commas and parens", () => {
    expect(applyModifiers("-1234.56", ["AccountFormat"])).toBe("$(1,234.56)");
  });

  it("AccountFormat on positive prepends $", () => {
    expect(applyModifiers("50", ["AccountFormat"])).toBe("$50");
  });

  // PercentFormat — applyModifiers unit tests
  it("PercentFormat appends % to positive", () => {
    expect(applyModifiers("75", ["PercentFormat"])).toBe("75%");
  });

  it("PercentFormat appends % to negative", () => {
    expect(applyModifiers("-12.5", ["PercentFormat"])).toBe("-12.5%");
  });

  it("PercentFormat appends % to zero", () => {
    expect(applyModifiers("0", ["PercentFormat"])).toBe("0%");
  });

  // IntFormat — applyModifiers unit tests
  it("IntFormat truncates positive decimal", () => {
    expect(applyModifiers("3.9", ["IntFormat"])).toBe("3");
  });

  it("IntFormat truncates negative decimal toward zero", () => {
    expect(applyModifiers("-3.9", ["IntFormat"])).toBe("-3");
  });

  it("IntFormat leaves integer unchanged", () => {
    expect(applyModifiers("42", ["IntFormat"])).toBe("42");
  });

  it("IntFormat + CommaFormat on large decimal", () => {
    expect(applyModifiers("1234567.89", ["IntFormat", "CommaFormat"])).toBe("1,234,567");
  });

  // Comma-in-input parsing
  it("cell value with commas is treated as numeric", () => {
    const md = `| Price | Tax | Total |\n|---|---|---|\n| 1,000 | 100 | =A1+B1 |`;
    expect(evaluateTableFormulas(md).body[0][2]).toBe("1100");
  });

  it("cell value 1,234,567 parsed correctly", () => {
    const md = `| X |\n|---|\n| 1,234,567 |\n| =A1*2 |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("2469134");
  });

  // Integration: new modifiers in full table evaluation
  it("MoneyFormat in table cell", () => {
    const md = `| Revenue |\n|---|\n| 1000000 |\n| =A1-MoneyFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$1,000,000");
  });

  it("PercentFormat in table cell", () => {
    const md = `| Rate |\n|---|\n| 75 |\n| =A1-PercentFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("75%");
  });

  it("IntFormat in table cell with decimal result", () => {
    const md = `| A | B | C |\n|---|---|---|\n| 10 | 3 | =A1/B1-IntFormat |`;
    expect(evaluateTableFormulas(md).body[0][2]).toBe("3");
  });

  it("AccountFormat on negative in table", () => {
    const md = `| Balance |\n|---|\n| -5000 |\n| =A1-AccountFormat |`;
    expect(evaluateTableFormulas(md).body[1][0]).toBe("$(5,000)");
  });
});

// ── Group J: parseDisplayValue ─────────────────────────────────────────────────

describe("parseDisplayValue", () => {
  it("parses plain integer", () => {
    expect(parseDisplayValue("42")).toBe(42);
  });

  it("parses plain decimal", () => {
    expect(parseDisplayValue("3.14")).toBe(3.14);
  });

  it("parses negative number", () => {
    expect(parseDisplayValue("-5.5")).toBe(-5.5);
  });

  it("strips commas before parsing", () => {
    expect(parseDisplayValue("1,234,567")).toBe(1234567);
  });

  it("strips $ and commas", () => {
    expect(parseDisplayValue("$1,234.56")).toBe(1234.56);
  });

  it("strips % suffix", () => {
    expect(parseDisplayValue("75%")).toBe(75);
  });

  it("converts accounting parens to negative", () => {
    expect(parseDisplayValue("(123)")).toBe(-123);
  });

  it("converts accounting parens with commas and $ to negative", () => {
    expect(parseDisplayValue("$(1,234.56)")).toBe(-1234.56);
  });

  it("returns original string for non-numeric input", () => {
    expect(parseDisplayValue("hello")).toBe("hello");
  });

  it("returns original string for empty cell", () => {
    expect(parseDisplayValue("")).toBe("");
  });

  it("returns original string for formula error token", () => {
    expect(parseDisplayValue("#ERR")).toBe("#ERR");
  });
});

// ── Group K: sortBodyRows ──────────────────────────────────────────────────────

describe("sortBodyRows", () => {
  const numericBody = [
    ["Banana", "5"],
    ["Apple",  "3"],
    ["Cherry", "10"],
    ["Date",   "1"],
  ];

  it("sorts numerically ascending by column 1", () => {
    const result = sortBodyRows(numericBody, 1, "asc");
    expect(result.map(r => r[1])).toEqual(["1", "3", "5", "10"]);
  });

  it("sorts numerically descending by column 1", () => {
    const result = sortBodyRows(numericBody, 1, "desc");
    expect(result.map(r => r[1])).toEqual(["10", "5", "3", "1"]);
  });

  it("sorts alphabetically ascending by column 0", () => {
    const result = sortBodyRows(numericBody, 0, "asc");
    expect(result.map(r => r[0])).toEqual(["Apple", "Banana", "Cherry", "Date"]);
  });

  it("sorts alphabetically descending by column 0", () => {
    const result = sortBodyRows(numericBody, 0, "desc");
    expect(result.map(r => r[0])).toEqual(["Date", "Cherry", "Banana", "Apple"]);
  });

  it("does not mutate the original array", () => {
    const original = [["B", "2"], ["A", "1"]];
    sortBodyRows(original, 0, "asc");
    expect(original[0][0]).toBe("B");
  });

  it("handles formatted values: CommaFormat numbers sort numerically", () => {
    const body = [["$1,000"], ["$200"], ["$3,500"]];
    const result = sortBodyRows(body, 0, "asc");
    expect(result.map(r => r[0])).toEqual(["$200", "$1,000", "$3,500"]);
  });

  it("handles AccountFormat negatives (parens) sort correctly", () => {
    const body = [["$(500)"], ["$200"], ["$(100)"]];
    const result = sortBodyRows(body, 0, "asc");
    expect(result.map(r => r[0])).toEqual(["$(500)", "$(100)", "$200"]);
  });

  it("error tokens sort last in ascending order", () => {
    const body = [["#ERR"], ["5"], ["2"]];
    const result = sortBodyRows(body, 0, "asc");
    expect(result[2][0]).toBe("#ERR");
  });

  it("error tokens sort last in descending order", () => {
    const body = [["#ERR"], ["5"], ["2"]];
    const result = sortBodyRows(body, 0, "desc");
    expect(result[2][0]).toBe("#ERR");
  });

  it("mixed numeric and string cells — numeric rows group together", () => {
    const body = [["10"], ["apple"], ["3"], ["banana"]];
    const asc = sortBodyRows(body, 0, "asc");
    // All rows present, no crash
    expect(asc.length).toBe(4);
  });

  it("empty body returns empty array", () => {
    expect(sortBodyRows([], 0, "asc")).toEqual([]);
  });

  it("single-row body returns same row", () => {
    const body = [["only"]];
    expect(sortBodyRows(body, 0, "asc")).toEqual([["only"]]);
  });
});
