# Step 02 — Unit Tests for the Heading Scanner

**Deliverables:**
1. `tests/auto-toc.test.ts`

**Prerequisite:** step_01 complete (the `auto-toc.plugin.ts` source must exist so the import resolves).

**Verified complete when:**
- `npm test` (or `npx vitest run`) exits 0 with no failing tests.
- All 28 edge cases listed in `docs/requirements/active_task.md` that can be covered by a pure-function test are covered.

---

## Scope of tests in this step

`scanHeadings` is a pure function with no CM6 dependency. Every input/output combination can be tested with plain Vitest. This makes it the ideal and complete unit-test surface for the plugin logic.

`findActiveIndex` is not exported and is tested indirectly. The developer may choose to export and test it directly as well; that is at their discretion.

The DOM lifecycle (sidebar creation, layout toggle) and the updateListener are runtime-only concerns that cannot be tested without a real CM6 instance and a real DOM. They are verified in step_03 by manual visual inspection.

---

## File to create: `tests/auto-toc.test.ts`

### Import

```typescript
import { describe, it, expect } from "vitest";
import { scanHeadings, type HeadingEntry } from "../src/plugins/auto-toc/auto-toc.plugin";
```

Vitest resolves TypeScript sources directly; no build step is needed before running tests.

---

### Test suite structure

```
describe("scanHeadings")
  describe("empty and no-heading documents")
    it EC-1: empty string
    it EC-2: text with no headings
  describe("ATX heading detection")
    it: H1 through H6 single headings
    it: heading text is captured correctly
    it EC-6: empty heading text (# followed by space, nothing after)
    it EC-7: heading text with inline Markdown syntax verbatim
    it: not a heading — 7+ hash characters
    it: not a heading — hash with no trailing space
    it: not a heading — hash in the middle of a line
  describe("level and indent")
    it EC-4: document with only H1 headings
    it EC-5: document with only H6 headings
    it: mixed levels produce correct level values
  describe("multiple headings")
    it EC-8: two headings with identical text — both entries present, different lineFrom
    it EC-9: 201 headings — all returned without error
    it: document order preserved (headings appear in the order they occur)
  describe("lineFrom accuracy")
    it: H1 on line 1 has lineFrom 0
    it: H1 on line 3 has lineFrom equal to cumulative length of preceding lines+newlines
    it EC-22: heading on first line
    it EC-23: heading on last line
  describe("code fence exclusion — EC-25")
    it: heading inside triple-backtick fence is not detected
    it: heading inside triple-tilde fence is not detected
    it: heading after closing fence IS detected
    it: two fences — heading in first fence excluded, heading between fences included, heading in second fence excluded
    it: unclosed fence — lines after opening fence are excluded for remainder of document
  describe("lineNumber field")
    it: lineNumber is 1-based and matches actual line number in document
  describe("EC-27 / EC-28 — fresh documents")
    it: calling scanHeadings with a new document returns fresh results (pure function, no state)
```

---

### Reference implementations for key test cases

The following examples define the exact expected outputs. The developer must match these exactly.

#### Empty document (EC-1)

```typescript
it("returns empty array for empty string", () => {
  expect(scanHeadings("")).toEqual([]);
});
```

#### No headings (EC-2)

```typescript
it("returns empty array when document has no headings", () => {
  const doc = "Just some plain text\nAnd another line\n\nA paragraph.";
  expect(scanHeadings(doc)).toEqual([]);
});
```

#### H1 on line 1 (EC-22, lineFrom = 0)

```typescript
it("H1 on the first line has lineFrom 0 and lineNumber 1", () => {
  const result = scanHeadings("# Hello World");
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject<Partial<HeadingEntry>>({
    level: 1,
    text: "Hello World",
    lineFrom: 0,
    lineNumber: 1,
  });
});
```

#### H2 on line 3 (lineFrom calculation)

```typescript
it("correctly computes lineFrom for a heading on line 3", () => {
  // Line 1: "Line one" (8 chars) + \n = 9
  // Line 2: "Line two" (8 chars) + \n = 9  =>  cumulative offset = 18
  // Line 3: "## Heading" starts at offset 18
  const doc = "Line one\nLine two\n## Heading";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(1);
  expect(result[0].lineFrom).toBe(18);
  expect(result[0].lineNumber).toBe(3);
});
```

#### Empty heading text (EC-6)

```typescript
it("includes a heading with empty text (hash + space, nothing after)", () => {
  const result = scanHeadings("# ");
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("");
  expect(result[0].level).toBe(1);
});
```

#### Heading with inline Markdown (EC-7)

```typescript
it("stores heading text verbatim including inline Markdown syntax", () => {
  const result = scanHeadings("## **Bold** and [link](url)");
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("**Bold** and [link](url)");
});
```

#### Not a heading — 7 hashes

```typescript
it("does not treat 7+ hashes as a heading", () => {
  expect(scanHeadings("####### Not a heading")).toEqual([]);
});
```

#### Not a heading — no trailing space

```typescript
it("does not treat # with no trailing space as a heading", () => {
  expect(scanHeadings("#NoSpace")).toEqual([]);
});
```

#### H1–H6 levels

```typescript
it("detects H1 through H6 with correct level values", () => {
  const doc = [
    "# H1",
    "## H2",
    "### H3",
    "#### H4",
    "##### H5",
    "###### H6",
  ].join("\n");
  const result = scanHeadings(doc);
  expect(result.map((e) => e.level)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(result.map((e) => e.text)).toEqual(["H1", "H2", "H3", "H4", "H5", "H6"]);
});
```

