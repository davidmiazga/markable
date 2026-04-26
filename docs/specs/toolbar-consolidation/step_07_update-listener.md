---
title: "Step 07 — Shared CM6 Update Listener"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 07 — Shared CM6 Update Listener

## What to Build

Build the single CM6 `updateListener` factory (`buildUpdateListener`) that replaces the
three separate listeners from the original plugins. This listener:

1. Guards on `_enabled`.
2. Calls `resolveContext(update)` to determine the active context.
3. Synchronously shows or hides sub-toolbars based on context (no debounce, no rAF).
4. Debounces (150 ms) only the active-button highlight recalculation.

This is the most complex section of the unified plugin. Every edge case related to
context switching, tab switching, and sidebar panel content swapping is handled here.

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Append section 12 after section 11 (context resolver).

---

## Precise Specification

### `buildUpdateListener` function

```typescript
function buildUpdateListener() {
  // Obtain the CM6 updateListener extension from window.__CM_VIEW__
  const { updateListener } = window.__CM_VIEW__;
  return updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;
    // ... body below
  });
}
```

#### Listener body — step by step

**Step 1: Capture view reference**

```typescript
_view = update.view;
```

**Step 2: Resolve context (synchronous)**

```typescript
const context: ToolbarContext = resolveContext(update);
```

**Step 3: Synchronous show/hide (no debounce — NFR-5, EC-34)**

Call the appropriate show/hide helper immediately based on context and `_settings.toolbarMode`:

```
if context === "image":
  showImageSubToolbar(update)
  hideTableSubToolbar()
  hideMarkdownSubToolbar()

else if context === "table":
  hideImageSubToolbar()
  showTableSubToolbar(update)
  hideMarkdownSubToolbar()
  if _settings.toolbarMode === "sidebar":
    swapSidebarContent("table")   // toggle div display — no re-registration

else: // "default"
  hideImageSubToolbar()
  hideTableSubToolbar()
  showMarkdownSubToolbar(update)
  if _settings.toolbarMode === "sidebar":
    swapSidebarContent("default")
```

All helpers in this step are internal functions defined in the same section.

**`showImageSubToolbar(update)`** — calls `showPopover(currentImageContext)` (which
internally calls `positionPopover`). If `currentImageContext` is null at this point,
hide and return. This path is entered when the image context was detected by
`resolveContext` in step 2.

**`hideImageSubToolbar()`** — calls `hideToolbar()` (from section 9b).

**`showTableSubToolbar(update)`**:
- In floating mode: calls `updateFloatingPositions(ctx, update.view)` and
  `updateFloatingVisibility(true)`.
- In sidebar mode: calls `swapSidebarContent("table")`.

**`hideTableSubToolbar()`**:
- In floating mode: calls `updateFloatingVisibility(false)`.
- In sidebar mode: calls `swapSidebarContent("default")`.
  Exception: only call `swapSidebarContent("default")` if leaving table context; if
  entering image context while in table context, do NOT change the sidebar panel content
  (the image popover is floating-only; EC-14).

**`showMarkdownSubToolbar(update)`**:
- In floating mode: calls `updatePosition(update.view, _toolbarEl)` (position the
  floating bubble).
- In sidebar mode: calls `swapSidebarContent("default")`.
- Then deferred button highlight update (step 4).

**`hideMarkdownSubToolbar()`**:
- In floating mode: hide `_toolbarEl` (set `display: none` or remove `.visible` class,
  matching original markdown-toolbar behaviour).
- In sidebar mode: do nothing (the panel stays visible; buttons are just not highlighted).

**`swapSidebarContent(context: "table" | "default")`** — internal helper:
```typescript
function swapSidebarContent(ctx: "table" | "default"): void {
  const mdDiv = _sidebarPanelEl?.querySelector("#unified-toolbar-md-content") as HTMLElement | null;
  const tblDiv = _sidebarPanelEl?.querySelector("#unified-toolbar-tbl-content") as HTMLElement | null;
  if (!mdDiv || !tblDiv) return;
  mdDiv.style.display  = ctx === "default" ? "" : "none";
  tblDiv.style.display = ctx === "table"   ? "" : "none";
}
```

**EC-14 — Sidebar mode, cursor on image line:**
The sidebar panel shows whichever context was active before the image was detected
(table controls if cursor was in a table, markdown buttons otherwise). The image popover
appears as a floating overlay. This means: when `context === "image"`, do NOT call
`swapSidebarContent` at all. The sidebar panel retains its previous content.

**Step 4: Debounced active-button highlight (NFR-5)**

