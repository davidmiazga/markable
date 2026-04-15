---
title: "Image Toolbar — Step 06: CM6 updateListener + Click Delegation Wiring"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 06 — CM6 updateListener + Click Delegation Wiring, onEnable/onDisable

**Depends on:** step_01–05 (all pure functions, DOM helpers, and module-level state)
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` sections 23–26
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_06 — wiring", ...)`

This step introduces all CM6-dependent and event-listener code. The `buildUpdateListener` factory and the click/mousedown handlers are assembled here. `onEnable` and `onDisable` are also completed.

---

## Helper: `getEditorView`

```typescript
function getEditorView(): EditorViewType | undefined {
  return (window as any).__MARKABLE_EDITOR_VIEW__ as EditorViewType | undefined;
}
```

Returns `undefined` when the global is not set (test environment, EC-14). Always reads fresh — never caches (EC-25).

## Helper: `getCmView`

```typescript
function getCmView() {
  return (window as any).__CM_VIEW__ as {
    EditorView: typeof import("@codemirror/view").EditorView;
  };
}
```

## Helper: `getCmState`

```typescript
function getCmState() {
  return (window as any).__CM_STATE__ as {
    syntaxTree: typeof import("@codemirror/language").syntaxTree;
  } | undefined;
}
```

---

## `detectImageRegion` (section 18 of the file)

Full implementation as described in `step_02_image_context_detection.md`, FR-4 algorithm. Returns `Omit<ImageContext, "anchorEl"> | null`.

Key guard: if `getCmState()` is undefined, log a warning and return null. This ensures the plugin is a no-op in environments where CM globals have not been set up (EC-13 analogue for CM globals).

### `posAtDOM` try/catch (EC-15)

Inside `_onDocClick`, the position recovery must be guarded:

```typescript
let pos: number;
try {
  pos = view.posAtDOM(imgEl);
} catch (err) {
  // Fallback: scan visible ranges for a matching Image node
  pos = _fallbackPosFromImgEl(view, imgEl);
  if (pos === -1) {
    console.error("[image-toolbar] posAtDOM failed and fallback scan found no match", err);
    return;
  }
}
```

### `_fallbackPosFromImgEl(view, imgEl): number`

Internal fallback for EC-15:

1. Iterate `view.visibleRanges`.
2. For each range, use `syntaxTree(view.state).cursor()` to walk all `Image` nodes.
3. For each Image node: `const resolved = view.state.doc.sliceString(node.from, node.to)`. Extract `url` via `extractImageCore`.
4. Compare `resolveImageSrc(url)` (the Tauri asset URL form) against `imgEl.src`.
5. Return `node.from` on first match, else `-1`.

Note: `resolveImageSrc` is an internal function in `live-preview.ts` and is not importable in the plugin. The fallback uses the heuristic that `imgEl.src` ends with the URL's last path segment. This is a best-effort fallback (AD-2 specifies posAtDOM as the primary path).

---

## `buildUpdateListener`

```typescript
function buildUpdateListener() {
  const { EditorView } = getCmView();

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;
    if (!update.selectionSet && !update.docChanged) return;

    const pos = update.state.selection.main.head;
    const ctxData = detectImageRegion(update.state, pos);

    if (ctxData !== null) {
      // Cursor is on an image line.
      if (
        currentImageContext === null ||
        currentImageContext.from !== ctxData.from ||
        currentImageContext.to !== ctxData.to
      ) {
        // New image context — find anchor element and show/reposition.
        const anchorEl = _resolveAnchorForEditMode(update.view, ctxData.from);
        if (anchorEl) {
          const ctx: ImageContext = { ...ctxData, anchorEl };
          currentImageContext = ctx;
          triggerMode = "edit";
          showPopover(ctx);
        }
      }
      // else: same image context, toolbar already positioned — no action.
    } else {
      // Cursor is not on an image line.
      if (currentImageContext !== null) {
        hideToolbar();  // EC-11
      }
    }
  });
}
```

### `_resolveAnchorForEditMode(view, fromPos): HTMLElement | null`

Find the `<img class="cm-live-image">` DOM element that corresponds to document position `fromPos`.

Strategy:
1. `const imgs = view.dom.querySelectorAll("img.cm-live-image")`.
2. For each `img`: try `view.posAtDOM(img)`. On throw: skip.
3. Return the `img` whose position is `fromPos` (or within a small tolerance: `Math.abs(pos - fromPos) < 5`).
4. If no match: return `null`. When `null`, the toolbar does not open in edit mode for that image. This can happen when the image widget is not in the visible range (outside viewport).

Rationale: In edit mode, the cursor is on the image syntax, which means the image widget may not be rendered (the editor shows raw Markdown syntax when the cursor is on the line). In that case there is no `<img>` DOM element to anchor to. The toolbar position should then fall back to `view.coordsAtPos(fromPos)`:

```typescript
function _resolveAnchorForEditMode(
  view: EditorViewType,
  fromPos: number,
): HTMLElement | DOMRect | null {
  // First: try to find the actual rendered <img> element
  const imgs = view.dom.querySelectorAll("img.cm-live-image");
  for (const img of imgs) {
    try {
      const p = view.posAtDOM(img as HTMLElement);
      if (Math.abs(p - fromPos) < 5) return img as HTMLElement;
    } catch { /* skip */ }
  }

  // Fallback: use coordsAtPos to produce a pseudo-rect
  const coords = view.coordsAtPos(fromPos);
  if (!coords) return null;

  // Return a plain object that satisfies the DOMRect interface for positionPopover
  return {
    top: coords.top,
    bottom: coords.bottom,
    left: coords.left,
    right: coords.right,
    getBoundingClientRect() { return this as DOMRect; },
  } as unknown as HTMLElement;
}
```

