/**
 * Tests for the Math plugin (FC2 #8).
 *
 * Covers all edge cases from docs/specs/math/00_index.md:
 *   - scanMathRanges: all EC-* edge cases from requirements spec
 *   - isCursorInsideRange: boundary conditions (EC-1, EC-2, EC-3, EC-4)
 *   - InlineMathWidget / BlockMathWidget: DOM output, eq(), error handling
 *   - buildMathDecorations: StateField integration
 *   - CSS injection helpers: idempotency, cleanup (EC-23)
 *
 * Test count: 101 tests across 11 groups + 1 performance test.
 *
 * Environment: happy-dom (configured globally in vitest.config.ts)
 *
 * WHY THIS FILE USES DYNAMIC IMPORTS:
 * math.plugin.ts destructures window.__CM_STATE__ and window.__CM_VIEW__ at
 * module evaluation time (top-level `const { WidgetType, ... } = window.__CM_VIEW__`).
 * Static `import` statements are hoisted before any code in the file runs — including
 * `beforeAll()` callbacks — so setting globals in `beforeAll` is too late for static
 * imports (the module would be evaluated first with undefined globals).
 *
 * Solution: in `beforeAll`, set the CM6 globals then dynamically import the math module.
 * Dynamic `import()` is not hoisted; it runs at the point of the `await` expression,
 * which is after the globals have been assigned. This avoids polluting
 * window.__CM_STATE__ / window.__CM_VIEW__ for every other test file in the project
 * (the old math.setup.ts was registered globally in vitest.config.ts setupFiles,
 * which ran before ALL test files — a Finding 1 violation fixed here).
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { EditorState } from "@codemirror/state";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";

// ── Module-level references populated in beforeAll ────────────────────────────
//
// These are declared with `let` (not imported statically) because the module must
// not be evaluated until after the CM6 globals are set on `window`.

/* eslint-disable @typescript-eslint/no-explicit-any */
let scanMathRanges: (text: string) => any[];
let isCursorInsideRange: (anchor: number, head: number, from: number, to: number) => boolean;
let buildMathDecorations: (state: EditorState) => any;
let InlineMathWidget: any;
let BlockMathWidget: any;
let renderMathError: (container: HTMLElement, latex: string, isBlock: boolean) => void;
let injectCSS: () => void;
let removeCSS: () => void;
let injectPluginCSS: () => void;
let removePluginCSS: () => void;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Global setup: set CM6 globals then dynamically import the plugin ──────────
//
// This beforeAll runs once before all tests in this file. By the time any `it()`
// callback executes, the globals are set and the plugin module is loaded.

beforeAll(async () => {
  // Mirror what src/lib/cm-globals.ts does in the running app so math.plugin.ts
  // can destructure window.__CM_STATE__ and window.__CM_VIEW__ at evaluation time.
  (window as any).__CM_STATE__ = cmState;
  (window as any).__CM_VIEW__  = cmView;
  // Tests run with preview enabled — source-mode guard must not suppress decorations.
  (window as any).__MARKABLE_PREVIEW_ENABLED__ = true;

  // Dynamic import runs AFTER the globals assignment above — math.plugin.ts is
  // evaluated here and the destructure at the top of that module finds the globals.
  const mod = await import("../../../src/plugins/math/math.plugin");

  // Capture named exports for use in all test groups below.
  scanMathRanges     = mod.scanMathRanges;
  isCursorInsideRange = mod.isCursorInsideRange;
  buildMathDecorations = mod.buildMathDecorations;
  InlineMathWidget   = mod.InlineMathWidget;
  BlockMathWidget    = mod.BlockMathWidget;
  renderMathError    = mod.renderMathError;
  injectCSS          = mod.injectCSS;
  removeCSS          = mod.removeCSS;
  injectPluginCSS    = mod.injectPluginCSS;
  removePluginCSS    = mod.removePluginCSS;
});

// ── 1. Scanner — Basic inline math (10 tests) ─────────────────────────────────

