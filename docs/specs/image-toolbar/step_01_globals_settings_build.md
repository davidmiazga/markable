---
title: "Image Toolbar — Step 01: Globals, Settings, CSS, Build"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 01 — Globals, Settings, CSS Lifecycle, and Build System

**Depends on:** nothing
**Produces:**
- `src/plugins/image-toolbar/image-toolbar.plugin.ts` (skeleton with sections 1–5)
- `tests/plugins/image-toolbar/image-toolbar.test.ts` (step_01 suite)
- Modified: `src/main.ts`
- Modified: `vite.plugins.config.ts`
- Modified: `scripts/build-plugins.mjs`

---

## 1. Expose window globals in `src/main.ts`

### 1a. Import `dialogOpen`

At the top of `main.ts`, alongside the existing Tauri imports, add:

```typescript
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
```

### 1b. Expose `__TAURI_DIALOG__`

Immediately after line 776 (the `__MARKABLE_EDITOR_VIEW__` assignment), add:

```typescript
(window as unknown as Record<string, unknown>)["__TAURI_DIALOG__"] = { open: dialogOpen };
```

### 1c. Expose `__MARKABLE_CURRENT_FILE__`

`setLivePreviewFilePath` is called in `tab-manager.ts`, not `main.ts`. The correct exposure point is `tab-manager.ts`. Open `src/tabs/tab-manager.ts` and add the global write immediately after **each** call to `setLivePreviewFilePath(...)`:

**In `_applyActiveTab()` (~line 235):**

```typescript
setLivePreviewFilePath(tab.filePath);
(window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = tab.filePath;
```

**In `afterSaveAs()` (~line 677):**

```typescript
setLivePreviewFilePath(path);
(window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = path;
```

`tab.filePath` is `string | null` — untitled tabs have `null`, which is the correct value for the global in that case.

---

## 2. Create the plugin file skeleton

Create `src/plugins/image-toolbar/image-toolbar.plugin.ts` with these sections in order:

### Section 1 — Type-only imports

```typescript
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

No value imports from `@codemirror/*` or any app-internal module.

### Section 2 — Settings types and defaults

```typescript
/** Persisted settings for the Image Toolbar plugin. No user-configurable fields in v1.0. */
export interface ImageToolbarSettings {
  // reserved for future fields (e.g. defaultAlignment)
}

export const DEFAULT_SETTINGS: ImageToolbarSettings = {};

/**
 * Merge raw persisted data with defaults.
 * EC-19: null input → returns empty settings object (no crash).
 */
export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): ImageToolbarSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS };
}
```

### Section 3 — Module-level state declarations

```typescript
let _enabled: boolean = false;
let _api: MarkablePluginAPI | null = null;
let _popoverEl: HTMLElement | null = null;
let currentImageContext: ImageContext | null = null;  // ImageContext defined in step_02
let triggerMode: "edit" | "click" | null = null;
let _onDocClick: ((e: MouseEvent) => void) | null = null;
let _onDocMousedown: ((e: MouseEvent) => void) | null = null;
```

Note: `ImageContext` is declared in step_02. Place the interface definition before this state block in the final file.

### Section 4 — CSS constant

```typescript
export const STYLE_ID = "__markable_img_toolbar_css__";

const TOOLBAR_CSS = `
.img-toolbar {
  position: fixed;
  z-index: 10000;
  display: none;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent);
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
  min-width: 220px;
}

.img-toolbar__tabs {
  display: flex;
  gap: 0;
  border-bottom: 1px solid color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin-bottom: 4px;
}

.img-toolbar__tab {
  flex: 1;
  padding: 4px 8px;
  border: none;
  border-bottom: 2px solid transparent;
  background: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: -1px;
}

.img-toolbar__tab--active {
  border-bottom-color: var(--accent-color);
  color: var(--text-primary);
}

.img-toolbar__panel {
  display: flex;
  gap: 6px;
  align-items: center;
}

.img-toolbar__input {
  flex: 1;
  padding: 4px 8px;
  background: var(--bg-chrome);
  border: 1px solid color-mix(in srgb, var(--text-primary) 20%, transparent);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 12px;
  outline: none;
}

.img-toolbar__input:focus {
  border-color: var(--accent-color);
}

.img-toolbar__btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: var(--selection-bg);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.img-toolbar__btn:hover {
  background: var(--accent-color);
  color: var(--bg-primary);
}

.img-toolbar__divider {
  height: 1px;
  background: color-mix(in srgb, var(--text-primary) 12%, transparent);
  margin: 2px 0;
}

.img-toolbar__align-group {
  display: flex;
  gap: 4px;
}

.img-toolbar__align-btn {
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 4px;
  background: none;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.img-toolbar__align-btn:hover {
  background: var(--selection-bg);
}

.img-toolbar__align-btn--active {
  background: var(--accent-color);
  color: var(--bg-primary);
}
`;
```

### Section 5 — CSS lifecycle helpers

```typescript
/**
 * Inject the toolbar <style> tag if not already present.
 * Idempotent: multiple calls are safe (EC-17).
 */
