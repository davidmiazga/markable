---
title: "Markdown Toolbar Plugin"
last-updated: "2026-04-15"
review-cadence-days: 14
status: active
---

# Markdown Toolbar Plugin — Requirements Spec

## Summary

As a user, I want a formatting toolbar with buttons for common Markdown styles so that I can apply and remove inline formatting without memorising syntax.

---

## Functional Requirements

### FR-1: Two Display Modes

The plugin supports exactly two mutually exclusive display modes, controlled by a persistent setting (`toolbarMode`).

| Mode | Description |
|---|---|
| `floating` | A bubble/palette that appears above the active text selection in the editor. Default mode. |
| `sidebar` | Docked inside a left or right sidebar panel registered via `api.registerSidebarPanel()`. |

The active mode is stored via `api.saveSettings()` and restored via `api.loadSettings()` on plugin enable. On first enable (no saved settings), `floating` mode is used and `sidebarSide` defaults to `"left"`.

### FR-2: Toolbar Buttons (10 total)

Each button wraps the current selection in the corresponding Markdown syntax. Buttons are listed in display order.

| # | Label | Syntax Applied | Notes |
|---|---|---|---|
| 1 | Bold | `**selection**` | |
| 2 | Italic | `*selection*` | |
| 3 | Underline | `<u>selection</u>` | HTML tag, not native Markdown |
| 4 | Strikethrough | `~~selection~~` | |
| 5 | Highlight | `==selection==` | |
| 6 | Inline Code | `` `selection` `` | |
| 7 | Superscript | `^selection^` | |
| 8 | Link | `[selection](url)` | See FR-9 for URL resolution |
| 9 | Image | `![selection](url)` | See FR-9 for URL resolution |
| 10 | Erase Formatting | (strip all wrappers) | See FR-10 |

Clicking a button that is already "active" (cursor/selection is inside that format) removes the wrapper instead of nesting it. This is a toggle: apply if absent, remove if present.

### FR-3: Active State Detection

When the cursor rests inside, or the selection overlaps, a formatted region, the corresponding button shows a highlighted/active visual state.

- Detection inspects the text immediately surrounding `selection.main` in the CM6 state.
- All ten formats (FR-2) participate in active state detection, including Underline (`<u>`) and Image (`![`).
- When the selection spans multiple overlapping formats (e.g. bold AND italic), all applicable buttons are highlighted simultaneously.
- Detection is re-evaluated on every CM6 `selectionSet` or `docChanged` event via the `updateListener` extension.

### FR-4: Floating Mode Behaviour

- The toolbar DOM element is appended to `document.body` and uses `position: fixed` to overlay the editor.
- The toolbar appears when `selection.main.from !== selection.main.to` (non-empty selection).
- Position is computed using `view.coordsAtPos(selection.main.from)` to place the toolbar above the start of the selection with a fixed vertical offset (e.g. `top - toolbarHeight - 8px`).
- The toolbar is hidden (or removed from the DOM) when the selection is cleared.
- The toolbar does not consume pointer events that fall through to the editor. Clicking a button applies the format and preserves the original selection range (restoring it after the dispatch if needed).
- The toolbar must not appear when the editor does not have focus (i.e. selection events from other inputs).

### FR-5: Sidebar Mode Behaviour

- The toolbar is registered as a sidebar panel via `api.registerSidebarPanel()` with `id: "markdown-toolbar"`.
- The toolbar is always visible while the plugin is enabled; it does not show/hide based on selection.
- Buttons are visually disabled (grayed out, `pointer-events: none`) when the selection is empty (`selection.main.empty === true`).
- Buttons remain enabled when the selection is non-empty.
- Active state detection (FR-3) functions the same as in floating mode.

### FR-6: Plugin Integration Contracts

- File: `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`
- Filename on disk (compiled): `markdown-toolbar.js` in `plugins/core/`
- Plugin object fields:
  - `id: "markdown-toolbar"`
  - `name: "Markdown Toolbar"`
  - `version: "1.0.0"`
  - `description`: one-line summary
  - `detail`: multi-sentence description for the Plugins Panel
  - `sidebarPanelId: "markdown-toolbar"` — always set; the sidebar assignment toggle in the Plugins Panel relies on this field. When `toolbarMode` is `"floating"`, the panel is not registered at runtime, but the field is still present on the plugin object so the panel assignment UI is always available.