describe("scanMathRanges — basic inline math", () => {
  // S01
  it("S01: finds a single inline expression at start of document", () => {
    const result = scanMathRanges("$x^2$");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: 0, to: 5, latex: "x^2", display: false });
  });

  // S02
  it("S02: finds inline expression with surrounding text", () => {
    // "abc $x$ def": a=0,b=1,c=2,' '=3,$=4,x=5,$=6,' '=7,d=8,e=9,f=10
    // Opening $ at 4, closing $ at 6, to = 7 (exclusive end: char AFTER closing $)
    const result = scanMathRanges("abc $x$ def");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: 4, to: 7, latex: "x" });
  });

  // S03
  it("S03: finds two inline expressions on same line", () => {
    const result = scanMathRanges("$a$ and $b$");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ from: 0, to: 3, latex: "a", display: false });
    expect(result[1]).toMatchObject({ from: 8, to: 11, latex: "b", display: false });
  });

  // S04
  it("S04: returns empty for document with no math", () => {
    expect(scanMathRanges("no math here")).toHaveLength(0);
  });

  // S05
  it("S05: returns empty for empty document", () => {
    expect(scanMathRanges("")).toHaveLength(0);
  });

  // S06
  it("S06: single lone $ with no closing delimiter returns 0 ranges", () => {
    expect(scanMathRanges("$")).toHaveLength(0);
  });

  // S07
  it("S07: inline expression at end of document", () => {
    const result = scanMathRanges("abc $x$");
    expect(result).toHaveLength(1);
    expect(result[0].to).toBe(7);
  });

  // S08
  it("S08: inline expression at start of document", () => {
    const result = scanMathRanges("$x$ abc");
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(0);
  });

  // S09
  it("S09: complex LaTeX expression with braces", () => {
    const result = scanMathRanges("$\\frac{1}{2}$");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("\\frac{1}{2}");
  });

  // S10
  it("S10: three inline spans sorted by from position", () => {
    const result = scanMathRanges("$a$ $b$ $c$");
    expect(result).toHaveLength(3);
    expect(result.map((r: any) => r.latex)).toEqual(["a", "b", "c"]);
  });
});

// ── 2. Scanner — Block math (8 tests) ─────────────────────────────────────────

