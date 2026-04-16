---
title: "Step 1: Core Switching Logic + Unit Tests"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 1: Core Switching Logic + Unit Tests

## Goal

Create `src/editor/list-style-switch.ts` containing the `switchListStyle()` function that rewrites all markers in a list block to a target style via a single CM6 transaction. Write comprehensive tests in `tests/list-style-switch.test.ts`.

## New File: `src/editor/list-style-switch.ts`

### Exports

```typescript
import { EditorView } from "@codemirror/view";
import type { ListStyle } from "./list-engine";

/**
 * Rewrite all list markers in the block containing the cursor to the target style.
 *
 * Returns true if a rewrite was performed, false if the cursor is not on a list line.
 * Dispatches a single CM6 transaction (one undo step).
 */
export function switchListStyle(view: EditorView, targetStyle: ListStyle): boolean;

/** Keybinding handler: switch to alphanumeric style. Returns false if not on list line. */
export function switchToAlphanumeric(view: EditorView): boolean;

/** Keybinding handler: switch to decimal style. Returns false if not on list line. */
export function switchToDecimal(view: EditorView): boolean;

/** Keybinding handler: switch to steps style. Returns false if not on list line. */
export function switchToSteps(view: EditorView): boolean;

/** Keybinding handler: switch to standard style. Returns false if not on list line. */
export function switchToStandard(view: EditorView): boolean;
```

### Algorithm for `switchListStyle(view, targetStyle)`

1. Get the cursor line number (1-based from CM6, convert to 0-based for engine).
2. Build document lines array: `string[]` (same pattern as `getDocLines()` in `list-keybindings.ts`).
3. Call `findListBlockRange(lines, cursorLineIndex)`. If null, return false (EC-1, EC-16).
4. Iterate lines from `block.start` to `block.end` (inclusive):
   a. Call `detectListLine(lines[i])`.
   b. If null (comment line -- EC-18), skip. The line is not rewritten.
   c. Determine the target marker type: `markerTypeForDepth(targetStyle, info.depth)`.
   d. Compute ordinal: track ordinal counters per depth level. Each depth starts at 1 and increments for each line at that depth. When depth decreases, reset all deeper counters.
   e. For **decimal-outline** (`targetStyle === "decimal"`): build parentChain from the ordinals of ancestor depths. Example: if depth-0 ordinal is 2 and depth-1 ordinal is 3, parentChain for depth-2 is `[2, 3]`.
   f. Call `generateMarker(markerType, ordinal, parentChain)` to get the new marker string.
   g. Build a change spec: `{ from: lineObj.from + info.indent.length, to: lineObj.from + info.indent.length + info.marker.length, insert: newMarker }`.
5. If no changes were generated (all lines were comments), return false.
6. Dispatch all changes as a single transaction. Use `view.dispatch({ changes })`.
7. Cursor: set the selection anchor to the cursor's original line, at the end of the new marker + original content offset. The simplest approach: store the cursor's character offset from the start of the content (after marker), then restore it relative to the new marker end.
8. Return true.

### Ordinal Tracking Detail

Maintain a `Map<number, number>` or array tracking the current ordinal at each depth:

```typescript
const ordinals: number[] = []; // ordinals[depth] = current count at that depth

for each line in block:
  if not a list line, skip
  const depth = info.depth;
  // Reset deeper levels when we move to a shallower or same depth
  ordinals.length = depth + 1;
  if (ordinals[depth] === undefined) ordinals[depth] = 0;
  ordinals[depth]++;

  // For decimal-outline, parentChain = ordinals.slice(0, depth)
  const parentChain = targetStyle === "decimal" ? ordinals.slice(0, depth) : undefined;
  const markerType = markerTypeForDepth(targetStyle, depth);
  const newMarker = generateMarker(markerType, ordinals[depth], parentChain);
```

### Cursor Preservation

Store before the transaction:
- `cursorLine` = line number (1-based) of the cursor
- `contentOffset` = `cursorPos - (lineFrom + indent.length + marker.length)` -- offset into content text

After building changes, compute new cursor position:
- Find the change for `cursorLine` in the changes array
- New cursor = `lineFrom + indent.length + newMarker.length + contentOffset`
- Clamp to line boundaries

If the cursor is before the marker end (in indent or marker area), place it at the start of the new marker's content area.

## Test File: `tests/list-style-switch.test.ts`

Since `switchListStyle` requires a CM6 `EditorView`, tests will use a mock approach or test the internal logic. The recommended approach: extract the pure transformation logic into a testable helper that takes document lines and returns change specs, then test that helper directly.

