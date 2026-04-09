# Step 02 — Move Line Up / Down (Opt-Up / Opt-Down)

**Requirements:** `docs/requirements/active_task.md` §2 Feature 2, §3 EC-M1–M7, §4 AC-M1–M6
**Files modified:**
- `src/editor/format.ts` only

---

## 1. Overview

Two pure CM6 functions. Each reads the document state, resolves the contiguous
line block covered by `state.selection.main`, performs a boundary check (no-op
at document edges), then builds a single `view.dispatch({ changes, selection })`
call that atomically swaps the block with its neighboring line.

No Tauri / Rust changes. No menu items.

---

## 2. Design: Line Swap Transaction

### Swap "block up" (move block from lines [F..L] upward)

Given:
- `above` = line at number `F - 1`
- `block` = contiguous lines `F` through `L`

The swap is expressed as two replacement changes in one transaction:

```
Change A: replace range [above.from .. above.to]  with  blockText
Change B: replace range [block.from .. block.to]  with  aboveText
```

Where:
- `aboveText = state.doc.sliceString(above.from, above.to)`  (no newline)
- `blockText = state.doc.sliceString(block.from, block.to)`   (no newline)

The newlines between lines are structural characters that live at positions
`line.to` (the position after the last character, before the `\n`). When
two line ranges are swapped by replacing `[line.from .. line.to]` the newline
characters at `above.to` and `block.to` remain in place — only the text content
moves. This satisfies EC-M7 (no trailing newline is gained or lost).

After the dispatch, the new selection anchor/head must be computed relative to
the new positions. When moving up:
- The moved block now starts at `above.from`.
- Selection offset within the block is preserved.

### Swap "block down" (move block from lines [F..L] downward)

Given:
- `block` = contiguous lines `F` through `L`
- `below` = line at number `L + 1`

Same two-change pattern:

```
Change A: replace range [block.from .. block.to]  with  belowText
Change B: replace range [below.from .. below.to]  with  blockText
```

After the dispatch, the moved block starts at `block.from + below.text.length`.

---

## 3. `src/editor/format.ts`

### 3a. New function — `moveLineUp`

Add immediately before the `formatKeymap` array (after `insertLink`).

```typescript
/**
 * Move the line(s) covered by the primary selection one position upward.
 * Operates on selection.main only (consistent with toggleOrderedList).
 * No-op if the first selected line is already line 1.
 */
export function moveLineUp(view: EditorView): void {
  const state = view.state;
  const main = state.selection.main;

  const firstLine = state.doc.lineAt(main.from);
  const lastLine  = state.doc.lineAt(main.to);

  // Boundary check — EC-M1, EC-M3, EC-M5
  if (firstLine.number === 1) return;

  const aboveLine = state.doc.line(firstLine.number - 1);
  const aboveText = state.doc.sliceString(aboveLine.from, aboveLine.to);
  const blockText = state.doc.sliceString(firstLine.from, lastLine.to);

  view.dispatch({
    changes: [
      { from: aboveLine.from, to: aboveLine.to, insert: blockText },
      { from: firstLine.from, to: lastLine.to,  insert: aboveText },
    ],
    selection: {
      anchor: aboveLine.from + (main.anchor - firstLine.from),
      head:   aboveLine.from + (main.head   - firstLine.from),
    },
  });

  view.focus();
}
```

### 3b. New function — `moveLineDown`

```typescript
/**
 * Move the line(s) covered by the primary selection one position downward.
 * Operates on selection.main only (consistent with toggleOrderedList).
 * No-op if the last selected line is already the last line of the document.
 */
export function moveLineDown(view: EditorView): void {
  const state = view.state;
  const main = state.selection.main;

  const firstLine = state.doc.lineAt(main.from);
  const lastLine  = state.doc.lineAt(main.to);

  // Boundary check — EC-M2, EC-M4, EC-M5
  if (lastLine.number === state.doc.lines) return;

  const belowLine = state.doc.line(lastLine.number + 1);
  const belowText = state.doc.sliceString(belowLine.from, belowLine.to);
  const blockText = state.doc.sliceString(firstLine.from, lastLine.to);

  // After the swap, the block starts at firstLine.from + belowText.length + 1
  // (+1 for the newline that separates the two positions).
  const newBlockStart = firstLine.from + belowText.length + 1;

  view.dispatch({
    changes: [
      { from: firstLine.from, to: lastLine.to,  insert: belowText },
      { from: belowLine.from, to: belowLine.to, insert: blockText },
    ],
    selection: {
      anchor: newBlockStart + (main.anchor - firstLine.from),
      head:   newBlockStart + (main.head   - firstLine.from),
    },
  });

  view.focus();
}
```

### 3c. New `formatKeymap` entries

Append to the `formatKeymap` array after the `Meta-k` entry:

```typescript
{ key: "Alt-ArrowUp",   mac: "Alt-ArrowUp",   run: (v) => { moveLineUp(v);   return true; } },
{ key: "Alt-ArrowDown", mac: "Alt-ArrowDown",  run: (v) => { moveLineDown(v); return true; } },
```

---

## 4. Why `[line.from .. line.to]` (no newline in the range)

`line.to` in CM6 is the position of the last character of the line, exclusive
of the `\n`. The newline lives at `line.to` through `line.to + line.length -
(line.to - line.from)` — more precisely, each `\n` is at the position between
`line.to` and the following `line.from`. When both the `aboveLine` range and the
`blockLine` range are expressed as `[from .. to]` (not `[from .. to + 1]`), the
two `\n` characters remain untouched in the document, and only the text content
of the two regions is exchanged. This avoids gaining or losing newlines
(EC-M7).

---

## 5. Selection Tracking After Move

### Move up

Before:
```
line F-1:  "above"           from=A
line F:    "first"           from=B   ← main.anchor/head somewhere in [B..L.to]
line L:    "last"            to=E
```

After the dispatch (CM6 applies changes in document order, last change first
for overlapping ranges, but these are non-overlapping so order is stable):
```
line F-1:  "first...last"   from=A   ← block is now here
line L':   "above"
```

New `anchor = A + (old_anchor - B)` preserves the caret's visual offset within
the moved block.

### Move down

Before:
```
line F:    "first"           from=B   ← main.anchor/head somewhere in [B..E]
line L:    "last"            to=E
line L+1:  "below"           from=C
```

After:
```
line F:    "below"           from=B
line F+1:  "first...last"    from=B + belowText.length + 1
```

New `anchor = (B + belowText.length + 1) + (old_anchor - B)`.

---

## 6. Acceptance Criteria Traceability

| AC | Satisfied by |
|----|-------------|
| AC-M1 | `moveLineUp`: `firstLine.number === 1` guard |
| AC-M2 | `moveLineDown`: `lastLine.number === state.doc.lines` guard |
| AC-M3 | Same guard as AC-M1; first selected line hits line-1 boundary |
| AC-M4 | Same guard as AC-M2; last selected line hits document-end boundary |
| AC-M5 | Both guards trigger for a single-line document |
| AC-M6 | Multi-line selection: `firstLine` and `lastLine` span the block; single dispatch swaps the whole block |
