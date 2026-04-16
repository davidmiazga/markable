---
title: "Step 3: Status Bar Indicator"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 3: Status Bar Indicator

## Goal

Display the active list style name in the status bar when the cursor is inside a list block. Hide the indicator when the cursor is not in a list.

## Design Decision: Where to Put the Code

The status bar indicator is NOT a separate plugin. Per AD-4, it integrates with the existing status bar infrastructure. The indicator logic lives in `src/editor/list-style-switch.ts` as an exported `EditorView.updateListener` extension, wired into the editor in `src/main.ts`.

This follows the pattern where `main.ts` appends a `StateEffect.appendConfig` with the listener (same as the dirty-state tracking listener already in main.ts at line ~838).

## Implementation in `src/editor/list-style-switch.ts`

### New Export

```typescript
import { EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

/**
 * Create a CM6 updateListener that writes the inferred list style name
 * to the provided DOM element. Clears the element when cursor is not
 * in a list block.
 *
 * @param targetEl  The status bar zone element to write text into.
 */
export function listStyleIndicator(targetEl: HTMLElement): ReturnType<typeof EditorView.updateListener.of>;
```

### Logic

```typescript
export function listStyleIndicator(targetEl: HTMLElement) {
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!update.docChanged && !update.selectionSet) return; // NFR-4: bail early

    const state = update.state;
    const cursorLine = state.doc.lineAt(state.selection.main.head);
    const lineIndex = cursorLine.number - 1; // 0-based for engine

    // Build lines array
    const lines: string[] = [];
    for (let i = 1; i <= state.doc.lines; i++) {
      lines.push(state.doc.line(i).text);
    }

    const block = findListBlockRange(lines, lineIndex);
    if (!block) {
      targetEl.textContent = "";
      return;
    }

    const blockLines = lines.slice(block.start, block.end + 1);
    const precedingLine = block.start > 0 ? lines[block.start - 1] : null;
    const fallback = (getCurrentSettings().listStyle as ListStyle) ?? "standard";
    const style = inferListStyle(blockLines, precedingLine, fallback);

    // Display names per FR-3.1
    const DISPLAY_NAMES: Record<ListStyle, string> = {
      standard: "Standard",
      alphanumeric: "Alphanumeric",
      decimal: "Decimal",
      steps: "Steps",
    };

    targetEl.textContent = DISPLAY_NAMES[style];
  });
}
```

### Performance (NFR-4)

The `if (!update.docChanged && !update.selectionSet) return;` guard is identical to the word-count plugin pattern. This ensures no work is done on focus events, cursor blinks, or other non-semantic updates.

Building the full lines array on every qualifying update is acceptable because:
- The document is typically small (Markdown files rarely exceed 10K lines).
- `findListBlockRange` is O(n) in block size, not document size.
- `inferListStyle` scans at most the block lines.

If performance becomes a concern in the future, the lines array could be cached per document version using `update.state.doc` identity, but this optimization is not needed for the initial version.

## Changes to `src/main.ts`

### Import

```typescript
import { listStyleIndicator } from "./editor/list-style-switch";
```

### Wiring

After the existing dirty-state `updateListener` block (around line ~848), add:

```typescript
// List style status bar indicator (FR-3).
// Writes the inferred style name to the status bar right zone when the cursor
// is inside a list block; clears it when not.
const listStyleTarget = statusBarZones.right;
if (listStyleTarget) {
  editor.dispatch({
    effects: StateEffect.appendConfig.of(listStyleIndicator(listStyleTarget)),
  });
}
```

Using `statusBarZones.right` places the indicator in the right zone. This avoids conflicts with the word-count plugin (which uses the center zone).

## Edge Cases Addressed

- **EC-11**: When cursor moves from list to non-list line, `findListBlockRange` returns null, so `targetEl.textContent = ""` hides the indicator.
- **EC-12**: When a `<!-- list: steps -->` comment precedes a block with `1. 2. 3.` markers, `inferListStyle` returns "steps" (comment override wins), so the status bar shows "Steps".
- **EC-16**: Empty document or cursor on blank line -- `findListBlockRange` returns null, indicator is cleared.

## Acceptance Criteria

1. When cursor is on a standard list line, status bar right zone shows "Standard".
2. When cursor is on an alphanumeric list line, shows "Alphanumeric".
3. When cursor is on a decimal outline line, shows "Decimal".
4. When cursor is on a steps-style line, shows "Steps".
5. When cursor moves to a non-list line (heading, paragraph, blank), indicator text is cleared.
6. Comment override is respected: `<!-- list: steps -->` above a `1. 2.` list shows "Steps".
7. No visible lag on keystroke (early bailout on non-semantic updates).
8. The indicator appears in the status bar right zone.
9. No new plugin is created; the listener is wired directly in `main.ts`.
10. All existing tests pass.