export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

/**
 * Remove the toolbar <style> tag by id.
 * Safe to call even if the tag was never inserted.
 */
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}
```

---

## 3. Update build system files

### `scripts/build-plugins.mjs`

Add one entry to the `PLUGINS` array after the `table-toolbar` entry:

```javascript
["image-toolbar", "src/plugins/image-toolbar/image-toolbar.plugin.ts"],
```

Update the final log message from:

```javascript
console.log("\n[build-plugins] All 7 core plugins built successfully.");
```

to:

```javascript
console.log("\n[build-plugins] All 8 core plugins built successfully.");
```

### `vite.plugins.config.ts`

Add one `pluginConfig(...)` call after the `table-toolbar` entry (with `clearOutput: false`):

```typescript
pluginConfig(
  "image-toolbar",
  resolve(__dirname, "src/plugins/image-toolbar/image-toolbar.plugin.ts"),
  false,
),
```

Also update the top-of-file comment from "six per-plugin configs" to "seven per-plugin configs" (or "seven built-in plugins" — match the surrounding comment style).

---

## 4. Tests for step_01

File: `tests/plugins/image-toolbar/image-toolbar.test.ts`

Test suite: `describe("step_01 — settings and CSS lifecycle", ...)`

### Test cases

**mergeWithDefaults**

| # | Input | Expected output |
|---|---|---|
| 1.1 | `null` | `{}` (no crash, returns defaults) |
| 1.2 | `{}` | `{}` |
| 1.3 | `{ unknownKey: "foo" }` | `{}` (unknown keys dropped) |

**STYLE_ID**

| # | Assertion |
|---|---|
| 1.4 | `STYLE_ID === "__markable_img_toolbar_css__"` |

**injectCSS / removeCSS**

| # | Scenario | Expected |
|---|---|---|
| 1.5 | Call `injectCSS()` once | `document.getElementById(STYLE_ID)` is non-null |
| 1.6 | Call `injectCSS()` twice | Only one `<style>` tag with that id exists in `document.head` |
| 1.7 | Call `injectCSS()` then `removeCSS()` | `document.getElementById(STYLE_ID)` is null |
| 1.8 | Call `removeCSS()` when not injected | No crash |

**window globals (integration check)**

These tests do not test the Tauri runtime but verify the exposure contract:

| # | Scenario | Expected |
|---|---|---|
| 1.9 | `(window as any).__TAURI_DIALOG__` is set in test env | Either defined (if main.ts runs) or `undefined` — the plugin must handle both without crash (EC-13) |

---

## Acceptance Criteria for Step 01

- [ ] `mergeWithDefaults(null)` returns `{}` without throwing
- [ ] `injectCSS()` called twice produces exactly one `<style id="__markable_img_toolbar_css__">` tag
- [ ] `removeCSS()` removes the tag; second call is a no-op
- [ ] `vite.plugins.config.ts` has an `image-toolbar` entry
- [ ] `build-plugins.mjs` has an `image-toolbar` entry and says "All 8 core plugins"
- [ ] `main.ts` sets `window.__TAURI_DIALOG__`
- [ ] `tab-manager.ts` sets `window.__MARKABLE_CURRENT_FILE__` at both call-sites of `setLivePreviewFilePath`
- [ ] `npm run build:plugins` completes without error and produces `src-tauri/plugins/core/image-toolbar.js`
