# Active Task: Auto TOC Plugin — Phase 1 (Sidebar Mode)

**Status: VALIDATED**
**Date: 2026-04-13**
**Supersedes:** Unified Plugin System task (now complete)
**Scope:** Phase 1 of the Auto TOC plugin: sidebar-only. Phase 2 (left-margin dot/line mode) is explicitly out of scope and will be a separate work item.

---

## Summary

As a Markable user, I want a Table of Contents sidebar on the right side of the editor that shows all headings in the current document, updates in real time as I type, highlights the section I am currently editing, and lets me jump to any heading with a single click — all controlled by the existing plugin toggle in the Plugins panel.

---

## Background and Constraints from Existing Architecture

The following facts are locked by existing code and are hard constraints for this feature.

### Plugin system (locked)

- All plugins are IIFE `.js` files compiled from `src/plugins/<name>/<name>.plugin.ts` and output to `src-tauri/plugins/core/<name>.js`.
- Every plugin receives a `MarkablePluginAPI` object in `onEnable` / `onDisable`. The raw `EditorView` is not exposed through the API.
- CM6 extensions are registered via `api.addExtensions([...])` in `onEnable` and removed via `api.removeExtensions()` in `onDisable`.
- CSS that cannot be imported from within the IIFE sandbox must be injected as a `<style>` tag in `onEnable` and removed in `onDisable` (see focus-mode.plugin.ts precedent).
- The `MarkablePluginAPI` does not expose DOM references to the editor container or status bar beyond the three status bar zone elements. Any DOM the plugin needs beyond those zones must be created and appended directly to `document.body` or a suitable parent, and torn down on `onDisable`.

### CM6 access pattern (locked)

- CM6 packages are not bundled inside the IIFE. Plugins access them via `window.__CM_VIEW__` and `window.__CM_STATE__` globals assigned before any plugin runs.
- To read document headings, the plugin must use the CM6 `EditorView.updateListener` extension (via `api.addExtensions`) to receive `ViewUpdate` events and iterate the document tree, OR use the lezer syntax tree via `syntaxTree(state)` from `@codemirror/language` accessed as `window.__CM_LANGUAGE__` (check whether this global is currently exposed — see Open Question OQ-1).
- To scroll a heading into view after click, the plugin must call `view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "center" }) })` and also `view.dispatch({ selection: { anchor: pos } })`. The plugin accesses the live `EditorView` instance through `window.__CM_VIEW__` (already a pattern used by other parts of the codebase for the editor instance — see Open Question OQ-2).

### DOM layout (locked)

The current `#app` layout (from `index.html` + `styles.css`):

```
body (flex-direction: column)
  #titlebar  (height: 38px, flex-shrink: 0)
  #app       (flex: 1, display: flex, flex-direction: column)
    #editor  (flex: 1, overflow: hidden)
    #statusbar (hidden unless a plugin uses it)
```

Adding a sidebar requires changing `#app`'s flex-direction to `row` (or inserting a new row-flex wrapper inside it), then placing the TOC panel as a sibling to `#editor`. This is a layout-level change that affects the main app styles, not just the plugin's own CSS.

---

## Functional Requirements

### FR-1: Plugin identity

The plugin must be a core plugin conforming to the `UnifiedPlugin` interface:

| Field | Value |
|---|---|
| `id` | `"auto-toc"` |
| `name` | `"Auto TOC"` |
| `version` | `"1.0.0"` |
| `description` | `"Table of contents sidebar"` |
| `detail` | Long-form description shown in the plugin panel detail view (see FR-2) |

The plugin is compiled from `src/plugins/auto-toc/auto-toc.plugin.ts` and output to `src-tauri/plugins/core/auto-toc.js`.

### FR-2: Plugin panel detail text

The `detail` field must describe what the plugin does, including the sidebar mode, real-time updates, active heading highlight, and click-to-jump behavior, in 2–3 sentences suitable for the Plugins panel detail view.

### FR-3: Sidebar DOM structure

When the plugin is enabled (`onEnable`), it must:

1. Create a `<div id="toc-sidebar">` element.
2. Append it as a sibling to `#editor` inside `#app` (on the right side).
3. Apply `display: flex; flex-direction: row;` to `#app` (or the nearest suitable wrapper) so that `#editor` and `#toc-sidebar` sit side by side horizontally. The `#editor` element must shrink to fill remaining space (`flex: 1`); the sidebar must have a fixed width (see FR-5).
4. Restore `#app` layout to its original state on `onDisable`.

When the plugin is disabled (`onDisable`), it must:

1. Remove `#toc-sidebar` from the DOM.
2. Restore `#app` (or wrapper) to its original `flex-direction: column` layout so the editor occupies the full width again.