#### Only H1 (EC-4) — verify no indent issues in level values

```typescript
it("handles a document with only H1 headings (EC-4)", () => {
  const doc = "# Alpha\n\nSome text.\n\n# Beta\n\n# Gamma";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(3);
  expect(result.every((e) => e.level === 1)).toBe(true);
  expect(result.map((e) => e.text)).toEqual(["Alpha", "Beta", "Gamma"]);
});
```

#### Only H6 (EC-5)

```typescript
it("handles a document with only H6 headings (EC-5)", () => {
  const doc = "###### Deep One\n###### Deep Two";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(2);
  expect(result.every((e) => e.level === 6)).toBe(true);
});
```

#### Duplicate heading text (EC-8)

```typescript
it("returns separate entries for headings with identical text (EC-8)", () => {
  const doc = "# Same\n\nParagraph\n\n# Same";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Same");
  expect(result[1].text).toBe("Same");
  // They must point to different lines.
  expect(result[0].lineFrom).not.toBe(result[1].lineFrom);
  expect(result[0].lineNumber).toBe(1);
  expect(result[1].lineNumber).toBe(5);
});
```

#### 201 headings (EC-9)

```typescript
it("handles 201 headings without error (EC-9)", () => {
  const lines = Array.from({ length: 201 }, (_, i) => `# Heading ${i + 1}`);
  const result = scanHeadings(lines.join("\n"));
  expect(result).toHaveLength(201);
  expect(result[200].text).toBe("Heading 201");
});
```

#### Code fence exclusion — triple backtick (EC-25)

```typescript
it("excludes headings inside a triple-backtick code fence (EC-25)", () => {
  const doc = [
    "# Before fence",
    "```",
    "# Inside fence — NOT a heading",
    "```",
    "# After fence",
  ].join("\n");
  const result = scanHeadings(doc);
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Before fence");
  expect(result[1].text).toBe("After fence");
});
```

#### Code fence exclusion — triple tilde (EC-25)

```typescript
it("excludes headings inside a triple-tilde code fence (EC-25)", () => {
  const doc = [
    "# Real heading",
    "~~~",
    "# Fake heading in fence",
    "~~~",
    "## Also real",
  ].join("\n");
  const result = scanHeadings(doc);
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Real heading");
  expect(result[1].text).toBe("Also real");
});
```

#### Heading after closing fence is detected

```typescript
it("detects headings that appear after a closing fence marker", () => {
  const doc = "```\n# in fence\n```\n# After fence";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("After fence");
});
```

#### Two fences — complex interleaving

```typescript
it("correctly handles two consecutive fences with headings between them", () => {
  const doc = [
    "```",
    "# Excluded A",
    "```",
    "# Included B",
    "```",
    "# Excluded C",
    "```",
    "# Included D",
  ].join("\n");
  const result = scanHeadings(doc);
  expect(result).toHaveLength(2);
  expect(result[0].text).toBe("Included B");
  expect(result[1].text).toBe("Included D");
});
```

#### Unclosed fence — remainder excluded

```typescript
it("excludes all headings after an unclosed opening fence", () => {
  const doc = [
    "# Before",
    "```",
    "# In unclosed fence",
    "# Still in fence",
  ].join("\n");
  const result = scanHeadings(doc);
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("Before");
});
```

#### Pure function — no shared state between calls (EC-27/EC-28)

```typescript
it("is stateless — repeated calls with different documents return independent results", () => {
  const doc1 = "# Heading One";
  const doc2 = "## Heading Two";
  const r1 = scanHeadings(doc1);
  const r2 = scanHeadings(doc2);
  expect(r1).toHaveLength(1);
  expect(r1[0].level).toBe(1);
  expect(r2).toHaveLength(1);
  expect(r2[0].level).toBe(2);
  // Calling r1 again produces the same result (no side effects from r2 call).
  expect(scanHeadings(doc1)).toEqual(r1);
});
```

#### Hash in middle of line — not a heading

```typescript
it("does not treat a hash character mid-line as a heading", () => {
  const doc = "This is not # a heading\nNor is this ## a heading either";
  expect(scanHeadings(doc)).toEqual([]);
});
```

#### Heading on last line of document (EC-23)

```typescript
it("detects a heading on the last line (no trailing newline) (EC-23)", () => {
  const doc = "Some text\n# Last Line Heading";
  const result = scanHeadings(doc);
  expect(result).toHaveLength(1);
  expect(result[0].text).toBe("Last Line Heading");
  expect(result[0].lineNumber).toBe(2);
});
```

---

## Checklist for step_02

- [ ] `tests/auto-toc.test.ts` created
- [ ] Import path resolves (`../src/plugins/auto-toc/auto-toc.plugin` — named exports `scanHeadings` and `HeadingEntry`)
- [ ] All test cases from the "reference implementations" section above are present
- [ ] EC-1 through EC-9 and EC-22, EC-23, EC-25, EC-27, EC-28 each have at least one test
- [ ] No test imports from `@codemirror/*` (the scanner has no CM6 dependency)
- [ ] `npx vitest run tests/auto-toc.test.ts` exits 0 with all tests passing
- [ ] Total Vitest test count increases by the number of tests added (confirm no regressions in the existing 204 tests)
