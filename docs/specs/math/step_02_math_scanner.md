---
title: "Math Step 02 — Math Scanner"
last-updated: "2026-04-18"
review-cadence-days: 14
status: active
---

# Step 02 — Math Scanner

## Objective

Implement `scanMathRanges(text: string): MathRange[]` — a pure function with zero dependencies that finds all valid inline and block math ranges in a document string. This is the most test-critical piece of the plugin; all edge cases in the requirements spec are exercised here.

## What to Implement

### 2a. The `MathRange` type

Export this type from `math.plugin.ts` so tests can import it:

```typescript
/**
 * A single math expression found in the document.
 *
 * `from` and `to` are character offsets into the original document string,
 * matching the values CM6's `doc.toString()` produces (LF-only line endings).
 *
 * `from` is the index of the opening `$` (or first `$` of `$$`).
 * `to`   is the index AFTER the closing `$` (or after the second `$` of closing `$$`).
 * This matches CM6's exclusive-end convention for decoration ranges.
 *
 * `latex` is the content between the delimiters, with leading/trailing whitespace
 * preserved (KaTeX handles it gracefully; trimming is the renderer's concern).
 *
 * `display` is true for `$$...$$` blocks, false for `$...$` inline.
 */
export interface MathRange {
  from: number;
  to: number;
  latex: string;
  display: boolean;
}
```

### 2b. The scanner algorithm

The function must be exported from `math.plugin.ts`:

```typescript
export function scanMathRanges(text: string): MathRange[] { ... }
```

**Algorithm (implement in exactly this order):**

**Phase 1 — Mark excluded regions.**

Build a `Uint8Array` (or `boolean[]`) of length `text.length`, initialized to `false`. For each character position, `true` means "this position is inside a code region and must not be treated as a math delimiter."

Mark fenced code blocks:
- Scan for triple-backtick fences: a line that starts (after optional spaces) with ` ``` ` (three or more backticks). Mark from the start of the opening fence line's first backtick through the end of the closing fence line's last backtick (inclusive both). If no closing fence is found before end-of-string, mark to end-of-string.
- Same for `~~~` fences (three or more tildes).
- Nesting is not supported (matches Markdown CommonMark behavior for fences).

Mark inline code spans:
- Scan for backtick runs outside already-marked regions. A backtick run of length N opens a code span. The span closes at the next matching run of exactly N backticks. Mark from the opening backtick through the closing backtick (inclusive both).
- If no closing backtick run is found, do not mark (unclosed inline code is treated as literal text by most Markdown parsers).

**Phase 2 — Find block math `$$...$$`.**

Walk the text line by line (split on `\n` or track line boundaries manually). For each line:
- After stripping trailing whitespace, if the line consists of exactly `$$` (nothing else) AND none of the two `$` characters are in excluded regions:
  - This is a potential block-open delimiter. Record the position of this line's first `$`.
  - Scan subsequent lines for a matching closing `$$` line (same definition: trimmed content is exactly `$$`).
  - If found: record a `MathRange` with:
    - `from`: position of the opening line's first `$`
    - `to`: position after the closing line's last `$` (i.e., the position of the character AFTER the second `$` on the closing line)
    - `latex`: all text between the newline after the opening `$$` and the newline before the closing `$$` (the multi-line content, without the delimiter lines themselves)
    - `display: true`
  - Mark all positions in `[from, to)` as excluded so the inline scanner (Phase 3) does not re-process them.
  - If no closing `$$` found before end-of-string: no range produced (EC-19).

**Phase 3 — Find inline math `$...$`.**

Walk the text character by character:
- At each `$` character that is NOT in an excluded region:
  - Check if the previous character (index - 1, if it exists) is `\`. If so, skip this `$` (it's an escaped dollar sign — EC-13).
  - Check if the next character (index + 1) is also `$`. If so, skip — this is the start of a `$$` sequence not caught by Phase 2 (i.e., `$$` on a line that has other content, which is not a valid block delimiter). Do not attempt inline matching from here.
  - Otherwise: this `$` is a potential inline open delimiter. Search forward on the SAME LINE ONLY (do not cross `\n`) for the next unescaped `$` that is also not in an excluded region and is not immediately followed by another `$`.
  - If found: the content between the two `$` characters must be non-empty (EC-6). If non-empty: record a `MathRange` with `display: false`. Mark the range as excluded.
  - Advance the scan position past the closing `$`.

**Phase 4 — Sort and return.**

Sort all collected `MathRange` objects by `from` ascending. Return the sorted array.

### 2c. Function signature summary

```typescript
// Exported from math.plugin.ts
export interface MathRange {
  from: number;
  to: number;
  latex: string;
  display: boolean;
}