- `onEnable(api)`: loads settings, resolves mode, injects CSS, registers CM6 extension, conditionally registers sidebar panel.
- `onDisable(api)`: removes CM6 extension, unregisters sidebar panel if registered, removes floating toolbar DOM, removes injected CSS, resets all module-level state.
- CM6 globals access pattern: all `@codemirror/*` values accessed via `window.__CM_VIEW__` (same pattern as `word-count.plugin.ts` and `auto-toc.plugin.ts`). `window.__CM_VIEW__` is never accessed at module-evaluation time; only inside `onEnable` or factory functions called from `onEnable`.
- Direct editor dispatch uses `(window as any).__MARKABLE_EDITOR_VIEW__` (same pattern as `auto-toc.plugin.ts` render callback).

### FR-7: Persistent Settings

Settings object shape (stored at `plugins/markdown-toolbar/settings.json`):

```
{
  toolbarMode: "floating" | "sidebar",   // default "floating"
  sidebarSide: "left" | "right"          // default "left"
}
```

- `saveSettings` is called immediately whenever either setting changes.
- `loadSettings` is called in `onEnable`; on `null` return the defaults above are used.
- The `sidebarSide` value determines the `side` field passed to `api.registerSidebarPanel()` when `toolbarMode === "sidebar"`.

### FR-8: Formatting Dispatch

- All formatting operations are dispatched as CM6 transactions via `view.dispatch({ changes: ..., selection: ... })`.
- Transactions must be constructed so that Cmd-Z (undo) reverses them in a single step. Each button click produces exactly one `view.dispatch` call (not multiple sequential dispatches).
- After applying a wrapping format, the selection is updated to cover only the inserted text content (not the markers), so the user can keep typing without re-selecting.
- After removing a format (toggle off), the selection is updated to cover the remaining unwrapped text.

### FR-9: URL Resolution for Link and Image

When the Link or Image button is activated:

1. Attempt to read the system clipboard via `navigator.clipboard.readText()`.
2. If the clipboard contains a string that passes a URL heuristic (starts with `http://`, `https://`, `ftp://`, or `/`), use it as the URL without prompting.
3. Otherwise, call `window.prompt("Enter URL:")`. If the user cancels (`null` return), abort the operation with no changes to the document.
4. The resolved URL is inserted into the `(url)` placeholder.

### FR-10: Erase Formatting

The Erase button removes all recognised format wrappers from the current selection:

- Bold (`**`), Italic (`*`), Underline (`<u>...</u>`), Strikethrough (`~~`), Highlight (`==`), Inline Code (`` ` ``), Superscript (`^`).
- Link syntax `[text](url)` is stripped to `text` (the URL and brackets are removed).
- Image syntax `![alt](url)` is stripped to `alt`.
- Stripping is applied iteratively until no further wrappers are found (handles nested formats).
- All stripping happens in a single `view.dispatch` call (one undoable step).

### FR-11: CSS Scoping and Injection

- All CSS class names are prefixed `.md-toolbar` (e.g. `.md-toolbar`, `.md-toolbar__btn`, `.md-toolbar__btn--active`, `.md-toolbar__btn--disabled`).
- CSS is injected as a `<style id="__markable_md_toolbar_css__">` tag in `onEnable`.
- The same guard used in `auto-toc.plugin.ts` (check `document.getElementById(STYLE_ID)` before inserting) prevents duplicate injection on rapid toggle cycles.
- CSS is removed in `onDisable` by removing the `<style>` element by id.
- CSS uses `var(--bg-primary)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--link-color)`, `var(--selection-bg)`, `var(--code-bg)` for automatic theme adoption.

---

## Non-Functional Requirements

### NFR-1: No New Dependencies

The plugin uses only vanilla TypeScript/DOM APIs. No third-party libraries are added to `package.json`. CM6 APIs are accessed exclusively through the existing `window.__CM_VIEW__` global (same pattern as all other plugins).

### NFR-2: Performance

- The CM6 `updateListener` extension is debounced at 150 ms (matching the existing plugins) for active-state detection updates.
- In floating mode, toolbar position recalculation runs synchronously on each selection change (no debounce) to avoid visual lag in the bubble position. Position update is cheap (one `coordsAtPos` call + two style assignments).
- Toolbar DOM is created once in `onEnable` and reused; it is not recreated per selection event.

### NFR-3: Toggle Cycle Correctness

The plugin must survive repeated enable/disable cycles without leaking DOM nodes, event listeners, or CM6 extensions:

- All module-level state is reset to initial values at the end of `onDisable`.
- The `<style>` tag is removed in `onDisable`.
- The floating toolbar DOM element is removed from `document.body` in `onDisable`.
- `api.removeExtensions()` is always called in `onDisable`.
- `api.unregisterSidebarPanel("markdown-toolbar")` is called in `onDisable` if (and only if) the panel was registered in the corresponding `onEnable`.

### NFR-4: Mode Switch Without Plugin Restart

If a future settings UI allows changing `toolbarMode` while the plugin is enabled, the plugin must cleanly teardown the current mode and set up the new one (disable then re-enable pattern is acceptable for v1.0; no live mode-switch is required in this release).

---

## Edge Case Inventory

All items below are mandatory test cases for the Code Reviewer.

| # | Scenario | Expected Behaviour |
|---|---|---|
| EC-1 | Empty selection in floating mode | Toolbar does not appear; no DOM insertion or positioning occurs |
| EC-2 | Empty selection in sidebar mode | All 10 buttons are visually disabled; clicks are no-ops |
| EC-3 | Selection covers both bold and italic (e.g. `***text***`) | Both Bold and Italic buttons show active state simultaneously |
| EC-4 | Nested formats — inner italics inside bold (`**_text_**`) | Both Bold and Italic detected; active state on both buttons |
| EC-5 | Toggle off — cursor inside `**text**`, click Bold | Bold markers removed; selection covers unwrapped `text`; one undo step restores markers |
| EC-6 | Undo after bold applied | Single Cmd-Z reverts the entire wrap (one dispatch = one undo step) |
| EC-7 | Link button, clipboard contains `https://example.com` | No prompt; URL inserted directly |
| EC-8 | Link button, clipboard is empty or non-URL text | `window.prompt` shown; user input used as URL |
| EC-9 | Link button, user cancels prompt (returns null) | No changes to document; selection unchanged |
| EC-10 | Image button with empty alt text (no selection) | Sidebar mode: button disabled (EC-2). Floating mode: toolbar not shown (EC-1). Both enforced by the empty-selection guard |
| EC-11 | Erase on selection with no recognised wrappers | No document change; one dispatch with empty changeset or no dispatch at all |
| EC-12 | Erase on selection with mixed formats (`**bold** and *italic*`) | All wrappers stripped in a single dispatch; result is `bold and italic` |
| EC-13 | Erase on link `[text](https://url)` | Reduces to `text`; URL and surrounding syntax removed in one dispatch |
| EC-14 | Floating toolbar positioned near top of viewport | Toolbar positioned below the selection (flipped) when insufficient space above; or clamped so it remains on-screen |
| EC-15 | Rapid toggle (enable/disable/enable) | No duplicate `<style>` tags; no orphaned toolbar DOM; no stale CM6 extensions; no duplicate sidebar panels |
| EC-16 | Plugin disabled while toolbar is visible (floating mode) | Toolbar is removed from DOM immediately in `onDisable`; no dangling element |
| EC-17 | Plugin disabled while sidebar panel is registered | `api.unregisterSidebarPanel` called; `SidebarManager.destroy()` runs cleanly |
| EC-18 | `loadSettings()` returns null (first run) | Defaults used: `toolbarMode: "floating"`, `sidebarSide: "left"`; no crash |
| EC-19 | `loadSettings()` returns partial object (missing one key) | Missing key falls back to its default; no crash; settings not corrupted |
| EC-20 | Selection spanning multiple lines | Active state detection still functions; toolbar appears/updates correctly |
| EC-21 | Inline code button on selection containing backticks | Backticks in selection are not double-escaped; wrap produces `` `selection` `` verbatim |
| EC-22 | `window.__MARKABLE_EDITOR_VIEW__` is undefined when render() fires | Toolbar renders in empty/disabled state; updateListener populates it on the next transaction |
| EC-23 | Toolbar button clicked after editor view is replaced (new tab opened) | `__MARKABLE_EDITOR_VIEW__` always holds the live view; dispatch targets correct view |
| EC-24 | Cursor/selection inside a `* item` bullet-list item | Italic button must NOT show active; italic detection must distinguish a `*` list bullet (at start-of-line, followed by a space) from a `*` italic marker |

---

## Out of Scope (v1.0)

- Custom button order or button visibility toggles via UI
- Keyboard shortcuts for individual toolbar buttons (may be added in a future settings pass)
- Live mode-switch (floating to sidebar) without plugin restart
- Toolbar customisation panel within the Plugins Panel detail view
- Support for block-level formatting (headings, blockquotes, lists)