### Internal Testable Helper

```typescript
// Exported for testing only (not part of public API)
export function computeStyleSwitchChanges(
  lines: string[],
  cursorLineIndex: number,
  targetStyle: ListStyle,
): { changes: Array<{ lineIndex: number; oldMarker: string; newMarker: string }>; blockStart: number; blockEnd: number } | null;
```

This function contains the pure logic (steps 1-5 of the algorithm) without any CM6 dependency. The `switchListStyle` wrapper calls this and maps the result to CM6 change specs.

### Test Cases (TDD -- write these first)

```
describe("computeStyleSwitchChanges")

  EC-1: cursor not on list line
    - input: ["# Heading", "Some text"], cursorLine: 0
    - expected: null

  EC-2: single-item list
    - input: ["1. Only item"], cursorLine: 0, target: "alphanumeric"
    - expected: marker changes from "1. " to "I. "

  EC-3: deeply nested list (5+ levels, alphanumeric)
    - input: 6 lines at depths 0-5
    - target: "alphanumeric"
    - expected: markers cycle through roman-upper, alpha-upper, decimal, alpha-lower, roman-lower, roman-upper

  EC-4: empty list items
    - input: ["1. ", "2. Content"], cursorLine: 0, target: "alphanumeric"
    - expected: both markers rewritten, empty content preserved

  EC-5: mixed depths to decimal
    - input: ["1. A", "  1. B", "  2. C", "2. D", "  1. E", "    1. F"]
    - target: "decimal"
    - expected: ["1. A", "  1.1. B", "  1.2. C", "2. D", "  2.1. E", "    2.1.1. F"]

  EC-6: comment override present
    - input: ["<!-- list: alphanumeric -->", "1. First", "2. Second"]
    - cursorLine: 1, target: "steps"
    - expected: comment line unchanged, markers rewritten to steps

  EC-7: switching to same style (standard -> standard)
    - input: ["1. A", "2. B"], cursorLine: 0, target: "standard"
    - expected: markers remain "1. " and "2. " (idempotent)

  EC-8: alpha overflow (27+ items)
    - input: 28 lines all at depth 1 (alpha-lower depth in alphanumeric)
    - target: "alphanumeric"
    - expected: items 1-26 get a.-z., item 27 gets "27. ", item 28 gets "28. "

  EC-9: roman numeral generation (not ambiguity)
    - input: ["1. A", "2. B", "3. C"], target: "alphanumeric"
    - expected: depth-0 markers become "I. ", "II. ", "III. "

  EC-10: single transaction (verified by counting changes array length = block size)

  EC-14: decimal parent chain computation
    - input: lines at depths [0,1,1,0,1,2]
    - target: "decimal"
    - expected markers: ["1. ", "1.1. ", "1.2. ", "2. ", "2.1. ", "2.1.1. "]

  EC-15: bullet markers in steps at depth 2+
    - input: 3 lines at depths [0, 1, 2]
    - target: "steps"
    - expected: depth-0 = "1. ", depth-1 = "a. ", depth-2 = "- "

  EC-16: empty document
    - input: [], cursorLine: 0
    - expected: null

  EC-17: cursor in middle of two blocks separated by blank line
    - input: ["1. Block1-A", "2. Block1-B", "", "1. Block2-A", "2. Block2-B"]
    - cursorLine: 3, target: "alphanumeric"
    - expected: only lines 3-4 are rewritten

  EC-18: block starts with comment
    - input: ["<!-- list: decimal -->", "1. A", "  2. B"]
    - cursorLine: 1, target: "alphanumeric"
    - expected: comment at index 0 is in block but not rewritten (no marker), lines 1-2 rewritten
```

## Acceptance Criteria

1. `switchListStyle(view, "alphanumeric")` rewrites all markers in the block to the alphanumeric depth cycle.
2. `switchListStyle(view, "decimal")` produces correct `x.y.z.` markers with parent chains.
3. `switchListStyle(view, "steps")` produces decimal at depth 0, alpha-lower at depth 1, bullet at depth 2+.
4. `switchListStyle(view, "standard")` produces `N.` at all depths.
5. Returns false when cursor is not on a list line.
6. All changes are in a single array (one transaction, one undo step).
7. Comment lines in the block are preserved unchanged.
8. Cursor position is approximately restored (same line, near same content offset).
9. All test cases above pass.
10. `list-engine.ts` is NOT modified (import only).
11. Existing 909 Vitest tests still pass.
