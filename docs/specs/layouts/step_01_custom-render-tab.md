---
title: "Step 01 — Custom Render Tab Infrastructure"
last-updated: "2026-05-06"
review-cadence-days: 14
status: active
---

# Step 01 — Custom Render Tab Infrastructure

Delivers FR-01 through FR-11 from the requirements: the `"custom"` TabKind,
`#custom-tab-host` DOM element, `openCustomRenderTab()` method on TabManager and
MarkablePluginAPI, three new window globals, and the `handleAction()` extension
map. No Part B code is written in this step.

---

## Files to Modify

1. `src/tabs/tab-types.ts`
2. `src/tabs/tab-manager.ts`
3. `src/tabs/tabs.css`
4. `src/plugins/markable-plugin-api.ts`
5. `src/main.ts`
6. `index.html`

---

## 1. `src/tabs/tab-types.ts`

### Change: extend `TabKind`

Replace:

```typescript
export type TabKind = "editor" | "media";
```

With:

```typescript
export type TabKind = "editor" | "media" | "custom";
```

### Change: add `renderFn?` to `TabEntry`

Add the following field to `TabEntry` after the `pinned?` field:

```typescript
/**
 * Render callback for custom tabs. Called once by TabManager immediately
 * after #custom-tab-host is activated and cleared.
 *
 * Only present when kind === "custom". Never serialized to session storage.
 * Must not throw — TabManager wraps the call in try/catch (FR-04, EC-15).
 */
renderFn?: (container: HTMLElement) => void;
```

Implementation notes:
- No default value. `undefined` is the natural absent state.
- TypeScript will correctly narrow `renderFn` to defined inside `if (tab.kind === "custom")` blocks.

---

## 2. `src/tabs/tab-manager.ts`

### Change A: store `#custom-tab-host` reference in `init()`

In the `init()` method, after the `this.mediaViewerEl` assignment block, add:

```typescript
/** The #custom-tab-host DOM element. Never removed from DOM (FR-03). */
private customTabHostEl: HTMLElement | null = null;
```

(This field declaration belongs with the other private fields at the top of the class.)

In `init()`, after the `#media-viewer` injection block, add:

```typescript
// Locate #custom-tab-host (must exist in index.html — FR-03).
// Unlike #media-viewer which is created by init(), this element is static HTML.
this.customTabHostEl = document.getElementById("custom-tab-host");
if (!this.customTabHostEl) {
  console.error(
    "TabManager.init: #custom-tab-host element not found in DOM. " +
    "Ensure index.html has been updated per step_01_custom-render-tab.md."
  );
}
```

### Change B: add `openCustomRenderTab()` public method

Add the following method to `TabManager` after `openMediaInTab()`:

```typescript
/**
 * Open a custom render tab with the given title and render function.
 *
 * If a custom tab with the same title already exists it is replaced in-place
 * (same array index, new renderFn) — prevents duplicate render tabs (DC-07).
 *
 * Clears #custom-tab-host, calls renderFn(hostEl), and activates the tab.
 * If renderFn throws, a fallback error message is shown in #custom-tab-host
 * and the tab remains active (EC-15).
 *
 * EC-25: if #custom-tab-host is absent from the DOM, logs a console error
 * and returns without opening a tab.
 *
 * @param title     Display title shown in the tab strip.
 * @param renderFn  Callback that populates the host element with HTML.
 */
openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void {
  // EC-25: host element must exist.
  const hostEl = this.customTabHostEl ?? document.getElementById("custom-tab-host");
  if (!hostEl) {
    console.error("TabManager.openCustomRenderTab: #custom-tab-host not in DOM.");
    return;
  }

  this._captureActiveTab();

  // DC-07: replace an existing custom tab with the same title in-place.
  const existingIdx = this.tabs.findIndex(
    (t) => t.kind === "custom" && t.title === title
  );

  if (existingIdx !== -1) {
    // Replace renderFn in-place; do not append a new tab entry.
    this.tabs[existingIdx].renderFn = renderFn;
    this.activeIndex = existingIdx;
  } else {
    const tab: TabEntry = {
      id: crypto.randomUUID(),
      kind: "custom",
      filePath: null,
      title,
      isDirty: false,
      doc: "",
      scrollTop: 0,
      renderFn,
    };
    this.tabs.push(tab);
    this.activeIndex = this.tabs.length - 1;
  }

  // Clear host and render.
  hostEl.innerHTML = "";
  try {
    renderFn(hostEl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    hostEl.innerHTML = `<div class="layout-error">Render error: ${msg}</div>`;
  }

  // Show the custom tab host, hide the editor.
  document.body.classList.add("has-custom-tab");
  this._updateTitleBar(this.tabs[this.activeIndex]);
  this._notifyRenderer();
  void this.saveSession();
}
```

