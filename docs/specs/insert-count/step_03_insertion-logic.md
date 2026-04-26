---
title: "Step 03 — Insertion Logic"
last-updated: "2026-04-20"
review-cadence-days: 14
status: active
---

# Step 03 — Insertion Logic

## Goal

Implement `applyInsertions`, the three mode-resolution functions, the value formatter, and the CM6 dispatch call. After this step the plugin is functionally complete: the dialog's Insert action produces the correct counter values at the correct positions in a single transaction.

---

## Files Modified

`src/plugins/insert-count/insert-count.plugin.ts` — add all logic functions referenced below.

---

## Key Types

These types live in the same IIFE file (no exports at runtime):

```typescript
interface InsertionPosition {
  /** Document offset at which to insert text. */
  offset: number;
  /** 0-based index in the sequence. Formatted value = start + index * step. */
  index: number;
}
```

---

## formatValue — Pure Function

This function has no side effects and is fully unit-testable. Define it at module scope.

```typescript
/**
 * Compute the formatted string for position `index` in the sequence.
 *
 * FR-03.6 rules:
 *   - If wrap contains "__COUNTER__", replace all occurrences with the number.
 *   - If wrap is non-empty but has no token, append the number after the string.
 *   - If wrap is empty, return the bare number string.
 */
function formatValue(start: number, step: number, wrap: string, index: number): string {
  const value = start + index * step;
  const numStr = String(value);
  if (!wrap) return numStr;
  if (wrap.includes("__COUNTER__")) {
    return wrap.replaceAll("__COUNTER__", numStr);
  }
  return wrap + numStr;
}
```

Note: `String.prototype.replaceAll` is available in all modern browsers and the Tauri WebView. No polyfill needed.

---

## resolveInsertionPositions — Mode Resolution

```typescript
/**
 * Determine insertion positions from the current editor state.
 *
 * Returns an array of InsertionPosition sorted by ascending offset.
 * CM6 ChangeSet requires changes in document order (ascending `from`).
 *
 * Priority: Mode A (multi-cursor) → Mode B (single selection, multi-line)
 *           → Mode C (single cursor / single-line selection).
 */
function resolveInsertionPositions(state: any): InsertionPosition[] {
  const ranges: any[] = Array.from(state.selection.ranges);

  // ── Mode A: multiple cursor ranges ──────────────────────────────────────────
  if (ranges.length > 1) {
    // Sort by `from` ascending (CM6 selection.ranges is already in document order,
    // but sort defensively for correctness — EC-23).
    const sorted = [...ranges].sort((a, b) => a.from - b.from);
    return sorted.map((r, i) => ({ offset: r.from, index: i }));
  }

  // ── Single range ─────────────────────────────────────────────────────────────
  const range = ranges[0];
  const from = range.from;
  const to   = range.to;

  // ── Mode C: no selection (bare cursor) ────────────────────────────────────────
  if (from === to) {
    return [{ offset: from, index: 0 }];
  }

  // ── Determine lines covered by the selection ──────────────────────────────────
  const startLine = state.doc.lineAt(from);
  const endLine   = state.doc.lineAt(to);

  // ── Mode C (single-line selection): selection within one line ─────────────────
  // EC-07: partial selection on a single line — treat as Mode C.
  if (startLine.number === endLine.number) {
    return [{ offset: from, index: 0 }];
  }

  // ── Mode B: selection spanning multiple lines ─────────────────────────────────
  // Compute cursor column from the selection's `head` position (UK-02).
  const headLine = state.doc.lineAt(range.head);
  const cursorCol = range.head - headLine.from;

  const positions: InsertionPosition[] = [];

  for (let lineNum = startLine.number; lineNum <= endLine.number; lineNum++) {
    const line = state.doc.line(lineNum);
    // If the line is shorter than cursorCol, append at line end (UK-02 / FR-03.3).
    const col = Math.min(cursorCol, line.length);
    positions.push({ offset: line.from + col, index: positions.length });
  }

  return positions;
}
```

---

## buildChanges — Assemble CM6 ChangeSpec Array

```typescript
/**
 * Produce a CM6-compatible array of change specs for the given positions.
 *
 * Each change inserts `formatted` text at `offset` with from===to (pure insert).
 * CM6 requires changes in ascending `from` order; resolveInsertionPositions
 * guarantees this.
 *
 * EC-23: Same-line multi-cursor shifts are handled automatically by CM6's
 * ChangeSet — we do NOT manually adjust offsets.
 */
function buildChanges(
  positions: InsertionPosition[],
  config: InsertCountSettings,
): Array<{ from: number; to: number; insert: string }> {
  return positions.map((pos) => ({
    from:   pos.offset,
    to:     pos.offset,
    insert: formatValue(config.start, config.step, config.wrap, pos.index),
  }));
}
```

---

## computePostInsertionCursor — Post-Insertion Selection

