---
title: "Table Toolbar — Step 01: Plugin Skeleton, Settings, CSS Scaffold, Build Config"
last-updated: "2026-04-14"
review-cadence-days: 14
status: active
---

# Step 01 — Plugin Skeleton, Settings, CSS Scaffold, Build Config

## Goal

Establish the complete plugin file structure with no logic gaps: settings types,
module-level state variables, CSS injection/removal, the `onEnable`/`onDisable`
stubs (no real behaviour yet — just the correct call sequence with placeholders),
and the two build-system registrations. After this step the plugin can be built,
loaded, enabled, disabled, and toggled rapidly without any DOM leaks, duplicate
`<style>` tags, or crashes.

---

## Files Changed

| File | Change type |
|---|---|
| `src/plugins/table-toolbar/table-toolbar.plugin.ts` | Create (new) |
| `tests/plugins/table-toolbar/table-toolbar.test.ts` | Create (new) |
| `scripts/build-plugins.mjs` | Modify — add `table-toolbar` entry |
| `vite.plugins.config.ts` | Modify — add `pluginConfig(...)` call |

---

## Implementation Notes

### 1. File header and section order

The file must open with the same module-level JSDoc comment block as
`markdown-toolbar.plugin.ts`, listing all 11 sections in order. The section
numbers and names used throughout the spec are:

```
1.  Type-only imports
2.  Settings types and defaults
3.  Module-level state declarations
4.  CSS constant and lifecycle helpers
5.  TableContext type + pure detectTableContext (stub — returns null)
6.  Pure table operations (stubs — all return null)
7.  DOM: buildTopBar / buildRowHandle / buildBottomPill (stubs — return div)
8.  DOM: updateFloatingPositions / updateFloatingVisibility / clampPosition (stubs)
9.  DOM: buildSidebarPanel / updateSidebarButtonStates (stubs)
10. CM6 listener factory: buildUpdateListener (stub — returns no-op listener)
11. Plugin export object
```

In this step, sections 5–10 are stubs. Their bodies are one line each:
`return null;` or `return document.createElement("div");` as appropriate.

### 2. Type-only imports (Section 1)

```typescript
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { SyntaxTree } from "@lezer/common";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

All three are erased by tsc. The `SyntaxTree` import is for the `detectTableContext`
function signature (step_02). `@lezer/common` is a dev-dependency already present
in the project.

### 3. Settings (Section 2)

```typescript
export type ToolbarMode = "floating" | "sidebar";
export type SidebarSide = "left" | "right";

export interface TableToolbarSettings {
  toolbarMode: ToolbarMode;
  sidebarSide: SidebarSide;
}

export const DEFAULT_SETTINGS: TableToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};

