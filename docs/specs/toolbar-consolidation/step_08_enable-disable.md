---
title: "Step 08 — onEnable, onDisable, renderDetailExtra, Plugin Export"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 08 — onEnable, onDisable, renderDetailExtra, Plugin Export

## What to Build

Complete the plugin by wiring together:
1. `onEnable` — initialises all sub-toolbars based on `_settings.toolbarMode`.
2. `onDisable` — full teardown of all DOM, event listeners, CM6 extensions, and state.
3. Event handlers: `_onDocClick`, `_onDocMousedown` (image click-to-trigger path).
4. `handleAction` — dispatches CM6 transactions for all three sub-toolbars.
5. `renderDetailExtra` — the 3-way position toggle (Left / Float / Right).
6. Plugin export object.

After this step the plugin is functionally complete and can be loaded by the PluginManager.

---

## File to Modify

`src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (unified)

Append sections 13–16 at the end of the file.

---

## Precise Specification

### Section 13 — Event handlers

Port verbatim from `image-toolbar.plugin.ts` section 17:
- `_onDocClick` — the named function reference stored in the module-level variable of the
  same name. Handles click-on-rendered-image triggering the image popover.
- `_onDocMousedown` — the dismiss handler for clicks outside the popover.

The function bodies are identical to the originals. The difference is they now reside
in the unified file's closure.

Also port from `table-toolbar.plugin.ts` section 8 (`startRowDrag` is already handled
in section 9 via step_06; no additional event handlers needed for the table sub-toolbar
beyond the blur listener).

### Section 14 — Action handler

Port `handleAction` verbatim from `image-toolbar.plugin.ts` section 18. This function
handles the image popover button actions: `"embed-image"`, `"choose-file"`, and the four
alignment values.

Then add the table action dispatcher. Port `handleAction` from `table-toolbar.plugin.ts`
section 11. Because both originals define a function named `handleAction`, combine them
into a single dispatching function:

```typescript
function handleAction(action: string, payload?: unknown): void {
  // Image actions
  if (isImageAction(action)) {
    handleImageAction(action, payload);
    return;
  }
  // Table actions
  if (isTableAction(action)) {
    handleTableAction(action);
    return;
  }
  // Markdown actions are handled by button click directly (no handleAction in original)
}
```

The original `markdown-toolbar` plugin does not have a `handleAction` — its buttons
attach click handlers inline via `handleButtonClick`. Port `handleButtonClick` verbatim
from `markdown-toolbar.plugin.ts` as a private function. It is not part of the exported
`handleAction` surface.

Exports: `handleAction` (for test access, matching `image-toolbar.test.ts` imports).

### Section 15 — `onEnable`

**`onEnable` sequence:**

```
1. _enabled = true
2. const raw = await api.loadSettings()
   _settings = mergeWithDefaults(raw)
   _api = api
3. injectCSS()
4. Build DOM elements based on _settings.toolbarMode:
   a. If "floating":
      - { toolbar, buttons } = buildToolbarDOM()
        _toolbarEl = toolbar; _buttons = buttons
        toolbar.style.display = "none"
        document.body.appendChild(toolbar)
      - { topBar, rowHandle, bottomPill } = buildTopBar() / buildRowHandle() / buildBottomPill()
        _topBar = topBar; _rowHandle = rowHandle; _bottomPill = bottomPill
        [topBar, rowHandle, bottomPill].forEach(el => document.body.appendChild(el))
      - _popoverEl = buildPopover()
        _popoverEl.style.display = "none"
        document.body.appendChild(_popoverEl)
   b. If "sidebar":
      - _sidebarPanelEl = buildSidebarPanel()
        _buttons = _sidebarPanelEl.querySelector("#unified-toolbar-md-content")
                     .querySelectorAll("button[data-format]")
        api.registerSidebarPanel({
          id: "markdown-toolbar",
          title: "Toolbar",
          side: _settings.sidebarSide,
          render(container) { container.appendChild(_sidebarPanelEl!) },
          destroy() { /* no-op — panel el removed by unregister */ },
        })
        _sidebarPanelRegistered = true
      - _popoverEl = buildPopover()
        _popoverEl.style.display = "none"
        document.body.appendChild(_popoverEl)
        // Image popover is always floating (AD-5 / FR-4)
