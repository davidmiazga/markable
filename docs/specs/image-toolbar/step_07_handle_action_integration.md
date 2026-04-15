---
title: "Image Toolbar — Step 07: handleAction, Integration Tests, renderDetailExtra"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 07 — handleAction, Integration Tests, renderDetailExtra

**Depends on:** step_01–06 (all pure functions, DOM, CM6 wiring, onEnable/onDisable)
**Adds to:** `src/plugins/image-toolbar/image-toolbar.plugin.ts` section 26 (plugin export object)
**Tests:** `tests/plugins/image-toolbar/image-toolbar.test.ts` — `describe("step_07 — handleAction and integration", ...)`

This is the final step. It completes the plugin by wiring all buttons to their dispatch actions via `handleAction`, completes the plugin export object, and adds integration-level tests.

---

## `handleAction(action: string): void`

The single routing function called by the popover's delegated click listener. All button data-action strings route here.

```typescript
export function handleAction(action: string): void
```

Rules (all actions):
- Read `getEditorView()` fresh — never use a cached view (EC-25).
- If view is undefined: return silently (EC-14).
- If `currentImageContext` is null: return silently.
- After a successful dispatch: call `hideToolbar()`.

### Action: `"choose-file"` (FR-2a)

```typescript
case "choose-file": {
  const dialog = (window as any).__TAURI_DIALOG__;
  if (!dialog?.open) {
    console.warn("[image-toolbar] __TAURI_DIALOG__ not available");
    return; // EC-13 — toolbar stays open, no crash
  }

  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null | undefined;

  dialog.open({
    multiple: false,
    filters: [{
      name: "Images",
      extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg"],
    }],
  }).then((selectedPath: string | null) => {
    if (!selectedPath) return; // EC-12 — user cancelled; toolbar stays open

    const docPath = currentFile ?? null;
    const resolvedUrl = resolveRelativePath(selectedPath, docPath ?? null);

    const view = getEditorView();
    if (!view || !currentImageContext) return;

    const { from, to, rawSource } = currentImageContext;
    const newSource = replaceImageSrc(rawSource, resolvedUrl);
    view.dispatch({ changes: { from, to, insert: newSource } });
    hideToolbar();
  }).catch((err: unknown) => {
    console.error("[image-toolbar] dialog.open() failed", err);
  });

  break;
  // Note: toolbar does NOT close immediately — it closes after the async dialog resolves.
}
```

### Action: `"embed-image"` (FR-2b)

```typescript
case "embed-image": {
  if (!currentImageContext) return;
  const newUrl = _urlInput?.value?.trim() ?? "";

  // EC-20: unchanged URL — no dispatch
  // EC-21: empty input — no dispatch
  if (!newUrl || newUrl === currentImageContext.url) return;

  const view = getEditorView();
  if (!view) return;

  const { from, to, rawSource } = currentImageContext;
  const newSource = replaceImageSrc(rawSource, newUrl);
  view.dispatch({ changes: { from, to, insert: newSource } });
  hideToolbar();
  break;
}
```

### Actions: `"align-left"`, `"align-center"`, `"align-right"`, `"align-float-right"` (FR-3)

```typescript
case "align-left":
case "align-center":
case "align-right":
case "align-float-right": {
  if (!currentImageContext) return;
  const view = getEditorView();
  if (!view) return;

  const alignMap: Record<string, AlignmentState> = {
    "align-left": "left",
    "align-center": "center",
    "align-right": "right",
    "align-float-right": "float-right",
  };
  const alignment = alignMap[action];
  const { from, to, rawSource } = currentImageContext;
  const newSource = applyAlignment(rawSource, alignment);

  view.dispatch({ changes: { from, to, insert: newSource } });
  hideToolbar();
  break;
}
```

### Default

```typescript
default:
  // Unknown action — no-op. Log in development.
  console.warn("[image-toolbar] unknown action:", action);
  break;
```

---

## `renderDetailExtra` (AD-5)

The Image Toolbar is floating-only — no sidebar mode. `renderDetailExtra` returns `null`.

```typescript
renderDetailExtra(): null {
  return null;
}
```

This satisfies the `MarkablePluginAPI` interface without requiring any sidebar toggle UI. The Plugins Panel will show no position toggle for this plugin.

---

## Plugin export object

```typescript
const __markablePlugin__ = {
  id: "image-toolbar",
  name: "Image Toolbar",
  version: "1.0.0",
  description: "Floating toolbar for aligning images and replacing image sources.",
  detail: "Shows a popover toolbar when you click a rendered image or move the cursor onto an image syntax line. Lets you change the image source (by picking a file or entering a URL) and set alignment to Left, Center, Right, or Float Right.",
  // sidebarPanelId omitted — floating only (AD-5)

  async onEnable(api: MarkablePluginAPI): Promise<void> {
    // ... (completed in step_06)
  },

  onDisable(api: MarkablePluginAPI): void {
    // ... (completed in step_06)
  },

  renderDetailExtra(): null {
    return null;
  },
};
```

---

## Tests for step_07

### `handleAction` — alignment actions

For these tests, set up `currentImageContext` with a known `rawSource` and mock `view.dispatch` with `vi.fn()`.

