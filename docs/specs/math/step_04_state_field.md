---
title: "Math Step 04 — StateField"
last-updated: "2026-04-18"
review-cadence-days: 14
status: active
---

# Step 04 — StateField

## Objective

Implement `mathField` — the `StateField<DecorationSet>` that drives all math rendering. It uses `scanMathRanges()` from step_02 and the widgets from step_03. The StateField decides which ranges become widgets and which stay as raw text based on the current cursor position.

## What to Implement

### 4a. Cursor-inside detection function

```typescript
/**
 * Return true if the cursor selection overlaps the given range.
 *
 * "Overlapping" means: any position from `anchor` to `head` (in either direction)
 * touches the range [from, to]. The definition covers:
 *   - Cursor collapsed inside the range (head between from and to inclusive).
 *   - Selection that starts outside but head is inside.
 *   - Selection that starts inside but head is outside.
 *   - Selection entirely spanning the range.
 *
 * "Inclusive" means: cursor exactly on the opening $ (position === from) or
 * on the closing $ (position === to - 1) counts as inside (EC-1, EC-2).
 * The closing delimiter is at index (to - 1) because to is exclusive.
 *
 * @param selectionAnchor - The anchor end of the current selection (state.selection.main.anchor).
 * @param selectionHead   - The head end of the current selection (state.selection.main.head).
 * @param from            - Inclusive start of the math range.
 * @param to              - Exclusive end of the math range.
 */
function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  // Overlap: selection and range share at least one character position.
  // Because `to` is exclusive, the condition is selFrom < to && selTo >= from.
  // Special case: collapsed cursor (selFrom === selTo) is inside when selFrom >= from && selFrom < to.
  // This unified form handles both:
  return selFrom < to && selTo >= from;
}
```

**Boundary condition precision:**

- Inline range `$x^2$` where `from = 4`, `to = 8` (text = `"abc $x^2$ "`):
  - Cursor at 4 (on opening `$`): `selFrom = 4`, `selTo = 4`. `4 < 8 && 4 >= 4` → `true`. Correct (EC-1).
  - Cursor at 7 (on closing `$`): `selFrom = 7`, `selTo = 7`. `7 < 8 && 7 >= 4` → `true`. Correct (EC-2).
  - Cursor at 8 (after closing `$`): `selFrom = 8`, `selTo = 8`. `8 < 8` → `false`. Correct — cursor is past the expression.
  - Cursor at 3 (before opening `$`): `selFrom = 3`, `selTo = 3`. `3 < 8 && 3 >= 4` → `false`. Correct.

### 4b. Decoration builder function

```typescript
/**
 * Build the full DecorationSet for the given editor state.
 *
 * Called by the StateField's `create` and `update` methods.
 *
 * Algorithm:
 *   1. Get document text via state.doc.toString().
 *   2. Call scanMathRanges(text) to find all math ranges.
 *   3. Get the current selection anchor and head.
 *   4. For each range: if cursor is NOT inside, add a replace decoration.
 *      If cursor IS inside: skip (no decoration; raw text shown).
 *   5. Build and return the DecorationSet via RangeSetBuilder.
 *
 * @param state - The current EditorState.
 * @returns A DecorationSet containing replace decorations for all non-cursor math ranges.
 */
function buildMathDecorations(state: EditorState): DecorationSet {
  const text   = state.doc.toString();
  const ranges = scanMathRanges(text);
  const sel    = state.selection.main;

  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const range of ranges) {
    if (isCursorInsideRange(sel.anchor, sel.head, range.from, range.to)) {
      continue; // Cursor is inside: show raw source
    }

    const widget = range.display
      ? new BlockMathWidget(range.latex)
      : new InlineMathWidget(range.latex);

    const deco = range.display
      ? Decoration.replace({ widget, block: true })
      : Decoration.replace({ widget });

    builder.add(range.from, range.to, deco);
  }

  return builder.finish();
}
```

**Important:** `RangeSetBuilder` requires ranges to be added in ascending order of `from`. The `scanMathRanges` function guarantees this (it sorts by `from` in Phase 4). Do not add ranges out of order — CM6 will throw.

### 4c. The `mathField` StateField

```typescript
/**
 * CM6 StateField that maintains the DecorationSet for all math expressions.
 *
 * Recomputes on every transaction where the document changed or the selection
 * changed — same trigger pattern as focus-mode's ViewPlugin.update().
 *
 * Registered via api.addExtensions([mathField]) in onEnable.
 * Removed via api.removeExtensions() in onDisable.
 *
 * The field is constructed inside onEnable (not at module evaluation time) so
 * that CM6 globals are available when the field is first created. This matches
 * the pattern used by other plugins that construct CM6 objects at enable time.
 */
function createMathField() {
  return StateField.define<DecorationSet>({
    create(state: EditorState): DecorationSet {
      return buildMathDecorations(state);
    },

    update(value: DecorationSet, tr: Transaction): DecorationSet {
      if (!tr.docChanged && !tr.selection) {
        return value; // No doc or selection change — reuse existing decorations
      }
      return buildMathDecorations(tr.state);
    },

    provide(field) {
      return _EditorView.decorations.from(field);
    },
  });
}
```

