---
title: "Math Step 06 — Full Test Suite"
last-updated: "2026-04-18"
review-cadence-days: 14
status: active
---

# Step 06 — Full Test Suite

## Objective

Write the complete test suite for the math plugin. Target: 80+ tests covering scanner edge cases, widget behavior, cursor-inside logic, StateField recomputation, and integration scenarios. All tests run in Vitest with `happy-dom`.

## Test File Location

`tests/plugins/math/math.test.ts`

## Test File Setup

```typescript
/**
 * Tests for the Math plugin (FC2 #8).
 *
 * Covers:
 *   - scanMathRanges: all EC-* edge cases from requirements spec
 *   - isCursorInsideRange: boundary conditions
 *   - InlineMathWidget / BlockMathWidget: DOM output, eq(), error handling
 *   - buildMathDecorations: StateField integration
 *   - CSS injection helpers: idempotency, cleanup
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";
import { EditorState } from "@codemirror/state";

// Set up window globals BEFORE importing the plugin module,
// so the top-level destructure in math.plugin.ts resolves correctly.
beforeAll(() => {
  (window as any).__CM_STATE__ = cmState;
  (window as any).__CM_VIEW__  = cmView;
});

// Named exports from math.plugin.ts (step_02, step_03, step_04 exports)
import {
  scanMathRanges,
  isCursorInsideRange,
  buildMathDecorations,
  MathRange,
} from "../../../src/plugins/math/math.plugin";

// Widget classes — exported for testing
import {
  InlineMathWidget,
  BlockMathWidget,
  renderMathError,
  injectCSS,
  removeCSS,
  injectPluginCSS,
  removePluginCSS,
} from "../../../src/plugins/math/math.plugin";
```

**Note on exports:** `math.plugin.ts` currently uses `export default` for the plugin object. The test imports above require named exports. The developer must also add named exports alongside the default:

```typescript
// In math.plugin.ts, add these named exports:
export { scanMathRanges, MathRange };             // from step_02
export { isCursorInsideRange, buildMathDecorations }; // from step_04
export { InlineMathWidget, BlockMathWidget, renderMathError }; // from step_03
export { injectCSS, removeCSS, injectPluginCSS, removePluginCSS }; // from step_03
```

This follows the `auto-toc.plugin.ts` pattern where `scanHeadings` and `HeadingEntry` are exported alongside the default plugin object.

---

## Complete Test Specification

### 1. Scanner — Basic inline (10 tests)

| # | Input | Expected |
|---|---|---|
| S01 | `"$x^2$"` | 1 range, from=0, to=5, latex="x^2", display=false |
| S02 | `"abc $x$ def"` | 1 range, from=4, to=8, latex="x" |
| S03 | `"$a$ and $b$"` | 2 ranges, latexes ["a","b"] |
| S04 | `"no math here"` | 0 ranges |
| S05 | `""` | 0 ranges |
| S06 | `"$"` | 0 ranges (single $ with no close) |
| S07 | Inline at document end: `"abc $x$"` | 1 range, to=7 |
| S08 | Inline at document start: `"$x$ abc"` | 1 range, from=0 |
| S09 | Complex LaTeX: `"$\\frac{1}{2}$"` | 1 range, latex=`"\\frac{1}{2}"` |
| S10 | Three inline spans: `"$a$ $b$ $c$"` | 3 ranges sorted by from |

### 2. Scanner — Block math (8 tests)

| # | Input | Expected |
|---|---|---|
| B01 | `"$$\nx\n$$"` | 1 range, display=true |
| B02 | `"$$\na+b\n=c\n$$"` | 1 range, latex contains both lines |
| B03 | `"$$\n$$"` (empty block) | 1 range, latex="" or "\n" |
| B04 | `"$$\n   \n$$"` (whitespace content) | 1 range |
| B05 | Block at doc start: `"$$\nx\n$$"` | from=0 |
| B06 | Unterminated block: `"$$\nx\n"` | 0 ranges (EC-19) |
| B07 | `"$$" on line with text` e.g. `"$$ foo\nbar\n$$"` | 0 ranges (opening `$$` has trailing content — not a valid delimiter) |
| B08 | Two blocks in document | 2 ranges, both display=true |

### 3. Scanner — Code exclusions (10 tests)