| # | Setup | Action | Expected dispatch |
|---|---|---|---|
| 7.1 | rawSource=`"![photo](a.png)"`, alignment=`"left"` | `"align-left"` | `dispatch` called with `insert: "![photo](a.png)"` (EC-5) |
| 7.2 | rawSource=`"![photo](a.png)"` | `"align-center"` | `insert: '<div align="center">![photo](a.png)</div>'` |
| 7.3 | rawSource=`"![photo](a.png)"` | `"align-right"` | `insert: '<div align="right">![photo](a.png)</div>'` |
| 7.4 | rawSource=`"![photo](a.png)"` | `"align-float-right"` | `insert: '<img src="a.png" alt="photo" align="right" style="float:right; margin:0 0 8px 16px">'` |
| 7.5 | rawSource=`'<div align="center">![photo](a.png)</div>'` | `"align-left"` | `insert: "![photo](a.png)"` (EC-1) |
| 7.6 | rawSource=float-right `<img>` form | `"align-center"` | `insert: '<div align="center">![photo](a.png)</div>'` (EC-4) |
| 7.7 | After dispatch | any alignment action | `hideToolbar()` called (ctx is null) |

### `handleAction` — embed-image action

| # | Setup | Expected |
|---|---|---|
| 7.8 | `_urlInput.value = ""` | No dispatch emitted (EC-21) |
| 7.9 | `_urlInput.value = "same.png"`, `ctx.url = "same.png"` | No dispatch (EC-20) |
| 7.10 | `_urlInput.value = "new.png"`, `ctx.url = "old.png"` | dispatch called with `insert: "![photo](new.png)"` |
| 7.11 | After successful embed dispatch | `hideToolbar()` called |
| 7.12 | `view` is undefined | No crash (EC-14) |

### `handleAction` — choose-file action

| # | Setup | Expected |
|---|---|---|
| 7.13 | `__TAURI_DIALOG__` is undefined | Console.warn logged; no crash; toolbar stays open (EC-13) |
| 7.14 | dialog.open resolves with null | No dispatch emitted; toolbar stays open (EC-12) |
| 7.15 | dialog.open resolves with `"/Users/dm/Notes/img.png"`, `__MARKABLE_CURRENT_FILE__ = "/Users/dm/Notes/doc.md"` | dispatch with `insert: "![photo](./img.png)"` (EC-6) |
| 7.16 | dialog.open resolves with `"/Other/img.png"`, `__MARKABLE_CURRENT_FILE__ = "/Users/dm/Notes/doc.md"` | dispatch with `insert: "![photo](/Other/img.png)"` (EC-7) |
| 7.17 | `__MARKABLE_CURRENT_FILE__` is null | dispatch with absolute path (EC-8) |
| 7.18 | Path contains spaces: `"/path/my photo.png"`, null doc | dispatch with `insert: "![photo](/path/my photo.png)"` (EC-31 — no encoding) |

### `handleAction` — guard conditions

| # | Scenario | Expected |
|---|---|---|
| 7.19 | `currentImageContext` is null | No dispatch; no crash |
| 7.20 | `getEditorView()` returns undefined | No dispatch; no crash (EC-14) |
| 7.21 | Unknown action string passed | console.warn; no crash |

### `renderDetailExtra`

| # | Scenario | Expected |
|---|---|---|
| 7.22 | `__markablePlugin__.renderDetailExtra()` | Returns `null` |

### Single-dispatch guarantee (NFR-4)

| # | Scenario | Expected |
|---|---|---|
| 7.23 | Any alignment action with valid context | Exactly 1 call to `view.dispatch`; never 2 |
| 7.24 | Embed image action with changed URL | Exactly 1 call to `view.dispatch` |

---

## Full edge case test summary

The following EC numbers require explicit test methods (not covered by earlier steps):

| EC | Test # | Step |
|---|---|---|
| EC-9 (click-triggered mode dismisses on click-away, not cursor move) | 6.6 (mousedown outside) | step_06 |
| EC-12 (dialog cancelled → no dispatch) | 7.14 | step_07 |
| EC-13 (__TAURI_DIALOG__ undefined) | 7.13 | step_07 |
| EC-14 (__MARKABLE_EDITOR_VIEW__ undefined) | 7.20 | step_07 |
| EC-20 (embed unchanged URL) | 7.9 | step_07 |
| EC-21 (embed empty input) | 7.8 | step_07 |
| EC-22 / EC-27 (CRLF preserved) | 3.11 (detectLineEnding) | step_03 |
| EC-25 (fresh view read on each action) | 7.23 uses fresh mock | step_07 |
| EC-31 (no URL-encoding) | 7.18 | step_07 |
| EC-32 (clicking active alignment still dispatches) | 7.1 (align-left on already-left) | step_07 |

---

## Acceptance Criteria for Step 07

- [ ] All 24 test cases pass
- [ ] `handleAction("align-*")` always calls `view.dispatch` exactly once (NFR-4)
- [ ] `handleAction("embed-image")` skips dispatch for empty or unchanged URL (EC-20, EC-21)
- [ ] `handleAction("choose-file")` skips dispatch when dialog returns null (EC-12)
- [ ] `handleAction("choose-file")` degrades gracefully when `__TAURI_DIALOG__` is undefined (EC-13)
- [ ] `resolveRelativePath` is applied inside `"choose-file"` with the `__MARKABLE_CURRENT_FILE__` global (FR-2a)
- [ ] `renderDetailExtra()` returns `null` (AD-5)
- [ ] Plugin export object has all required fields: `id`, `name`, `version`, `description`, `detail`, `onEnable`, `onDisable`, `renderDetailExtra`
- [ ] `sidebarPanelId` is absent from the plugin export object (AD-5)
