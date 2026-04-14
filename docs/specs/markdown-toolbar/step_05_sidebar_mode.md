---
title: "Step 05 — Sidebar Panel Mode"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 05 — Sidebar Panel Mode

**Prerequisite:** step_04 complete and visually verified.
**Produces:** `onEnable` sidebar branch wired; `updateDisabledState`; sidebar mode visually testable.

---

## Goal

Wire the sidebar panel registration in `onEnable`. When `toolbarMode === "sidebar"`, the toolbar is registered as a `SidebarPanelDescriptor` and mounted inside the sidebar container. The toolbar is always visible; buttons are greyed out and inert when the selection is empty.

---

## Files Modified

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Add: `updateDisabledState`; fill sidebar branch in `onEnable` |

No Vitest tests added — sidebar registration and disabled-state UX are verified by visual inspection.

---

## Detailed Specification

### 1. updateDisabledState

```typescript
function updateDisabledState(
  isEmpty: boolean,
  buttons: NodeListOf<HTMLButtonElement> | null
): void {
  if (!buttons) return;
  for (const btn of buttons) {
    if (isEmpty) {
      btn.classList.add("md-toolbar__btn--disabled");
    } else {
      btn.classList.remove("md-toolbar__btn--disabled");
    }
  }
}
```

When `isEmpty === true`, all 10 buttons receive the `--disabled` class (CSS sets `opacity: 0.35; pointer-events: none`). When `isEmpty === false`, the class is removed.

This function is called by `buildUpdateListener` (step_06) on every debounced tick when `_settings.toolbarMode === "sidebar"`.

**EC-2:** In sidebar mode, when the selection is empty, all buttons are visually disabled AND pointer-events disabled — clicks are physically impossible, not just rejected in the handler.

### 2. SidebarPanelDescriptor for the toolbar

```typescript
const sidebarDescriptor: SidebarPanelDescriptor = {
  id: "markdown-toolbar",
  title: "Markdown Toolbar",
  side: _settings.sidebarSide,      // FR-7: from loaded settings
  defaultWidth: 220,

  render(container: HTMLElement): void {
    // Mount the pre-built toolbar element into the sidebar container.
    // _toolbarEl was created by buildToolbarDOM() in onEnable before
    // registerSidebarPanel is called, so it is always non-null here.
    if (_toolbarEl) {
      container.appendChild(_toolbarEl);
    }

    // Perform initial disabled-state update.
    // EC-22: if __MARKABLE_EDITOR_VIEW__ is undefined, treat selection as empty.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
      | EditorViewType
      | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */

    const isEmpty = liveView
      ? liveView.state.selection.main.empty
      : true;
    updateDisabledState(isEmpty, _buttons);
  },

  destroy(_container: HTMLElement): void {
    // The container DOM is removed by SidebarManager after this callback.
    // We do not need to explicitly remove _toolbarEl — it will be removed
    // with the container. Null the reference so onDisable does not attempt
    // to call .remove() on a detached node.
    _toolbarEl = null;
    _buttons = null;
  },
};
```

### 3. Wire sidebar branch in onEnable

Replace the `as any` placeholder from step_04:

```typescript
if (_settings.toolbarMode === "floating") {
  document.body.appendChild(_toolbarEl!);
  _toolbarEl!.style.display = "none";
} else {
  api.registerSidebarPanel(sidebarDescriptor);
  _sidebarPanelRegistered = true;
}
```

**Note:** `sidebarDescriptor` must be constructed after `_toolbarEl` and `_buttons` are assigned. It captures them via closure. The `side` field uses `_settings.sidebarSide` which is resolved from `mergeWithDefaults` earlier in `onEnable`.

### 4. Sidebar CSS considerations

In the CSS constant from step_01, the rule:

```css
.sidebar-panel-content .md-toolbar {
  position: static;
  flex-wrap: wrap;
  padding: 12px 8px;
  box-shadow: none;
  border: none;
  background: transparent;
}
```

overrides the floating-mode `position: fixed` when the toolbar is inside a sidebar panel. The `SidebarManager` gives the content container the class `sidebar-panel-content` (verify this class name against `src/sidebar/sidebar-manager.ts` before implementing — if the actual class name differs, use the correct one).

---

## Acceptance Criteria

Verified by visual inspection in the running app.

### AC-5.1: Sidebar panel appears when mode is "sidebar"
Set `toolbarMode: "sidebar"` in settings (or via `api.saveSettings` call in a dev script) → enable plugin → toolbar appears in sidebar.

### AC-5.2: Sidebar side follows sidebarSide setting
With `sidebarSide: "right"` → toolbar panel appears in the right sidebar.

### AC-5.3: Buttons disabled when selection is empty (EC-2)
No text selected → all toolbar buttons are greyed out and non-interactive.

### AC-5.4: Buttons enabled when selection is non-empty
Select text in the editor → buttons become interactive.

### AC-5.5: Bold works in sidebar mode
Select text → click Bold in sidebar toolbar → format applied correctly.

### AC-5.6: Sidebar panel removed on disable (EC-17)
Enable in sidebar mode → disable plugin → sidebar panel is unregistered, slot is empty.

### AC-5.7: Rapid toggle leaves no duplicate panels (EC-15)
Enable → disable → enable → only one "Markdown Toolbar" panel in the sidebar.

### AC-5.8: Sidebar panel visible without any selection
Panel is visible (not hidden) at all times when plugin is enabled — unlike floating mode which hides when selection is empty.

---

## Notes for the Developer

**Class name verification.** Before implementing the CSS override, check the actual CSS class applied to the sidebar panel content container. Open `src/sidebar/sidebar-manager.ts` and look for the class name assigned to the content wrapper. The blueprint uses `sidebar-panel-content` as a placeholder — update the CSS rule to match the actual class.

**`_toolbarEl = null` in destroy().** The `destroy` callback nulls `_toolbarEl` because the node will be removed from the DOM by `SidebarManager` after `destroy` returns. If `onDisable` then runs and tries to call `_toolbarEl.remove()`, the null check prevents a double-remove on an already-detached node. The `_settings.toolbarMode === "floating"` check in `onDisable` is also a guard — in sidebar mode that branch is not reached regardless.

**`_buttons = null` in destroy().** Null this too, since the button nodes are children of `_toolbarEl` which is being torn down. Step_06 and step_07 check `_buttons` for null before iterating.

**`sidebarDescriptor` construction.** The descriptor object may be created as a local `const` inside `onEnable` (just before the sidebar branch) or as a module-level variable. Using a local const is preferred — it avoids stale closure values if settings change between `onEnable` calls.