### Change C: handle `kind === "custom"` in `_applyActiveTab()`

In `_applyActiveTab()`, add a custom-tab branch after the existing media-tab
branch (after the `if (tab.kind === "media")` block and before the editor
branch):

```typescript
if (tab.kind === "custom") {
  // Hide editor; show custom tab host.
  this.editorContainer?.classList.remove("has-media-tab");
  document.body.classList.add("has-custom-tab");
  this._updateTitleBar(tab);
  // AD-6: custom tabs have no meaningful file path.
  (window as unknown as Record<string, unknown>)["__MARKABLE_CURRENT_FILE__"] = null;
  return;
}
```

Also update the editor-tab branch: add `document.body.classList.remove("has-custom-tab");`
at the start of the editor branch, alongside the existing `this.editorContainer?.classList.remove("has-media-tab");` call.

Update the zero-tab guard at the top of `_applyActiveTab()` to also remove
`has-custom-tab`:

```typescript
// In the zero-tab guard:
this.editorContainer?.classList.remove("has-media-tab");
document.body.classList.remove("has-custom-tab");
```

### Change D: skip dirty-check for custom tabs in `closeTab()`

In `closeTab()`, the media-tab dirty-check guard currently reads:

```typescript
if (tab.isDirty && tab.kind !== "media") {
```

Change both occurrences (last-tab and multi-tab branches) to:

```typescript
if (tab.isDirty && tab.kind !== "media" && tab.kind !== "custom") {
```

Custom tabs are always clean (FR-07), so `isDirty` will always be `false` on
them. This change is defensive belt-and-suspenders.

### Change E: exclude custom tabs from `saveSession()`

In `saveSession()`, the existing filter already excludes non-editor tabs:

```typescript
const openFiles = this.tabs
  .filter((t) => t.kind === "editor" && t.filePath !== null)
  ...
```

This filter already excludes `"custom"` tabs because it requires `kind === "editor"`.
No additional change is needed in `saveSession()`.

However, `init()` session restore reads `settings.openFiles` which may contain
stale `"custom"` entries from a hypothetical future where they were accidentally
persisted. Add a defensive guard in the restore loop:

```typescript
// In init(), in the session restore for-of loop, before pushing to this.tabs:
// (the openFiles entries will never have kind: "custom" because saveSession
//  excludes them, but guard defensively — FR-06)
```

The existing `readFile` call already guards against missing files. Since
session entries only have `filePath` + `scrollTop` + optional `pinned`, there
is no `kind` field to check. The defensive handling is already provided by the
"silent skip on read failure" pattern.

---

## 3. `src/tabs/tabs.css`

Append the following block at the end of `tabs.css` (after the media-viewer
section):

```css
/* ── Custom render tab host ──────────────────────────────────────────────── */
/*
 * #custom-tab-host is a permanent sibling of #editor inside #app.
 * Default state: hidden. Shown by adding has-custom-tab to <body>.
 * When visible, #editor and #media-viewer are hidden.
 *
 * No hardcoded colors — all values use CSS variables from the active theme.
 */

#custom-tab-host {
  display: none;
  position: absolute;
  inset: 0;
  z-index: 1;
  overflow: auto;
  background: var(--bg-primary, #1e1e2e);
  padding: var(--content-padding, 24px);
  box-sizing: border-box;
  color: var(--text-primary, #eee);
  font-family: var(--ui-font, system-ui, sans-serif);
}

/* Show host, hide editor when a custom tab is active. */
body.has-custom-tab #editor {
  display: none;
}

body.has-custom-tab #custom-tab-host {
  display: block;
}

/* Error fallback rendered by TabManager when renderFn throws (EC-15). */
.layout-error {
  color: var(--error-fg, #f66);
  background: var(--error-bg, rgba(255, 80, 80, 0.1));
  border: 1px solid var(--error-fg, #f66);
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: var(--ui-font, system-ui, sans-serif);
  margin: 8px 0;
}
```