Note: `tr.selection` is the transaction's selection update. It is truthy when the selection changed (equivalent to `selectionSet` in a ViewPlugin's `ViewUpdate`). This matches the trigger logic in `focus-mode.plugin.ts`'s `update(update: ViewUpdate) { if (update.docChanged || update.selectionSet) ... }`.

**Why `createMathField()` as a factory, not a module-level constant:**

The `StateField.define()` call accesses `StateField` from the window global destructure at the top of the file. That destructure runs at module evaluation time. In the IIFE context, module evaluation IS runtime — the globals are set before any IIFE runs. So a module-level constant would work. However, the factory approach allows `onEnable` to call `createMathField()` fresh on each enable cycle (EC-15: re-enable after disable creates a fresh StateField, no residual state). This is the safer pattern.

### 4d. Module-level state for the field instance

```typescript
// Module-level storage for the active StateField instance.
// Set in onEnable, cleared in onDisable.
// Used so onDisable can call api.removeExtensions() without needing to pass
// the field reference (api.removeExtensions() removes all extensions by plugin id,
// not by field reference — so this is just documentation clarity).
let _mathField: ReturnType<typeof StateField.define> | null = null;
```

### 4e. `provide` function and EditorView.decorations

The `provide` callback is how CM6 learns to extract the decoration set from the StateField. The correct API is:

```typescript
provide(field) {
  return _EditorView.decorations.from(field);
}
```

Where `_EditorView` is `EditorView` from `window.__CM_VIEW__`. This is identical to the pattern used by the YAML pane's StateField (when it has one) and by focus-mode (which uses ViewPlugin instead).

## Function/Type Signatures (Summary)

```typescript
function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number
): boolean

function buildMathDecorations(state: EditorState): DecorationSet

function createMathField(): StateField<DecorationSet>

// Export for tests:
export { isCursorInsideRange, buildMathDecorations }
```

Export `isCursorInsideRange` and `buildMathDecorations` for unit testing (same pattern as `scanHeadings` in auto-toc). Note: `buildMathDecorations` requires an `EditorState` — tests must mock or create a state.

## Test Cases to Write (Red Phase First)

### Group: `isCursorInsideRange`

These are pure function tests with no DOM or CM6 dependencies. They can run in node environment.

```typescript
describe("isCursorInsideRange", () => {
  // Range: from=4, to=8 (e.g., "$x^2$" at positions 4-8 in "abc $x^2$")
  const from = 4, to = 8;

  it("returns false when cursor is before the range", () => {
    expect(isCursorInsideRange(3, 3, from, to)).toBe(false);
  });

  it("returns false when cursor is immediately after the range", () => {
    expect(isCursorInsideRange(8, 8, from, to)).toBe(false);
  });

  it("returns true when cursor is at the opening delimiter (EC-1)", () => {
    expect(isCursorInsideRange(4, 4, from, to)).toBe(true);
  });

  it("returns true when cursor is at the closing delimiter position (EC-2)", () => {
    // Closing $ is at index 7 (to-1). Cursor at 7.
    expect(isCursorInsideRange(7, 7, from, to)).toBe(true);
  });

  it("returns true when cursor is in the middle of the range", () => {
    expect(isCursorInsideRange(5, 5, from, to)).toBe(true);
  });

  it("returns true for selection with anchor outside and head inside (EC-1.4)", () => {
    expect(isCursorInsideRange(2, 5, from, to)).toBe(true);
  });

  it("returns true for selection with anchor inside and head outside (EC-1.4)", () => {
    expect(isCursorInsideRange(6, 10, from, to)).toBe(true);
  });

  it("returns true for selection spanning the entire range", () => {
    expect(isCursorInsideRange(0, 20, from, to)).toBe(true);
  });

  it("returns false for selection entirely before the range", () => {
    expect(isCursorInsideRange(0, 3, from, to)).toBe(false);
  });

  it("returns false for selection entirely after the range", () => {
    expect(isCursorInsideRange(9, 15, from, to)).toBe(false);
  });

  it("handles reversed selection (anchor > head)", () => {
    // Selection from 10 back to 5 (user selected backwards)
    expect(isCursorInsideRange(10, 5, from, to)).toBe(true);
  });

  it("handles zero-length range (from === to)", () => {
    // Degenerate case: should not occur in practice but must not crash
    expect(isCursorInsideRange(5, 5, 5, 5)).toBe(false); // 5 < 5 is false
  });
});
```

### Group: `buildMathDecorations` with mocked EditorState

Testing `buildMathDecorations` requires an `EditorState`. Use CM6's `EditorState.create()`:

