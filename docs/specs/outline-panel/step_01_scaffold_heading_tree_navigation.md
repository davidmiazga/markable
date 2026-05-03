---
title: Outline Panel — Step 01 — Scaffold, Heading Tree, Navigation
last-updated: "2026-05-02"
review-cadence-days: 90
status: active
---

# Step 01 — Scaffold, Heading Tree, Navigation

**Implements:** FR-1, FR-2, FR-3, FR-4, FR-11, FR-13 (partial)
**Deferred to step_02:** FR-5, FR-6, FR-7, FR-8, FR-9, FR-12 (fold state change trigger), FR-13 (removeExtensions fold cleanup)

---

## Goal

Produce a working Outline Panel plugin that:

1. Registers as a left-sidebar panel via `api.registerSidebarPanel`.
2. Scans all ATX headings from the active document and renders them as a flat list.
3. Highlights the heading containing the cursor.
4. Navigates to a heading when clicked.
5. Shows "No headings" for empty/heading-free documents.
6. Cleans up completely on `onDisable`.

No fold infrastructure in this step. All chevrons are hidden (or rendered as an inert placeholder). Fold is added in step_02.

---

## Files to Create

### `src/plugins/outline-panel/outline-panel.plugin.ts`

New file. This is the only file created in this step. It is complete for the step_01 scope; step_02 will add fold logic to it.

---

## Files to Modify

### `scripts/build-plugins.mjs`

Add one entry to the `PLUGINS` array, immediately after the `file-browser` entry:

```javascript
["outline-panel", "src/plugins/outline-panel/outline-panel.plugin.ts"],
```

The existing comment block above `file-browser` reads `// PKM Step 02a: File Browser`. Add the new entry after the last existing entry (before the closing `];`). The exact insertion point:

```javascript
  // existing last entry:
  ["knowledge-graph",   "src/plugins/knowledge-graph/knowledge-graph.plugin.ts"],
  // ADD HERE:
  ["outline-panel",     "src/plugins/outline-panel/outline-panel.plugin.ts"],
];
```

Also update the success log count:
```javascript
// Before:
console.log(`\n[build-plugins] All ${PLUGINS.length} core plugins built successfully.`);
// After: no change needed — PLUGINS.length is dynamic.
```

---

## Implementation Specification: `outline-panel.plugin.ts`

### File header (verbatim comment block)

```typescript
/**
 * IIFE entry point for the Outline Panel core plugin.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/outline-panel.js
 *
 * Self-containment rules:
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__
 *     and window.__CM_LANGUAGE__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_outline_panel_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 *
 * Step 01 scope: heading tree rendering, navigation, active highlight.
 * Step 02 scope: fold infrastructure, bidirectional sync, foldService.
 */
```

### Type-only imports

```typescript
import type { EditorView as EditorViewType, ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

### Exported types

```typescript
export interface HeadingEntry {
  level: number;
  text: string;
  lineFrom: number;
  lineNumber: number;
}
```

The `HeadingEntry` shape is identical to auto-toc's. Exporting it allows tests to import the type directly from the plugin source.

### Module-level state

Declare these module-level variables (all reset in `onDisable`):

```typescript
const DEBOUNCE_MS = 150;

let _view: EditorViewType | null = null;
let _enabled = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastEntries: HeadingEntry[] = [];
let _outlineList: HTMLElement | null = null;
```

Step_02 will add `_lastFoldRanges` here.

### CM6 globals accessors

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
function getCmView(): typeof import("@codemirror/view") {
  return (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
}
/* eslint-enable @typescript-eslint/no-explicit-any */
```

Do NOT call `getCmView()` at module-evaluation time. Call it only inside `onEnable` and factory functions.

Step_02 will add `getCmLanguage()`.

### Pure functions (exported for testability)

#### `scanHeadings(docText: string): HeadingEntry[]`

Copy verbatim from `src/plugins/auto-toc/auto-toc.plugin.ts` lines 199–263. The logic is identical; there is no shared module between the two plugins (requirements prohibit merging concerns). Update the JSDoc to reference this plugin.

