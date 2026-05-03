---
title: Outline Panel — Step 02 — Fold Infrastructure and Bidirectional Sync
last-updated: "2026-05-02"
review-cadence-days: 90
status: active
---

# Step 02 — Fold Infrastructure and Bidirectional Sync

**Prerequisite:** step_01 must be complete and all its tests passing before starting this step.

**Implements:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-12 (fold state trigger), FR-13 (complete), EC-4, EC-5, EC-7, EC-12, EC-13, EC-14, EC-19, AC-3–AC-12

---

## Goal

Add full fold infrastructure to the already-working Outline Panel:

1. `computeFoldRange()` — the pure function that defines collapsible section boundaries.
2. `foldService` — CM6 extension that teaches CM6 the fold ranges for heading lines.
3. `codeFolding()` — CM6 built-in that renders the fold gutter widget (FR-7).
4. Updated `updateListener` — detects fold state changes in addition to doc/selection changes.
5. Updated `rebuildOutline()` — renders chevrons in correct collapsed/expanded/hidden states.
6. Chevron click handler — dispatches `foldEffect` / `unfoldEffect` on the EditorView.
7. Updated navigation click handler — unfolds target section before scrolling (FR-3, EC-5).
8. Guard in `onEnable` — try/catch for missing `__CM_LANGUAGE__` (EC-13).

---

## Files to Modify

Only `src/plugins/outline-panel/outline-panel.plugin.ts` changes in this step.

No other file changes. The build config entry was already added in step_01.

---

## Implementation Specification

### 1. Add `getCmLanguage()` accessor

