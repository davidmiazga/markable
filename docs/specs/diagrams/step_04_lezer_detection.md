---
title: "Step 04 — Lezer FencedCode Detection"
last-updated: "2026-04-20"
review-cadence-days: 7
status: active
---

# Step 04: Lezer FencedCode Detection

**Requirement:** FR-01 (Fenced Block Detection), FR-02.5 (Cursor overlap), FR-06 (Source-mode guard), AD-05 (Lezer AST), AD-04 (source-mode guard)
**Files modified:** `src/plugins/diagrams/diagrams.plugin.ts`

---

## Goal

Implement `buildDiagramDecorations(state)` — the core function that walks the Lezer syntax tree, finds all `mermaid`-tagged `FencedCode` nodes, applies cursor-overlap suppression, and returns a `DecorationSet`. The actual `MermaidWidget` class is added in step_05; this step produces the widget placeholder call as `new (MermaidWidget as any)(source)` and can be tested with a stub widget.

---

## Implementation Instructions

Add the following to `src/plugins/diagrams/diagrams.plugin.ts`, after the CSS injection helpers and before the stubs comment. This replaces the stub comment `// buildDiagramDecorations() — added in step_04`.

### Interface: DiagramBlock

```typescript
/**
 * A single mermaid fenced code block found in the document.
 * `from` is the start of the opening fence line.
 * `to` is the character position after the last character of the closing fence line.
 * `source` is the raw Mermaid content between the fences (not including fence lines).
 */
export interface DiagramBlock {
  from: number;
  to: number;
  source: string;
}
```

### Function: scanDiagramBlocks

```typescript
/**
 * Walk the Lezer syntax tree and return all mermaid FencedCode blocks.
 *
 * Detection strategy (AD-05):
 *   - Iterates FencedCode nodes from the Lezer tree.
 *   - For each FencedCode, walks its children to find a CodeInfo child.
 *   - Reads CodeInfo text; if it equals "mermaid" (case-insensitive), records the block.
 *   - The `from` offset is the FencedCode node's `from` (start of opening fence).
 *   - The `to` offset is the FencedCode node's `to` (end of closing fence).
 *   - The `source` is read from the CodeText child node (the content between fences).
 *     If no CodeText child exists (empty block, EC-01/EC-02), source is "".
 *   - An unclosed fence produces no FencedCode node in Lezer (EC-03) — handled naturally.
 *   - Mermaid blocks inside blockquotes ARE included — Lezer iterates nested FencedCode
 *     nodes regardless of blockquote nesting (EC-08).
 *
 * @param state - The current CM6 EditorState.
 * @returns Array of DiagramBlock objects sorted ascending by `from`.
 */
export function scanDiagramBlocks(state: EditorState): DiagramBlock[] {
  const results: DiagramBlock[] = [];

  syntaxTree(state).iterate({
    enter(node: { name: string; from: number; to: number; node: { cursor: () => { firstChild: () => boolean; name: string; from: number; to: number; nextSibling: () => boolean } } }) {
      if (node.name !== "FencedCode") return;

      // Walk FencedCode children to find CodeInfo and CodeText.
      let langTag = "";
      let source = "";

      const cursor = node.node.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === "CodeInfo") {
            langTag = state.doc.sliceString(cursor.from, cursor.to).trim().toLowerCase();
          }
          if (cursor.name === "CodeText") {
            // CodeText includes the trailing newline before the closing fence.
            // Trim to get clean Mermaid source.
            source = state.doc.sliceString(cursor.from, cursor.to).trim();
          }
        } while (cursor.nextSibling());
      }

      if (langTag !== "mermaid") {
        // Not a mermaid block — continue iterating sibling nodes.
        return;
      }

      results.push({
        from: node.from,
        to: node.to,
        source,
      });

      // Return false to stop descending into this FencedCode's children —
      // we have already walked them manually above.
      return false;
    },
  });

  // Safety sort — Lezer iterates left-to-right so results are normally already sorted,
  // but RangeSetBuilder requires strictly ascending `from` order (FR-02.1).
  results.sort((a, b) => a.from - b.from);
  return results;
}
```

### Function: isCursorInsideRange

Copy this verbatim from the math plugin pattern (FR-02.5). Both plugins use the same overlap formula.

```typescript
/**
 * Return true if the selection overlaps the given document range.
 *
 * Formula: selFrom < to && selTo >= from
 *   - Handles collapsed cursors (anchor === head) and multi-character selections.
 *   - Normalises anchor/head so reversed selections work correctly.
 *   - Cursor exactly at `from` (on the opening fence) counts as inside.
 *   - Cursor exactly at `to` (after the closing fence) counts as outside.
 *
 * @param selectionAnchor - state.selection.main.anchor
 * @param selectionHead   - state.selection.main.head
 * @param from            - Inclusive start of the fenced block range.
 * @param to              - Exclusive end of the fenced block range.
 */
export function isCursorInsideRange(
  selectionAnchor: number,
  selectionHead: number,
  from: number,
  to: number,
): boolean {
  const selFrom = Math.min(selectionAnchor, selectionHead);
  const selTo   = Math.max(selectionAnchor, selectionHead);
  return selFrom < to && selTo >= from;
}
```