```typescript
clearTimeout(_debounceTimer);
_debounceTimer = setTimeout(() => {
  if (!_enabled) return;
  if (context === "default" || context === "image") {
    // Markdown button highlights apply in default context.
    // In image context, no markdown buttons are highlighted.
    updateActiveButtons(_buttons, detectFormats(update.state, update.view));
    updateDisabledState(_buttons, update.state);
  } else if (context === "table") {
    // In table context, update table sidebar button states if in sidebar mode.
    if (_settings.toolbarMode === "sidebar") {
      const tblCtx = detectTableContextFromState(update);
      if (tblCtx) updateSidebarButtonStates(tblCtx);
    } else {
      // In floating mode, the top bar button states (disable guards) update here.
      const tblCtx = detectTableContextFromState(update);
      if (tblCtx) updateTopBarButtonStates(tblCtx);
    }
  }
}, DEBOUNCE_MS);
```

#### Tab-switch handling (EC-25, EC-26)

Tab switches update `window.__MARKABLE_EDITOR_VIEW__`. The next CM6 transaction on the
new view fires `updateListener`, which calls `resolveContext` on the new view. If the new
view's cursor is not on an image line, `resolveContext` returns `"table"` or `"default"`,
and `hideImageSubToolbar()` is called. No special tab-switch detection code is needed.

Document this as a comment inside the listener body.

---

## Exports

`buildUpdateListener` is not exported (internal factory). Exported for test access:
```typescript
export { swapSidebarContent };  // only if needed for step_09 integration tests
```

---

## Acceptance Criteria

### AC-7.1 — Context switch: default to table (EC-1)
When the updateListener fires with a cursor inside a GFM table (context = "table"):
- `_toolbarEl` is hidden.
- `_topBar` is visible (floating mode).

### AC-7.2 — Context switch: table to default (EC-2)
When the updateListener fires with cursor back outside the table (context = "default"):
- `_topBar`, `_rowHandle`, `_bottomPill` are hidden.
- `_toolbarEl` is shown (if selection is non-empty).

### AC-7.3 — Image wins over table (EC-3)
When cursor is on an image line inside a table:
- `resolveContext` returns `"image"`.
- `_topBar` is hidden.
- `_popoverEl` is shown.

### AC-7.4 — Return from image to table (EC-4)
When cursor moves off the image line but stays in the table:
- Next updateListener tick returns `"table"`.
- `_popoverEl` is hidden.
- `_topBar` is shown.

### AC-7.5 — Rapid context switches apply immediately (EC-34)
Ten consecutive updateListener ticks cycling through all three contexts:
- Sub-toolbar show/hide changes are applied on each tick synchronously.
- The debounce timer is reset on each tick but the sub-toolbar states are always
  correct before the debounce fires.
- After the 10th tick plus 151 ms, `updateActiveButtons` has been called exactly once
  (the debounce collapsed the 10 calls into 1).

### AC-7.6 — Sidebar mode: cursor enters table (EC-12)
`swapSidebarContent` sets `#unified-toolbar-md-content` to `display: none` and
`#unified-toolbar-tbl-content` to `display: ""`.

### AC-7.7 — Sidebar mode: cursor leaves table (EC-13)
`swapSidebarContent` reverses the display values.

### AC-7.8 — Sidebar mode: cursor on image line (EC-14)
Sidebar panel content is NOT swapped. The image popover appears floating.

### AC-7.9 — Tab switch while image popover open (EC-25)
Next updateListener tick on the new view (non-image cursor): `hideImageSubToolbar()`
is called; `_popoverEl.style.display` is `"none"`.

### AC-7.10 — Tab switch while table UI visible (EC-26)
Next updateListener tick on the new view (non-table cursor): table floating elements
are hidden.

### AC-7.11 — Sidebar mode empty selection: markdown buttons shown but not highlighted (EC-33)
In sidebar mode with an empty selection in default context: `swapSidebarContent("default")`
is called; `updateActiveButtons` is debounced and runs with no active formats.

---

## Risks and Dependencies

- **Risk**: The `showMarkdownSubToolbar` logic must preserve the exact floating-position
  calculation from the original `markdown-toolbar` (show only when selection is non-empty
  or cursor line is non-empty). Copy the condition from the original `buildUpdateListener`.
- **Risk**: EC-14 requires the sidebar panel NOT to be swapped when context is `"image"`.
  This is a new behaviour (the originals had no cross-plugin coordination). Implement the
  guard carefully: `if (context === "image") { /* do not swapSidebarContent */ }`.
- **Dependency**: Steps 05 and 06 must be complete. `resolveContext`, all show/hide
  helpers, and `swapSidebarContent` are defined or referenced from those steps.
- **Dependency**: The CM6 `updateListener` extension object is accessed via
  `window.__CM_VIEW__`. This global is set by `main.ts` before any plugin is enabled.
  No new globals are introduced (NFR-3).
