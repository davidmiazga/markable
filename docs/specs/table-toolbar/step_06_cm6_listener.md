---
title: "Table Toolbar — Step 06: CM6 updateListener Wiring"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 06 — CM6 updateListener Wiring

## Goal

Replace the no-op `buildUpdateListener` stub with the full implementation that
drives both the synchronous position recalculation and the debounced enabled/
disabled state. After this step the floating elements track the cursor in real time
and disappear when the cursor leaves the table, and sidebar buttons enable/disable
correctly — all without touching click dispatch (that is step_07).

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Fill section 10 |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Add listener logic tests |

---

## Implementation Notes

### 1. Required CM6 globals access

The listener needs:
- `EditorView.updateListener` from `window.__CM_VIEW__`
- `syntaxTree` from the language package global (needed for `detectTableContextFromState`)

`getCmView()` is already defined (step_01). Add `getCmLanguage()` if not already
present:

```typescript
function getCmLanguage(): { syntaxTree: (state: any) => SyntaxTree } {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__CM_LANGUAGE__;
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
```

Check `src/lib/cm-globals.ts` for the exact global name used in this project.
`@codemirror/language`'s `syntaxTree` is typically exported on
`window.__CM_LANGUAGE__` alongside the language package. If the project exposes it
differently, adapt accordingly — but do NOT import `@codemirror/language` directly.

### 2. detectTableContextFromState — production path

```typescript
/**
 * Detect the TableContext for the current editor state.
 * This is the production wrapper around the pure detectTableContext function.
 * Called from buildUpdateListener (not exported — use detectTableContext in tests).
 */
function detectTableContextFromState(state: any): TableContext | null {
  const { syntaxTree } = getCmLanguage();
  const tree      = syntaxTree(state);
  const docText   = state.doc.toString();
  const cursorPos = state.selection.main.head;
  return detectTableContext(docText, cursorPos, tree);
}
```

### 3. Full buildUpdateListener (Section 10)

```typescript
/**
 * Build the CM6 updateListener extension for the Table Toolbar plugin.
 *
 * Two-rate architecture (AD-8, NFR-2):
 *   - Synchronous: floating element positions updated on every selection/doc change.
 *     Uses coordsAtPos — cheap (~2 calls) and must be lag-free.
 *   - Debounced (DEBOUNCE_MS = 150): detectTableContext + enabled/disabled state
 *     + floating element show/hide. doc.toString() is O(doc size) — worth debouncing.
 *
 * EC-13: editor focus-out hides elements. Handled via a separate blur listener
 * (see onEnable — step_01 note). Alternatively, the debounced path checks
 * update.view.hasFocus.
 *
 * EC-23: __MARKABLE_EDITOR_VIEW__ is NOT cached at enable time. The updateListener
 * callback receives the live view reference via update.view on every invocation.
 */
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;
    if (!docChanged && !selChanged) return;

    const view = update.view;

    // ── Synchronous path: reposition floating elements ────────────────────────
    if (_settings.toolbarMode === "floating") {
      // Get the current table context synchronously for position data.
      // This is cheap because we only need tableFrom, tableTo, and rowFrom —
      // no doc.toString() call here.
      const state   = view.state;
      const tree    = getCmLanguage().syntaxTree(state);
      const head    = state.selection.main.head;

      // Walk the syntax tree to find Table, TableRow nodes (cheap tree walk).
      let tableFrom: number | null = null;
      let tableTo:   number | null = null;
      let rowFrom:   number | null = null;

      let node = tree.resolve(head, 1);
      while (node) {
        if (node.name === "Table") {
          tableFrom = node.from;
          tableTo   = node.to;
        }
        if ((node.name === "TableRow" || node.name === "TableDelimiter") && rowFrom === null) {
          rowFrom = node.from;
        }
        node = node.parent as any;
      }

      if (tableFrom !== null && tableTo !== null && rowFrom !== null) {
        updateFloatingPositions(view, tableFrom, tableTo, rowFrom);
      }
      // If outside table, synchronous path does nothing — debounced path will hide.
    }

    // ── Debounced path: table context + button states ─────────────────────────
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot the state NOW before the 150 ms window.
    const state = update.state;

    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;

      const ctx = detectTableContextFromState(state);

      if (_settings.toolbarMode === "floating") {
        updateFloatingVisibility(ctx);
      } else {
        // Sidebar mode: update button enabled/disabled states.
        if (_sidebarPanelEl) {
          updateSidebarButtonStates(_sidebarPanelEl, ctx);
        }
      }
    }, DEBOUNCE_MS);
  });
}
```

