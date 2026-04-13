# Step 01 — Plugin File + Build Config

**Deliverables:**
1. `src/plugins/auto-toc/auto-toc.plugin.ts`
2. `scripts/build-plugins.mjs` — one line added to `PLUGINS` array

**Prerequisite:** None (first step).

**Verified complete when:**
- `npm run build:plugins` exits 0 and prints `auto-toc.js done`.
- `src-tauri/plugins/core/auto-toc.js` exists and is non-empty.
- TypeScript compiler (`tsc --noEmit`) reports no errors in the new file.

---

## File to create: `src/plugins/auto-toc/auto-toc.plugin.ts`

### Preamble comment (required at top of file)

```typescript
/**
 * IIFE entry point for the Auto TOC core plugin.
 *
 * Compiled by scripts/build-plugins.mjs into:
 *   src-tauri/plugins/core/auto-toc.js
 *
 * Self-containment rules (same as all .plugin.ts files):
 *   - No @codemirror/* imports as values — accessed via window.__CM_VIEW__.
 *   - No app-internal module imports (bridge, settings, main, plugin-types).
 *   - CSS injected as <style id="__markable_auto_toc_css__"> in onEnable.
 *   - import type annotations are erased by tsc; safe for IDE support.
 */
```

### CM6 globals destructure

```typescript
/* eslint-disable @typescript-eslint/no-explicit-any */
const { EditorView } =
  (window as any).__CM_VIEW__ as typeof import("@codemirror/view");
/* eslint-enable @typescript-eslint/no-explicit-any */

import type { ViewUpdate } from "@codemirror/view";
import type { MarkablePluginAPI } from "../markable-plugin-api";
```

Only `EditorView` is needed as a runtime value (for `EditorView.updateListener.of` and `EditorView.scrollIntoView`). `ViewUpdate` is a type only.

### Data types (exported for testability)

```typescript
export interface HeadingEntry {
  level: number;       // 1–6
  text: string;        // raw text after "# "; may be empty string
  lineFrom: number;    // absolute char offset of line start (CM6-compatible)
  lineNumber: number;  // 1-based
}
```

### Pure function: `scanHeadings` (exported for testability)

```typescript
export function scanHeadings(docText: string): HeadingEntry[]
```

Implementation contract:

1. Initialize `inFence = false`, `lineStart = 0`, `result: HeadingEntry[] = []`, `lineNumber = 1`.
2. Split `docText` on `\n`. Iterate each `line`.
3. At each iteration:
   a. If `line.trimStart()` starts with ` ``` ` or `~~~`: toggle `inFence`. Advance `lineStart += line.length + 1`; `lineNumber++`; `continue`.
   b. If `!inFence`: test `line` against `/^(#{1,6}) (.*)/`. If it matches: push `{ level: match[1].length, text: match[2], lineFrom: lineStart, lineNumber }`.
   c. `lineStart += line.length + 1`; `lineNumber++`.
4. Return `result`.

The regex `/^(#{1,6}) (.*)/` matches exactly 1–6 `#` characters followed by a literal space then any text. This satisfies FR-4 and EC-6 (empty text = `match[2]` is `""`). Lines starting with `#######` do not match because `{1,6}` is the limit.

Note: `match[2]` may include trailing `#` characters (e.g. `# Heading ##` is valid ATX Markdown and should be kept verbatim per FR-6 Phase-1 rule of no stripping).

### Pure function: `findActiveIndex`

```typescript
function findActiveIndex(entries: HeadingEntry[], cursorPos: number): number
```

Implementation contract:

- Iterate `entries` from index 0 to end.
- Track `active = -1`.
- If `entries[i].lineFrom <= cursorPos`: set `active = i`.
- Else `break` (entries are in document order; once we pass the cursor no later entry can be active).
- Return `active`. Value `-1` means cursor is above all headings.

This function is **not exported** (it is a pure implementation detail; its behavior is covered through integration in the plugin tests via `rebuildTOC`).

### CSS constant

Define a `const TOC_CSS: string` that contains the sidebar CSS as a template literal. The full CSS to embed:

```css
.toc-editor-row {
  display: flex;
  flex-direction: row;
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

#toc-sidebar {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-titlebar);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px 0;
}

.toc-item {
  display: block;
  width: 100%;
  background: none;
  border: none;
  border-left: 2px solid transparent;
  text-align: left;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  padding: 4px 12px;
  color: var(--text-secondary);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  box-sizing: border-box;
}

.toc-item:hover {
  background: var(--code-bg);
}

.toc-item-active {
  color: var(--text-primary);
  border-left: 2px solid var(--link-color);
  background: var(--selection-bg);
}

.toc-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  color: var(--text-secondary);
  pointer-events: none;
  user-select: none;
}
```

### CSS injection helpers

```typescript
function injectCSS(): void {
  const STYLE_ID = "__markable_auto_toc_css__";
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = TOC_CSS;
  document.head.appendChild(style);
}

function removeCSS(): void {
  document.getElementById("__markable_auto_toc_css__")?.remove();
}
```

### DOM lifecycle helpers

#### `createSidebar(): HTMLDivElement`

Creates and returns `#toc-sidebar`. Does not append it to the document.

```typescript
function createSidebar(): HTMLDivElement {
  const sidebar = document.createElement("div");
  sidebar.id = "toc-sidebar";
  const list = document.createElement("div");
  list.className = "toc-list";
  sidebar.appendChild(list);
  _tocList = list;
  return sidebar;
}
```

#### `enableLayout(sidebar: HTMLDivElement): void`

Inserts the `.toc-editor-row` wrapper into `#app`, moves `#editor` into it, appends the sidebar.

```typescript
function enableLayout(sidebar: HTMLDivElement): void {
  const app = document.getElementById("app")!;
  const editor = document.getElementById("editor")!;
  const statusbar = document.getElementById("statusbar");

  const row = document.createElement("div");
  row.className = "toc-editor-row";
  _tocEditorRow = row;

  // Insert the row wrapper before the statusbar (or append if no statusbar).
  if (statusbar) {
    app.insertBefore(row, statusbar);
  } else {
    app.appendChild(row);
  }

  row.appendChild(editor);
  row.appendChild(sidebar);
}
```

#### `disableLayout(): void`

Reverses `enableLayout` exactly.

```typescript
function disableLayout(): void {
  const app = document.getElementById("app")!;
  const editor = document.getElementById("editor")!;
  const statusbar = document.getElementById("statusbar");

  // Move #editor back to #app, before statusbar.
  if (statusbar) {
    app.insertBefore(editor, statusbar);
  } else {
    app.appendChild(editor);
  }

  // Remove sidebar and row wrapper.
  _tocSidebar?.remove();
  _tocEditorRow?.remove();
  _tocSidebar = null;
  _tocEditorRow = null;
  _tocList = null;
}
```

### DOM render helper: `rebuildTOC`

```typescript
function rebuildTOC(entries: HeadingEntry[], activeIdx: number): void {
  if (!_tocList) return;

  // Remove all existing children (clears old listeners implicitly).
  _tocList.innerHTML = "";

  if (entries.length === 0) {
    const empty = document.createElement("div");
    empty.className = "toc-empty";
    empty.textContent = "No headings";
    _tocList.appendChild(empty);
    return;
  }

  const BASE_PADDING = 12; // px for left-side base padding
  const INDENT_PER_LEVEL = 12; // px per level below H1

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const btn = document.createElement("button");
    btn.className = "toc-item";
    if (i === activeIdx) btn.classList.add("toc-item-active");

    const indent = (entry.level - 1) * INDENT_PER_LEVEL;
    btn.style.paddingLeft = `${BASE_PADDING + indent}px`;

    // EC-6: empty heading text gets a non-breaking space so the button has height.
    btn.textContent = entry.text || "\u00A0";

    // Click-to-jump: capture lineFrom in closure.
    const lineFrom = entry.lineFrom;
    btn.addEventListener("click", () => {
      if (!_view) return;
      _view.dispatch({
        selection: { anchor: lineFrom },
        effects: EditorView.scrollIntoView(lineFrom, { y: "center" }),
      });
      _view.focus();
    });

    _tocList.appendChild(btn);
  }
}
```

Implementation notes:
- `_tocList.innerHTML = ""` removes all child nodes and their inline event listeners in one operation. This satisfies the "no memory leaks" non-functional requirement — no explicit removeEventListener calls are needed because the nodes are discarded.
- `rebuildTOC` is called both for doc changes (entries may differ) and selection changes (only `activeIdx` differs). Both paths replace all children, which is acceptable given the 200-heading upper bound from EC-9.

### CM6 updateListener

```typescript
const tocUpdateListener = EditorView.updateListener.of((update: ViewUpdate) => {
  if (!_enabled) return;

  // Always capture the latest view reference.
  _view = update.view;

  const docChanged = update.docChanged;
  const selChanged = update.selectionSet;

  if (!docChanged && !selChanged) return;

  // Cancel any pending debounce.
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }

  // Snapshot immutable values before the async delay.
  const docText = docChanged ? update.state.doc.toString() : null;
  const cursorPos = update.state.selection.main.head;

  _debounceTimer = setTimeout(() => {
    if (!_enabled) return;
    if (docText !== null) {
      _lastEntries = scanHeadings(docText);
    }
    const activeIdx = findActiveIndex(_lastEntries, cursorPos);
    rebuildTOC(_lastEntries, activeIdx);
  }, DEBOUNCE_MS);
});
```

Key design decisions:
- `_view` is captured on **every** update (not just doc changes) so it is always fresh. This is cheap (just an assignment).
- When only the selection changed (`!docChanged`), the snapshot of `docText` is `null` and `_lastEntries` is reused from the previous scan. Only `activeIdx` is recalculated. This avoids re-scanning the full document on every cursor move.
- When `docChanged`, a fresh `docText` snapshot is taken before the timeout. The snapshot is taken immediately (not inside the timeout) so no stale closure captures the `update` object after the transaction is discarded.
- The guard `if (!_enabled) return` inside the timeout body handles the case where the plugin is disabled during the debounce window (EC-10).

### Module-level state declarations

Place all module-level `let` declarations at the top of the file, after the imports:

```typescript
const DEBOUNCE_MS = 150;

let _view: import("@codemirror/view").EditorView | null = null;
let _enabled = false;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _lastEntries: HeadingEntry[] = [];
let _tocList: HTMLElement | null = null;
let _tocEditorRow: HTMLDivElement | null = null;
let _tocSidebar: HTMLDivElement | null = null;
```

The `import("@codemirror/view").EditorView` type reference in the `let _view` declaration uses a dynamic import type — this is erased by tsc and produces no runtime code, identical to using `EditorView` as a type annotation in a `import type` statement.

### Plugin export object

```typescript
export default {
  id: "auto-toc",
  name: "Auto TOC",
  version: "1.0.0",
  description: "Table of contents sidebar",
  detail:
    "Displays a real-time table of contents in a right-side sidebar, listing all headings in the document. The active heading is highlighted as you move the cursor through the document. Click any heading to jump to it instantly.",

  onEnable(api: MarkablePluginAPI): void {
    _enabled = true;
    api.loadSettings(); // Forward-compatibility stub (FR-12); result discarded.

    injectCSS();
    _tocSidebar = createSidebar();
    enableLayout(_tocSidebar);
    api.addExtensions([tocUpdateListener]);

    // Trigger an initial build with the current document content.
    // The updateListener fires on the next transaction; for the initial state
    // we trigger a synthetic build immediately. The view is not yet captured
    // at this point, so we read from the CM6 view via the window global.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const liveView = (window as any).__MARKABLE_EDITOR_VIEW__ as
      | import("@codemirror/view").EditorView
      | undefined;
    /* eslint-enable @typescript-eslint/no-explicit-any */
    if (liveView) {
      _view = liveView;
      _lastEntries = scanHeadings(liveView.state.doc.toString());
      const activeIdx = findActiveIndex(
        _lastEntries,
        liveView.state.selection.main.head,
      );
      rebuildTOC(_lastEntries, activeIdx);
    } else {
      // No document yet; show empty state.
      rebuildTOC([], -1);
    }
  },

  onDisable(api: MarkablePluginAPI): void {
    _enabled = false;

    if (_debounceTimer) {
      clearTimeout(_debounceTimer);
      _debounceTimer = null;
    }

    api.removeExtensions();
    disableLayout();
    removeCSS();

    // Reset all module-level state.
    _view = null;
    _lastEntries = [];
  },
};
```

#### Note on `__MARKABLE_EDITOR_VIEW__`

The `onEnable` initial build reads from `window.__MARKABLE_EDITOR_VIEW__` (if it exists) to populate the TOC immediately when the plugin is first enabled, rather than waiting for the next document change. This is a convenience path — if the global is absent the plugin shows the empty state and the updateListener populates it on the next keystroke.

**The developer must confirm** whether `window.__MARKABLE_EDITOR_VIEW__` is already exposed in `src/main.ts` or `src/lib/cm-globals.ts`. If it is not, the initial build path should use `rebuildTOC([], -1)` unconditionally for now, and the first cursor movement will trigger a full rebuild via the updateListener. The architecture does not depend on this global being present — it is a progressive enhancement.

---

## File to modify: `scripts/build-plugins.mjs`

Add one entry to the `PLUGINS` array. The entry goes after the existing `"word-count"` entry:

```javascript
// Before:
const PLUGINS = [
  ["focus-mode",      "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode", "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",      "src/plugins/word-count/word-count.plugin.ts"],
  ["status-bar",      "src/plugins/status-bar/status-bar.plugin.ts"],
];

// After:
const PLUGINS = [
  ["focus-mode",      "src/plugins/focus-mode/focus-mode.plugin.ts"],
  ["typewriter-mode", "src/plugins/typewriter-mode/typewriter-mode.plugin.ts"],
  ["word-count",      "src/plugins/word-count/word-count.plugin.ts"],
  ["status-bar",      "src/plugins/status-bar/status-bar.plugin.ts"],
  ["auto-toc",        "src/plugins/auto-toc/auto-toc.plugin.ts"],
];
```

Also update the success message at the bottom of the file from `"All 4 core plugins"` to `"All 5 core plugins"`.

---

## Checklist for step_01

- [ ] Directory `src/plugins/auto-toc/` created
- [ ] `auto-toc.plugin.ts` created with all sections above
- [ ] `scanHeadings` is `export function` (not default export, not unexported)
- [ ] `HeadingEntry` is `export interface`
- [ ] `export default` object has all required `UnifiedPlugin` fields
- [ ] No `import` from `@codemirror/*` as a value (only `import type`)
- [ ] No imports from any `src/lib/*` or `src/main` or `src/editor/*`
- [ ] `build-plugins.mjs` has `auto-toc` entry added
- [ ] `npm run build:plugins` exits 0
- [ ] `src-tauri/plugins/core/auto-toc.js` exists
