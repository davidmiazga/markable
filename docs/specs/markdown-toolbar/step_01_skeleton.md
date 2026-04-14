---
title: "Step 01 — Plugin Skeleton, Settings, CSS Lifecycle"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 01 — Plugin Skeleton, Settings, and CSS Lifecycle

**Prerequisite:** `docs/requirements/active_task.md` exists and is marked active.
**Produces:** A compilable plugin file with no logic, plus a passing initial test.

---

## Goal

Create the plugin entry point with:
- The correct `UnifiedPlugin` object shape (id, name, version, sidebarPanelId, etc.)
- Settings types, default values, and `mergeWithDefaults`
- The CSS constant and `injectCSS`/`removeCSS` helpers
- All module-level state variables declared and reset in `onDisable`
- `onEnable` and `onDisable` stubs that satisfy NFR-3 (clean toggle cycle) even before any logic is wired
- The build config entry in `vite.plugins.config.ts`

After this step the plugin can be enabled and disabled without errors. It does nothing visible yet.

---

## Files to Create / Modify

| File | Action |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Create |
| `vite.plugins.config.ts` | Modify — add `markdown-toolbar` entry |
| `tests/markdown-toolbar.test.ts` | Create — initial skeleton test |

---

## Detailed Specification

### 1. Plugin file header and type-only imports

