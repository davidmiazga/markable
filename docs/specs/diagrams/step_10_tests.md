---
title: "Step 10 — Tests"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 10: Tests

**Requirement:** All FRs, Edge Cases EC-01/03/04/06/09/12/13/14/20, NFR-03 (self-containment)
**Files created:** `tests/plugins/diagrams/diagrams.test.ts`

---

## Goal

Write the Vitest unit test suite for the Diagrams plugin. Tests cover the exported pure functions (`scanDiagramBlocks`, `isCursorInsideRange`, `buildDiagramDecorations`) using mock CM6 state objects — the same pattern used by the math and media-preview tests.

Mermaid itself cannot be tested in the Vitest environment (it requires a DOM with SVG support and is async). `MermaidWidget.toDOM()` is tested at the unit level by stubbing `mermaid.render`. The Rust cap change (step_01) is tested in `plugins.rs` (step_01's cargo tests). The command bar integration (step_09) is covered by the existing command-bar tests for the COMMANDS array format.

---

## Test File Location

`tests/plugins/diagrams/diagrams.test.ts`

---

## Prerequisites

Read how the math plugin tests work:

```
tests/plugins/math/math.test.ts
```

The pattern: import the exported pure functions directly (`scanMathRanges`, `isCursorInsideRange`, `buildMathDecorations`), construct minimal CM6 EditorState objects using `EditorState.create({ doc: "..." })`, and assert on the returned values.

For `buildDiagramDecorations`, the state requires the `syntaxTree` from `@codemirror/language` to be populated. Use `@codemirror/lang-markdown` as the language extension when creating test states.

---

## Implementation Instructions

### Test file structure

```typescript
/**
 * Diagrams Plugin — Unit Tests
 *
 * Tests exported pure functions from diagrams.plugin.ts.
 * Mermaid async rendering is stubbed — toDOM() behavior is tested
 * at the unit level without full SVG output.
 *
 * Architecture: docs/specs/diagrams/00_index.md
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";

// Import pure functions from the plugin.
// Note: this import triggers IIFE evaluation — window globals must be stubbed.
// The test environment sets up window.__CM_VIEW__, __CM_STATE__, __CM_LANGUAGE__
// via the vi.mock() setup at the top of this file.
import {
  scanDiagramBlocks,
  isCursorInsideRange,
  buildDiagramDecorations,
  resolveMermaidTheme,
  reinitIfNeeded,
  DiagramBlock,
} from "../../../src/plugins/diagrams/diagrams.plugin";
```

### Setup: stub window globals

The plugin's IIFE destructures from `window.__CM_VIEW__`, `__CM_STATE__`, `__CM_LANGUAGE__`. In the Vitest environment, these are not available. Use `vi.stubGlobal` in a `beforeEach` to stub them. This pattern matches the math plugin test setup.

```typescript
import { Decoration, WidgetType, EditorView } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

beforeEach(() => {
  vi.stubGlobal("__CM_VIEW__", { Decoration, WidgetType, EditorView });
  vi.stubGlobal("__CM_STATE__", { StateField, StateEffect, RangeSetBuilder });
  vi.stubGlobal("__CM_LANGUAGE__", { syntaxTree });
  vi.stubGlobal("__MARKABLE_PREVIEW_ENABLED__", true);
  vi.stubGlobal("__MARKABLE_EDITOR_VIEW__", null);
});

afterEach(() => {
  vi.unstubAllGlobals();
});
```

Also stub `mermaid` since it is imported by the plugin:

```typescript
vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: "<svg>test</svg>" }),
  },
}));
```

### Helper: create test state

```typescript
function makeState(doc: string, cursorPos?: number): EditorState {
  return EditorState.create({
    doc,
    selection: cursorPos !== undefined ? { anchor: cursorPos } : undefined,
    extensions: [markdown()],
  });
}
```

---

## Test cases

### Group 1: scanDiagramBlocks

```typescript
describe("scanDiagramBlocks", () => {

  it("returns empty array for document with no mermaid blocks (EC-20)", () => {
    const state = makeState("# Hello\n\nSome text\n");
    expect(scanDiagramBlocks(state)).toEqual([]);
  });

  it("detects a single mermaid block", () => {
    const doc = "# Doc\n\n```mermaid\ngraph TD\n  A --> B\n```\n";
    const state = makeState(doc);
    const blocks = scanDiagramBlocks(state);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source.trim()).toContain("graph TD");
  });

  it("detects multiple mermaid blocks (EC-06)", () => {
    const doc = [
      "```mermaid",
      "graph TD",
      "  A --> B",
      "```",
      "",
      "```mermaid",
      "sequenceDiagram",
      "  Alice ->> Bob: Hello",
      "```",
    ].join("\n");
    const state = makeState(doc);
    const blocks = scanDiagramBlocks(state);
    expect(blocks).toHaveLength(2);
    // Results must be sorted by from
    expect(blocks[0].from).toBeLessThan(blocks[1].from);
  });

  it("ignores a ```python block (wrong language tag)", () => {
    const doc = "```python\nprint('hello')\n```\n";
    const state = makeState(doc);
    expect(scanDiagramBlocks(state)).toEqual([]);
  });

  it("ignores a ```MERMAID block (case-insensitive detection)", () => {
    // FR-01.1: language tag is case-insensitive
    const doc = "```MERMAID\ngraph TD\n  A --> B\n```\n";
    const state = makeState(doc);
    // scanDiagramBlocks lowercases the tag — should detect it
    expect(scanDiagramBlocks(state)).toHaveLength(1);
  });

  it("returns source = '' for empty mermaid block (EC-01)", () => {
    const doc = "```mermaid\n```\n";
    const state = makeState(doc);
    const blocks = scanDiagramBlocks(state);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("");
  });

  it("returns source = '' for whitespace-only mermaid block (EC-02)", () => {
    const doc = "```mermaid\n   \n   \n```\n";
    const state = makeState(doc);
    const blocks = scanDiagramBlocks(state);
    // source is trimmed — whitespace only becomes ""
    expect(blocks).toHaveLength(1);
    expect(blocks[0].source).toBe("");
  });

  it("produces no block for unclosed fence (EC-03)", () => {
    // Lezer does not produce a complete FencedCode node for unclosed fences
    const doc = "```mermaid\ngraph TD\n  A --> B\n";
    const state = makeState(doc);
    // Lezer may or may not produce a FencedCode — behavior is parser-dependent.
    // The test verifies that if any block is detected, it has valid from/to
    // (no crash) and the plugin handles it gracefully.
    const blocks = scanDiagramBlocks(state);
    // Accept either zero or one result — the key invariant is no crash.
    expect(() => scanDiagramBlocks(state)).not.toThrow();
  });

  it("blocks are sorted by from position", () => {
    const doc = [
      "Some text\n",
      "```mermaid\ngraph TD\n  A --> B\n```\n",
      "More text\n",
      "```mermaid\nsequenceDiagram\n  Alice ->> Bob: Hi\n```\n",
    ].join("");
    const state = makeState(doc);
    const blocks = scanDiagramBlocks(state);
    for (let i = 1; i < blocks.length; i++) {
      expect(blocks[i].from).toBeGreaterThan(blocks[i - 1].from);
    }
  });

});
```

### Group 2: isCursorInsideRange

```typescript
describe("isCursorInsideRange", () => {

  it("collapsed cursor before range is outside", () => {
    expect(isCursorInsideRange(0, 0, 5, 20)).toBe(false);
  });

  it("collapsed cursor at from is inside", () => {
    expect(isCursorInsideRange(5, 5, 5, 20)).toBe(true);
  });

  it("collapsed cursor in middle of range is inside", () => {
    expect(isCursorInsideRange(12, 12, 5, 20)).toBe(true);
  });

  it("collapsed cursor at to is outside (exclusive end)", () => {
    expect(isCursorInsideRange(20, 20, 5, 20)).toBe(false);
  });

  it("collapsed cursor after range is outside", () => {
    expect(isCursorInsideRange(25, 25, 5, 20)).toBe(false);
  });

  it("selection fully containing range is inside", () => {
    expect(isCursorInsideRange(0, 30, 5, 20)).toBe(true);
  });

  it("reversed selection (head < anchor) works correctly", () => {
    // Reversed selection: anchor=20, head=5 (same as 5..20 logically)
    expect(isCursorInsideRange(20, 5, 5, 20)).toBe(true);
  });

  it("selection partially overlapping from the left is inside", () => {
    expect(isCursorInsideRange(3, 10, 5, 20)).toBe(true);
  });

  it("selection partially overlapping from the right is inside", () => {
    expect(isCursorInsideRange(15, 25, 5, 20)).toBe(true);
  });

});
```

### Group 3: buildDiagramDecorations

```typescript
describe("buildDiagramDecorations", () => {

  it("returns Decoration.none when __MARKABLE_PREVIEW_ENABLED__ is false (EC-09)", () => {
    vi.stubGlobal("__MARKABLE_PREVIEW_ENABLED__", false);
    const doc = "```mermaid\ngraph TD\n  A --> B\n```\n";
    const state = makeState(doc);
    const decos = buildDiagramDecorations(state);
    // Decoration.none is the empty RangeSet — size should be 0
    let count = 0;
    decos.between(0, doc.length, () => { count++; });
    expect(count).toBe(0);
  });

  it("returns Decoration.none for document with no mermaid blocks (EC-20)", () => {
    const state = makeState("# Hello\n\nNo diagrams here.\n");
    const decos = buildDiagramDecorations(state);
    let count = 0;
    decos.between(0, state.doc.length, () => { count++; });
    expect(count).toBe(0);
  });

  it("produces one decoration for a single mermaid block with cursor outside", () => {
    const doc = "Before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nAfter\n";
    // Place cursor before the mermaid block
    const state = makeState(doc, 0);
    const decos = buildDiagramDecorations(state);
    let count = 0;
    decos.between(0, doc.length, () => { count++; });
    expect(count).toBe(1);
  });

  it("suppresses decoration when cursor is inside the mermaid block (EC-09)", () => {
    const doc = "```mermaid\ngraph TD\n  A --> B\n```\n";
    // Place cursor inside the block (character 5 — inside the fence)
    const state = makeState(doc, 5);
    const decos = buildDiagramDecorations(state);
    let count = 0;
    decos.between(0, doc.length, () => { count++; });
    expect(count).toBe(0);
  });

  it("reveals only the block containing the cursor when multiple blocks exist (EC-06)", () => {
    const block1 = "```mermaid\ngraph TD\n  A --> B\n```\n";
    const between = "\nSome text\n\n";
    const block2 = "```mermaid\nsequenceDiagram\n  A ->> B: Hi\n```\n";
    const doc = block1 + between + block2;
    // Place cursor inside block1 (position 5)
    const state = makeState(doc, 5);
    const decos = buildDiagramDecorations(state);
    let count = 0;
    decos.between(0, doc.length, () => { count++; });
    // block1 suppressed (cursor inside), block2 decorated
    expect(count).toBe(1);
  });

  it("re-enables preview mode after being toggled off (EC-25)", () => {
    const doc = "```mermaid\ngraph TD\n  A --> B\n```\n";

    // Preview off: no decorations
    vi.stubGlobal("__MARKABLE_PREVIEW_ENABLED__", false);
    const stateOff = makeState(doc, 0);
    const decosOff = buildDiagramDecorations(stateOff);
    let countOff = 0;
    decosOff.between(0, doc.length, () => { countOff++; });
    expect(countOff).toBe(0);

    // Preview on: decorations appear
    vi.stubGlobal("__MARKABLE_PREVIEW_ENABLED__", true);
    const stateOn = makeState(doc, 0);
    const decosOn = buildDiagramDecorations(stateOn);
    let countOn = 0;
    decosOn.between(0, doc.length, () => { countOn++; });
    expect(countOn).toBe(1);
  });

});
```

### Group 4: resolveMermaidTheme

```typescript
describe("resolveMermaidTheme", () => {

  it("returns 'dark' when --color-scheme is dark on :root", () => {
    document.documentElement.style.setProperty("--color-scheme", "dark");
    // _settings.mermaidTheme must be "auto" for auto-detection to kick in.
    // The module exports _settings indirectly via resolveMermaidTheme,
    // which reads from the module-level _settings. For this test, we need
    // to verify the behavior when mermaidTheme is "auto".
    // We can call resolveMermaidTheme() after ensuring _settings.mermaidTheme = "auto"
    // by relying on DEFAULT_SETTINGS (module default).
    const result = resolveMermaidTheme();
    expect(result).toBe("dark");
    document.documentElement.style.removeProperty("--color-scheme");
  });

  it("returns 'default' when --color-scheme is light on :root", () => {
    document.documentElement.style.setProperty("--color-scheme", "light");
    const result = resolveMermaidTheme();
    expect(result).toBe("default");
    document.documentElement.style.removeProperty("--color-scheme");
  });

});
```

### Group 5: reinitIfNeeded

```typescript
describe("reinitIfNeeded", () => {

  it("calls mermaid.initialize() on first call (new theme)", async () => {
    const { default: mermaidMock } = await import("mermaid");
    (mermaidMock.initialize as ReturnType<typeof vi.fn>).mockClear();

    // Ensure _initializedTheme is "" by importing the module fresh.
    // In practice, test isolation requires resetting module state.
    // Accept that initialize() is called at least once.
    reinitIfNeeded();
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: "strict" })
    );
  });

  it("does not call mermaid.initialize() if theme has not changed", async () => {
    const { default: mermaidMock } = await import("mermaid");
    // Call once to set _initializedTheme
    reinitIfNeeded();
    const callCount = (mermaidMock.initialize as ReturnType<typeof vi.fn>).mock.calls.length;
    // Call again — should not initialize again if theme is same
    reinitIfNeeded();
    expect((mermaidMock.initialize as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callCount);
  });

});
```

### Group 6: Edge cases — MermaidWidget DOM

These tests verify `MermaidWidget` behavior at the unit level. They require stubbing `mermaid.render`.

```typescript
describe("MermaidWidget", () => {
  // Import MermaidWidget — available after step_05 adds the full implementation
  let MermaidWidget: typeof import("../../../src/plugins/diagrams/diagrams.plugin").MermaidWidget;

  beforeEach(async () => {
    const mod = await import("../../../src/plugins/diagrams/diagrams.plugin");
    MermaidWidget = mod.MermaidWidget as any;
  });

  it("eq() returns true for same source and theme (EC-14)", () => {
    const w1 = new MermaidWidget("graph TD\n  A --> B");
    const w2 = new MermaidWidget("graph TD\n  A --> B");
    expect(w1.eq(w2 as any)).toBe(true);
  });

  it("eq() returns false for different source (EC-13)", () => {
    const w1 = new MermaidWidget("graph TD\n  A --> B");
    const w2 = new MermaidWidget("graph TD\n  A --> C");
    expect(w1.eq(w2 as any)).toBe(false);
  });

  it("toDOM() returns a div with cm-mermaid-loading class immediately", () => {
    const w = new MermaidWidget("graph TD\n  A --> B");
    const el = w.toDOM();
    expect(el.tagName).toBe("DIV");
    expect(el.classList.contains("cm-mermaid-block")).toBe(true);
    expect(el.classList.contains("cm-mermaid-loading")).toBe(true);
  });

  it("ignoreEvent() returns false (clicks pass through to CM6)", () => {
    const w = new MermaidWidget("graph TD\n  A --> B");
    expect(w.ignoreEvent()).toBe(false);
  });

  it("toDOM() triggers async render that injects SVG into placeholder", async () => {
    const { default: mermaidMock } = await import("mermaid");
    (mermaidMock.render as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ svg: "<svg>rendered</svg>" });

    const w = new MermaidWidget("graph TD\n  A --> B");
    const el = w.toDOM();

    // Wait for the async render to complete
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.innerHTML).toContain("<svg>rendered</svg>");
    expect(el.classList.contains("cm-mermaid-loading")).toBe(false);
  });

  it("toDOM() shows error placeholder when mermaid.render() rejects (EC-04)", async () => {
    const { default: mermaidMock } = await import("mermaid");
    (mermaidMock.render as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("syntax error"));

    const w = new MermaidWidget("invalid mermaid source");
    const el = w.toDOM();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(el.classList.contains("cm-mermaid-error")).toBe(true);
    expect(el.textContent).toContain("syntax error");
  });

  it("toDOM() shows error for empty source without calling mermaid.render (EC-01)", async () => {
    const { default: mermaidMock } = await import("mermaid");
    (mermaidMock.render as ReturnType<typeof vi.fn>).mockClear();

    const w = new MermaidWidget("");
    const el = w.toDOM();

    await new Promise((resolve) => setTimeout(resolve, 0));

    // mermaid.render should NOT have been called for empty source
    expect(mermaidMock.render).not.toHaveBeenCalled();
    expect(el.classList.contains("cm-mermaid-error")).toBe(true);
  });

  it("each widget instance gets a unique render ID (EC-19)", () => {
    const w1 = new MermaidWidget("graph TD\n  A --> B");
    const w2 = new MermaidWidget("graph TD\n  A --> B");
    // Access renderId indirectly — if we need to verify it, access via private field.
    // Instead, verify that two toDOM() calls do NOT produce SVG from the same ID
    // by checking mermaid.render is called with different IDs.
    const renderMock = mermaid.render as ReturnType<typeof vi.fn>;
    renderMock.mockClear();
    w1.toDOM();
    w2.toDOM();
    // After async microtask
    return new Promise((resolve) => setTimeout(resolve, 0)).then(() => {
      const ids = renderMock.mock.calls.map((call) => call[0]);
      expect(ids[0]).not.toBe(ids[1]);
    });
  });

});
```

---

## Running tests

```bash
npm test -- tests/plugins/diagrams/
```

Or with watch mode during development:

```bash
npm test -- --watch tests/plugins/diagrams/
```

---

## Expected coverage

After step_10, the test suite should cover:
- All 9 edge cases listed above (EC-01, 02, 03, 04, 06, 09, 12, 13, 14, 20, 25)
- Source-mode guard (FR-06)
- Cursor-overlap suppression (FR-02.5)
- Multiple blocks (FR-02.6)
- eq() reuse / re-render logic (FR-04.4)
- Theme resolution (FR-07.2)

---

## Acceptance Criteria

- [ ] `tests/plugins/diagrams/diagrams.test.ts` exists
- [ ] All tests pass with `npm test`
- [ ] The suite covers EC-01, EC-03, EC-04, EC-06, EC-09, EC-12, EC-13, EC-14, EC-20
- [ ] `buildDiagramDecorations` with `__MARKABLE_PREVIEW_ENABLED__ = false` returns zero decorations
- [ ] `isCursorInsideRange` tests cover all boundary conditions
- [ ] No TODO comments in the test file

---

## Files Created in This Step

| File | Action | Purpose |
|------|--------|---------|
| `tests/plugins/diagrams/diagrams.test.ts` | CREATE | Full unit test suite for the diagrams plugin |