| # | Input | Expected |
|---|---|---|
| C01 | ` "```\n$x$\n```" ` | 0 ranges (EC-11) |
| C02 | `"~~~\n$x$\n~~~"` | 0 ranges (tilde fence) |
| C03 | `` "`$x$`" `` | 0 ranges (EC-12) |
| C04 | `` "`$$`" `` | 0 ranges (EC-17) |
| C05 | `` "$a$ and `$b$`" `` | 1 range (only $a$ matches) |
| C06 | Code fence followed by math: `` "```\ncode\n```\n$x$" `` | 1 range for $x$ |
| C07 | Math before code fence: `"$x$\n```\ncode\n```"` | 1 range for $x$ |
| C08 | Block math not inside code: `"text\n$$\nx\n$$\nmore"` | 1 range |
| C09 | `$$` inside inline code: `` "`$$`" `` | 0 ranges |
| C10 | Unclosed code fence: `` "```\n$x$" `` | 0 ranges (unclosed fence masks to end of doc) |

### 4. Scanner — Escaped dollar signs (6 tests)

| # | Input | Expected |
|---|---|---|
| E01 | `"\\$5"` | 0 ranges (EC-13) |
| E02 | `"\\$x^2$"` | 0 ranges (opening $ escaped) |
| E03 | `"cost \\$5 and $x^2$"` | 1 range (only $x^2$ matches) |
| E04 | `"\\$"` (single escaped $) | 0 ranges |
| E05 | `"$x\\$y$"` | 0 ranges (closing $ escaped) |
| E06 | `"\\$ $x$ \\$"` | 1 range for $x$ only |

### 5. Scanner — Inline edge cases (8 tests)

| # | Input | Expected |
|---|---|---|
| I01 | `"$$"` on one line with no block context | 0 ranges (EC-6: zero-length inline) |
| I02 | `"$a\n+b$"` (multi-line inline) | 0 ranges (EC-20) |
| I03 | `"$ $"` (space-only content) | 1 range, latex=" " (KaTeX handles it) |
| I04 | `"$  $"` (multiple spaces) | 1 range |
| I05 | Inline adjacent to bold: `"**$x$**"` | 1 range |
| I06 | Inline adjacent to another: `"$a$$b$"` | Complex — at minimum 0 or 1 range; must not crash |
| I07 | Very long LaTeX: 1000 character string | 1 range, no hang |
| I08 | Unicode in LaTeX: `"$α + β$"` | 1 range |

### 6. Scanner — from/to boundaries (6 tests)

All tested in step_02's boundary group. Confirm:

| # | Check |
|---|---|
| F01 | `from` is the index of the opening `$` |
| F02 | `to` is one past the closing `$` (exclusive end) |
| F03 | Block `from` is index of first `$` on opening line |
| F04 | Block `to` is one past the second `$` on closing line |
| F05 | Two inline spans: no overlap in their `[from,to)` ranges |
| F06 | Block range covers delimiter lines, not just content |

### 7. `isCursorInsideRange` (12 tests)

Covered fully in step_04's test spec. Key cases:

| # | Check |
|---|---|
| CR01 | Cursor before range → false |
| CR02 | Cursor exactly at `to` → false |
| CR03 | Cursor at `from` (opening $) → true (EC-1) |
| CR04 | Cursor at `to - 1` (closing $) → true (EC-2) |
| CR05 | Cursor in middle → true |
| CR06 | Selection anchor outside, head inside → true (EC-1.4) |
| CR07 | Selection anchor inside, head outside → true (EC-1.4) |
| CR08 | Selection spanning entire range → true |
| CR09 | Selection entirely before → false |
| CR10 | Selection entirely after → false |
| CR11 | Reversed selection (anchor > head) → true when overlapping |
| CR12 | Zero-length range → false |

### 8. Widget rendering (12 tests)

| # | Test |
|---|---|
| W01 | `InlineMathWidget("x^2").toDOM()` returns `<span class="cm-math-inline">` |
| W02 | `InlineMathWidget("x^2").toDOM().innerHTML` contains KaTeX output (non-empty) |
| W03 | `InlineMathWidget.eq()` true for same latex |
| W04 | `InlineMathWidget.eq()` false for different latex |
| W05 | `BlockMathWidget("E=mc^2").toDOM()` returns `<div class="cm-math-block">` |
| W06 | `BlockMathWidget("").toDOM()` does not throw (EC-7) |
| W07 | `BlockMathWidget.eq()` true for same latex |
| W08 | `BlockMathWidget` does not throw for very long LaTeX (EC-16) |
| W09 | `renderMathError(span, "bad", false)` sets class `cm-math-error` and `cm-math-inline` |
| W10 | `renderMathError(div, "bad", true)` sets classes `cm-math-error cm-math-block` |
| W11 | Error placeholder `textContent` is "Math error" |
| W12 | Error placeholder `title` attribute is the raw LaTeX string |

### 9. CSS injection (8 tests)