Implementation notes:
- `#editor` has `position: relative` from `styles.css`; `#custom-tab-host`
  must be positioned relative to `#app` (its parent), not `#editor`. The
  `position: absolute; inset: 0` approach works because `#app` establishes a
  containing block. Verify that `#app` in `styles.css` has `position: relative`
  or add it.
- `#media-viewer` is hidden by the existing `body.has-custom-tab #editor { display: none }`
  rule indirectly, since `#media-viewer` lives inside `#editor`. No additional
  rule is needed for `#media-viewer`.

---

## 4. `index.html`

Add `<div id="custom-tab-host"></div>` as a direct child of `#app`, immediately
after the `#editor` div (and after `#statusbar`):

```html
<div id="app">
  <div id="editor" role="textbox" aria-label="Markdown editor for Markable"></div>
  <div id="statusbar" class="hidden">
    <div class="statusbar-left"></div>
    <div class="statusbar-center"></div>
    <div class="statusbar-right"></div>
  </div>
  <!-- Custom render tab host: permanent element. Visibility via body.has-custom-tab. -->
  <div id="custom-tab-host"></div>
</div>
```

Note: `#media-viewer` is injected dynamically by `TabManager.init()` into
`#editor`, not declared in `index.html`. `#custom-tab-host` is different — it
is a static DOM element because it needs to be a sibling of `#editor`, not a
child.

---

## 5. `src/plugins/markable-plugin-api.ts`

### Change A: add method to `MarkablePluginAPI` interface

Add after `toggleSidebarPanel`:

```typescript
/**
 * Open a custom render tab in the main content area.
 *
 * Delegates to tabManager.openCustomRenderTab(). If a custom tab with the
 * same title already exists, it is replaced in-place (DC-07).
 *
 * renderFn is called synchronously within openCustomRenderTab — errors are
 * caught by TabManager and displayed as a fallback message (EC-15).
 *
 * @param title     Display title for the tab strip entry.
 * @param renderFn  Callback that receives the cleared host element and
 *                  populates it with HTML content.
 */
openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void;
```

### Change B: add implementation in `buildMarkablePluginAPI()`

Add the corresponding implementation in the returned object literal:

```typescript
openCustomRenderTab(title: string, renderFn: (container: HTMLElement) => void): void {
  // Import is deferred to the closure body to avoid a circular module
  // evaluation dependency (same pattern as pluginManager import above).
  const { tabManager } = require("../tabs/tab-manager") as
    typeof import("../tabs/tab-manager");
  tabManager.openCustomRenderTab(title, renderFn);
},
```

**Important**: `require()` is not available in this ESM context. Use a static
import at the top of `markable-plugin-api.ts` instead:

```typescript
import { tabManager } from "../tabs/tab-manager";
```

Add this import alongside the existing imports. There is no circular dependency
risk: `markable-plugin-api.ts` already imports `pluginManager` from `./index`,
and `./index` (tab-manager is not imported by index.ts) does not form a cycle.
Verify by checking that `src/tabs/tab-manager.ts` does not import from
`src/plugins/markable-plugin-api.ts` (it does not — confirmed by reading the
file).

---

## 6. `src/main.ts`

### Change A: import `marked`

`marked` is used in `live-preview.ts`. Add the import to `main.ts`:

```typescript
import { marked } from "marked";
```

This is a deduplicated import; the bundler will not create a second copy.

### Change B: add three window globals

In the globals setup block (after `tabManager.init()` and before
`pluginManager.loadPlugins()`), add:

```typescript
// FR-09: IIFE plugin access to openCustomRenderTab.
(window as unknown as Record<string, unknown>)["__MARKABLE_OPEN_CUSTOM_TAB__"] =
  (title: string, renderFn: (container: HTMLElement) => void) =>
    tabManager.openCustomRenderTab(title, renderFn);

// FR-10: expose marked.parse so IIFE plugins share the same renderer.
(window as unknown as Record<string, unknown>)["__MARKABLE_RENDER_MD__"] =
  (md: string) => marked.parse(md);

// FR-11: plugin command extension map.
(window as unknown as Record<string, unknown>)["__MARKABLE_ACTION_EXTENSIONS__"] =
  new Map<string, () => void>();
```

### Change C: extend `handleAction()` default branch

In the `default:` case of `handleAction()`, after the existing
`__MARKABLE_COMMANDS__` array lookup (line ~801), add:

```typescript
// FR-11: check plugin action extensions registered by IIFE plugins.
const ext = (window as unknown as Record<string, unknown>)[
  "__MARKABLE_ACTION_EXTENSIONS__"
] as Map<string, () => void> | unknown;
if (ext instanceof Map && ext.has(action)) {
  ext.get(action)!();
  return;
}
```

This runs after the `recent-file-` and `custom:` prefix checks, but before the
`__MARKABLE_COMMANDS__` array lookup. Wait — on reading the code more carefully,
the current flow is:

```
default:
  if startsWith("recent-file-") → handle
  else if startsWith("custom:")  → handle
  else: COMMANDS array lookup
```

The `__MARKABLE_ACTION_EXTENSIONS__` check should be inserted in the `else`
branch, after `COMMANDS` lookup fails (to give built-in commands priority), or
before it. The requirements say "after the existing `__MARKABLE_COMMANDS__`
lookup". The implementation is:

```typescript
default: {
  if (action.startsWith("recent-file-")) {
    // ... existing
  } else if (action.startsWith("custom:")) {
    // ... existing
  } else {
    // Existing COMMANDS array lookup.
    const cmds = (window as unknown as Record<string, unknown>)["__MARKABLE_COMMANDS__"] as
      Array<{ id: string; action: () => void }> | undefined;
    const found = cmds?.find((c) => c.id === action);
    if (found) {
      found.action();
    } else {
      // FR-11: plugin action extensions (IIFE plugins registering arbitrary actions).
      const ext = (window as unknown as Record<string, unknown>)[
        "__MARKABLE_ACTION_EXTENSIONS__"
      ];
      if (ext instanceof Map && ext.has(action)) {
        (ext as Map<string, () => void>).get(action)!();
      }
    }
  }
  break;
}
```

---

## Invariant verification

After modifying `src/main.ts`, verify the window size invariant:
- Confirm `DEFAULT_SETTINGS.window.sizeH` remains `"80%"` in `src/lib/settings.ts`.
- Confirm the `0.8` multiplier in `src-tauri/src/lib.rs` is untouched.
- Run `npm run test:run -- tests/settings/window-defaults.test.ts`.

---

## Test Cases (Red phase — `tests/tabs/custom-tab.test.ts`)

All tests are in `tests/tabs/custom-tab.test.ts`. The test file imports
`TabManager` directly (not the singleton) and constructs an isolated instance.

```typescript
// TC-01: openCustomRenderTab creates a tab with kind "custom"
// TC-02: body.has-custom-tab is added after openCustomRenderTab
// TC-03: activating a non-custom tab removes body.has-custom-tab
// TC-04: duplicate title replaces the tab in-place (array length unchanged)
// TC-05: renderFn is called with the host element
// TC-06: renderFn that throws produces layout-error fallback, tab stays open
// TC-07: saveSession excludes custom tabs from openFiles
// TC-08: closeTab on a custom tab skips the dirty-check dialog
// TC-09: EC-25 — openCustomRenderTab without #custom-tab-host logs error and returns
// TC-10: MarkablePluginAPI.openCustomRenderTab delegates to tabManager
// TC-11: window.__MARKABLE_OPEN_CUSTOM_TAB__ calls openCustomRenderTab
// TC-12: window.__MARKABLE_RENDER_MD__(md) returns marked.parse(md)
// TC-13: window.__MARKABLE_ACTION_EXTENSIONS__ is a Map
// TC-14: handleAction calls the registered extension for an unknown action id
```

---

## Implementation Notes

- `_applyActiveTab()` must handle `kind === "custom"` without dispatching to
  the CM6 EditorView. Custom tabs have no document text; the dispatch would
  clear any work-in-progress in the editor. The custom branch returns early.
- `_captureActiveTab()` already has a `if (tab.kind === "media") return` guard.
  Add the same guard for custom: `if (tab.kind === "media" || tab.kind === "custom") return;`
- The `closeAllTabs()` and `closeOtherTabs()` methods use
  `tab.isDirty && tab.kind !== "media"` for the dirty check. Update both
  to `tab.kind !== "media" && tab.kind !== "custom"` for completeness.
- `markActiveTabDirty()` already guards `tab.kind === "media"`. Add
  `tab.kind === "custom"` to the same guard: custom tabs can never be dirty.
