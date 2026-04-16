---
title: "Step 01 — Settings, CSS, and Module-Level State"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 01 — Settings, CSS, and Module-Level State

## What to Build

Establish the scaffolding of the unified plugin file. This step produces:

1. The unified `UnifiedToolbarSettings` interface and `mergeWithDefaults` (replaces the three
   separate settings types, which were identical save for the name).
2. All module-level state declarations (combined from all three originals).
3. The merged CSS string (`TOOLBAR_CSS`) containing all three original CSS blocks verbatim.
4. The CSS lifecycle helpers (`injectCSS` / `removeCSS`) and the single `STYLE_ID` constant.

After this step the file compiles cleanly and exports the settings surface. No logic
beyond settings and CSS is present yet.

---

## File to Create / Rewrite

**Rewrite**: `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`

Start from scratch — do not partially edit the existing file. The existing file will be
replaced completely by the unified plugin built across steps 01–08. However, keep a copy
of each original file open for reference while porting.

---

## Precise Specification

### Section 1 — Type-only imports

```typescript
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { EditorState as EditorStateType } from "@codemirror/state";
import type { Tree as SyntaxTree } from "@lezer/common";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

All four imports are type-only (erased at compile time). `EditorStateType` and
`SyntaxTree` are new additions sourced from the original image-toolbar and table-toolbar.

### Section 2 — Settings types and defaults

```typescript
export type ToolbarMode = "floating" | "sidebar";
export type SidebarSide = "left" | "right";

export interface UnifiedToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

export const DEFAULT_SETTINGS: UnifiedToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};

export function mergeWithDefaults(
  raw: Record<string, unknown> | null,
): UnifiedToolbarSettings { ... }
```

`mergeWithDefaults` must handle:
- EC-15: `null` input — returns `{ ...DEFAULT_SETTINGS }`.
- EC-16: missing keys — fills from defaults.
- EC-17: invalid `toolbarMode` string — falls back to `"floating"`.
- EC-18: The function never reads `table-toolbar` or `image-toolbar` settings; it only
  validates and merges its own input. The old settings files are irrelevant here.

### Section 3 — Module-level state declarations

Combine the state variables from all three originals. Every variable must be annotated
with which original plugin it came from and which requirements it serves.

Required state variables (complete list):

```typescript
// Shared
const DEBOUNCE_MS = 150;
let _enabled: boolean = false;
let _settings: UnifiedToolbarSettings = { ...DEFAULT_SETTINGS };
let _api: MarkablePluginAPI | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;

// Markdown sub-toolbar
let _view: EditorViewType | null = null;
let _toolbarEl: HTMLElement | null = null;
let _buttons: NodeListOf<HTMLButtonElement> | null = null;
let _clickInFlight: boolean = false;
let _sidebarPanelRegistered: boolean = false;

// Table sub-toolbar
let _topBar: HTMLElement | null = null;
let _rowHandle: HTMLElement | null = null;
let _dragIndicator: HTMLElement | null = null;
let _bottomPill: HTMLElement | null = null;
let _sidebarPanelEl: HTMLElement | null = null;
let _blurListener: (() => void) | null = null;

// Image sub-toolbar
let _popoverEl: HTMLElement | null = null;
let currentImageContext: ImageContext | null = null;
let triggerMode: "edit" | "click" | null = null;
let _onDocClick: ((e: MouseEvent) => void) | null = null;
let _onDocMousedown: ((e: MouseEvent) => void) | null = null;
let _onEditorBlur: (() => void) | null = null;
let _urlInput: HTMLInputElement | null = null;
let _alignBtns: NodeListOf<HTMLButtonElement> | null = null;
```

Note: `ImageContext` is declared in step_03. Use a forward-reference comment at this
position: `// ImageContext is defined in section 7 (step_03).`

Note: `_sidebarPanelRegistered` covers both the markdown and table sidebar panels since
they now share one unified panel registration. The single boolean guards
`api.unregisterSidebarPanel("markdown-toolbar")` in `onDisable`.

### Section 4 — CSS constant and lifecycle helpers

**`STYLE_ID`** constant:

```typescript
export const STYLE_ID = "__markable_unified_toolbar_css__";
```

This replaces the three separate `STYLE_ID` constants (`__markable_md_toolbar_css__`,
`__markable_tbl_toolbar_css__`, `__markable_img_toolbar_css__`).

**`TOOLBAR_CSS`** string:

Concatenate the three original CSS blocks in this order:
1. Markdown toolbar CSS (from `markdown-toolbar.plugin.ts` section 4 — `.md-toolbar` rules)
2. Table toolbar CSS (from `table-toolbar.plugin.ts` section 4 — `.tbl-toolbar` rules)
3. Image toolbar CSS (from `image-toolbar.plugin.ts` section 4 — `.img-toolbar` rules)

No class names may be changed. Preserve every rule verbatim, including vendor-specific
syntax and ordering within each block. Separate the three blocks with a blank line and
a comment: `/* ── Table toolbar ── */` and `/* ── Image toolbar ── */`.

**`injectCSS` function**:

```typescript
export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return; // idempotent guard (EC-9)
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}
```

**`removeCSS` function**:

```typescript
export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}
```

---

## Acceptance Criteria

### AC-1.1 — Type compilation
`tsc --noEmit` passes on the file after this step with no type errors.

### AC-1.2 — mergeWithDefaults: null input (EC-15)
```typescript
expect(mergeWithDefaults(null)).toEqual({ toolbarMode: "floating", sidebarSide: "left" });
```

### AC-1.3 — mergeWithDefaults: partial input (EC-16)
```typescript
expect(mergeWithDefaults({ toolbarMode: "sidebar" }))
  .toEqual({ toolbarMode: "sidebar", sidebarSide: "left" });
```

### AC-1.4 — mergeWithDefaults: invalid toolbarMode (EC-17)
```typescript
expect(mergeWithDefaults({ toolbarMode: "invalid", sidebarSide: "right" }))
  .toEqual({ toolbarMode: "floating", sidebarSide: "right" });
```

### AC-1.5 — mergeWithDefaults: valid full object
```typescript
expect(mergeWithDefaults({ toolbarMode: "sidebar", sidebarSide: "right" }))
  .toEqual({ toolbarMode: "sidebar", sidebarSide: "right" });
```

### AC-1.6 — STYLE_ID value
```typescript
expect(STYLE_ID).toBe("__markable_unified_toolbar_css__");
```

### AC-1.7 — injectCSS idempotency (EC-9)
Calling `injectCSS()` twice results in exactly one `<style>` element with id
`__markable_unified_toolbar_css__` in `document.head`.

### AC-1.8 — removeCSS removes the style element
After `injectCSS()` then `removeCSS()`, `document.getElementById(STYLE_ID)` is `null`.

### AC-1.9 — CSS contains all three namespaces
`TOOLBAR_CSS` contains the strings `.md-toolbar`, `.tbl-toolbar`, and `.img-toolbar`.

---

## Risks and Dependencies

- **Risk**: Accidentally changing a CSS class name during the copy. Mitigation: do a
  character-for-character copy of each CSS block; run the existing tests against the
  merged CSS to verify `.md-toolbar`, `.tbl-toolbar`, `.img-toolbar` classes are present.
- **Dependency**: Steps 02–08 build on top of this file. All subsequent steps assume
  section 1–4 are already in place and passing AC-1.1.
- **No test deletions yet**: The existing markdown-toolbar test file imports `STYLE_ID`
  from the original plugin. After this step that import still resolves — the export name
  is preserved. The table-toolbar and image-toolbar test files still import from their
  own source files (not yet migrated). Do not modify the test files in this step.