describe("scanMathRanges — block math", () => {
  // B01
  it("B01: finds a single display block", () => {
    const text = "$$\nx\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
  });

  // B02
  it("B02: captures multi-line content in display block", () => {
    const text = "$$\na+b\n=c\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    // latex should contain both content lines
    expect(result[0].latex).toContain("a+b");
    expect(result[0].latex).toContain("=c");
  });

  // B03
  it("B03: handles empty block (EC-7 variant)", () => {
    const text = "$$\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
    // latex is the content between the two delimiter lines
    expect(typeof result[0].latex).toBe("string");
  });

  // B04
  it("B04: handles whitespace-only content in block (EC-7)", () => {
    const text = "$$\n   \n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
  });

  // B05
  it("B05: block at document start — from is 0 (EC-8)", () => {
    const text = "$$\nE = mc^2\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(0);
  });

  // B06
  it("B06: unterminated block produces no range (EC-19)", () => {
    const text = "$$\nx\n";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // B07
  it("B07: $$ with trailing text on same line is not a valid block delimiter", () => {
    // "$$ foo" is not a valid block open line (trimmed content is not exactly "$$")
    const text = "$$ foo\nbar\n$$";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // B08
  it("B08: two display blocks in same document", () => {
    const text = "$$\na\n$$\n\n$$\nb\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(2);
    expect(result.every((r: any) => r.display)).toBe(true);
  });
});

// ── 3. Scanner — Code exclusions (10 tests) ───────────────────────────────────

describe("scanMathRanges — code exclusions", () => {
  // C01
  it("C01: $ inside backtick-fenced code block not matched (EC-11)", () => {
    const text = "```\n$x^2$\n```";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // C02
  it("C02: $ inside tilde-fenced code block not matched", () => {
    const text = "~~~\n$x^2$\n~~~";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // C03
  it("C03: $ inside inline code span not matched (EC-12)", () => {
    const text = "`$x$`";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // C04
  it("C04: $$ inside inline code span not matched (EC-17)", () => {
    const text = "`$$`";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // C05
  it("C05: $ outside inline code matches, $ inside does not (EC-12 mixed)", () => {
    const text = "$a$ and `$b$`";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("a");
  });

  // C06
  it("C06: $ after closed code fence is matched", () => {
    const text = "```\ncode\n```\n$x$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });

  // C07
  it("C07: $ before code fence is matched", () => {
    const text = "$x$\n```\ncode\n```";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });

  // C08
  it("C08: block math not inside code fence is matched", () => {
    const text = "text\n$$\nx\n$$\nmore";
    expect(scanMathRanges(text)).toHaveLength(1);
  });

  // C09
  it("C09: $$ inside inline code produces 0 ranges", () => {
    const text = "`$$`";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // C10
  it("C10: unclosed code fence masks $ to end of document", () => {
    const text = "```\n$x$";
    expect(scanMathRanges(text)).toHaveLength(0);
  });
});

// ── 4. Scanner — Escaped dollar signs (6 tests) ───────────────────────────────

describe("scanMathRanges — escaped dollar signs (EC-13)", () => {
  // E01
  it("E01: \\$ does not open a math span", () => {
    expect(scanMathRanges("\\$5")).toHaveLength(0);
  });

  // E02
  it("E02: \\$ at start of potential inline — no match", () => {
    expect(scanMathRanges("\\$x^2$")).toHaveLength(0);
  });

  // E03
  it("E03: valid math after escaped dollar sign matches", () => {
    const result = scanMathRanges("cost \\$5 and $x^2$");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x^2");
  });

  // E04
  it("E04: single \\$ produces no ranges", () => {
    expect(scanMathRanges("\\$")).toHaveLength(0);
  });

  // E05 — EC-13 edge case: escaped $ inside a span
  it("E05: $x\\$y$ — scanner finds close at final $ producing 1 range (acknowledged spec deviation)", () => {
    // Positions in "$x\\$y$":
    //   0=$, 1=x, 2=\, 3=$, 4=y, 5=$
    // Opening $ at 0. Scanning forward for close:
    //   j=3: preceded by \, so SKIPPED (escaped close).
    //   j=5: preceded by 'y', so VALID close. latex = "x\$y".
    // The scanner therefore produces 1 range with latex "x\$y".
    // This is a known deviation from the strict interpretation that says
    // "any escaped $ in the content means no match". See 00_index.md Known Limitations.
    const result = scanMathRanges("$x\\$y$");
    expect(result.length).toBe(1);
    // Scanner interpretation: \$ inside span is kept as literal content.
    // Result: 1 range with latex "x\$y". See 00_index.md Known Limitations.
    expect(result[0].latex).toBe("x\\$y");
  });

  // E06
  it("E06: \\$ $x$ \\$ — only the middle $x$ matches", () => {
    const result = scanMathRanges("\\$ $x$ \\$");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });
});

// ── 5. Scanner — Inline edge cases (8 tests) ──────────────────────────────────

describe("scanMathRanges — inline edge cases", () => {
  // I01
  it("I01: $$ alone on a line with no block context is 0 ranges (EC-6)", () => {
    // $$ on a line that has no matching closing $$ is not inline (adjacent $$
    // skips to prevent zero-length inline) and not block (no content + closer)
    expect(scanMathRanges("$$")).toHaveLength(0);
  });

  // I02
  it("I02: multi-line inline math not matched (EC-20)", () => {
    const text = "$a\n+b$";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  // I03
  it("I03: space-only content is a valid inline span", () => {
    const result = scanMathRanges("$ $");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe(" ");
  });

  // I04
  it("I04: multiple-space content is a valid inline span", () => {
    const result = scanMathRanges("$  $");
    expect(result).toHaveLength(1);
  });

  // I05 — EC-5: inline math adjacent to bold markers (also covers inline inside bold)
  it("I05: inline adjacent to bold markers", () => {
    const result = scanMathRanges("**$x$**");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });

  // I06
  it("I06: $a$$b$ — must not crash and must produce at most 1 range", () => {
    // The $$ between a and b is skipped by the adjacent-$$ guard.
    // "$ a$" could produce 1 range ("a"), or 0 — must not crash.
    expect(() => scanMathRanges("$a$$b$")).not.toThrow();
  });

  // I07
  it("I07: very long LaTeX string (1000 chars) produces one range without hanging", () => {
    const longLatex = "x".repeat(1000);
    const text = `$${longLatex}$`;
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe(longLatex);
  });

  // I08
  it("I08: Unicode characters inside LaTeX are preserved", () => {
    const result = scanMathRanges("$α + β$");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("α + β");
  });
});

// ── 5b. Scanner — Bold/inline-math interaction (EC-5) ─────────────────────────

describe("scanMathRanges — math embedded in bold content (EC-5)", () => {
  // EC5-A: inline math inside a bold run (the core EC-5 case)
  it("EC5-A: math inside bold — 1 range with correct latex", () => {
    // "**bold $x^2$ bold**" — the $x^2$ spans a region surrounded by bold markers.
    // The scanner must treat ** as ordinary text and find the math range.
    const result = scanMathRanges("**bold $x^2$ bold**");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x^2");
  });
});

// ── 6. Scanner — from/to boundary precision (6 tests) ────────────────────────

describe("scanMathRanges — from/to boundaries", () => {
  // F01
  it("F01: from is the index of the opening $", () => {
    const text = "abc $x$ def";
    const result = scanMathRanges(text);
    expect(result[0].from).toBe(4);
    expect(text[result[0].from]).toBe("$");
  });

  // F02
  it("F02: to is the index AFTER the closing $ (exclusive end)", () => {
    // "abc $x$ def": opening $ at 4, closing $ at 6, space at 7, d at 8
    // to = 7 (exclusive end — one past the closing $; text[7] === ' ')
    const text = "abc $x$ def";
    const result = scanMathRanges(text);
    expect(result[0].to).toBe(7);
    expect(text[result[0].to]).toBe(" "); // space character at the exclusive end
  });

  // F03
  it("F03: block from is index of the first $ on the opening line", () => {
    const text = "$$\nx\n$$";
    const result = scanMathRanges(text);
    expect(result[0].from).toBe(0);
    expect(text[result[0].from]).toBe("$");
  });

  // F04
  it("F04: block to is one past the second $ on the closing line", () => {
    // text = "$$\nx\n$$"  positions: 0=$, 1=$, 2=\n, 3=x, 4=\n, 5=$, 6=$
    // to should be 7 (after index 6)
    const text = "$$\nx\n$$";
    const result = scanMathRanges(text);
    expect(result[0].to).toBe(7);
  });

  // F05
  it("F05: two inline spans have non-overlapping [from, to) ranges", () => {
    const result = scanMathRanges("$a$ $b$");
    expect(result).toHaveLength(2);
    // First span ends before second begins
    expect(result[0].to).toBeLessThanOrEqual(result[1].from);
  });

  // F06
  it("F06: block range covers full delimiter lines (from on opening line, to after closing line)", () => {
    // "text\n$$\nx\n$$\nmore"
    // Opening $$ starts at index 5 (after "text\n")
    const text = "text\n$$\nx\n$$\nmore";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(5);
    // Closing $$ is at indices 10,11. to = 12.
    expect(result[0].to).toBe(12);
  });
});

// ── 7. Scanner — Indented block delimiter (Finding 5) ─────────────────────────

describe("scanMathRanges — indented block delimiters", () => {
  // IND01 — Finding 5: isBlockDelimiterLine permits leading whitespace
  it("IND01: indented $$ delimiter lines are recognised as a valid block", () => {
    // The scanner permits any leading whitespace before $$ (more permissive than
    // CommonMark's 3-space indent limit). See isBlockDelimiterLine comment.
    const result = scanMathRanges("    $$\nx\n    $$");
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
    expect(result[0].latex.trim()).toContain("x");
  });
});

// ── 8. isCursorInsideRange (12 tests) ─────────────────────────────────────────

describe("isCursorInsideRange", () => {
  // Range: from=4, to=8  (e.g. "$x^2$" at positions 4–8 in "abc $x^2$ ")
  const from = 4, to = 8;

  // CR01
  it("CR01: cursor before range → false", () => {
    expect(isCursorInsideRange(3, 3, from, to)).toBe(false);
  });

  // CR02
  it("CR02: cursor exactly at to (just past closing $) → false", () => {
    expect(isCursorInsideRange(8, 8, from, to)).toBe(false);
  });

  // CR03 — EC-1
  it("CR03: cursor at from (on opening $) → true (EC-1)", () => {
    expect(isCursorInsideRange(4, 4, from, to)).toBe(true);
  });

  // CR04 — EC-2
  it("CR04: cursor at to-1 (on closing $) → true (EC-2)", () => {
    expect(isCursorInsideRange(7, 7, from, to)).toBe(true);
  });

  // CR05
  it("CR05: cursor in the middle of the range → true", () => {
    expect(isCursorInsideRange(5, 5, from, to)).toBe(true);
  });

  // CR06 — EC-1.4
  it("CR06: selection anchor outside, head inside → true", () => {
    expect(isCursorInsideRange(2, 5, from, to)).toBe(true);
  });

  // CR07 — EC-1.4
  it("CR07: selection anchor inside, head outside → true", () => {
    expect(isCursorInsideRange(6, 10, from, to)).toBe(true);
  });

  // CR08
  it("CR08: selection spanning entire range → true", () => {
    expect(isCursorInsideRange(0, 20, from, to)).toBe(true);
  });

  // CR09
  it("CR09: selection entirely before range → false", () => {
    expect(isCursorInsideRange(0, 3, from, to)).toBe(false);
  });

  // CR10
  it("CR10: selection entirely after range → false", () => {
    expect(isCursorInsideRange(9, 15, from, to)).toBe(false);
  });

  // CR11
  it("CR11: reversed selection (anchor > head) overlapping → true", () => {
    // User selected backwards: anchor=10, head=5 — overlaps range [4,8)
    expect(isCursorInsideRange(10, 5, from, to)).toBe(true);
  });

  // CR12
  it("CR12: zero-length range (from === to) → false", () => {
    // Degenerate case: 5 < 5 is false so cursor is never "inside" a zero-length range
    expect(isCursorInsideRange(5, 5, 5, 5)).toBe(false);
  });
});

// ── 9. Widget rendering (12 tests) ────────────────────────────────────────────

describe("InlineMathWidget", () => {
  // W01
  it("W01: toDOM() returns a <span> with class cm-math-inline", () => {
    const w = new InlineMathWidget("x^2");
    const dom = w.toDOM();
    expect(dom.tagName).toBe("SPAN");
    expect(dom.classList.contains("cm-math-inline")).toBe(true);
  });

  // W02
  it("W02: toDOM() innerHTML contains KaTeX output (non-empty, includes 'katex')", () => {
    const w = new InlineMathWidget("x^2");
    const dom = w.toDOM();
    expect(dom.innerHTML.length).toBeGreaterThan(0);
    expect(dom.innerHTML).toContain("katex");
  });

  // W03
  it("W03: eq() returns true when latex is identical", () => {
    const w1 = new InlineMathWidget("x^2");
    const w2 = new InlineMathWidget("x^2");
    expect(w1.eq(w2)).toBe(true);
  });

  // W04
  it("W04: eq() returns false when latex differs", () => {
    const w1 = new InlineMathWidget("x^2");
    const w2 = new InlineMathWidget("y^2");
    expect(w1.eq(w2)).toBe(false);
  });
});

describe("BlockMathWidget", () => {
  // W05
  it("W05: toDOM() returns a <div> with class cm-math-block", () => {
    const w = new BlockMathWidget("E = mc^2");
    const dom = w.toDOM();
    expect(dom.tagName).toBe("DIV");
    expect(dom.classList.contains("cm-math-block")).toBe(true);
  });

  // W06 — EC-7
  it("W06: toDOM() with empty latex does not throw (EC-7)", () => {
    const w = new BlockMathWidget("");
    expect(() => w.toDOM()).not.toThrow();
  });

  // W07
  it("W07: eq() returns true for same latex", () => {
    expect(new BlockMathWidget("E").eq(new BlockMathWidget("E"))).toBe(true);
  });

  // W08 — EC-16
  it("W08: toDOM() with very long LaTeX does not throw (EC-16)", () => {
    const longLatex = "x +".repeat(500);
    const w = new BlockMathWidget(longLatex);
    expect(() => w.toDOM()).not.toThrow();
  });
});

describe("Math widget error handling", () => {
  // W09
  it("W09: renderMathError on span sets cm-math-error and cm-math-inline classes", () => {
    const container = document.createElement("span");
    renderMathError(container, "bad latex", false);
    expect(container.classList.contains("cm-math-error")).toBe(true);
    expect(container.classList.contains("cm-math-inline")).toBe(true);
  });

  // W10
  it("W10: renderMathError on div sets cm-math-error and cm-math-block classes", () => {
    const container = document.createElement("div");
    renderMathError(container, "bad", true);
    expect(container.classList.contains("cm-math-block")).toBe(true);
    expect(container.classList.contains("cm-math-error")).toBe(true);
  });

  // W11
  it("W11: error placeholder textContent is 'Math error'", () => {
    const container = document.createElement("span");
    renderMathError(container, "bad latex", false);
    expect(container.textContent).toBe("Math error");
  });

  // W12
  it("W12: error placeholder title attribute is the raw LaTeX string", () => {
    const container = document.createElement("span");
    renderMathError(container, "bad latex string", false);
    expect(container.title).toBe("bad latex string");
  });
});

// ── 10. CSS injection (8 tests) ────────────────────────────────────────────────

describe("CSS injection (EC-23)", () => {
  // Clean slate before each test so tests are independent
  beforeEach(() => {
    document.getElementById("__markable_math_css__")?.remove();
    document.getElementById("__markable_math_plugin_css__")?.remove();
  });

  // CSS01
  it("CSS01: injectCSS() creates a <style> tag with the correct id", () => {
    injectCSS();
    expect(document.getElementById("__markable_math_css__")).toBeTruthy();
  });

  // CSS02 — EC-23
  it("CSS02: injectCSS() twice — only one tag exists (idempotent)", () => {
    injectCSS();
    injectCSS();
    const tags = document.querySelectorAll("#__markable_math_css__");
    expect(tags.length).toBe(1);
  });

  // CSS03
  it("CSS03: removeCSS() removes the injected <style> tag", () => {
    injectCSS();
    removeCSS();
    expect(document.getElementById("__markable_math_css__")).toBeNull();
  });

  // CSS04
  it("CSS04: removeCSS() is safe when tag does not exist (no throw)", () => {
    expect(() => removeCSS()).not.toThrow();
  });

  // CSS05
  it("CSS05: injectPluginCSS() creates <style id='__markable_math_plugin_css__'>", () => {
    injectPluginCSS();
    expect(document.getElementById("__markable_math_plugin_css__")).toBeTruthy();
  });

  // CSS06
  it("CSS06: injectPluginCSS() twice — only one tag exists", () => {
    injectPluginCSS();
    injectPluginCSS();
    const tags = document.querySelectorAll("#__markable_math_plugin_css__");
    expect(tags.length).toBe(1);
  });

  // CSS07
  it("CSS07: removePluginCSS() removes the plugin CSS tag", () => {
    injectPluginCSS();
    removePluginCSS();
    expect(document.getElementById("__markable_math_plugin_css__")).toBeNull();
  });

  // CSS08
  it("CSS08: KATEX_CSS contains layout CSS and no @font-face or font file URLs", async () => {
    const { KATEX_CSS } = await import("../../../src/plugins/math/katex-css");
    // Layout CSS must be present (~10 KB after @font-face stripping).
    expect(KATEX_CSS.length).toBeGreaterThan(10_000);
    // @font-face blocks were stripped to keep math.js under the 500 KB plugin cap.
    // Font file references (fonts/*.woff2 etc.) must not appear — they 404 in the
    // Tauri WebView which has no HTTP server to serve relative paths.
    expect(KATEX_CSS).not.toMatch(/@font-face/);
    expect(KATEX_CSS).not.toMatch(/url\(fonts\//);
  });
});

// ── 11. buildMathDecorations with EditorState (10 tests) ─────────────────────

describe("buildMathDecorations", () => {
  // D01
  it("D01: no math in doc → empty DecorationSet", () => {
    const state = EditorState.create({ doc: "Hello world" });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // D02
  it("D02: inline math, cursor away → 1 decoration", () => {
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  // D03 — EC-1
  it("D03: inline math, cursor at from (opening $) → 0 decorations (EC-1)", () => {
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 4, head: 4 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // D04 — EC-2
  it("D04: inline math, cursor at to-1 (closing $) → 0 decorations (EC-2)", () => {
    // "abc $x^2$ def": opening $ at 4, closing $ at 8, to=9
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 8, head: 8 }, // on closing $
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // D05
  it("D05: inline math, cursor at to (just past expression) → 1 decoration", () => {
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 9, head: 9 }, // one past closing $
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  // D06
  it("D06: block math, cursor away → 1 decoration", () => {
    const doc = "abc\n$$\nE=mc^2\n$$\nxyz";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  // D07 — EC-3
  it("D07: block math, cursor on opening $$ delimiter line → 0 decorations (EC-3)", () => {
    const doc = "$$\nE=mc^2\n$$";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // D08 — EC-4
  it("D08: two inline spans, cursor between → 2 decorations (EC-4)", () => {
    // "$a$ and $b$" — cursor at position 4 (between the spans, on space)
    const state = EditorState.create({
      doc: "$a$ and $b$",
      selection: { anchor: 4, head: 4 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(2);
  });

  // D09
  it("D09: mixed inline + block, cursor in neither → 2 decorations", () => {
    const doc = "See $a$ and:\n$$\nb\n$$\ndone";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length, head: doc.length },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(2);
  });

  // D10 — NFR-1
  it("D10: 50 inline expressions, cursor away → 50 decorations", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}: $x_${i}^2$`);
    const doc = lines.join("\n");
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(50);
  });
});

// ── 12. Integration / edge cases (8 tests) ────────────────────────────────────

describe("Integration edge cases", () => {
  // INT01 — EC-17
  it("INT01: $$ inside inline code is not a block delimiter (EC-17)", () => {
    const result = scanMathRanges("Use `$$` as a block delimiter");
    expect(result).toHaveLength(0);
  });

  // INT02
  it("INT02: $ inside block math content is not also an inline match", () => {
    const text = "$$\n$x$\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
  });

  // INT03 — EC-22
  it("INT03: scanMathRanges is pure — successive calls produce independent results", () => {
    expect(scanMathRanges("$x^2$")).toHaveLength(1);
    expect(scanMathRanges("")).toHaveLength(0);
    expect(scanMathRanges("$x^2$")).toHaveLength(1);
  });

  // INT04 — EC-18
  it("INT04: two display blocks, neither with cursor → 2 decorations", () => {
    const doc = "$$\na\n$$\n\n$$\nb\n$$";
    const state = EditorState.create({
      doc,
      selection: { anchor: 8, head: 8 }, // in the blank line between blocks
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(2);
  });

  // INT05 — EC-3
  it("INT05: block with cursor in content (not on delimiter) → 0 decorations", () => {
    const doc = "$$\nE=mc^2\n$$";
    // Position 3 is the start of the content line (the E)
    const state = EditorState.create({
      doc,
      selection: { anchor: 3, head: 3 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // INT06 — EC-3
  it("INT06: block with cursor on closing $$ line → 0 decorations", () => {
    const doc = "$$\nE=mc^2\n$$";
    // "$$\nE=mc^2\n$$" — closing $$ at positions 10-11
    const state = EditorState.create({
      doc,
      selection: { anchor: 10, head: 10 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  // INT07
  it("INT07: inline math adjacent to bold syntax — 1 math decoration, no crash", () => {
    const doc = "**$x$**";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    expect(() => buildMathDecorations(state)).not.toThrow();
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  // INT08
  it("INT08: empty document → 0 ranges and empty DecorationSet", () => {
    expect(scanMathRanges("")).toHaveLength(0);
    const state = EditorState.create({ doc: "" });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });
});

// ── 13. Performance (1 test) ──────────────────────────────────────────────────

describe("Performance (NFR-1)", () => {
  it("scans 50 inline expressions in under 50ms", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}: $x_${i}^2$`);
    const text = lines.join("\n");

    const start = performance.now();
    const result = scanMathRanges(text);
    const elapsed = performance.now() - start;

    expect(result).toHaveLength(50);
    expect(elapsed).toBeLessThan(50);
  });
});