Key rules (already in auto-toc's implementation, verify they are preserved):
- ATX headings only: `/^(#{1,6}) (.*)/`
- Fenced code block exclusion: track open/close state using `"```"` / `"~~~"` marker matching
- `lineFrom` accumulated via `line.length + 1` per line
- Empty text stored verbatim (EC-6)

#### `findActiveIndex(entries: HeadingEntry[], cursorPos: number): number`

Copy verbatim from auto-toc lines 278–290.

### CSS constant

Define a string constant `OUTLINE_CONTENT_CSS`. Prefix all class names with `outline-`. The style tag id is `__markable_outline_panel_css__`.

Required class definitions:

```css
.outline-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.outline-row {
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  padding: 2px 8px 2px 0;
}

.outline-chevron {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  background: none;
  border: none;
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 0.1s ease;
}

/* Step 01: all chevrons hidden until fold is wired in step_02 */
.outline-chevron {
  visibility: hidden;
}

.outline-chevron-visible {
  visibility: visible;
}

.outline-chevron-collapsed {
  transform: rotate(-90deg);
}

.outline-label {
  flex: 1;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: var(--ui-font);
  font-size: 12px;
  line-height: 1.4;
  padding: 2px 8px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.outline-label:hover {
  background: var(--code-bg);
}

.outline-label-active {
  color: var(--text-primary);
  border-left: 2px solid var(--link-color);
  background: var(--selection-bg);
}

.outline-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: var(--ui-font);
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
```

Note: the `.outline-chevron` visibility rule hides all chevrons in step_01. Step_02 will replace it with a rule that only hides chevrons when the section is not collapsible (class `.outline-chevron` visible by default; hidden via `.outline-chevron-hidden`).

### CSS lifecycle helpers

```typescript
function injectCSS(): void {
  const STYLE_ID = "__markable_outline_panel_css__";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = OUTLINE_CONTENT_CSS;
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById("__markable_outline_panel_css__")?.remove();
}
```

### `rebuildOutline(entries, activeIdx)` — step_01 signature

```typescript
function rebuildOutline(entries: HeadingEntry[], activeIdx: number): void
```

Step_01 implementation (fold parameters added in step_02):

1. If `!_outlineList` return immediately.
2. `_outlineList.innerHTML = ""` to clear previous DOM.
3. If `entries.length === 0`, append `<div class="outline-empty">No headings</div>` and return.
4. Cache `const { EditorView } = getCmView()` once per rebuild.
5. For each `entry` at index `i`:
   a. Create `<div class="outline-row">`.
   b. Create `<button class="outline-chevron" aria-hidden="true">▶</button>`. In step_01 this is always hidden (the CSS rule hides it). Do NOT wire a click handler yet; that is step_02.
   c. Create `<button class="outline-label">`.
      - Add class `outline-label-active` when `i === activeIdx`.
      - Set `paddingLeft` to `${(entry.level - 1) * 12 + 8}px` (8 px base, +12 per level).
      - Set `textContent` to `entry.text || "\u00A0"` (EC-6: non-breaking space for empty headings).
      - Capture `lineFrom` in the closure for the click handler.
   d. Attach click handler to `.outline-label` (see "Navigation click handler" below).
   e. Append chevron and label to the row div, row div to `_outlineList`.

#### Navigation click handler (step_01, no fold awareness)

```typescript
btn.addEventListener("click", () => {
  if (!_view) return;
  const { EditorView } = getCmView();
  _view.dispatch({
    selection: { anchor: lineFrom },
    effects: EditorView.scrollIntoView(lineFrom, { y: "center" }),
  });
  _view.focus();
});
```

Step_02 will replace this handler with a fold-aware version (FR-3, EC-5).

### `buildOutlineUpdateListener()` — step_01

```typescript
function buildOutlineUpdateListener() {
  const { EditorView } = getCmView();
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    _view = update.view;

    const docChanged = update.docChanged;
    const selChanged = update.selectionSet;

    if (!docChanged && !selChanged) return;

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    const docText = docChanged ? update.state.doc.toString() : null;
    const cursorPos = update.state.selection.main.head;

    _debounceTimer = setTimeout(() => {
      if (!_enabled) return;
      if (docText !== null) {
        _lastEntries = scanHeadings(docText);
      }
      const activeIdx = findActiveIndex(_lastEntries, cursorPos);
      rebuildOutline(_lastEntries, activeIdx);
    }, DEBOUNCE_MS);
  });
}
```

Step_02 will add fold state change detection to this listener.

### Plugin export object

```typescript
export default {
  id: "outline-panel",
  name: "Outline Panel",
  version: "1.0.0",
  description: "Live heading outline with section folding",
  sidebarPanelId: "outline-panel",
  detail: "Shows a live H1–H6 heading tree for the active document. Click any heading to navigate. Click the chevron to collapse or expand a section in the editor.",

  onEnable(api: MarkablePluginAPI): void {
    // Step_02 will wrap this entire body in a try/catch for EC-13.
    _enabled = true;
    injectCSS();

    api.addExtensions([buildOutlineUpdateListener()]);

    api.registerSidebarPanel({
      id: "outline-panel",
      title: "Outline",
      side: "left",
      defaultWidth: 220,

      render(container: HTMLElement): void {
        const list = document.createElement("div");
        list.className = "outline-list";
        container.appendChild(list);
        _outlineList = list;

        /* eslint-disable @typescript-eslint/no-explicit-any */
        const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
          | EditorViewType
          | undefined;
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (liveView) {
          _view = liveView;
          _lastEntries = scanHeadings(liveView.state.doc.toString());
          const activeIdx = findActiveIndex(
            _lastEntries,
            liveView.state.selection.main.head,
          );
          rebuildOutline(_lastEntries, activeIdx);
        } else {
          rebuildOutline([], -1);
        }
      },

      destroy(_container: HTMLElement): void {
        if (_debounceTimer) {
          clearTimeout(_debounceTimer);
          _debounceTimer = null;
        }
        _outlineList = null;
      },
    });
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    api.removeExtensions();
    api.unregisterSidebarPanel("outline-panel");
    removeCSS();

    _view = null;
    _lastEntries = [];
    // _outlineList nulled by destroy() callback above
  },
};
```

---

## Acceptance Criteria for Step 01

Before declaring step_01 complete, verify ALL of the following manually and via tests:

1. `npm run build:plugins` exits 0 and `src-tauri/plugins/core/outline-panel.js` is present.
2. With the app running and the plugin enabled, opening a document with headings shows them in the left sidebar panel labelled "Outline".
3. Headings are indented by level (H1 flush, each level adds 12 px).
4. Moving the cursor into a heading's section highlights that heading in the panel (within 150 ms).
5. Clicking a heading row moves the cursor to that line and scrolls it to centre.
6. A document with no headings shows "No headings".
7. Disabling the plugin removes the sidebar panel. Re-enabling it restores the panel with the current document.
8. All step_01 unit tests pass (see "Tests" section below).
9. No chevrons are visible in the panel (all hidden until step_02).

---

## Tests

Create `tests/plugins/outline-panel/outline-panel.test.ts`.

Test file header:
```typescript
/**
 * Unit tests for the Outline Panel plugin pure functions.
 * Imports directly from the TypeScript source; Vitest resolves TS natively.
 * No CM6 runtime or DOM required for these tests.
 */
import { describe, it, expect } from "vitest";
import { scanHeadings, findActiveIndex } from
  "../../../src/plugins/outline-panel/outline-panel.plugin";
```

### `scanHeadings` test cases (mirror auto-toc coverage)

Cover all of the following. Each test name is a verbatim requirement for the test description string:

| Test description | Input | Expected |
|---|---|---|
| "returns empty array for empty string" | `""` | `[]` |
| "returns empty array when document has no headings" | `"plain text\nmore text"` | `[]` |
| "detects H1 through H6 headings" | one of each level | 6 entries, levels 1–6 |
| "H1 on the first line has lineFrom 0 and lineNumber 1" | `"# Hello\nBody"` | entry with `lineFrom: 0, lineNumber: 1` |
| "computes correct lineFrom for second heading" | `"# First\n# Second"` | second entry `lineFrom: 8` (length of `"# First\n"`) |
| "excludes headings inside backtick code fences" | `"# Real\n```\n# Fake\n```\n# Real2"` | 2 entries |
| "excludes headings inside tilde code fences" | `"# Real\n~~~\n# Fake\n~~~\n# Real2"` | 2 entries |
| "does not close a backtick fence with tilde" | `"# Real\n```\n# Fake\n~~~\n# Fake2\n```\n# Real2"` | 2 entries |
| "handles a line with 7 hash characters (not a heading)" | `"####### Not a heading"` | 0 entries |
| "heading with no text after space is included with empty text" | `"# "` | 1 entry, `text: ""` |
| "heading with no trailing space is not a heading" | `"#NoSpace"` | 0 entries |
| "heading on the last line without trailing newline" | `"# First\n# Last"` | 2 entries; second has correct lineFrom |
| "stores heading text verbatim including inline Markdown syntax" | `"# Hello **world**"` | `text: "Hello **world**"` |
| "is stateless — repeated calls with different documents return independent results" | call twice with different inputs | each call returns result for its own input |
| "handles 201 headings without error" | 201 `# H\n` lines | 201 entries |

### `findActiveIndex` test cases

| Test description | entries | cursorPos | Expected |
|---|---|---|---|
| "returns -1 when entries is empty" | `[]` | `0` | `-1` |
| "returns -1 when cursor is before all headings" | `[{ lineFrom: 10 }]` | `5` | `-1` |
| "returns 0 when cursor is on the first heading line" | `[{ lineFrom: 0 }, { lineFrom: 20 }]` | `0` | `0` |
| "returns index of last heading before cursor" | `[{ lineFrom: 0 }, { lineFrom: 20 }, { lineFrom: 40 }]` | `25` | `1` |
| "returns last index when cursor is at end of document" | `[{ lineFrom: 0 }, { lineFrom: 20 }]` | `9999` | `1` |

### Build verification test (optional but recommended)

A test that imports the plugin default export and asserts its shape:
```typescript
import plugin from "../../../src/plugins/outline-panel/outline-panel.plugin";
// Assert id, name, version, sidebarPanelId exist and are non-empty strings.
// Assert onEnable and onDisable are functions.
```

---

## Build Command

After implementation:

```bash
npm run build:plugins && npm run sync:plugins
```

Verify:
- Exit code 0
- `src-tauri/plugins/core/outline-panel.js` exists
- No Rollup errors for the outline-panel entry

---

## Definition of Done for Step 01

- [ ] `src/plugins/outline-panel/outline-panel.plugin.ts` created
- [ ] `scripts/build-plugins.mjs` updated with outline-panel entry
- [ ] `tests/plugins/outline-panel/outline-panel.test.ts` created
- [ ] All tests pass: `npm run test:run -- tests/plugins/outline-panel/outline-panel.test.ts`
- [ ] Full test suite passes: `npm run test:run` (zero regressions)
- [ ] `npm run build:plugins` exits 0
- [ ] Manual verification: panel renders heading tree, navigation works, "No headings" state works