export function mergeWithDefaults(raw: Record<string, unknown> | null): TableToolbarSettings {
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

This is an exact copy of the pattern in `markdown-toolbar.plugin.ts`, adapted for
`TableToolbarSettings`. It handles EC-20 and EC-21 correctly.

### 4. Module-level state (Section 3)

Declare exactly these variables (all `let`, all reset to initial values in
`onDisable`):

```typescript
const DEBOUNCE_MS = 150;

let _enabled:                boolean = false;
let _settings:               TableToolbarSettings = { ...DEFAULT_SETTINGS };
let _api:                    MarkablePluginAPI | null = null;
let _topBar:                 HTMLElement | null = null;
let _rowHandle:              HTMLElement | null = null;
let _rowMenu:                HTMLElement | null = null;   // the inline menu popup
let _bottomPill:             HTMLElement | null = null;
let _sidebarPanelRegistered: boolean = false;
let _debounceTimer:          ReturnType<typeof setTimeout> | null = null;
let _outsideClickListener:   ((e: MouseEvent) => void) | null = null;
```

No other module-level state is needed at this step.

### 5. CSS (Section 4)

```typescript
export const STYLE_ID = "__markable_tbl_toolbar_css__";

const TOOLBAR_CSS = `
/* ... full CSS defined in step_04 ... */
/* Placeholder for step_01: inject one rule so the style tag is testable */
.tbl-toolbar { box-sizing: border-box; }
`;

export function injectCSS(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOOLBAR_CSS;
  document.head.appendChild(style);
}

export function removeCSS(): void {
  document.getElementById(STYLE_ID)?.remove();
}
```

The `TOOLBAR_CSS` content is a placeholder in step_01; the full ruleset is
filled in during step_04. The guard pattern (check `getElementById` before
inserting) satisfies EC-19.

### 6. getCmView helper

```typescript
function getCmView(): typeof import("@codemirror/view") {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
```

Same pattern as `markdown-toolbar.plugin.ts`. Not called at module-eval time.

### 7. onEnable skeleton

The sequence must be:

```
_enabled = true
_api = api
raw = await api.loadSettings()
_settings = mergeWithDefaults(raw)
injectCSS()
_topBar = buildTopBar()       // stub: returns empty div
_rowHandle = buildRowHandle() // stub: returns empty div
_rowMenu = buildRowMenu()     // stub: returns empty div
_bottomPill = buildBottomPill() // stub: returns empty div
api.addExtensions([buildUpdateListener()])
if floating: append _topBar, _rowHandle, _rowMenu, _bottomPill to body (hidden)
if sidebar: api.registerSidebarPanel(...); _sidebarPanelRegistered = true
```

All four floating elements start with `style.display = "none"`.

### 8. onDisable skeleton

The sequence must be the exact reversal:

```
_enabled = false
if _debounceTimer: clearTimeout; null
if _outsideClickListener: document.removeEventListener("mousedown", ...); null
api.removeExtensions()
if floating: [_topBar, _rowHandle, _rowMenu, _bottomPill].forEach(el => el?.remove())
if _sidebarPanelRegistered: api.unregisterSidebarPanel("table-toolbar"); false
removeCSS()
// Reset all module-level state:
_topBar = _rowHandle = _rowMenu = _bottomPill = _api = null
_settings = { ...DEFAULT_SETTINGS }
_sidebarPanelRegistered = false
_outsideClickListener = null
```

Note: `_settings.toolbarMode` is read BEFORE reset to decide whether to remove
floating elements or not. Save the mode in a local variable at the top of
`onDisable`:

```typescript
const mode = _settings.toolbarMode;
```

### 9. buildUpdateListener stub

```typescript
function buildUpdateListener() {
  const { EditorView } = getCmView();
  return EditorView.updateListener.of((_update: ViewUpdate) => {
    if (!_enabled) return;
    // stub: filled in step_06
  });
}
```

This is enough to verify that `api.addExtensions` is called without error.

### 10. renderDetailExtra stub

Implement the full `renderDetailExtra` function as specified in FR-10 and AD-10.
This is the same 3-way toggle as `markdown-toolbar.plugin.ts` (Left / Float / Right).
The implementation is identical — copy the pattern from `markdown-toolbar.plugin.ts`
lines 1482–1525, substituting `"table-toolbar"` for `"markdown-toolbar"` and
`TableToolbarSettings`/`ToolbarMode`/`SidebarSide` types.

This is placed in step_01 (not step_07) because it depends only on settings types
and `_api`, both of which are established in this step.

### 11. Plugin export object

```typescript
export default {
  id:             "table-toolbar",
  name:           "Table Toolbar",
  version:        "1.0.0",
  description:    "Contextual toolbar for Markdown table management",
  detail:
    "Provides column insertion/deletion, row insertion/deletion, alignment controls, " +
    "and a Delete Table button. Appears as a floating UI around the table when the " +
    "cursor is inside it (default) or as a docked sidebar panel. All operations are " +
    "single undo steps.",
  sidebarPanelId: "table-toolbar",
  renderDetailExtra,
  onEnable,
  onDisable,
};
```

### 12. Build config changes

`scripts/build-plugins.mjs` — add at end of PLUGINS array:

```javascript
["table-toolbar", "src/plugins/table-toolbar/table-toolbar.plugin.ts"],
```

Also update the final `console.log` message from `"All 6 core plugins"` to
`"All 7 core plugins"`.

`vite.plugins.config.ts` — add at end of exported array:

```typescript
pluginConfig(
  "table-toolbar",
  resolve(__dirname, "src/plugins/table-toolbar/table-toolbar.plugin.ts"),
  false,
),
```

---

## Test Cases (must all pass before step is done)

File: `tests/plugins/table-toolbar/table-toolbar.test.ts`

Use the same Vitest + JSDOM setup as
`tests/plugins/markdown-toolbar/markdown-toolbar.test.ts`. Look at that file for
the `beforeEach`/`afterEach` setup pattern (document.head cleanup, window globals
stub).

### Settings tests

```
describe("mergeWithDefaults") {
  it("returns defaults when raw is null") {
    // mergeWithDefaults(null) → { toolbarMode: "floating", sidebarSide: "left" }
  }
  it("returns defaults when raw is empty object") {
    // mergeWithDefaults({}) → defaults
  }
  it("preserves valid toolbarMode") {
    // mergeWithDefaults({ toolbarMode: "sidebar", sidebarSide: "right" })
    //   → { toolbarMode: "sidebar", sidebarSide: "right" }
  }
  it("falls back toolbarMode on invalid value") {
    // mergeWithDefaults({ toolbarMode: "invalid" }) → toolbarMode: "floating"
  }
  it("falls back sidebarSide on invalid value") {
    // mergeWithDefaults({ sidebarSide: "center" }) → sidebarSide: "left"
  }
  it("fills missing sidebarSide from defaults") {
    // mergeWithDefaults({ toolbarMode: "sidebar" }) → sidebarSide: "left"
  }
  it("does not mutate DEFAULT_SETTINGS") {
    // mergeWithDefaults(null); check DEFAULT_SETTINGS unchanged
  }
}
```

### CSS injection tests

```
describe("injectCSS / removeCSS") {
  it("injects a style tag with the correct id") {
    // injectCSS(); expect(document.getElementById(STYLE_ID)).not.toBeNull()
  }
  it("is idempotent — no duplicate tags on double call (EC-19)") {
    // injectCSS(); injectCSS();
    // expect(document.querySelectorAll(`#${STYLE_ID}`)).toHaveLength(1)
  }
  it("removeCSS removes the injected tag") {
    // injectCSS(); removeCSS(); expect(document.getElementById(STYLE_ID)).toBeNull()
  }
  it("removeCSS is a no-op when tag not present") {
    // removeCSS(); // should not throw
  }
}
```

### DEFAULT_SETTINGS test

```
it("DEFAULT_SETTINGS has correct shape") {
  expect(DEFAULT_SETTINGS.toolbarMode).toBe("floating");
  expect(DEFAULT_SETTINGS.sidebarSide).toBe("left");
}
```

### STYLE_ID test

```
it("STYLE_ID is the correct string constant") {
  expect(STYLE_ID).toBe("__markable_tbl_toolbar_css__");
}
```

### Build config tests (manual verification)

These are verified by the Code Reviewer, not automated:

- EC-32: `scripts/build-plugins.mjs` contains `"table-toolbar"` entry.
- EC-33: `vite.plugins.config.ts` contains `pluginConfig("table-toolbar", ...)` call.

---

## Definition of Done

- [ ] `table-toolbar.plugin.ts` exists with all 11 section stubs in order.
- [ ] All settings unit tests pass (`npm test -- table-toolbar`).
- [ ] All CSS injection unit tests pass.
- [ ] `scripts/build-plugins.mjs` updated with `table-toolbar` entry.
- [ ] `vite.plugins.config.ts` updated with `pluginConfig("table-toolbar", ...)`.
- [ ] `npm run build:plugins` completes without error and produces
      `src-tauri/plugins/core/table-toolbar.js`.
- [ ] No TypeScript errors in `table-toolbar.plugin.ts` (`npx tsc --noEmit`).
