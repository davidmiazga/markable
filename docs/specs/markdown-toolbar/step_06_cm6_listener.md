---
title: "Step 06 — CM6 UpdateListener Wiring"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 06 — CM6 UpdateListener Wiring

**Prerequisite:** step_05 complete and visually verified.
**Produces:** `buildUpdateListener` fully implemented; toolbar positions and updates in real time.

---

## Goal

Replace the no-op `buildUpdateListener` stub from step_04 with the real implementation. After this step:
- In floating mode, the toolbar repositions immediately (synchronous) on every selection change.
- In both modes, active-state detection and disabled-state updates are debounced at 150 ms.
- The module-level `_view` is kept up to date on every transaction.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Replace `buildUpdateListener` stub with full implementation |

No new Vitest tests — the listener is a CM6 extension and is verified by visual inspection.

---

## Detailed Specification

### Full buildUpdateListener implementation

```typescript
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    // Always capture the latest view reference — cheap, always safe.
    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;

    if (!docChanged && !selChanged) return;

    // ── Synchronous: reposition floating toolbar ──────────────────────────
    // No debounce here — visual lag in the bubble position is unacceptable.
    // coordsAtPos is cheap (one line lookup).
    if (_settings.toolbarMode === "floating" && _toolbarEl) {
      updatePosition(update.view, _toolbarEl);
    }

    // ── Debounced: active state + disabled state ──────────────────────────
    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    // Snapshot state BEFORE the setTimeout so the correct doc/sel is used
    // even if CM6 discards or merges transactions during the delay.
    const docText  = update.state.doc.toString();
    const sel      = update.state.selection.main;
    const isEmpty  = sel.empty;

    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;   // plugin may have been disabled during debounce

      const flags = detectFormats(docText, sel.from, sel.to);
      updateActiveButtons(flags, _buttons);

      if (_settings.toolbarMode === "sidebar") {
        updateDisabledState(isEmpty, _buttons);
      }
    }, DEBOUNCE_MS);
  });
}
```

**Key design decisions:**

1. **Synchronous position update, debounced state update.** The NFR-2 requirement is that position recalculation runs synchronously. Active state detection is O(constant) but involves `doc.toString()` which can be O(document size) — worth debouncing at 150 ms.

2. **`_view = update.view` always runs.** Even if `!docChanged && !selChanged`, the view reference may have changed (tab switch). The guard returns early after updating `_view`, so the reference is always current.

3. **Snapshot before setTimeout.** `update.state.doc.toString()` and `update.state.selection.main` are snapshotted synchronously into `docText` and `sel`. If these were read inside the `setTimeout` callback, the CM6 state may have advanced to a newer transaction by the time the callback fires.

4. **`_enabled` guard inside setTimeout.** The plugin may be disabled during the 150 ms window (EC-16). The guard prevents `updateActiveButtons` from running on stale buttons after `onDisable` has nulled them.

### DEBOUNCE_MS constant

```typescript
const DEBOUNCE_MS = 150;
```

Defined at module scope (same as `auto-toc.plugin.ts` and `word-count.plugin.ts`). Do not hardcode 150 inside the listener body.

---

## Acceptance Criteria

Verified by visual inspection.

### AC-6.1: Toolbar repositions immediately on selection change
Drag to extend selection → toolbar follows smoothly without visible lag.

### AC-6.2: Active state updates after 150 ms debounce
Type rapidly → active state buttons update ~150 ms after typing stops.

### AC-6.3: Debounce timer cancelled on disable (EC-16)
While typing rapidly, disable the plugin → no deferred `updateActiveButtons` call fires after disable.

### AC-6.4: Toolbar does not appear when editor has no selection (EC-1)
Click in editor without selecting → toolbar stays hidden.

### AC-6.5: Active state correct after cursor moves into bold region (EC-3)
Place cursor inside `**text**` → Bold button becomes active within 150 ms.

### AC-6.6: Active state correct across tabs (EC-23)
Open a second tab, switch back → `_view` updated to the new tab's EditorView; active state reflects the new document.

---

## Notes for the Developer

**`doc.toString()` cost.** In floating mode, `doc.toString()` is called on every selection change (to feed `detectFormats`). For a 100 KB document this is a few milliseconds — acceptable. The 150 ms debounce ensures it runs at most 6–7 times per second during rapid typing. This is consistent with word-count and auto-toc behaviour.

**Why not defer position update into the debounce?** Because the toolbar would visually lag behind the selection by up to 150 ms, which feels broken. The `coordsAtPos` call is a single binary search on the line tree — it is O(log lines) and costs < 1 ms in practice.

**`update.view` vs `window.__MARKABLE_EDITOR_VIEW__`.** Inside the listener, use `update.view` directly — it is the same object. Only use `window.__MARKABLE_EDITOR_VIEW__` inside the button click handler (step_04) and the render callback (step_05), where there is no `update` parameter.