```typescript
/**
 * Compute the document offset for the collapsed cursor after all insertions.
 *
 * FR-03.5: cursor collapses to immediately after the last inserted string.
 *
 * CM6 automatically adjusts positions when a ChangeSet is applied, so we
 * cannot simply use `lastPos.offset + lastFormatted.length` on the PRE-dispatch
 * state offsets — the offsets of later insertions shift when earlier text is
 * inserted. Instead, we pass the desired anchor as a position in the
 * POST-dispatch state by using CM6's `mapPos` or by computing it at dispatch
 * time using `changes.mapPos`.
 *
 * Implementation: pass `selection` as a `SelectionRange` inside `dispatch`.
 * CM6 automatically maps the provided selection through the ChangeSet, so
 * we can supply the anchor as `lastPos.offset + lastFormatted.length` and
 * CM6 adjusts for the text inserted before it.
 *
 * Actually this is correct: the `selection` field in a dispatch call is
 * interpreted in the NEW (post-change) document coordinates. So we must
 * provide the final cursor offset in NEW coords. The safest approach is to
 * compute the cumulative shift manually:
 *
 *   newOffset = originalOffset + sum(length of all inserted strings at or before this position)
 *
 * Since positions are sorted ascending, the shift for position i is the
 * sum of all formatted string lengths at indices 0..i-1.
 */
function computePostInsertionCursor(
  positions: InsertionPosition[],
  config: InsertCountSettings,
): number {
  if (positions.length === 0) return 0;

  const last = positions[positions.length - 1];
  const lastFormatted = formatValue(config.start, config.step, config.wrap, last.index);

  // Cumulative shift: total characters inserted before the last position.
  let shift = 0;
  for (let i = 0; i < positions.length - 1; i++) {
    shift += formatValue(config.start, config.step, config.wrap, positions[i].index).length;
  }

  return last.offset + shift + lastFormatted.length;
}
```

---

## applyInsertions — Main Entry Point

This function is called by `closeDialog(true, view, config)`:

```typescript
/**
 * Apply the insertion sequence to the editor as a single CM6 transaction.
 *
 * Called immediately after the user clicks Insert or presses Enter.
 * Settings are persisted here (not before the dialog closes) so a save
 * failure does not prevent the insertion from being visible.
 *
 * EC-27: Read-only document guard — check state.readOnly before dispatching.
 */
async function applyInsertions(view: any, config: InsertCountSettings): Promise<void> {
  if (!view) return;

  // EC-27: Read-only check.
  if (view.state.readOnly) {
    console.warn("[insert-count] Editor is read-only; skipping dispatch.");
    return;
  }

  const positions = resolveInsertionPositions(view.state);
  if (positions.length === 0) return;

  const changes = buildChanges(positions, config);
  const anchor  = computePostInsertionCursor(positions, config);

  // Single CM6 transaction — NFR-01, EC-05.
  // The `selection` field is in POST-dispatch coordinates (new document).
  view.dispatch({
    changes,
    selection: { anchor },
    // scrollIntoView keeps the final cursor position visible.
    scrollIntoView: true,
  });

  // Persist settings only after the insertion is confirmed (FR-04.3, EC-16).
  if (pluginApi) {
    await persistSettings(pluginApi, config);
  }
}
```

Note: `applyInsertions` is `async` because `persistSettings` is async. The `closeDialog` call uses `void applyInsertions(...)` to fire-and-forget without blocking the close.

Update `closeDialog` accordingly:

```typescript
// In closeDialog, change the apply call to:
if (insert && view && config) {
  void applyInsertions(view, config);
}
```

---

## Edge Cases Addressed

| EC | How |
|---|---|
| EC-03 | Mode C: `from===to` → single position at `from`, index=0 |
| EC-04 | Mode A: sorted ranges, each assigned sequential index |
| EC-05 | Single `view.dispatch({changes})` call — one Undo step |
| EC-06 | Mode B: one position per line covered by selection |
| EC-07 | Single-line selection → `startLine.number === endLine.number` → Mode C |
| EC-09 | Negative step: `start + index * step` = 10, 8, 6... valid; no special handling |
| EC-10 | `wrap="Item "`, no token → `"Item " + numStr` |
| EC-11 | `wrap="Step __COUNTER__:"` → `replaceAll` substitution |
| EC-12 | `wrap="__COUNTER__/__COUNTER__"` → `replaceAll` replaces both occurrences |
| EC-22 | 200 cursors: `buildChanges` produces 200 specs; CM6 handles in one transaction |
| EC-23 | Same-line multi-cursor: CM6 ChangeSet manages offset collision automatically |
| EC-24 | Large number (9999999999): `String(value)` works without truncation |
| EC-27 | `view.state.readOnly` checked before dispatch; no crash |

---

## Acceptance Criteria

- `formatValue(1, 1, "", 0)` returns `"1"`.
- `formatValue(1, 1, "", 4)` returns `"5"`.
- `formatValue(1, 1, "Step __COUNTER__:", 2)` returns `"Step 3:"`.
- `formatValue(1, 1, "__COUNTER__/__COUNTER__", 2)` returns `"3/3"`.
- `formatValue(1, 1, "Item ", 0)` returns `"Item 1"` (no token → append).
- `formatValue(10, -2, "", 3)` returns `"4"` (10 + 3*-2 = 4).
- `resolveInsertionPositions` with 3 ranges returns array length 3, sorted ascending.
- `resolveInsertionPositions` with 1 range `from===to` returns array length 1 with `index=0`.
- `resolveInsertionPositions` with selection spanning 4 lines returns array length 4.
- `buildChanges` produces objects with `from===to` (pure insert).
- All 200 positions produce 200 change specs without error.
- After dispatch, cursor is at position after last insertion (manually verified or tested via state).
- Read-only state skips dispatch without throwing.