| # | Test |
|---|---|
| CSS01 | `injectCSS()` creates `<style id="__markable_math_css__">` |
| CSS02 | `injectCSS()` twice — only one tag exists (EC-23) |
| CSS03 | `removeCSS()` removes the tag |
| CSS04 | `removeCSS()` when no tag exists — does not throw |
| CSS05 | `injectPluginCSS()` creates `<style id="__markable_math_plugin_css__">` |
| CSS06 | `injectPluginCSS()` twice — only one tag exists |
| CSS07 | `removePluginCSS()` removes the tag |
| CSS08 | KaTeX CSS string length > 10,000 characters (sanity check) |

### 10. `buildMathDecorations` with EditorState (10 tests)

| # | Test |
|---|---|
| D01 | No math in doc → empty DecorationSet |
| D02 | Inline math, cursor away → 1 decoration |
| D03 | Inline math, cursor at `from` → 0 decorations (EC-1) |
| D04 | Inline math, cursor at `to-1` → 0 decorations (EC-2) |
| D05 | Inline math, cursor at `to` (just past) → 1 decoration |
| D06 | Block math, cursor away → 1 decoration |
| D07 | Block math, cursor on `$$` line → 0 decorations (EC-3) |
| D08 | Two inline spans, cursor between → 2 decorations (EC-4) |
| D09 | Mixed inline + block, cursor in neither → 2 decorations |
| D10 | 50 inline expressions, cursor away → 50 decorations (NFR-1 performance) |

### 11. Integration / edge cases (8 tests)

| # | Test |
|---|---|
| INT01 | `$$` inside inline code is not a block delimiter (EC-17) |
| INT02 | `$` inside block math content is not also an inline match (no double-match) |
| INT03 | Undo scenario: `scanMathRanges("$x^2$")` then `scanMathRanges("")` returns 0 (EC-22 state machine) |
| INT04 | Two blocks, neither with cursor → 2 decorations (EC-18) |
| INT05 | Block with cursor in content (not on delimiter) → 0 decorations (EC-3) |
| INT06 | Block with cursor on closing `$$` line → 0 decorations (EC-3) |
| INT07 | Inline `$...$` adjacent to live-preview bold syntax → 1 math decoration, no crash |
| INT08 | Empty document → `scanMathRanges("")` returns [] and `buildMathDecorations` returns empty set |

---

## Performance Test (NFR-1)

Add one timing test for the 50-expression performance requirement:

```typescript
it("scans 50 inline expressions in under 50ms (NFR-1)", () => {
  // Build a document with 50 inline math spans
  const lines = Array.from({ length: 50 }, (_, i) => `Line ${i}: $x_${i}^2$`);
  const text = lines.join("\n");

  const start = performance.now();
  const result = scanMathRanges(text);
  const elapsed = performance.now() - start;

  expect(result).toHaveLength(50);
  expect(elapsed).toBeLessThan(50);
});
```

---

## Test Count Target

| Section | Count |
|---|---|
| Basic inline | 10 |
| Block math | 8 |
| Code exclusions | 10 |
| Escaped $ | 6 |
| Inline edge cases | 8 |
| from/to boundaries | 6 |
| isCursorInsideRange | 12 |
| Widgets | 12 |
| CSS injection | 8 |
| buildMathDecorations | 10 |
| Integration | 8 |
| Performance | 1 |
| **Total** | **99** |

---

## Acceptance Criteria

- [ ] All 99 tests pass (0 failing, 0 skipped except intentionally documented ones).
- [ ] No test imports from `@codemirror/*` as values without first setting up `window.__CM_VIEW__` and `window.__CM_STATE__` globals.
- [ ] CSS tests use `beforeEach` to reset the DOM (remove injected style tags) so tests are independent.
- [ ] Widget tests run in `happy-dom` environment (configured via `@vitest-environment happy-dom` comment or `vitest.config.ts`).
- [ ] Performance test passes reliably on development hardware (50ms budget is generous for 50 expressions).
- [ ] `npm run test:run` exits 0.

## Vitest Configuration Note

The existing `vitest.config.ts` should specify `environment: "happy-dom"` globally, or the math test file uses `// @vitest-environment happy-dom`. Check `vitest.config.ts` for the current setting before adding the per-file comment.

If `happy-dom` is already the global environment (it is — `happy-dom` is in `devDependencies`), no per-file annotation is needed. The `beforeAll` global setup for `window.__CM_STATE__`/`__CM_VIEW__` is still required since those are set by the running app in production but not in the test environment.

## Skippable Tests (Document Reason)

If any tests must be marked `it.skip`, document the reason inline:

```typescript
it.skip("InlineMathWidget renders specific KaTeX HTML structure", () => {
  // SKIPPED: KaTeX's HTML output structure may change across minor versions.
  // The test would be brittle. Instead we verify non-empty innerHTML and absence of errors.
});
```

The yaml-pane precedent: 30 tests skipped for runtime-only scenarios. For the math plugin, aim for 0 skips. All scenarios are testable with the DOM environment and CM6 state factory.