### FR-4: Heading detection

The plugin must detect ATX headings at levels H1 through H6 (lines starting with one to six `#` characters followed by a space) from the CM6 document. Detection must parse the text content of the heading (the part after the `#` marks and the space).

- Headings are identified by iterating the CM6 document text line by line, not by injecting widgets or decorations into the editor viewport.
- The heading list is rebuilt on every `ViewUpdate` where `update.docChanged` is true, debounced to avoid rebuilding on every keystroke (debounce interval: 200 ms is the recommended starting point — see Open Question OQ-3).
- Setext headings (underline style: `===` / `---`) are out of scope for Phase 1.

### FR-5: Sidebar dimensions

- Width: fixed at `220px`. No resize handle.
- Height: the sidebar fills the full height of `#app` minus the title bar.
- The TOC item list inside the sidebar must overflow and scroll vertically (`overflow-y: auto`) when it is taller than the sidebar height.
- The sidebar itself does not scroll horizontally.

### FR-6: TOC item rendering

Each heading in the document is rendered as one item in the TOC list. Items must:

- Be displayed in document order (top to bottom).
- Be visually indented by heading level: H1 has no indent; each level below H1 adds an indent increment (exact value: see Open Question OQ-4).
- Show the plain text of the heading (Markdown syntax characters such as `**`, `_`, `[`, `]` are displayed as-is in Phase 1; no inline rendering required).
- Be clickable (see FR-8).

### FR-7: Active heading highlight

The "active heading" is defined as the last heading whose line number is less than or equal to the current cursor line. In other words, the cursor falls within that heading's section.

- The active heading item in the TOC list receives a distinct visual treatment (background color, left border accent, or similar — exact style: see Open Question OQ-4).
- The active heading is recalculated on every `ViewUpdate` where `update.selectionSet` is true or `update.docChanged` is true.
- If the cursor is above the first heading, no item is highlighted.
- If the document has no headings, no item is highlighted (empty state — see FR-9).

### FR-8: Click-to-jump

Clicking a TOC item must:

1. Move the CM6 cursor to the first character of that heading's line.
2. Scroll the editor viewport so the heading line is centered vertically (`y: "center"`).
3. Refocus the editor after the jump (so the user can continue typing without an extra click).

The plugin accesses the live `EditorView` instance to dispatch the scroll/selection transaction (see Open Question OQ-2 for the exact global access pattern).

### FR-9: Empty state

When the document contains no headings (H1–H6), the TOC sidebar must display a non-interactive placeholder message. Exact text: "No headings" (centered, muted color). The placeholder disappears as soon as the user types the first heading.

### FR-10: Theme compatibility

The sidebar must use CSS variables from the existing design token set (`--bg-primary`, `--bg-titlebar`, `--border-color`, `--text-primary`, `--text-secondary`, `--link-color`) so that it automatically adapts to light mode, dark mode, and custom CSS themes without any plugin-side logic.

The sidebar background should use `--bg-titlebar` (same as the title bar) to visually separate it from the editor content area.

### FR-11: Enable / disable lifecycle

- `onEnable`: create sidebar DOM, inject CSS `<style>` tag, alter `#app` layout, register CM6 `updateListener` extension via `api.addExtensions`.
- `onDisable`: call `api.removeExtensions()`, remove sidebar DOM, remove injected `<style>` tag, restore `#app` layout.
- Toggle cycles (enable → disable → enable) must leave no orphaned DOM nodes, no duplicate `<style>` tags, and no stale CM6 extensions.

### FR-12: Settings stub

The plugin must call `api.loadSettings()` in `onEnable` to retrieve any previously saved settings. In Phase 1, no user-facing settings are persisted; `loadSettings()` will return `null` on first run and the result is discarded. The call must be present so the architecture is forward-compatible with Phase 2 settings without an API change.

### FR-13: Heading depth setting (Phase 1 default)

All six heading levels (H1–H6) are shown in Phase 1. No user-facing control for filtering heading depth is included in this phase.

---

## Layout Change Specification

The current `#app` element uses `flex-direction: column`. This must change to `flex-direction: row` when the sidebar is present so the editor and TOC sit side by side.

The approach must not break the existing `#statusbar` behavior. The status bar is a direct child of `#app` and currently spans full width in the column layout. When the sidebar is enabled, the status bar must continue to span the full width below the editor+sidebar row.

Recommended DOM structure when sidebar is active:

```
#app  (flex: column — unchanged outer structure)
  .toc-editor-row  (flex: row — new wrapper or #app itself reused)
    #editor        (flex: 1)
    #toc-sidebar   (width: 220px, flex-shrink: 0)
  #statusbar       (full width, unchanged)
```

