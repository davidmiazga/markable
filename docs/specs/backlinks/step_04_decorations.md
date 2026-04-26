---
title: "Step 4: Wiki-Link Decorations (ViewPlugin)"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 4: Wiki-Link Decorations (ViewPlugin)

## Goal

Build a CM6 ViewPlugin that scans visible ranges for wiki-link syntax and applies live-preview decorations: hiding `[[`/`]]` delimiters and `target|` prefix on non-active lines, styling the visible text with `.cm-live-link`.

## Acceptance Criteria

1. Wiki-links on non-active lines are rendered as styled inline links (`.cm-live-link` class).
2. `[[` and `]]` delimiters are hidden via `Decoration.replace({})`.
3. For `[[target|display]]`, the `target|` portion is also hidden; only "display" is visible.
4. For `[[target]]` (no pipe), "target" is displayed.
5. On active lines (cursor on the line), full raw syntax is shown.
6. Wiki-links inside fenced code blocks (`FencedCode` nodes) are NOT decorated.
7. Decorations rebuild on `docChanged`, `selectionSet`, or syntax tree change.
8. The ViewPlugin operates only on `view.visibleRanges` for performance (NFR-3).

## Design

### ViewPlugin Structure

The wiki-link decoration ViewPlugin follows the same pattern as `LivePreviewPlugin` in `live-preview.ts`:

```typescript
class WikiLinkPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildWikiLinkDecorations(view);
  }

  update(update: ViewUpdate) {
    // Always rebuild (same rationale as LivePreviewPlugin: async parser
    // dispatches transactions that need fresh decoration scanning).
    this.decorations = buildWikiLinkDecorations(update.view);
  }
}
```

The plugin is created via `ViewPlugin.fromClass(WikiLinkPlugin, { decorations: v => v.decorations })`.

### `buildWikiLinkDecorations(view: EditorView): DecorationSet`

1. Compute active lines from `view.state.selection` (same `getActiveLines` pattern as live-preview.ts, respecting `viewModeField` for view mode).
2. Get the syntax tree via `syntaxTree(view.state)`.
3. For each `view.visibleRanges` range:
   a. Scan the document text within the range using `WIKI_LINK_RE`.
   b. For each match, check if it falls within a `FencedCode` node by querying `tree.resolveInner(matchFrom, 1)` and walking ancestors. If any ancestor is `FencedCode`, skip.
   c. Check if the match's line is in the active lines set. If so, skip (show raw syntax).
   d. Apply decorations:
      - `Decoration.replace({})` for `[[` (2 chars from `match.from`)
      - `Decoration.replace({})` for `]]` (2 chars ending at `match.to`)
      - If pipe present: `Decoration.replace({})` for the range from after `[[` to after the first `|` (hides "target|")
      - `Decoration.mark({ class: "cm-live-link" })` for the visible text portion

4. Sort decorations by position and return `Decoration.set(decorations, true)`.

### Fenced Code Block Detection

Use `syntaxTree(state).resolveInner(pos, 1)` and walk up the tree:

```typescript
function isInsideFencedCode(tree: Tree, pos: number): boolean {
  let node = tree.resolveInner(pos, 1);
  while (node) {
    if (node.name === "FencedCode") return true;
    if (!node.parent) break;
    node = node.parent;
  }
  return false;
}
```

**Important**: Access `syntaxTree` from `window.__CM_LANGUAGE__` (not a direct import), following the IIFE pattern. The function `getCmLanguage()` returns the language module lazily:

```typescript
function getCmLanguage() {
  return (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
}
```

### Active Line Detection

Reuse the same logic as `getActiveLines()` in live-preview.ts. Since the plugin cannot import from live-preview.ts (IIFE isolation), implement a local version:

```typescript
function getActiveLines(state: EditorState): Set<number> {
  // Check viewModeField if available
  const viewModeField = (window as any).__CM_STATE__?.StateField;
  // ... simplified: in view mode, all lines are non-active (return empty set)
  // In edit mode, return set of line numbers for all selection ranges
}
```

**Simplification**: The plugin does not need to read `viewModeField` directly. It can check if `state.selection.ranges` length is 1 and the range is collapsed at position 0 with no doc changes -- but this is fragile. Instead, the plugin uses a simpler heuristic: just use the cursor's line numbers from `state.selection.ranges`. This matches the behavior of live-preview.ts's `getActiveLines()` without needing to import the field.

**View mode handling**: When view mode is active (cursor at 0, no user interaction), the active set is empty and ALL wiki-links get decorated. This is the correct behavior -- view mode means "show everything in preview."

## CM6 Globals Used

- `window.__CM_VIEW__` -- `ViewPlugin`, `ViewUpdate`, `EditorView`, `Decoration`, `DecorationSet`, `WidgetType`
- `window.__CM_STATE__` -- `EditorState`, `Range`
- `window.__CM_LANGUAGE__` -- `syntaxTree` (for fenced code detection)

## TDD Test Plan

### Unit Tests (pure function)

```
describe("buildWikiLinkDecorations — decoration ranges", () => {
  // These tests use a mock EditorView-like structure or test the
  // decoration-building logic via the pure parseWikiLinks + range math.

  test("simple [[target]] produces 3 decorations: hide [[, mark text, hide ]]")
  test("[[target|display]] produces 4 decorations: hide [[, hide target|, mark display, hide ]]")
  test("active line: no decorations applied")
  test("fenced code block: no decorations applied (EC-6)")
  test("wiki-link at document start position 0 (EC-26)")
  test("wiki-link at document end (EC-26)")
  test("two wiki-links on same line (EC-27)")
  test("wiki-link adjacent to bold **[[link]]** (EC-28)")
  test("wiki-link to self [[current-file]] still gets decorated (EC-2)")
  test("empty wiki-link [[]] produces hide [[ + hide ]] only (EC-9)")
})
```

### Integration Tests (require CM6 mock)

These tests run in the Vitest jsdom environment with mocked CM6 globals:

```
describe("WikiLinkPlugin integration", () => {
  test("decorations update on doc change")
  test("decorations clear on active line")
  test("no decorations inside fenced code block")
})
```

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-2 | Wiki-link to self is decorated normally; the self-reference check is in click handler (step 5), not decorations |
| EC-6 | `isInsideFencedCode()` checks syntax tree ancestors for `FencedCode` node |
| EC-9 | Empty `[[]]` produces only `replace` decorations for `[[` and `]]`; no mark decoration (empty visible range) |
| EC-26 | Regex scan starts from `visibleRanges[i].from`; position 0 and doc end are valid match positions |
| EC-27 | Regex has global flag; scan produces independent decoration sets for each match |
| EC-28 | Wiki-link decorations are independent of Markdown syntax decorations; both decoration sets coexist |

## Performance Notes (NFR-3)

- The ViewPlugin scans only `view.visibleRanges`, not the full document. For a 50,000-line document, this is typically only the ~50 visible lines.
- `WIKI_LINK_RE` is a simple regex with no backtracking risk.
- `isInsideFencedCode()` uses `resolveInner()` which is O(log n) on the syntax tree.
- The `update()` method always rebuilds (same as LivePreviewPlugin), which is acceptable because the regex scan over visible ranges is cheap.