5. Add window blur listener (floating mode only):
   _blurListener = () => { updateFloatingVisibility(false); hideToolbar(); }
   if "floating": window.addEventListener("blur", _blurListener, true)
6. Add document listeners for image click path:
   _onDocClick = (...) => { ... }  // image click trigger
   _onDocMousedown = (...) => { ... }  // outside-click dismiss
   document.addEventListener("click", _onDocClick)
   document.addEventListener("mousedown", _onDocMousedown)
7. Add editor blur listener:
   _onEditorBlur = () => hideToolbar()
   getEditorView()?.dom?.addEventListener("blur", _onEditorBlur)
8. api.addExtensions([buildUpdateListener()])
```

### Section 15 — `onDisable`

**`onDisable` sequence (exact reversal of onEnable — EC-6, EC-7, EC-8, EC-9):**

```
1. _enabled = false
   const mode = _settings.toolbarMode  // capture before reset
2. clearTimeout(_debounceTimer); _debounceTimer = null
3. Cancel drag:
   _dragIndicator?.remove(); _dragIndicator = null
4. api.removeExtensions()
5. Remove document listeners:
   document.removeEventListener("click", _onDocClick)
   document.removeEventListener("mousedown", _onDocMousedown)
   _onDocClick = null; _onDocMousedown = null
6. Remove editor blur listener:
   getEditorView()?.dom?.removeEventListener("blur", _onEditorBlur)
   _onEditorBlur = null
7. Remove window blur listener:
   if _blurListener:
     window.removeEventListener("blur", _blurListener, true)
     _blurListener = null
8. Mode-specific DOM teardown:
   if "floating":
     _toolbarEl?.remove()
     [_topBar, _rowHandle, _bottomPill].forEach(el => el?.remove())
     _popoverEl?.remove()
   if "sidebar":
     _popoverEl?.remove()  // image popover is always in body regardless of mode
     if _sidebarPanelRegistered:
       api.unregisterSidebarPanel("markdown-toolbar")
       _sidebarPanelRegistered = false
9. removeCSS()
10. Reset ALL module-level state to initial values:
    _enabled = false; _settings = {...DEFAULT_SETTINGS}; _api = null
    _view = null; _toolbarEl = null; _buttons = null; _clickInFlight = false
    _topBar = null; _rowHandle = null; _bottomPill = null
    _sidebarPanelEl = null; _debounceTimer = null; _blurListener = null
    _popoverEl = null; currentImageContext = null; triggerMode = null
    _onDocClick = null; _onDocMousedown = null; _onEditorBlur = null
    _urlInput = null; _alignBtns = null