```typescript
// Type-only imports — erased by tsc, no runtime code emitted.
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

No value imports from `@codemirror/*`. CM6 values are accessed via `window.__CM_VIEW__` inside factory functions (see step_06).

### 2. Settings types

```typescript
export type ToolbarMode = "floating" | "sidebar";
export type SidebarSide = "left" | "right";

export interface ToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

export const DEFAULT_SETTINGS: ToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};
```

### 3. mergeWithDefaults

```typescript
export function mergeWithDefaults(
  raw: Record<string, unknown> | null
): ToolbarSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  return {
    toolbarMode:
      raw["toolbarMode"] === "floating" || raw["toolbarMode"] === "sidebar"
        ? (raw["toolbarMode"] as ToolbarMode)
        : DEFAULT_SETTINGS.toolbarMode,
    sidebarSide:
      raw["sidebarSide"] === "left" || raw["sidebarSide"] === "right"
        ? (raw["sidebarSide"] as SidebarSide)
        : DEFAULT_SETTINGS.sidebarSide,
  };
}
```

This function handles EC-18 (null → defaults) and EC-19 (partial object → fill missing keys).

### 4. CSS constant

The CSS string `TOOLBAR_CSS` contains all `.md-toolbar*` rules. Reference the full CSS spec in `00_index.md`. Key rules to include verbatim:

- `.md-toolbar` — `position: fixed; display: flex; flex-direction: row; gap: 4px; padding: 6px 8px; border-radius: 6px; z-index: 10000; background: var(--bg-primary); border: 1px solid color-mix(in srgb, var(--text-primary) 15%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,0.25);`
- `.md-toolbar__btn` — `width: 28px; height: 28px; background: none; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; color: var(--text-primary); display: flex; align-items: center; justify-content: center;`
- `.md-toolbar__btn:hover` — `background: var(--code-bg);`
- `.md-toolbar__btn--active` — `background: var(--link-color); color: var(--bg-primary);`
- `.md-toolbar__btn--disabled` — `opacity: 0.35; pointer-events: none; cursor: default;`
- `.sidebar-panel-content .md-toolbar` — `position: static; flex-wrap: wrap; padding: 12px 8px; box-shadow: none; border: none; background: transparent;`

### 5. CSS lifecycle helpers

```typescript
const STYLE_ID = "__markable_md_toolbar_css__";

function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;   // EC-15 guard
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}
```

### 6. Module-level state

```typescript
let _enabled: boolean = false;
let _settings: ToolbarSettings = { ...DEFAULT_SETTINGS };
let _view: EditorViewType | null = null;
let _toolbarEl: HTMLElement | null = null;
let _buttons: NodeListOf<HTMLButtonElement> | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _sidebarPanelRegistered: boolean = false;
```

All variables declared at module scope. All reset to initial values at the end of `onDisable`.

### 7. onEnable stub

```typescript
async onEnable(api: MarkablePluginAPI): Promise<void> {
  _enabled = true;
  const raw = await api.loadSettings();
  _settings = mergeWithDefaults(raw);
  injectCSS();
  // TODO step_04: buildToolbarDOM()
  // TODO step_06: api.addExtensions([buildUpdateListener()])
  // TODO step_04/05: mount toolbar
}
```

### 8. onDisable stub

```typescript
onDisable(api: MarkablePluginAPI): void {
  _enabled = false;
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  api.removeExtensions();
  if (_toolbarEl && _settings.toolbarMode === "floating") {
    _toolbarEl.remove();                              // EC-16
  }
  if (_sidebarPanelRegistered) {
    api.unregisterSidebarPanel("markdown-toolbar");  // EC-17
    _sidebarPanelRegistered = false;
  }
  removeCSS();
  // Reset state
  _toolbarEl = null;
  _buttons = null;
  _view = null;
  _settings = { ...DEFAULT_SETTINGS };
}
```

### 9. Plugin export object

```typescript
export default {
  id: "markdown-toolbar",
  name: "Markdown Toolbar",
  version: "1.0.0",
  description: "Formatting toolbar for common Markdown styles",
  detail:
    "Provides a 10-button toolbar for applying and removing inline Markdown formatting: bold, italic, underline, strikethrough, highlight, inline code, superscript, link, image, and erase formatting. Available as a floating bubble above the selection (default) or as a docked sidebar panel.",
  sidebarPanelId: "markdown-toolbar",   // always present per FR-6
  onEnable,
  onDisable,
};
```

### 10. vite.plugins.config.ts modification

Add after the existing `status-bar` entry (keep `clearOutput: false`):

```typescript
pluginConfig(
  "markdown-toolbar",
  resolve(__dirname, "src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts"),
  false,
),
```

---

## Acceptance Criteria

These criteria must all pass before step_02 begins.

### AC-1.1: Plugin object shape
`markdownToolbarPlugin.id === "markdown-toolbar"` and `markdownToolbarPlugin.sidebarPanelId === "markdown-toolbar"`.

### AC-1.2: mergeWithDefaults with null
`mergeWithDefaults(null)` returns `{ toolbarMode: "floating", sidebarSide: "left" }`.

### AC-1.3: mergeWithDefaults with partial object
`mergeWithDefaults({ toolbarMode: "sidebar" })` returns `{ toolbarMode: "sidebar", sidebarSide: "left" }`.
`mergeWithDefaults({ sidebarSide: "right" })` returns `{ toolbarMode: "floating", sidebarSide: "right" }`.

### AC-1.4: mergeWithDefaults with invalid values
`mergeWithDefaults({ toolbarMode: "invalid" })` returns `{ toolbarMode: "floating", sidebarSide: "left" }`.

### AC-1.5: mergeWithDefaults is a pure function
Calling it twice with the same input returns equal objects; calling it once does not mutate `DEFAULT_SETTINGS`.

### AC-1.6: TypeScript compiles without errors
`npm run build:plugins` exits 0. No `tsc --noEmit` errors.

---

## Test File Skeleton

`tests/markdown-toolbar.test.ts` should import:

```typescript
import { describe, it, expect } from "vitest";
import {
  mergeWithDefaults,
  DEFAULT_SETTINGS,
  type ToolbarSettings,
} from "../src/plugins/markdown-toolbar/markdown-toolbar.plugin";
```

Write tests for AC-1.2 through AC-1.5. AC-1.1 and AC-1.6 are verified by build, not by Vitest.

---

## Notes for the Developer

- Do not access `window.__CM_VIEW__` in this step. All CM6 references are deferred to step_06.
- The `TODO` comments in `onEnable` are intentional placeholders; they will be filled in by later steps. Do not add any implementation logic here that belongs to a later step.
- `onDisable` must be complete in this step, not deferred. The full cleanup sequence must work even when only the skeleton is implemented (i.e. when `_toolbarEl` is still null, the null checks prevent errors).
- The CSS string may be written inline as a template literal. No separate `.css` file is created.
