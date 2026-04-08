# Step 01: ViewPlugin Scaffold + Heading Decorations

**Phase:** 2C -- Live Preview
**Depends on:** Phase 2B complete
**Creates:** `src/editor/live-preview.ts`
**Modifies:** `src/editor/extensions.ts`, `src/styles.css`

---

## Overview

Build the core ViewPlugin that powers live preview. This step implements the scaffold (active line detection, tree iteration, decoration building) and the first decoration type: ATX headings.

After this step, `# Hello` on an inactive line renders as large bold "Hello" with no `#` visible, and clicking the line reveals the raw markdown.

---

## Task 1: Create `src/editor/live-preview.ts`

### 1.1 Imports

```typescript
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import { EditorState, Range } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
```

### 1.2 Active Line Detection

Build a `Set<number>` of line numbers that are "active" (contain a cursor or are part of a selection).

```typescript
function getActiveLines(state: EditorState): Set<number> {
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let i = startLine; i <= endLine; i++) {
      activeLines.add(i);
    }
  }
  return activeLines;
}
```

### 1.3 Build Decorations Function

The core function that walks the syntax tree and produces decorations.

```typescript
function buildDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const activeLines = getActiveLines(state);
  const decorations: Range<Decoration>[] = [];
  const tree = syntaxTree(state);

  // Only iterate over visible range for performance
  for (const { from, to } of view.visibleRanges) {
    tree.iterate({
      from,
      to,
      enter(node) {
        // Check if this node is on an active line
        const line = state.doc.lineAt(node.from);
        if (activeLines.has(line.number)) return;

        const name = node.name;

        // ATX Headings (H1-H6)
        if (name.startsWith("ATXHeading")) {
          handleHeading(node, state, decorations);
        }
      },
    });
  }

  return Decoration.set(decorations, true);
}
```

### 1.4 Heading Handler

For each ATXHeading node, we need to:
1. Find the HeaderMark child (the `#` characters + space) and hide it with `Decoration.replace`
2. Apply a line decoration for the heading level styling

```typescript
function handleHeading(
  node: { from: number; to: number; name: string; node: any },
  state: EditorState,
  decorations: Range<Decoration>[]
) {
  // Determine heading level from node name (ATXHeading1 -> 1, etc.)
  const level = parseInt(node.name.charAt(node.name.length - 1), 10);
  if (isNaN(level) || level < 1 || level > 6) return;

  const headingClass = `cm-live-h${level}`;

  // Add line decoration for heading styling
  const line = state.doc.lineAt(node.from);
  decorations.push(
    Decoration.line({ class: headingClass }).range(line.from)
  );

  // Find and hide the HeaderMark (the `# ` prefix)
  // Walk children of this heading node
  const cursor = node.node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "HeaderMark") {
        // Replace the `#` marks and the space after them
        // The HeaderMark covers just the `#` chars. We also want to hide the space after.
        let hideEnd = cursor.to;
        // Check if next char is a space
        if (hideEnd < node.to && state.doc.sliceString(hideEnd, hideEnd + 1) === " ") {
          hideEnd += 1;
        }
        decorations.push(
          Decoration.replace({}).range(cursor.from, hideEnd)
        );
      }
    } while (cursor.nextSibling());
  }
}
```

### 1.5 ViewPlugin Class

```typescript
class LivePreviewPlugin {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildDecorations(view);
  }

  update(update: ViewUpdate) {
    if (
      update.docChanged ||
      update.selectionSet ||
      update.viewportChanged
    ) {
      this.decorations = buildDecorations(update.view);
    }
  }
}

export const livePreviewExtension = ViewPlugin.fromClass(LivePreviewPlugin, {
  decorations: (v) => v.decorations,
});
```

---

## Task 2: Add CSS Classes to styles.css

Add heading styles for live preview. These control font size and weight when headings are rendered.

```css
/* ============================================================
   Live Preview -- Heading Styles
   ============================================================ */
.cm-live-h1 { font-size: 1.8em; font-weight: 700; line-height: 1.3; }
.cm-live-h2 { font-size: 1.5em; font-weight: 700; line-height: 1.3; }
.cm-live-h3 { font-size: 1.25em; font-weight: 600; line-height: 1.3; }
.cm-live-h4 { font-size: 1.1em; font-weight: 600; line-height: 1.3; }
.cm-live-h5 { font-size: 1.0em; font-weight: 600; line-height: 1.3; }
.cm-live-h6 { font-size: 0.9em; font-weight: 600; line-height: 1.3; }
```

---

## Task 3: Wire Into extensions.ts

Import and add the extension:

```typescript
import { livePreviewExtension } from "./live-preview";

export function buildExtensions(): Extension[] {
  const extensions: Extension[] = [];

  try {
    extensions.push(markdown());
  } catch (error) {
    console.warn("Failed to load Markdown extension:", error);
  }

  extensions.push(livePreviewExtension);

  return extensions;
}
```

---

## Acceptance Criteria

- [ ] `# Hello` on inactive line: shows "Hello" large/bold, no `#`
- [ ] `## Sub` through `###### Small`: each renders at correct size
- [ ] Clicking any heading reveals raw `# ` markers
- [ ] Moving cursor away re-hides markers
- [ ] Multi-line document with mix of headings and plain text works
- [ ] Selection spanning a heading reveals raw markdown
- [ ] No console errors
- [ ] No perceptible lag during typing
- [ ] `tsc --noEmit` passes

---

## Troubleshooting

**Headings not decorating:** Check that `syntaxTree(state)` returns a parsed tree. The markdown language must be loaded first in the extensions array (before livePreviewExtension).

**Decorations in wrong order:** CM6 requires decorations sorted by position. Using `Decoration.set(decorations, true)` sorts automatically.

**Cursor jumps when clicking heading:** This can happen if `Decoration.replace` covers too much range. Ensure replace ranges only cover markers, not content.

**Line decoration not applying:** `Decoration.line()` must use `line.from` (start of line), not an arbitrary position within the line.