The plugin must choose one of the following two layout strategies:

**Strategy A (wrapper element):** Insert a new `<div class="toc-editor-row">` wrapper inside `#app`, move `#editor` into it, and append `#toc-sidebar` next to it. Reverse on disable by moving `#editor` back and removing the wrapper. This approach avoids modifying `#app`'s own CSS.

**Strategy B (mutate #app):** Change `#app`'s `flex-direction` from `column` to `row` directly, append `#toc-sidebar`, and insert an inner column wrapper for the remaining children. Reverse on disable.

The architect must choose one strategy and document the rationale. Strategy A is the recommended starting point because it requires fewer DOM mutations to reverse cleanly.

---

## Out of Scope (Phase 1)

The following items are explicitly excluded from this specification. They must not be implemented in Phase 1, but the architecture must not preclude them being added later.

| Item | Notes |
|---|---|
| Phase 2 dot/line mode (left margin) | Separate work item |
| Sidebar resize handle | Not required in Phase 1 |
| Setext heading detection (`===` / `---`) | Phase 1 uses ATX headings only |
| Inline Markdown rendering in TOC items | Plain text only in Phase 1 |
| Heading depth filter (show only H1–H3, etc.) | Phase 1 shows all levels |
| Auto-scroll the TOC list to keep the active heading visible | Nice to have; Phase 1 may omit this |
| Keyboard navigation within the TOC list | Phase 1 click-only |
| "Collapse" / "expand" TOC entries with children | Phase 1 flat list only |
| Persisted sidebar width | Phase 1 fixed width only |
| Export integration (TOC in exported HTML) | Separate feature |
| Multiple windows / multi-document | Markable is single-window in Phase 1 |

---

## Open Questions

These must be answered by the Software Architect before implementation begins. If any are unresolvable from the codebase alone, the architect must document the decision taken and the rationale.

**OQ-1 — Lezer syntax tree access in plugin IIFE:**
Does `window.__CM_LANGUAGE__` (or equivalent) expose `syntaxTree()` from `@codemirror/language` to plugin IIFEs? If not, the heading parser must use plain string matching on `state.doc` lines (which is simpler and sufficient for ATX headings). The architect must confirm which approach is used and update the spec accordingly.

**OQ-2 — Live EditorView access from plugin:**
Plugin IIFEs do not receive `EditorView` through the API. The click-to-jump behavior (FR-8) requires dispatching a transaction on the live view. The current pattern used in other parts of the codebase is `window.__CM_VIEW__` for the module namespace, but the *live instance* (`EditorView` object) is a different thing. Confirm the correct global or accessor pattern for obtaining the live editor instance from within a plugin IIFE (e.g. `window.__MARKABLE_EDITOR_VIEW__` or similar).

**OQ-3 — Debounce interval for heading rebuild:**
200 ms is proposed. The word-count plugin uses 150 ms. Confirm whether 200 ms is acceptable or whether it should match 150 ms for consistency.

**OQ-4 — Visual design tokens for the sidebar:**
The following design details are left for the architect/designer to specify before implementation:
- Indent increment per heading level (e.g. `12px` per level, so H2 = 12px, H3 = 24px, etc.)
- Active heading highlight style (e.g. background `var(--selection-bg)` + left border `2px solid var(--link-color)`)
- TOC item font size (e.g. `13px` to match the status bar / title bar)
- TOC item line height and padding
- Sidebar header label (e.g. "Contents" or no header at all)

---

## Edge Case Inventory

This list is the mandatory test checklist for the Code Reviewer. Every item must have a corresponding test or a documented reason it cannot be automated.

| # | Scenario | Expected behaviour |
|---|---|---|
| EC-1 | Document is empty (no text at all) | Sidebar shows empty-state placeholder "No headings" |
| EC-2 | Document has text but no headings | Sidebar shows "No headings" placeholder |
| EC-3 | Cursor is above the first heading | No TOC item is highlighted |
| EC-4 | Document has only H1 headings (no deeper levels) | All items shown with no indent; all are highlighted correctly as cursor moves |
| EC-5 | Document has only H6 headings (maximum depth) | Items shown at maximum indent level |
| EC-6 | Heading text is empty (`# ` with no text after the space) | Empty-text heading is included in the TOC list as a blank item (not skipped); the line is still a valid jump target |
| EC-7 | Heading text contains Markdown inline syntax (`**bold**`, `[link](url)`, etc.) | Displayed verbatim (raw Markdown) in Phase 1; no crash |
| EC-8 | Two or more headings have identical text | Both appear as separate items; clicking each jumps to the correct line |
| EC-9 | Document has more than 200 headings | TOC renders all of them without noticeable lag; list scrolls correctly |
| EC-10 | Plugin is toggled off while the cursor is inside a heading section | Sidebar is removed cleanly; editor returns to full width; no orphaned DOM |
| EC-11 | Plugin is toggled off then on (one full toggle cycle) | No duplicate `<style>` tags; no duplicate sidebar elements; no stale CM6 updateListener |
| EC-12 | Plugin is toggled off then on rapidly (3+ cycles) | Each cycle is clean; the CM6 compartment is not corrupted |
| EC-13 | User types a new heading at the top of the document | Within the debounce window, the TOC rebuilds and the new heading appears at the top |
| EC-14 | User deletes a heading that was previously the active heading | After debounce, that item disappears from the TOC; the active highlight moves to the new active heading (or clears if no heading precedes cursor) |
| EC-15 | User renames a heading while it is the active heading | After debounce, TOC item text updates; active highlight remains on the correct item |
| EC-16 | Window is resized while sidebar is visible | Sidebar remains `220px` wide; editor flex-grows to fill remaining space |
| EC-17 | Content width setting is changed while sidebar is visible | Editor content max-width is still respected within the narrower `#editor` flex cell |
| EC-18 | Zoom (font size) is changed while sidebar is visible | Sidebar font size is independent of zoom; editor zoom does not distort sidebar |
| EC-19 | Dark mode is active when plugin is enabled | Sidebar uses correct dark-mode CSS variable values via `--bg-titlebar`, `--text-primary`, etc. |
| EC-20 | Custom CSS theme is active when plugin is enabled | Sidebar variables resolve from the custom theme correctly (inherits from `:root` overrides) |
| EC-21 | Status bar is visible at the same time as the sidebar | Status bar still spans full width below the editor+sidebar row; not clipped or overlapped |
| EC-22 | Heading on line 1 (very first line of document) | Jump works correctly; scroll-to-center works even when the heading is near the top of the file |
| EC-23 | Heading on the last line of the document | Jump works correctly; scroll-to-center does not over-scroll |
| EC-24 | `loadSettings()` returns `null` (first run, no settings file) | Plugin enables correctly; no error thrown or logged |
| EC-25 | A line starts with `#` but is inside a fenced code block | This line must NOT be treated as a heading (see OQ-1 — if using plain string matching rather than the lezer tree, the architect must specify how code fence context is detected, or document that Phase 1 does not handle this case and accepts the false-positive) |
| EC-26 | View Mode is active (all lines in preview-only mode) | Clicking a TOC item must still move the cursor and scroll correctly; view mode does not block dispatching transactions |
| EC-27 | TOC sidebar is open and a new file is loaded | TOC list rebuilds immediately for the new document |
| EC-28 | TOC sidebar is open and "Close All" (or new empty document) is triggered | TOC list clears to the "No headings" empty state |

---

## Non-Functional Requirements

- **Performance:** Heading rebuild is debounced (FR-4). The `updateListener` callback must do minimal work in the hot path (only check `update.docChanged`; schedule rebuild via `setTimeout`).
- **Accessibility:** TOC items are `<button>` or `<a>` elements (keyboard-focusable, announced by VoiceOver as interactive). Phase 1 minimum: each item must be reachable and activatable by keyboard after the TOC receives focus.
- **No memory leaks:** All event listeners on TOC items are cleaned up in `onDisable` (or by removing the DOM subtree, which implicitly removes inline listeners — confirm which pattern is used).
- **No app-internal imports:** The plugin IIFE must not import from `src/lib/bridge`, `src/lib/settings`, `src/main`, or any other app-internal module. Only `@codemirror/*` and window globals are permitted.

---

## Proposed Constraints

- **PC-1:** The sidebar must not use `position: fixed` or `position: absolute`. It must participate in the normal document flow as a flex child so that the editor content area shrinks correctly (no overlay behaviour).
- **PC-2:** The plugin must not access `document.getElementById("editor")` and mutate the `#editor` element's own styles. It may only alter `#app`'s layout (or insert a wrapper). The `#editor` element's `flex: 1` rule handles its own width automatically.
- **PC-3:** The `<style>` tag injected by the plugin must use a unique `id` attribute (e.g. `__markable_auto_toc_css__`) and the injection function must guard against duplicate insertion (same pattern as `focus-mode.plugin.ts` — see `injectCSS()` guard).
- **PC-4:** Heading detection in Phase 1 must not introduce a dependency on `@codemirror/language`'s `syntaxTree` unless OQ-1 confirms the global is available. A regex-based line scanner is a valid and preferred fallback for ATX headings.
- **PC-5:** The plugin's `onDisable` must restore `#app`'s layout to exactly the state it was in before `onEnable` ran, regardless of any intermediate window resize or theme change events.