### Function: buildDiagramDecorations

```typescript
/**
 * Build a DecorationSet replacing all out-of-cursor mermaid blocks with widgets.
 *
 * Called by the StateField's create() and update() methods.
 *
 * Source-mode guard (AD-04, FR-06): returns Decoration.none immediately if
 * __MARKABLE_PREVIEW_ENABLED__ is falsy. No Lezer tree walk occurs in source mode.
 *
 * Cursor overlap (FR-02.5): if the selection touches a block's [from, to) range,
 * the decoration is suppressed and the raw fenced text is visible for editing.
 *
 * @param state - The current CM6 EditorState.
 * @returns DecorationSet with Decoration.replace({ block: true }) for each visible diagram.
 */
export function buildDiagramDecorations(state: EditorState): DecorationSet {
  // Source-mode guard (AD-04): no widgets in raw/source mode.
  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (!(window as any).__MARKABLE_PREVIEW_ENABLED__) return Decoration.none;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  const blocks = scanDiagramBlocks(state);
  if (blocks.length === 0) return Decoration.none; // EC-20: fast path

  const sel = state.selection.main;
  const builder = new RangeSetBuilder<ReturnType<typeof Decoration.replace>>();

  for (const block of blocks) {
    // Suppress decoration when cursor overlaps this block (FR-02.5).
    if (isCursorInsideRange(sel.anchor, sel.head, block.from, block.to)) {
      continue;
    }

    // MermaidWidget is defined in step_05. The decoration is a block replacement
    // spanning the full fenced block (opening fence through closing fence).
    const widget = new MermaidWidget(block.source);
    const deco = Decoration.replace({ widget, block: true });
    builder.add(block.from, block.to, deco);
  }

  return builder.finish();
}
```

Note: `MermaidWidget` is referenced here but defined in step_05. For this step to compile cleanly before step_05, add a temporary placeholder class immediately after the stubs comment:

```typescript
// TEMPORARY: replaced by full MermaidWidget in step_05.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class MermaidWidget extends (WidgetType as typeof WidgetTypeClass) {
  constructor(readonly source: string) { super(); }
  eq(other: MermaidWidget): boolean { return other.source === this.source; }
  toDOM(): HTMLElement { return document.createElement("div"); }
  ignoreEvent(): boolean { return false; }
}
```

This temporary class is replaced entirely in step_05. Remove it when step_05 is complete.

---

## Notes on FencedCode child node names

Confirmed for `@lezer/markdown` (the version used by `@codemirror/lang-markdown` in this project):

- `FencedCode` — the outer block spanning the opening fence through the closing fence
- `CodeInfo` — the language tag after the opening fence markers (e.g., `mermaid` in ` ```mermaid `)
- `CodeText` — the content lines between the fences (may be absent for empty blocks)
- `CodeMark` — the fence markers themselves (` ``` ` or `~~~`) — not used in this plugin

An unclosed fence block does NOT produce a `FencedCode` node — Lezer produces a `Document` node that contains only the opening `CodeMark` and an unclosed `FencedCode` stub without `to` aligned to the closing fence. In practice this means `from === to` or the `to` points to the document end without a proper closing fence marker. The `scanDiagramBlocks` iterator simply does not find a valid `FencedCode` node to process — handling EC-03 naturally.

A ` ```mermaid ` fence with only whitespace content between the fences produces a `FencedCode` with `CodeInfo = "mermaid"` and either no `CodeText` child or a `CodeText` with only whitespace. The `.trim()` call on the CodeText slice produces `""` — EC-01 and EC-02 are handled correctly.

---

## Acceptance Criteria

- [ ] `scanDiagramBlocks()` is exported and returns `DiagramBlock[]` sorted by `from`
- [ ] `isCursorInsideRange()` is exported and matches the math plugin formula
- [ ] `buildDiagramDecorations()` is exported and checks `__MARKABLE_PREVIEW_ENABLED__` first
- [ ] A document with no mermaid blocks returns `Decoration.none` (EC-20)
- [ ] A document with a valid ` ```mermaid ` block returns one decoration
- [ ] A ` ```python ` block (wrong language) produces no decoration
- [ ] An unclosed ` ```mermaid ` block (no closing fence) produces no decoration (EC-03)
- [ ] An empty mermaid block produces a decoration with `source = ""` (EC-01)
- [ ] `npm run build:plugins` compiles without TypeScript errors

---

## Files Modified in This Step

| File | Action | Purpose |
|------|--------|---------|
| `src/plugins/diagrams/diagrams.plugin.ts` | MODIFY | Add scanDiagramBlocks, isCursorInsideRange, buildDiagramDecorations |