```

### Section 15 — `renderDetailExtra`

Port verbatim from `markdown-toolbar.plugin.ts` `renderDetailExtra`. The 3-way position
toggle (Left / Float / Right) is identical — unified settings use the same `toolbarMode`
and `sidebarSide` fields. The image sub-toolbar has no position toggle (AD-5); the
combined `renderDetailExtra` renders only the single position control.

### Section 16 — Plugin export object

```typescript
export default {
  id:             "markdown-toolbar",
  name:           "Markdown Toolbar",
  version:        "2.0.0",
  description:    "Context-sensitive toolbar: formatting, table management, and image controls",
  detail:
    "Unified toolbar that switches automatically based on cursor context. " +
    "Shows formatting buttons by default, table management controls when inside a table, " +
    "and an image popover when on an image line. Available as a floating bubble (default) " +
    "or a docked sidebar panel.",
  sidebarPanelId: "markdown-toolbar",
  renderDetailExtra,
  onEnable,
  onDisable,
};
```

Note: `sidebarPanelId` is always set (even in floating mode) so the Plugins Panel can
show the Left / Right toggle in the detail view. This is consistent with the original
`markdown-toolbar` and `table-toolbar` behaviour.

---

## Acceptance Criteria

### AC-8.1 — Plugin disabled while image popover visible (EC-6)
Call `onEnable`, trigger image popover, then `onDisable`. After disable:
- `_popoverEl` is `null`.
- `document.body` does not contain any `.img-toolbar` element.

### AC-8.2 — Plugin disabled while table floating UI visible (EC-7)
Call `onEnable` in floating mode, trigger table context, then `onDisable`. After disable:
- `_topBar`, `_rowHandle`, `_bottomPill` are all `null`.
- `document.body` contains none of them.

### AC-8.3 — Plugin disabled while markdown toolbar visible (EC-8)
Call `onEnable` in floating mode, trigger markdown toolbar, then `onDisable`. After disable:
- `_toolbarEl` is `null`.
- `document.body` does not contain any `.md-toolbar` element.

### AC-8.4 — Rapid enable/disable/enable (EC-9)
Three cycles of `onEnable` → `onDisable` → `onEnable`:
- Exactly one `<style id="__markable_unified_toolbar_css__">` element in `document.head`.
- No orphaned `.md-toolbar`, `.tbl-toolbar`, or `.img-toolbar` elements in `document.body`.
- `api.addExtensions` called exactly 3 times total (once per enable).
- `api.removeExtensions` called exactly 2 times total (once per disable).

### AC-8.5 — Mode change floating to sidebar (EC-10)
After `saveSettings({ toolbarMode: "sidebar" })` and `api.restartSelf()`:
- No `.md-toolbar`, `.tbl-toolbar` in `document.body`.
- The sidebar panel is registered with `api.registerSidebarPanel`.
- `_popoverEl` is still appended to `document.body` (image popover is always floating).

### AC-8.6 — Mode change sidebar to floating (EC-11)
After `saveSettings({ toolbarMode: "floating" })` and `api.restartSelf()`:
- The sidebar panel is unregistered.
- `.md-toolbar` and `.tbl-toolbar` elements are present in `document.body`.

### AC-8.7 — Drag indicator removed on disable (EC-30)
Set `_dragIndicator` to a DOM element during a row drag; then call `onDisable`.
`_dragIndicator` is `null` and the element is not in `document.body`.

### AC-8.8 — sidebarSide change triggers restart (EC-32)
`renderDetailExtra` clicking "Right" when current side is "left":
- `api.saveSettings` called with `{ toolbarMode: "sidebar", sidebarSide: "right" }`.
- `api.restartSelf()` called.

### AC-8.9 — Plugin export id is "markdown-toolbar"
`pluginExport.id === "markdown-toolbar"`.

### AC-8.10 — onEnable loads settings from "markdown-toolbar" namespace only (EC-18)
`api.loadSettings()` is called exactly once during `onEnable`. The settings namespace is
determined by the plugin ID (`"markdown-toolbar"`) which is captured in the API factory.
No call to load settings for `"table-toolbar"` or `"image-toolbar"`.

---

## Risks and Dependencies

- **Risk**: Forgetting to add the image popover to `document.body` in sidebar mode
  (`onEnable` step 4b). The image popover is always floating regardless of mode (AD-5).
  A regression here would make the image toolbar invisible in sidebar mode.
- **Risk**: `unregisterSidebarPanel` called with wrong panel ID. The ID must be
  `"markdown-toolbar"` (matching the `registerSidebarPanel` call). The original
  table-toolbar used `"table-toolbar"` as its panel ID — this must be updated.
- **Risk**: State variables not fully reset in `onDisable`. The reset list in the spec
  above is exhaustive; cross-check against the combined state declaration in section 3
  (step_01) to ensure every variable is listed.
- **Dependency**: All previous steps must be complete. `onEnable` calls functions from
  sections 4, 9, 10, 12, 13, 14. `onDisable` calls functions from sections 4, 9b, 10.