After the existing `getCmView()` function, add:

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmLanguage(): typeof import("@codemirror/language") {
  return (window as any).__CM_LANGUAGE__ as typeof import("@codemirror/language");
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

### 2. Add `FoldRange` interface (exported)

```typescript
export interface FoldRange {
  from: number;  // character position at the end of the heading line (exclusive of \n)
  to: number;    // character position at the end of the last non-blank body line
}
```

### 3. Add `_lastFoldRanges` to module-level state

```typescript
let _lastFoldRanges: (FoldRange | null)[] = [];
```

This is parallel to `_lastEntries`: index `i` in `_lastFoldRanges` corresponds to index `i` in `_lastEntries`. A `null` entry means the section at that index is not collapsible.

Reset this to `[]` in `onDisable`.

### 4. Implement `computeFoldRange()` (exported pure function)

**Signature:**
```typescript
export function computeFoldRange(
  entries: HeadingEntry[],
  index: number,
  docText: string,
): FoldRange | null
```

**Contract:**
- Returns `null` if the section body (lines between this heading and the next same-or-higher-level heading) contains no non-whitespace, non-empty lines.
- Returns a `FoldRange` with `from` = end of heading line, `to` = end of last non-blank body line.
- "Same or higher level" means `nextHeading.level <= currentHeading.level`.

**Algorithm:**

```
entry = entries[index]
currentLevel = entry.level

// Find the exclusive end position for this section's body.
// Walk forward in entries to find the next heading at the same or higher level.
sectionEndPos = docText.length  // default: end of document
for j = index + 1 to entries.length - 1:
  if entries[j].level <= currentLevel:
    sectionEndPos = entries[j].lineFrom  // body stops before this heading's line start
    break

// The fold range 'from' is the end of the heading line itself.
// Compute by finding the '\n' after entry.lineFrom, or end of document.
headingLineEnd = docText.indexOf('\n', entry.lineFrom)
if headingLineEnd === -1:
  // Heading is on the last line with no trailing newline.
  // Section body is empty; no fold possible.
  return null
foldFrom = headingLineEnd  // position of the '\n'; CM6 foldEffect uses from = end of line

// Extract section body text (from after the heading's \n to sectionEndPos).
bodyText = docText.slice(headingLineEnd + 1, sectionEndPos)

// Check if body has any non-blank line.
bodyLines = bodyText.split('\n')
lastNonBlankOffset = -1
cumulativeOffset = headingLineEnd + 1  // absolute doc offset of first body char
for each line of bodyLines:
  if line.trim() !== '':
    lastNonBlankOffset = cumulativeOffset + line.length - 1  // last char of line (excl \n)
  cumulativeOffset += line.length + 1

if lastNonBlankOffset === -1:
  return null  // all body lines are blank → not collapsible

return { from: foldFrom, to: lastNonBlankOffset + 1 }
// +1 because CM6 fold ranges are exclusive on the right (folded range does not include 'to')
```

**Important detail — `from` and `to` semantics:**
- CM6's `foldEffect` takes `{ from, to }` where:
  - `from` is the position at the end of the line to fold from (the `\n` character position, which CM6 interprets as end-of-line).
  - `to` is the exclusive end of the hidden range.
- This matches the requirements spec (FR-5): `from` is "the character position immediately after the last character on the heading line, exclusive of the newline" — which in CM6's 0-indexed string model is the position of the `\n` character itself.

**Defensive guard (EC-12):**
If `from >= to`, return `null` rather than dispatching a zero-length fold.

### 5. Implement `isFolded()` (not exported — internal helper)

```typescript
function isFolded(
  foldedSet: ReturnType<typeof import("@codemirror/language").foldedRanges>,
  pos: number,
): boolean {
  let found = false;
  foldedSet.between(pos, pos, () => { found = true; });
  return found;
}
```

Note: `RangeSet.between(from, to, callback)` invokes the callback for each range whose interval overlaps `[from, to]`. Passing `pos, pos` finds any fold range that contains or starts at `pos`. This is the correct check for "is the fold range starting at `pos` currently folded".

Alternative using `.iter()` if `between` semantics are insufficient:
```typescript
function isFolded(foldedSet: any, pos: number): boolean {
  const iter = foldedSet.iter();
  while (iter.value !== null) {
    if (iter.from <= pos && pos <= iter.to) return true;
    iter.next();
  }
  return false;
}
```

Use whichever approach produces correct results. The `between` approach is O(log n) and preferred.

### 6. Update `rebuildOutline()` — add fold parameters

New signature:
```typescript
function rebuildOutline(
  entries: HeadingEntry[],
  foldRanges: (FoldRange | null)[],
  foldedSet: ReturnType<typeof import("@codemirror/language").foldedRanges> | null,
  activeIdx: number,
): void
```

Step_01 callers of `rebuildOutline(entries, activeIdx)` must be updated to pass the new parameters.

**Changes to the DOM build loop:**

For each entry at index `i`:

a. Compute `foldRange = foldRanges[i] ?? null`.
b. Determine fold state:
   - `isCollapsible = foldRange !== null`
   - `isCurrentlyFolded = isCollapsible && foldedSet !== null && isFolded(foldedSet, foldRange.from)`
c. Set chevron classes:
   - Base class: `outline-chevron`
   - Add `outline-chevron-visible` if `isCollapsible` (remove the blanket hidden rule from step_01's CSS, replace with this class-based approach)
   - Add `outline-chevron-collapsed` if `isCurrentlyFolded`
   - `aria-hidden="true"` when not collapsible; `aria-label="Collapse section"` / `"Expand section"` when collapsible
d. Wire chevron click handler (see section 8 below).

**CSS update (remove step_01's blanket hide rule):**

Replace this step_01 CSS rule:
```css
/* Step 01: all chevrons hidden until fold is wired in step_02 */
.outline-chevron {
  visibility: hidden;
}
```

With:
```css
.outline-chevron {
  visibility: hidden;
}

.outline-chevron-visible {
  visibility: visible;
}
```

(The base rule keeps non-collapsible chevrons invisible; the `.outline-chevron-visible` class overrides it for collapsible headings.)

### 7. Implement chevron click handler

Within the DOM build loop, attach to the chevron button:

```typescript
chev.addEventListener("click", (e) => {
  e.stopPropagation();  // prevent the row from triggering label navigation
  if (!_view || !foldRange) return;
  const { foldEffect, unfoldEffect, foldedRanges: getFoldedRanges } = getCmLanguage();
  const currentFoldedSet = getFoldedRanges(_view.state);
  if (isFolded(currentFoldedSet, foldRange.from)) {
    _view.dispatch({ effects: unfoldEffect.of({ from: foldRange.from }) });
  } else {
    _view.dispatch({ effects: foldEffect.of({ from: foldRange.from, to: foldRange.to }) });
  }
});
```

The `foldRange` variable is captured per-iteration from the outer loop scope. `isFolded` is called at click time (not at render time) to get the freshest state.

### 8. Update navigation click handler (FR-3, EC-5)

Replace the step_01 navigation click handler on `.outline-label` with:

```typescript
btn.addEventListener("click", () => {
  if (!_view) return;
  const { EditorView } = getCmView();
  const { unfoldEffect, foldedRanges: getFoldedRanges } = getCmLanguage();

  // EC-5: unfold the target section before navigating if it is currently folded.
  if (foldRange !== null) {
    const currentFoldedSet = getFoldedRanges(_view.state);
    if (isFolded(currentFoldedSet, foldRange.from)) {
      _view.dispatch({ effects: unfoldEffect.of({ from: foldRange.from }) });
    }
  }

  _view.dispatch({
    selection: { anchor: lineFrom },
    effects: EditorView.scrollIntoView(lineFrom, { y: "center" }),
  });
  _view.focus();
});
```

The `lineFrom` and `foldRange` variables are captured from the current loop iteration's closure.

### 9. Build `foldService` extension

Add a new factory function `buildFoldService()`:

```typescript
function buildFoldService() {
  const { foldService } = getCmLanguage();
  return foldService.of((state, lineStart) => {
    // Find the heading entry whose lineFrom matches lineStart.
    // _lastEntries is the most recent scan result from the updateListener.
    const idx = _lastEntries.findIndex((e) => e.lineFrom === lineStart);
    if (idx === -1) return null;  // EC-14: not a heading line

    const foldRange = _lastFoldRanges[idx];
    if (!foldRange) return null;  // EC-14: heading has no collapsible section

    return { from: foldRange.from, to: foldRange.to };
  });
}
```

This is the CM6 `foldService` Facet registration. It is called by CM6 whenever it needs to know the fold range for a given line (e.g. when rendering the fold gutter widget).

**Important:** `_lastEntries` and `_lastFoldRanges` are module-level state. The `foldService` closure reads them at call time (when CM6 invokes the service), not at registration time. This is correct: CM6 calls the service function reactively when it needs fold information.

### 10. Update `buildOutlineUpdateListener()` — add fold state change detection

Replace the step_01 listener body with:

```typescript
function buildOutlineUpdateListener() {
  const { EditorView } = getCmView();
  const { foldedRanges: getFoldedRanges } = getCmLanguage();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;
    // FR-12: detect fold state change using RangeSet reference identity (NFR-3, AD-3).
    const foldStateChanged =
      getFoldedRanges(update.state) !== getFoldedRanges(update.startState);

    if (!docChanged && !selChanged && !foldStateChanged) return;

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot immutable values before the async delay.
    const docText = docChanged ? update.state.doc.toString() : null;
    const cursorPos = update.state.selection.main.head;
    // Snapshot the fold state at this point in time (immutable EditorState).
    const foldedSet = getFoldedRanges(update.state);

    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;

      if (docText !== null) {
        _lastEntries = scanHeadings(docText);
        // Recompute fold ranges when document changes (headings may have moved).
        const text = docText;
        _lastFoldRanges = _lastEntries.map((_, i) =>
          computeFoldRange(_lastEntries, i, text),
        );
      }
      // Note: if only selection or fold state changed, _lastEntries and
      // _lastFoldRanges are reused from the previous scan.

      const activeIdx = findActiveIndex(_lastEntries, cursorPos);
      rebuildOutline(_lastEntries, _lastFoldRanges, foldedSet, activeIdx);
    }, DEBOUNCE_MS);
  });
}
```

### 11. Update `render()` callback in `onEnable`

Update the initial render inside the `render(container)` callback to compute fold ranges and pass them to `rebuildOutline`:

```typescript
render(container: HTMLElement): void {
  const list = document.createElement("div");
  list.className = "outline-list";
  container.appendChild(list);
  _outlineList = list;

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
    | EditorViewType
    | undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (liveView) {
    _view = liveView;
    const docText = liveView.state.doc.toString();
    _lastEntries = scanHeadings(docText);
    _lastFoldRanges = _lastEntries.map((_, i) =>
      computeFoldRange(_lastEntries, i, docText),
    );
    const { foldedRanges: getFoldedRanges } = getCmLanguage();
    const foldedSet = getFoldedRanges(liveView.state);
    const activeIdx = findActiveIndex(
      _lastEntries,
      liveView.state.selection.main.head,
    );
    rebuildOutline(_lastEntries, _lastFoldRanges, foldedSet, activeIdx);
  } else {
    rebuildOutline([], [], null, -1);
  }
},
```

### 12. Wrap `onEnable` in try/catch for EC-13

Replace the `onEnable` method body with:

```typescript
onEnable(api: MarkablePluginAPI): void {
  // EC-13: guard against missing __CM_LANGUAGE__ prerequisite.
  try {
    const cmLang = getCmLanguage();
    // Smoke-test the required exports exist at enable time.
    if (
      typeof cmLang.foldEffect === "undefined" ||
      typeof cmLang.unfoldEffect === "undefined" ||
      typeof cmLang.foldedRanges === "undefined" ||
      typeof cmLang.foldService === "undefined" ||
      typeof cmLang.codeFolding === "undefined"
    ) {
      throw new TypeError("Required fold exports missing from __CM_LANGUAGE__");
    }
  } catch (err) {
    console.error(
      "Outline Panel: @codemirror/language not available as window global. " +
      "Ensure cm-globals.ts exports __CM_LANGUAGE__.",
      err,
    );
    return;  // Do NOT partially enable.
  }

  _enabled = true;
  injectCSS();

  const { codeFolding } = getCmLanguage();
  api.addExtensions([
    buildOutlineUpdateListener(),
    buildFoldService(),
    codeFolding(),
  ]);

  api.registerSidebarPanel({
    id: "outline-panel",
    title: "Outline",
    side: "left",
    defaultWidth: 220,

    render(container: HTMLElement): void {
      // ... (as above in section 11)
    },

    destroy(_container: HTMLElement): void {
      if (_debounceTimer) {
        clearTimeout(_debounceTimer);
        _debounceTimer = null;
      }
      _outlineList = null;
    },
  });
},
```

### 13. Update `onDisable` to reset `_lastFoldRanges`

Add `_lastFoldRanges = [];` to the reset block in `onDisable`.

---

## CSS Additions for Step 02

Update `OUTLINE_CONTENT_CSS` to replace the step_01 blanket-hide rule and add fold-widget gutter styling:

```css
/* Remove the blanket hide rule from step_01: */
/* REMOVED: .outline-chevron { visibility: hidden; } */

/* Chevron is hidden by default; shown only when the section is collapsible. */
.outline-chevron {
  visibility: hidden;
}

.outline-chevron-visible {
  visibility: visible;
}

.outline-chevron-collapsed {
  transform: rotate(-90deg);
}

/* Style the CM6 fold gutter widget (codeFolding() extension) */
.cm-foldGutter span {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1;
}

.cm-foldGutter span:hover {
  color: var(--text-primary);
}
```

---

## Call Site Updates

Every call to `rebuildOutline` must be updated to the new four-parameter signature.

All call sites after step_02:
1. `render()` callback — updated in section 11 above.
2. `buildOutlineUpdateListener()` debounce callback — updated in section 10 above.

No other call sites exist after step_01.

---

## Acceptance Criteria for Step 02

Before declaring step_02 complete, verify ALL of the following:

### Manual verification (requires running app)

1. A heading with body text shows a downward-pointing chevron. A heading with no body text (empty section or only blank lines before the next heading) shows no chevron. Matches AC-11.

2. Clicking the chevron for an expanded section folds it in the editor (the body text collapses behind a fold widget). The chevron rotates to point right (collapsed state). The panel immediately reflects this. Matches AC-3.

3. Clicking the chevron again unfolds the section. The chevron returns to downward. Matches AC-4.

4. Clicking the fold widget in the editor gutter (the `codeFolding()` gutter, on a collapsible heading line) folds the section. Within 150 ms the panel's chevron updates to collapsed. Matches AC-5.

5. Clicking the fold gutter widget on a folded line unfolds it. The panel chevron updates. Matches AC-6.

6. Switching tabs: each tab's fold state is independent. Tab A with a folded section, switch to Tab B and back — Tab A's fold is still there. Panel chevron reflects it. Matches AC-7, AC-8.

7. Clicking a heading whose section is currently folded navigates to that heading AND unfolds it first (cursor lands on a visible heading line). Matches EC-5.

8. Disabling the plugin removes both the sidebar panel and the fold gutter widget. Existing folds in the editor state persist (the fold ranges do not disappear). Matches AC-10, NFR-4.

9. Re-enabling the plugin: the panel re-renders with the correct fold state for the current tab. Matches FR-13.

### Automated tests

Create or extend `tests/plugins/outline-panel/outline-panel.test.ts`.

#### `computeFoldRange` test cases

Import: `import { computeFoldRange } from "../../../src/plugins/outline-panel/outline-panel.plugin";`

| Test description | entries | index | docText | Expected |
|---|---|---|---|---|
| "returns null for a heading with no body" | `[{ level:1, lineFrom:0 }]` | `0` | `"# H1"` (no trailing newline) | `null` |
| "returns null for a heading whose body is all blank lines" | `[{ level:1, lineFrom:0 }, { level:1, lineFrom:11 }]` | `0` | `"# H1\n\n\n# H2"` | `null` |
| "returns fold range for a heading with body content" | `[{ level:1, lineFrom:0 }]` | `0` | `"# H1\nbody text"` | `{ from: 4, to: 13 }` |
| "returns null for two adjacent headings with no content between them (EC-7)" | `[{ level:2, lineFrom:0 }, { level:3, lineFrom:8 }]` | `0` | `"## Foo\n### Bar"` | `null` |
| "section ends at next same-level heading" | `[{ level:1, lineFrom:0 }, { level:1, lineFrom:14 }]` | `0` | `"# H1\nbody\n# H2\nmore"` | `{ from: 4, to: 9 }` |
| "section ends at next higher-level heading" | `[{ level:2, lineFrom:0 }, { level:1, lineFrom:11 }]` | `0` | `"## Sub\nbody\n# Parent"` | `{ from: 6, to: 11 }` |
| "section does not end at a lower-level heading" | `[{ level:1, lineFrom:0 }, { level:2, lineFrom:9 }]` | `0` | `"# H1\nbody\n## Sub"` | non-null (section includes the ## Sub line) |
| "section extends to end of document when no closing heading" | `[{ level:1, lineFrom:0 }]` | `0` | `"# H1\nbody"` | `{ from: 4, to: 9 }` (to = end of "body") |
| "returns null for last entry in a doc ending with a blank line" | heading at start, body is only `""` after `\n` | see test | `null` |
| "handles heading at end of document with no body (EC-6)" | `[{ level:1, lineFrom:0 }]` | `0` | `"# H1"` | `null` |
| "defensive: returns null if computed from >= to" | (craft minimal case) | see test | `null` |

#### Fold-related integration notes

Tests for `foldEffect` dispatch, `isFolded`, and `foldedRanges` cannot be unit tested without a running CM6 EditorState. These are covered by the manual acceptance criteria above. If a test harness for CM6 state is desired in a future iteration, it can be added as a separate test file.

---

## Build Command

```bash
npm run build:plugins && npm run sync:plugins
```

No change to the build config is needed (entry added in step_01).

---

## Definition of Done for Step 02

- [ ] `src/plugins/outline-panel/outline-panel.plugin.ts` updated with all fold infrastructure
- [ ] `tests/plugins/outline-panel/outline-panel.test.ts` extended with `computeFoldRange` tests
- [ ] All tests pass: `npm run test:run -- tests/plugins/outline-panel/outline-panel.test.ts`
- [ ] Full test suite passes: `npm run test:run` (zero regressions)
- [ ] `npm run build:plugins` exits 0
- [ ] All manual acceptance criteria AC-3 through AC-12 verified
- [ ] No console errors when enabling/disabling the plugin
- [ ] Fold state persists across tab switches (AC-7, AC-8)