`positionPopover` accepts `{ top, bottom, left, right }` so this works even though it is not a true `HTMLElement`.

---

## `_onDocClick` — click delegation handler

```typescript
_onDocClick = (event: MouseEvent): void => {
  const img = (event.target as Element).closest("img.cm-live-image") as HTMLElement | null;
  if (!img) return;

  const view = getEditorView();
  if (!view) return;

  let pos: number;
  try {
    pos = view.posAtDOM(img);
  } catch (err) {
    pos = _fallbackPosFromImgEl(view, img);
    if (pos === -1) {
      console.error("[image-toolbar] click: position recovery failed", err);
      return;
    }
  }

  const ctxData = detectImageRegion(view.state, pos);
  if (!ctxData) return;

  const ctx: ImageContext = { ...ctxData, anchorEl: img };
  currentImageContext = ctx;
  triggerMode = "click";
  showPopover(ctx);
};
```

---

## `_onDocMousedown` — click-away dismiss handler

```typescript
_onDocMousedown = (event: MouseEvent): void => {
  if (!currentImageContext) return;
  if (_popoverEl && _popoverEl.contains(event.target as Node)) return;
  hideToolbar();
};
```

---

## `onEnable`

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  _api = api;

  // FR-11: load settings (no-op in v1.0; hook for future extensibility)
  const raw = await api.loadSettings() as Record<string, unknown> | null;
  mergeWithDefaults(raw);  // result not stored — no settings to apply in v1.0

  // Inject CSS (idempotent — EC-17)
  injectCSS();

  // Build the popover DOM once
  _popoverEl = buildPopover();
  document.body.appendChild(_popoverEl);
  _popoverEl.style.display = "none";

  // Wire up event handlers (store as named refs for removal — NFR-3)
  _onDocClick = (event: MouseEvent) => { /* ... click delegation ... */ };
  _onDocMousedown = (event: MouseEvent) => { /* ... click-away ... */ };

  document.addEventListener("click", _onDocClick);
  document.addEventListener("mousedown", _onDocMousedown);

  // Register CM6 extension
  api.addExtensions([buildUpdateListener()]);
}
```

---

## `onDisable`

```typescript
onDisable(api: MarkablePluginAPI): void {
  _enabled = false;

  // Remove CM6 extension
  api.removeExtensions();

  // Remove popover from DOM (EC-18)
  if (_popoverEl) {
    _popoverEl.remove();
    _popoverEl = null;
  }

  // Remove document listeners using stored refs (NFR-3)
  if (_onDocClick) {
    document.removeEventListener("click", _onDocClick);
    _onDocClick = null;
  }
  if (_onDocMousedown) {
    document.removeEventListener("mousedown", _onDocMousedown);
    _onDocMousedown = null;
  }

  // Remove CSS
  removeCSS();

  // Reset all module-level state
  currentImageContext = null;
  triggerMode = null;
  _urlInput = null;
  _alignBtns = null;
  _api = null;
}
```

---

## Tests for step_06

Most tests in this step require mocking the CM6 globals. Use `vi.stubGlobal` in Vitest to set `window.__CM_VIEW__`, `window.__CM_STATE__`, and `window.__MARKABLE_EDITOR_VIEW__`.

### `_onDocClick` path (EC-9, EC-13, EC-15)

| # | Scenario | Expected |
|---|---|---|
| 6.1 | Click event target is not `.cm-live-image` | Handler returns early; `currentImageContext` remains null |
| 6.2 | `__MARKABLE_EDITOR_VIEW__` is undefined when click fires | Handler returns early; no crash (EC-14) |
| 6.3 | `view.posAtDOM` throws; fallback returns -1 | Error logged; toolbar does not open (EC-15) |
| 6.4 | Valid click on `.cm-live-image` with mocked state | `currentImageContext` is set; `triggerMode === "click"` |

### `_onDocMousedown` dismiss (FR-5)

| # | Scenario | Expected |
|---|---|---|
| 6.5 | Mousedown inside `_popoverEl` | `hideToolbar` NOT called |
| 6.6 | Mousedown outside `_popoverEl` when context is set | `hideToolbar` called; `currentImageContext` is null |
| 6.7 | Mousedown when `currentImageContext` is null | No-op; no error |

### `onEnable/onDisable` lifecycle (NFR-3, EC-17, EC-18)

| # | Scenario | Expected |
|---|---|---|
| 6.8 | Call `onEnable`; check `document.getElementById(STYLE_ID)` | Non-null |
| 6.9 | Call `onEnable` then `onDisable`; check `document.getElementById(STYLE_ID)` | Null |
| 6.10 | Call `onEnable` twice (rapid toggle) | Only one `<style>` tag in document |
| 6.11 | Call `onDisable`; check `document.querySelector("#__markable_img_toolbar__")` | Null (element removed) |
| 6.12 | Call `onEnable`, set `currentImageContext`, call `onDisable` | `currentImageContext` is null after disable |
| 6.13 | Call `onEnable` then `onDisable` three times | No duplicate listeners, no DOM leaks |

---

## Acceptance Criteria for Step 06

- [ ] All 13 test cases pass
- [ ] `onDisable` removes the popover element even when the toolbar is currently visible (EC-18)
- [ ] `posAtDOM` errors are caught; fallback attempted; if fallback fails, toolbar does not open (EC-15)
- [ ] `_onDocMousedown` does not hide when the click is inside the popover
- [ ] `document.removeEventListener` is called with the same function reference registered in `onEnable` (named refs, not anonymous) — NFR-3
- [ ] `_enabled` flag prevents the `updateListener` from running when the plugin is disabled (EC-11)
- [ ] Rapid enable/disable cycles leave no orphaned DOM nodes or event listeners (EC-17)