### 4. Editor focus-out handling (EC-13)

When the editor loses focus, all floating elements should hide immediately. Add
a focus-out listener in `onEnable` (floating mode only):

```typescript
let _blurListener: (() => void) | null = null;

// In onEnable, after building floating elements:
if (_settings.toolbarMode === "floating") {
  _blurListener = () => {
    updateFloatingVisibility(null);
  };
  // The editor's DOM element is accessed lazily on each blur.
  // We listen on the window since the editor may not be initialised yet.
  window.addEventListener("blur", _blurListener, true); // capture phase
}
```

In `onDisable`, remove the listener:
```typescript
if (_blurListener) {
  window.removeEventListener("blur", _blurListener, true);
  _blurListener = null;
}
```

Add `_blurListener` to the module-level state variables (Section 3).

### 5. Snapshot rationale for debounce

The `state` snapshot is captured before `setTimeout` because the CM6 editor may
process more transactions during the 150 ms window. Inside the callback, calling
`state.doc.toString()` is safe because the captured `state` is immutable. The
callback must NOT call `view.state` inside the timeout — it would reference the
newest state, not the one that triggered the debounce tick.

Note the difference from `markdown-toolbar.plugin.ts`: that plugin captures
`docText` and `sel` before the timeout. This plugin captures `state` (the entire
CM6 EditorState object) because `detectTableContextFromState` needs the full state
including the syntax tree. EditorState objects are immutable and safe to hold
across async boundaries.

---

## Test Cases

The updateListener itself cannot be easily unit-tested without a real CM6 editor.
The following tests verify the helper functions it calls, which can be tested with
mock data.

### detectTableContextFromState (integration-ish)

This function depends on `window.__CM_LANGUAGE__` being available. In tests,
provide a mock:

```typescript
beforeEach(() => {
  // Provide a mock getCmLanguage
  (window as any).__CM_LANGUAGE__ = {
    syntaxTree: (state: any) => parser.parse(state.doc.toString()),
  };
});
```

Then test with a fake CM6-like state object:

```typescript
function fakeState(text: string, cursorPos: number) {
  return {
    doc: { toString: () => text },
    selection: { main: { head: cursorPos } },
  };
}
```

```
describe("detectTableContextFromState") {
  it("returns null when cursor outside table") {
    const state = fakeState("hello world", 5);
    expect(detectTableContextFromState(state)).toBeNull();
  }

  it("returns context when cursor inside table") {
    const doc = TABLE_3COL;
    const state = fakeState(doc, doc.indexOf("Col1") + 1);
    const ctx = detectTableContextFromState(state);
    expect(ctx).not.toBeNull();
    expect(ctx!.columnCount).toBe(3);
  }
}
```

### Debounce guard test

```
describe("updateListener debounce guard") {
  it("_enabled false → listener is no-op") {
    // This is verified by the onDisable test: after onDisable, _enabled is false.
    // The listener guard `if (!_enabled) return` is covered by module inspection.
    // Snapshot: _enabled is reset to false in onDisable (step_01 test verifies this).
  }
}
```

### EC-12 and EC-13 — visual verification

EC-12 (cursor leaves table → elements hidden) and EC-13 (editor loses focus →
elements hidden) are runtime behaviours that cannot be fully unit-tested without
a real CM6 editor. They are marked as manual verification items for the Code
Reviewer.

Document them in the test file as skipped tests with explanatory comments:

```typescript
it.skip("EC-12: floating elements hidden within 150ms when cursor leaves table", () => {
  // Runtime-only: requires a real CM6 editor and clock manipulation.
  // Verified manually during QA.
});

it.skip("EC-13: floating elements hidden immediately on editor blur", () => {
  // Runtime-only: requires a real browser focus/blur event sequence.
  // Verified manually during QA.
});
```

---

## Definition of Done

- [ ] `buildUpdateListener` fully implemented (not a stub).
- [ ] `detectTableContextFromState` implemented.
- [ ] `_blurListener` variable added to module state; wired in `onEnable`/`onDisable`.
- [ ] `getCmLanguage()` helper added (or confirmed already present).
- [ ] All testable listener tests pass.
- [ ] EC-12, EC-13 skipped with explanatory comments.
- [ ] No TypeScript errors.
- [ ] The two-rate architecture (sync position, debounced state) matches AD-8 exactly.
