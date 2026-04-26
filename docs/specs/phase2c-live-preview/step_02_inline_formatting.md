# Step 02: Bold, Italic, Inline Code Decorations

**Phase:** 2C -- Live Preview
**Depends on:** Step 01 (ViewPlugin + headings working)
**Modifies:** `src/editor/live-preview.ts`, `src/styles.css`

---

## Overview

Add decoration handling for bold (`**text**`), italic (`*text*`), and inline code (`` `text` ``) to the existing ViewPlugin. The pattern is the same as headings: find the syntax node, skip if on active line, hide markers with `Decoration.replace`, style content with `Decoration.mark`.

---

## Task 1: Add StrongEmphasis (Bold) Handler

In `buildDecorations()`, add a case for `StrongEmphasis`:

```typescript
if (name === "StrongEmphasis") {
  handleInlineMarkers(node, state, decorations, "cm-live-bold");
}
```

The `handleInlineMarkers` function hides `EmphasisMark` children and applies a mark decoration to the content between them:

```typescript
function handleInlineMarkers(
  node: { from: number; to: number; name: string; node: any },
  state: EditorState,
  decorations: Range<Decoration>[],
  className: string
) {
  const marks: { from: number; to: number }[] = [];
  const cursor = node.node.cursor();
  if (cursor.firstChild()) {
    do {
      if (cursor.name === "EmphasisMark" || cursor.name === "CodeMark") {
        marks.push({ from: cursor.from, to: cursor.to });
      }
    } while (cursor.nextSibling());
  }

  // Hide all marker children
  for (const mark of marks) {
    decorations.push(Decoration.replace({}).range(mark.from, mark.to));
  }

  // Style the content between markers
  // Content is everything between the first marker end and last marker start
  if (marks.length >= 2) {
    const contentFrom = marks[0].to;
    const contentTo = marks[marks.length - 1].from;
    if (contentFrom < contentTo) {
      decorations.push(
        Decoration.mark({ class: className }).range(contentFrom, contentTo)
      );
    }
  }
}
```

---

## Task 2: Add Emphasis (Italic) Handler

Same pattern, different class:

```typescript
if (name === "Emphasis") {
  handleInlineMarkers(node, state, decorations, "cm-live-italic");
}
```

`handleInlineMarkers` already handles `EmphasisMark`, so no new handler function needed.

---

## Task 3: Add InlineCode Handler

```typescript
if (name === "InlineCode") {
  handleInlineMarkers(node, state, decorations, "cm-live-code");
}
```

`handleInlineMarkers` already handles `CodeMark`, so this works out of the box.

---

## Task 4: Handle Active Line Check for Inline Elements

The current active line check in `buildDecorations()` uses `node.from` to determine the line. For inline elements, this is correct since they don't span multiple lines. But we need to make sure the check applies to the line containing the inline element, not the parent block.

The existing check in the `enter` callback works:
```typescript
const line = state.doc.lineAt(node.from);
if (activeLines.has(line.number)) return;
```

For inline nodes like `StrongEmphasis`, this correctly checks if the bold text's line is active.

**Important:** When walking the tree, inline nodes are children of `Paragraph` or heading nodes. The `enter` callback is called for every node, so we get separate callbacks for `ATXHeading1`, `StrongEmphasis`, `Emphasis`, and `InlineCode`. We should return `undefined` (not `false`) from `enter` for nodes we don't handle so that their children are still visited.

For heading nodes specifically, we should `return false` after handling to avoid double-processing child emphasis marks that are part of the heading content.

Wait -- actually this needs care. If a heading contains bold text like `# **Bold Heading**`, we want:
- On inactive line: heading styling + bold content (hide `#` and `**`)
- On active line: raw `# **Bold Heading**`

The tree structure is: ATXHeading1 > HeaderMark, StrongEmphasis > EmphasisMark, text, EmphasisMark

If we handle ATXHeading and then allow iteration into its children, we'll also hit StrongEmphasis and handle it separately. This is correct behavior -- the heading handler hides `#`, and the bold handler hides `**` and styles the content.

So: do NOT return `false` from heading handler. Let children be visited.

---

## Task 5: Add CSS Classes

Add to `styles.css`:

```css
/* Live Preview -- Inline Formatting */
.cm-live-bold { font-weight: bold; }
.cm-live-italic { font-style: italic; }
.cm-live-code {
  font-family: "Menlo", "Consolas", "Courier New", monospace;
  font-size: 0.9em;
  background-color: rgba(0, 0, 0, 0.06);
  border-radius: 3px;
  padding: 1px 4px;
}
```

And in dark mode:

```css
@media (prefers-color-scheme: dark) {
  .cm-live-code {
    background-color: rgba(255, 255, 255, 0.1);
  }
}
```

---

## Task 6: Verify Nested Formatting

Test cases to verify:
- `**bold *and italic* text**` -- both bold and italic apply on inactive line
- `*italic **and bold** text*` -- both italic and bold apply
- `**bold `code` text**` -- bold applies to text, code style to code part

The tree naturally nests these, and since we handle each node independently, the decorations compose correctly. CM6 handles overlapping mark decorations by nesting DOM elements.

---

## Acceptance Criteria

- [ ] `**bold**` on inactive line: shows "bold" in bold, no asterisks
- [ ] `*italic*` on inactive line: shows "italic" in italic, no asterisks
- [ ] `` `code` `` on inactive line: shows "code" with background, no backticks
- [ ] Clicking any formatted text reveals raw syntax markers
- [ ] `**bold *nested italic***` renders correctly on inactive line
- [ ] Unclosed `**bold text` shows raw (no partial decoration)
- [ ] Undo/redo works without issues
- [ ] Pasting markdown text gets properly decorated
- [ ] No console errors
- [ ] `tsc --noEmit` passes
- [ ] Performance: no lag on 500+ line document with heavy formatting

---

## Troubleshooting

**Bold/italic markers not hiding:** Ensure `EmphasisMark` is the correct child node name. Check with `console.log(cursor.name)` during iteration.

**Code backticks not hiding:** The child node for backtick markers is `CodeMark`, not `EmphasisMark`. The `handleInlineMarkers` function checks for both.

**Nested formatting breaks:** If mark decorations overlap incorrectly, CM6 may produce unexpected DOM. Check that `Decoration.mark` ranges don't overlap with `Decoration.replace` ranges -- they shouldn't since we replace markers and mark content between them.

**Decorations applied on active line:** Double-check that the `activeLines.has(line.number)` check happens before any decoration is added. Inline nodes inherit their parent block's line.
