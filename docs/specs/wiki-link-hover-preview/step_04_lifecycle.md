---
title: "Step 04 — onEnable / onDisable Lifecycle Wiring"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 04: Lifecycle Wiring in `onEnable` / `onDisable`

## Requirement Traceability

- FR-8.1 — `onEnable` attaches a single `mouseover` listener to `document` (capture phase).
- FR-8.2 — `onDisable` removes the listener, cancels timers, removes popover, calls `removeWikiPopoverStyles()`.
- FR-6.1 — Click anywhere dismisses the popover.
- EC-05 — Listener is absent when plugin is disabled.
- EC-08 — Grace period: mouseenter on popover cancels dismiss timer.

## Context

The `onEnable` and `onDisable` functions already exist (Step 9 in the plugin
file). This step adds four operations to each:

**onEnable additions:**
1. Call `injectWikiPopoverStyles()`.
2. Build and attach the hover event listener.
3. Build and attach the click-anywhere dismissal listener.

**onDisable additions:**
1. Call `dismissWikiPopover()`.
2. Remove hover and dismissal event listeners.
3. Call `removeWikiPopoverStyles()`.
4. Null the listener references.

No other changes to `onEnable` or `onDisable` are needed.

---

## onEnable Changes

### Placement

Add the hover popover setup block immediately after the existing CSS injection
calls (`injectWikiLinkStyles()` and `injectBacklinksCSS()`), before the CM6
extensions block. This is approximately at line ~1932 in the current file.

### CSS injection (FR-9.1)

Add one line after the existing CSS injection calls:

```typescript
injectWikiPopoverStyles();
```

### Hover Listener Construction (FR-8.1)