export function scanMathRanges(text: string): MathRange[];
```

No other arguments. No side effects. Referentially transparent. Safe to call from tests without any browser globals.

## Test Cases to Write (Red Phase First)

File: `tests/plugins/math/math.test.ts`

Write all tests as failing first (`expect(true).toBe(false)` stubs), then implement the function until all pass.

### Group: Basic inline math

```typescript
describe("scanMathRanges — inline math", () => {
  it("finds a single inline expression", () => {
    const result = scanMathRanges("Hello $x^2$ world");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: 6, to: 11, latex: "x^2", display: false });
  });

  it("finds two inline expressions on the same line", () => {
    const result = scanMathRanges("$a$ and $b$");
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ from: 0, to: 3, latex: "a", display: false });
    expect(result[1]).toMatchObject({ from: 8, to: 11, latex: "b", display: false });
  });

  it("returns empty for document with no math", () => {
    expect(scanMathRanges("Hello world")).toHaveLength(0);
  });

  it("returns empty for empty document", () => {
    expect(scanMathRanges("")).toHaveLength(0);
  });
});
```

### Group: Block math

```typescript
describe("scanMathRanges — block math", () => {
  it("finds a single display block", () => {
    const text = "before\n$$\nx^2\n$$\nafter";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
    expect(result[0].latex).toBe("x^2\n");   // content between delimiters
  });

  it("captures multiline content in display block", () => {
    const text = "$$\na + b\n= c\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("a + b\n= c\n");
  });

  it("handles empty block — FR-2.5 (EC-7)", () => {
    const text = "$$\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("");
  });

  it("handles whitespace-only content in block (EC-7)", () => {
    const text = "$$\n   \n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
  });

  it("does NOT produce a range for unterminated block (EC-19)", () => {
    const text = "$$\nx^2\n";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("handles block at very start of document (EC-8)", () => {
    const text = "$$\nE = mc^2\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].from).toBe(0);
  });
});
```

### Group: Code region exclusions

```typescript
describe("scanMathRanges — code exclusions", () => {
  it("does not match $ inside fenced code block (EC-11)", () => {
    const text = "```\n$x^2$\n```";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("does not match $ inside inline code span (EC-12)", () => {
    const text = "Use `$x$` to write inline math";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("matches $ outside inline code but not inside (EC-12 mixed)", () => {
    const text = "$a$ and `$b$`";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("a");
  });

  it("does not match $$ inside inline code (EC-17)", () => {
    const text = "Use `$$` as a block delimiter";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("does not match $ inside tilde-fenced code block", () => {
    const text = "~~~\n$x^2$\n~~~";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("matches math after a closed fenced block", () => {
    const text = "```\ncode\n```\n$x$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x");
  });
});
```

### Group: Escaped dollar signs

```typescript
describe("scanMathRanges — escaped dollar signs (EC-13)", () => {
  it("does not treat \\$ as a delimiter", () => {
    expect(scanMathRanges("cost is \\$5")).toHaveLength(0);
  });

  it("\\$ does not open an inline math span", () => {
    expect(scanMathRanges("\\$x^2$")).toHaveLength(0);
  });

  it("\\$ does not close an inline math span", () => {
    // The $x\$y$ should not produce a match because the second $ is preceded by backslash
    // Depending on scanner strictness, this may or may not match. Spec: no match.
    expect(scanMathRanges("$x\\$y$")).toHaveLength(0);
  });

  it("recognizes valid math after escaped dollar", () => {
    const result = scanMathRanges("cost \\$5 and $x^2$");
    expect(result).toHaveLength(1);
    expect(result[0].latex).toBe("x^2");
  });
});
```

### Group: Edge cases for inline matching

```typescript
describe("scanMathRanges — inline edge cases", () => {
  it("does not match zero-length inline math (EC-6)", () => {
    // Two $$ on the same line that is NOT a block delimiter line is not valid inline
    expect(scanMathRanges("$$")).toHaveLength(0);
  });

  it("does not match single-character $ alone", () => {
    expect(scanMathRanges("$ alone")).toHaveLength(0);
  });

  it("does not cross a newline for inline math (EC-20)", () => {
    const text = "$a\n+b$";
    expect(scanMathRanges(text)).toHaveLength(0);
  });

  it("inline math immediately at start of document", () => {
    const result = scanMathRanges("$x$");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ from: 0, to: 3 });
  });

  it("inline math immediately at end of document", () => {
    const result = scanMathRanges("end $x$");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ to: 7 });
  });
});
```

### Group: Mixed inline and block

```typescript
describe("scanMathRanges — mixed inline and block", () => {
  it("finds inline and block in same document", () => {
    const text = "See $a$ and:\n$$\nb\n$$\ndone";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(2);
    expect(result[0].display).toBe(false);
    expect(result[1].display).toBe(true);
  });

  it("does not double-match: $ inside a found block range is not also inline", () => {
    const text = "$$\n$x$\n$$";
    const result = scanMathRanges(text);
    expect(result).toHaveLength(1);
    expect(result[0].display).toBe(true);
  });

  it("sorts results by from position (EC-4)", () => {
    const result = scanMathRanges("$a$ $b$ $c$");
    expect(result.map(r => r.latex)).toEqual(["a", "b", "c"]);
  });
});
```

### Group: `from`/`to` boundary precision (critical for EC-1, EC-2)

```typescript
describe("scanMathRanges — from/to boundaries", () => {
  it("from is the index of the opening $", () => {
    const text = "abc $x$ def";
    const result = scanMathRanges(text);
    expect(result[0].from).toBe(4);     // position of opening $
    expect(text[result[0].from]).toBe("$");
  });

  it("to is the index after the closing $", () => {
    const text = "abc $x$ def";
    const result = scanMathRanges(text);
    expect(result[0].to).toBe(8);      // exclusive end: position after closing $
    expect(text[result[0].to]).toBe(" "); // character at 'to' is the space after
  });

  it("block from is the index of the opening $$ first character", () => {
    const text = "$$\nx\n$$";
    const result = scanMathRanges(text);
    expect(result[0].from).toBe(0);
    expect(text[result[0].from]).toBe("$");
  });

  it("block to is the index after the closing $$ last character", () => {
    const text = "$$\nx\n$$";
    const result = scanMathRanges(text);
    // text = "$$\nx\n$$"
    //         01234567
    // Closing $$ are at index 5,6. to = 7 (after index 6).
    expect(result[0].to).toBe(7);
  });
});
```

## Acceptance Criteria

- [ ] `scanMathRanges` is exported from `math.plugin.ts` and importable by test files without needing any browser globals (same pattern as `scanHeadings` in `auto-toc.plugin.ts`).
- [ ] All test groups above pass (100 green, 0 failing).
- [ ] The function handles `text = ""` without throwing.
- [ ] The function handles documents with 50+ math expressions without taking more than 50ms (manual benchmark — not a unit test).
- [ ] No `$` inside a fenced code block or inline code span produces a `MathRange`.
- [ ] `\$` does not produce a `MathRange`.
- [ ] Unterminated `$$` blocks produce no range.
- [ ] Multi-line inline (`$a\n+b$`) produces no range.

## CM6-Specific Gotchas

**Line endings:** CM6 stores documents with LF-only line endings. The scanner receives `state.doc.toString()` which uses LF. The scanner must not split on `\r\n`. Tests use `\n` throughout.

**Character offsets:** CM6 decorations use `from` (inclusive) and `to` (exclusive) with character offsets into the LF-normalized string. The scanner must produce the same convention. In the test for `"abc $x$ def"`, the opening `$` is at index 4 (`from: 4`) and the closing `$` is at index 6 (`to: 7`). Note `to` is **exclusive** — it points to the character after the closing delimiter.

**`doc.toString()` is called once per StateField update.** The scanner receives the entire document as a string. This is O(N) memory but acceptable — the YAML pane and auto-toc both do the same.