```typescript
// These tests run in happy-dom environment to allow CM6 to initialize.
// Import CM6 as values (not from window globals — in tests, import directly).
import { EditorState } from "@codemirror/state";
import { EditorView, Decoration } from "@codemirror/view";

describe("buildMathDecorations", () => {
  it("returns empty DecorationSet for document with no math", () => {
    const state = EditorState.create({ doc: "Hello world" });
    const decos = buildMathDecorations(state);
    // DecorationSet.size is 0 when empty
    expect(decos.size).toBe(0);
  });

  it("returns one decoration for inline math when cursor is away", () => {
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 0, head: 0 }, // cursor at start, away from math
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  it("returns zero decorations when cursor is inside inline math (EC-1)", () => {
    const state = EditorState.create({
      doc: "abc $x^2$ def",
      selection: { anchor: 4, head: 4 }, // cursor on opening $
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  it("renders block math when cursor is on a different line", () => {
    const doc = "abc\n$$\nE=mc^2\n$$\nxyz";
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(1);
  });

  it("does not render block math when cursor is on the $$ delimiter line (EC-3)", () => {
    const doc = "$$\nE=mc^2\n$$";
    // Cursor at position 0 (on the first $)
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 0 },
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(0);
  });

  it("renders two widgets for two adjacent inline spans (EC-4)", () => {
    const state = EditorState.create({
      doc: "$a$ and $b$",
      selection: { anchor: 11, head: 11 }, // cursor at end
    });
    const decos = buildMathDecorations(state);
    expect(decos.size).toBe(2);
  });
});
```

**Note on test imports:** In test files, `@codemirror/*` packages are imported directly as values (not via window globals). The window global pattern is only required inside the IIFE plugin file. Tests can use the real CM6 imports because they run in the test runner's module context, not inside a sandboxed `new Function()`.

However, `buildMathDecorations` as written inside the plugin file uses the destructured `RangeSetBuilder`, `Decoration`, `InlineMathWidget`, and `BlockMathWidget` which depend on the window globals. For unit testing, the developer has two options:

1. **Export `buildMathDecorations` as a standalone function** that accepts `RangeSetBuilder`, `Decoration`, and widget classes as injected dependencies.
2. **Set up window globals in the test** (`window.__CM_VIEW__ = await import("@codemirror/view")` etc.) before importing the plugin.

**Recommended approach:** Option 2 — set up globals in the test `beforeAll`. This is cleaner than dependency injection and is the same approach used by the yaml-pane tests.

```typescript
// In math.test.ts:
import * as cmState from "@codemirror/state";
import * as cmView from "@codemirror/view";

beforeAll(() => {
  (window as any).__CM_STATE__ = cmState;
  (window as any).__CM_VIEW__  = cmView;
});
```

## Acceptance Criteria

- [ ] `isCursorInsideRange` returns the correct boolean for all 12 test cases above.
- [ ] `buildMathDecorations` returns an empty `DecorationSet` for a no-math document.
- [ ] `buildMathDecorations` returns 1 decoration for a single inline math expression when cursor is away.
- [ ] `buildMathDecorations` returns 0 decorations when cursor is inside any math range.
- [ ] Block decorations have `block: true` (verifiable by inspecting the decoration spec).
- [ ] `createMathField()` returns a StateField with a `provide` function (duck-type check: `.spec.provide` is a function).
- [ ] `StateField.define()` is called via the window global destructure, not a direct import.

## CM6-Specific Gotchas

**`tr.selection` vs `update.selectionSet`:** In a `StateField.update()`, the transaction object's `tr.selection` is a `SelectionUpdate` or `undefined`. It is truthy when the selection changed. In a `ViewPlugin.update()`, the equivalent is `update.selectionSet` (a boolean). Both achieve the same trigger condition. The StateField uses `tr.selection` (the transaction property).

**`RangeSetBuilder` requires ascending order.** If `scanMathRanges` ever returns ranges out of order (a bug), the `builder.add()` call will throw a CM6 runtime error. The sort in Phase 4 of the scanner prevents this, but the StateField can add a defensive check in development mode: `if (range.from < lastFrom) throw new Error(...)`.

**Block decoration range must span full source lines.** For `$$...$$` blocks, the decoration `from` must be at the start of the opening `$$` line and `to` must be at the end (or just past) the closing `$$` line. The scanner's `from`/`to` are already set this way (from = first `$` of opening line, to = position after second `$` of closing line). CM6 block replace decorations work correctly when the range spans complete lines.

**`EditorView.decorations.from(field)`:** This is the correct API to wire a StateField to the view's decoration set. The alternative `Decoration.set(...)` is not applicable here — that creates a static set, not a field-driven one. The `provide` callback in `StateField.define` uses `_EditorView.decorations.from(field)` where `_EditorView` is the destructured `EditorView` from `window.__CM_VIEW__`.
