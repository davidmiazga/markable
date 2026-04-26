---
title: "Step 5: Comment Override Verification Tests"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 5: Comment Override Verification Tests

## Goal

Add dedicated integration-style tests to `tests/list-engine.test.ts` that verify the full comment-override inference chain (FR-5). These tests are additive -- the existing 637 lines remain unchanged.

## Changes to `tests/list-engine.test.ts`

### New Test Block

Append a new `describe` block at the end of the file:

```typescript
// ============================================================
// Comment override integration tests (FR-5)
// ============================================================

describe("inferListStyle — comment override integration", () => {

  it("FR-5.1a: preceding comment overrides marker inference", () => {
    // A <!-- list: alphanumeric --> comment before a standard-looking list
    // causes inferListStyle to return "alphanumeric" regardless of markers.
    const lines = ["1. First item", "2. Second item"];
    const precedingLine = "<!-- list: alphanumeric -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  it("FR-5.1b: comment override takes priority over conflicting markers", () => {
    // List has roman-upper markers (I., II.) which would normally infer
    // "alphanumeric", but the comment says "steps".
    const lines = ["I. First item", "II. Second item"];
    const precedingLine = "<!-- list: steps -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("steps");
  });

  it("FR-5.1c: comment on first line of block also works", () => {
    // The comment is the first line of the block, not a preceding line.
    const lines = ["<!-- list: decimal -->", "1. First", "2. Second"];
    expect(inferListStyle(lines, null, "standard")).toBe("decimal");
  });

  it("FR-5.1d: whitespace variations in comment are accepted", () => {
    // Tight spacing
    expect(inferListStyle(
      ["1. A"],
      "<!--list:steps-->",
      "standard",
    )).toBe("steps");

    // Extra spaces
    expect(inferListStyle(
      ["1. A"],
      "<!--   list:   alphanumeric   -->",
      "standard",
    )).toBe("alphanumeric");

    // Normal spacing
    expect(inferListStyle(
      ["1. A"],
      "<!-- list: decimal -->",
      "standard",
    )).toBe("decimal");
  });

  it("FR-5.1e: preceding comment wins over first-line comment", () => {
    // Both a preceding line and first block line have comments.
    // Preceding should win (checked first in inferListStyle).
    const lines = ["<!-- list: decimal -->", "1. A"];
    const precedingLine = "<!-- list: alphanumeric -->";
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  it("FR-5.1f: invalid style in comment falls through to marker inference", () => {
    // A comment with an invalid style name is not matched by the regex.
    const lines = ["I. First", "II. Second"];
    const precedingLine = "<!-- list: fancy -->";
    // "fancy" does not match the regex, so the comment is ignored.
    // Marker inference finds roman-upper at depth 0 -> "alphanumeric".
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("alphanumeric");
  });

  it("FR-5.1g: comment with no list keyword is ignored", () => {
    // A regular HTML comment that doesn't match the list: pattern.
    const lines = ["1. A", "2. B"];
    const precedingLine = "<!-- this is a regular comment -->";
    // Falls through to marker inference -> all decimal at depth 0 -> standard fallback
    expect(inferListStyle(lines, precedingLine, "standard")).toBe("standard");
  });
});
```

### Verification of Existing Engine Behavior

These tests call only `inferListStyle()` which is already exported from `list-engine.ts`. They verify behavior that the engine already implements but was not previously covered by dedicated tests. No modifications to the engine are needed.

### Whitespace Regex Validation

The comment regex in `list-engine.ts` line 293 is:
```
/<!--\s*list:\s*(standard|alphanumeric|decimal|steps)\s*-->/
```

- `\s*` after `<!--` allows `<!--list:` (tight) and `<!--   list:` (loose).
- `\s*` after `list:` allows `list:steps` and `list: steps` and `list:   steps`.
- `\s*` before `-->` allows `steps-->` and `steps -->`.

The FR-5.1d test case verifies all three variations.

## Edge Cases Addressed

- **EC-6**: The comment override interaction is validated (preceding comment sets the style, marker rewrite does not change the comment).
- **EC-12**: The inference chain is validated (comment override wins over marker detection, which is what the status bar relies on).

## Acceptance Criteria

1. All new tests pass in `tests/list-engine.test.ts`.
2. The existing 637 lines of tests are not modified.
3. Total test count increases by 7 new test cases.
4. `list-engine.ts` is NOT modified.
5. All 909+ existing Vitest tests still pass.