The listener is a `mouseover` handler on `document` in the capture phase. Using
`mouseover` (not `mouseenter`) with capture allows a single top-level listener
to intercept events from any `.cm-wiki-link` span, including ones created after
`onEnable` runs (as the editor's visible ranges change).

```typescript
const hoverHandler = (e: MouseEvent) => {
  if (!_enabled) return;

  // Find the closest ancestor (or self) with data-wiki-target
  const target = e.target as HTMLElement | null;
  if (!target) return;
  const spanEl = target.closest("[data-wiki-target]") as HTMLElement | null;

  // If the event is coming FROM the active popover (EC-08 mouse traversal),
  // cancel any pending dismiss timer and return without starting a new show.
  if (_activePopoverEl && (target === _activePopoverEl || _activePopoverEl.contains(target))) {
    if (_hoverDismissTimer !== null) {
      clearTimeout(_hoverDismissTimer);
      _hoverDismissTimer = null;
    }
    return;
  }

  if (!spanEl) return;

  // Cursor has moved onto a new [data-wiki-target] span.
  // Cancel any pending show or dismiss timer from a prior span.
  if (_hoverShowTimer !== null) {
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = null;
  }
  if (_hoverDismissTimer !== null) {
    clearTimeout(_hoverDismissTimer);
    _hoverDismissTimer = null;
  }

  const wikiTarget = spanEl.getAttribute("data-wiki-target");
  if (!wikiTarget) return; // EC-12: empty target guard (resolveWikiLinkPath will still handle it, but skip early)

  // Start show delay (FR-1.1)
  _hoverShowTimer = setTimeout(() => {
    _hoverShowTimer = null;
    void showWikiPopover(spanEl, wikiTarget);
  }, 180);
};

document.addEventListener("mouseover", hoverHandler, true);
_wikiLinkHoverHandler = hoverHandler;
```

### Mouseleave Listener Construction (FR-6.1 grace period, EC-08)

A separate `mouseleave` event on `document` (also capture phase) handles:
- Cursor leaves the span → start 60 ms dismiss timer.
- Cursor leaves the popover → start 60 ms dismiss timer.

```typescript
const leaveHandler = (e: MouseEvent) => {
  if (!_enabled) return;

  const target = e.target as HTMLElement | null;
  if (!target) return;

  // Case 1: mouseleave on a [data-wiki-target] span
  const isLeavingSpan = target.hasAttribute("data-wiki-target") ||
    target.closest("[data-wiki-target]") !== null;

  // Case 2: mouseleave on the active popover
  const isLeavingPopover = _activePopoverEl !== null &&
    (target === _activePopoverEl || _activePopoverEl.contains(target));

  if (!isLeavingSpan && !isLeavingPopover) return;

  // Cancel any pending show timer (FR-1.2)
  if (_hoverShowTimer !== null) {
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = null;
  }

  // If no popover is visible, nothing to dismiss
  if (!_activePopoverEl) return;

  // Start grace-period dismiss timer (FR-6.1, EC-08)
  if (_hoverDismissTimer !== null) {
    clearTimeout(_hoverDismissTimer);
  }
  _hoverDismissTimer = setTimeout(() => {
    _hoverDismissTimer = null;
    dismissWikiPopover();
  }, 60);
};

document.addEventListener("mouseleave", leaveHandler, true);
_wikiLinkHoverLeaveHandler = leaveHandler;
```

### Click-Anywhere Dismissal (FR-6.1)

This is handled as part of the existing `_wikiLinkClickHandler` already in
`onEnable`. However, the click handler only fires when the click lands on a
`.cm-wiki-link` span. A click anywhere else in the document does NOT go through
that handler.

Add a dedicated click listener for popover dismissal:

```typescript
// The existing clickHandler already calls event.preventDefault() + stopPropagation()
// on wiki-link clicks. For popover dismissal on any other click, add a document
// listener at the bubbling phase (not capture) so it fires after CM6 handles it.
//
// Note: This listener is SEPARATE from _wikiLinkClickHandler. It fires for ALL
// clicks and always calls dismissWikiPopover() if a popover is visible.
// dismissWikiPopover() is idempotent so no double-dismiss issue.
//
// Implement this by extending the existing leaveHandler to also listen for
// 'click' events, OR add it separately. The simplest approach is a separate
// anonymous function that is attached in onEnable and removed in onDisable.
```

The cleanest implementation: expand `_wikiLinkHoverLeaveHandler` to also handle
click events by registering the same handler for `"click"` at document level.
Since `dismissWikiPopover()` is idempotent, calling it twice (once from click
on a wiki-link via `_wikiLinkClickHandler` and once from this click handler) is safe.

```typescript
// Register same leaveHandler for 'click' to dismiss on any document click
document.addEventListener("click", leaveHandler, true);
```

Wait — the `leaveHandler` function above checks for `isLeavingSpan` and
`isLeavingPopover` which are `MouseEvent`-specific. For clicks, we want to
dismiss regardless. Use a **dedicated click-dismiss handler** instead:

```typescript
const clickDismissHandler = (_e: MouseEvent) => {
  if (!_enabled) return;
  if (_activePopoverEl) dismissWikiPopover();
};
document.addEventListener("click", clickDismissHandler, true);
```

Store this reference. But we already have two handler references (`_wikiLinkHoverHandler`
and `_wikiLinkHoverLeaveHandler`). We need a third? No — store the click-dismiss
handler in `_wikiLinkHoverLeaveHandler` is not clean. 

**Final decision**: Use only two handler references. Combine the `leaveHandler`
and the `clickDismissHandler` into a single function that handles multiple event
types:

```typescript
const dismissHandler = (e: Event) => {
  if (!_enabled) return;

  if (e.type === "click") {
    if (_activePopoverEl) dismissWikiPopover();
    return;
  }

  // mouseleave handling (see above)
  const me = e as MouseEvent;
  const target = me.target as HTMLElement | null;
  if (!target) return;

  const isLeavingSpan = !!(target.hasAttribute("data-wiki-target") ||
    target.closest("[data-wiki-target]"));
  const isLeavingPopover = !!(_activePopoverEl &&
    (target === _activePopoverEl || _activePopoverEl.contains(target)));

  if (!isLeavingSpan && !isLeavingPopover) return;

  if (_hoverShowTimer !== null) {
    clearTimeout(_hoverShowTimer);
    _hoverShowTimer = null;
  }

  if (!_activePopoverEl) return;

  if (_hoverDismissTimer !== null) {
    clearTimeout(_hoverDismissTimer);
  }
  _hoverDismissTimer = setTimeout(() => {
    _hoverDismissTimer = null;
    dismissWikiPopover();
  }, 60);
};

document.addEventListener("mouseleave", dismissHandler, true);
document.addEventListener("click", dismissHandler, true);
_wikiLinkHoverLeaveHandler = dismissHandler as (e: MouseEvent) => void;
```

In `onDisable`, remove both:

```typescript
if (_wikiLinkHoverLeaveHandler) {
  document.removeEventListener("mouseleave", _wikiLinkHoverLeaveHandler, true);
  document.removeEventListener("click", _wikiLinkHoverLeaveHandler, true);
  _wikiLinkHoverLeaveHandler = null;
}
```

---

## onDisable Changes

### Placement

Add cleanup after the existing `_wikiLinkClickHandler` removal block, at the
end of the `onDisable` function (approximately lines ~2113–2134).

### Additions

```typescript
// Step 10: Hover popover cleanup
dismissWikiPopover();

if (_wikiLinkHoverHandler) {
  document.removeEventListener("mouseover", _wikiLinkHoverHandler, true);
  _wikiLinkHoverHandler = null;
}
if (_wikiLinkHoverLeaveHandler) {
  document.removeEventListener("mouseleave", _wikiLinkHoverLeaveHandler, true);
  document.removeEventListener("click", _wikiLinkHoverLeaveHandler, true);
  _wikiLinkHoverLeaveHandler = null;
}
removeWikiPopoverStyles();

// Clear hover state variables (belt-and-suspenders; dismissWikiPopover handles most)
_hoverShowTimer = null;
_hoverDismissTimer = null;
_activePopoverEl = null;
```

Note: `dismissWikiPopover()` already nulls `_activePopoverEl` and clears timers.
The explicit nulling at the end is a safety net in case the module-level
variables were somehow not reset by `dismissWikiPopover` (e.g., if called from
a code path where `_activePopoverEl` was already null). This matches the
defensive pattern used for `_view`, `_lastKnownFile`, etc. at the bottom of
`onDisable`.

---

## Full `onEnable` Snippet (showing only the additions, not the full function)

Insert after `injectBacklinksCSS();` and before the CM6 extensions block:

```typescript
// Step 10: Inject hover-popover styles
injectWikiPopoverStyles();

// Step 10: Hover popover — mouseover listener (FR-8.1)
const hoverHandler = (e: MouseEvent) => {
  // ... (full implementation from above)
};
document.addEventListener("mouseover", hoverHandler, true);
_wikiLinkHoverHandler = hoverHandler;

// Step 10: Hover popover — leave/click dismiss listener (FR-6.1, FR-8.1)
const dismissHandler = (e: Event) => {
  // ... (full implementation from above)
};
document.addEventListener("mouseleave", dismissHandler, true);
document.addEventListener("click", dismissHandler, true);
_wikiLinkHoverLeaveHandler = dismissHandler as (e: MouseEvent) => void;
```

---

## Acceptance Criteria

1. After `onEnable`, hovering a `.cm-wiki-link` span for 180 ms triggers `showWikiPopover`.
2. After `onEnable`, hovering a span and leaving within 180 ms does not call `invokeReadFile`.
3. After `onEnable`, a click anywhere on the document while the popover is visible calls `dismissWikiPopover`.
4. After `onDisable`, no `mouseover` handler fires on document (listener is removed).
5. After `onDisable`, `_activePopoverEl` is null.
6. After `onDisable`, `_wikiLinkHoverHandler` is null.
7. After `onDisable`, `_wikiLinkHoverLeaveHandler` is null.
8. Rapid `onEnable` → `onDisable` → `onEnable` cycle: only one set of listeners active after the second `onEnable`.
9. EC-08: Moving cursor from span to popover within 60 ms keeps the popover visible (dismiss timer is cancelled by `mouseover` on popover).
10. EC-05: When plugin is disabled, no popover appears even if a `.cm-wiki-link` span somehow receives a `mouseover` event (the `if (!_enabled) return` guard fires).

## Implementation Notes

- The `mouseover` event (not `mouseenter`) is required because `mouseenter` does not bubble. Using capture phase (`true` as third argument) means the listener fires before any CM6 handlers, which is correct — CM6 must not prevent the event from reaching this listener.
- The `mouseleave` event is used (not `mouseout`) for span leaving because `mouseleave` does not fire when moving to a child element. However, for the popover's own mouseleave, `mouseleave` also fires only when leaving the entire popover subtree, which is the desired behavior.
- The `Event` type (not `MouseEvent`) is used for the combined `dismissHandler` signature because it handles both `mouseleave` (MouseEvent) and `click` (MouseEvent, but typed as Event for the `addEventListener` overload). Cast to `MouseEvent` inside the handler.
- Both `mouseover` handlers use capture phase (`true`). Ensure `removeEventListener` calls use the same `true` flag. A mismatched flag means the listener is never removed (silent leak).
