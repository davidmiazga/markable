---
title: "Consolidate Toolbar Plugins"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Consolidate Toolbar Plugins — Requirements Spec

## Summary

As a user, I want the three separate toolbar plugins (markdown-toolbar, table-toolbar, image-toolbar) replaced by a single unified plugin whose active sub-toolbar switches automatically based on cursor context — image controls when on an image line, table controls when inside a table, formatting controls everywhere else — so that the Plugins Panel shows one entry instead of three and toolbar mode preferences are managed in one place.

---

## Background and Motivation

Three independently authored plugins currently share the same structural pattern:
- A CM6 `updateListener` that detects cursor context on every editor transaction.
- A `floating` or `sidebar` mode with identical settings shape (`toolbarMode`, `sidebarSide`).
- Separate CSS style tags, separate plugin IDs, separate entries in `build-plugins.mjs`, and separate test files.

Users must enable/disable three plugins separately. Settings are duplicated across three files. The Plugins Panel shows three toolbar entries, which is confusing because only one toolbar is ever active at a time.

The consolidation goal is to merge all three into a single plugin file `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` with a single build output `src-tauri/plugins/core/markdown-toolbar.js`.

---

## Functional Requirements

### FR-1: Single Plugin Entry Point

The unified plugin is registered under `id: "markdown-toolbar"`. The `table-toolbar` and `image-toolbar` plugin IDs are retired. After consolidation:

- `build-plugins.mjs` has one fewer entry (`table-toolbar` and `image-toolbar` are removed; `markdown-toolbar` remains).
- `src-tauri/plugins/core/` contains `markdown-toolbar.js` but no longer `table-toolbar.js` or `image-toolbar.js`.
- The Plugins Panel displays one toolbar entry.

### FR-2: Context-Sensitive Sub-Toolbar Switching

On every CM6 editor transaction (via a single shared `updateListener`), the plugin evaluates cursor context and activates exactly one sub-toolbar. Priority order when contexts overlap:

1. **Image context** — cursor is on a line containing `![alt](url)` syntax (edit mode), OR the user has clicked a rendered `<img class="cm-live-image">` element (live preview mode). Shows the image sub-toolbar.
2. **Table context** — cursor is inside a GFM table (detected via the existing `detectTableContext` logic). Shows the table sub-toolbar.
3. **Default context** — all other positions. Shows the markdown formatting sub-toolbar.

Only one sub-toolbar is visible at any given moment. Switching contexts hides the previously active sub-toolbar and shows the newly active one within the same update cycle (no flash).

The priority order (image > table > default) is the resolution rule when a position is simultaneously inside a table and on an image line (e.g. an image cell in a table). Image context wins.

### FR-3: Floating Mode Behaviour

When `toolbarMode === "floating"`:

- The markdown sub-toolbar (formatting buttons) shows as a floating bubble above the selection, identical to the current `markdown-toolbar` plugin behaviour. It is hidden when there is no selection and the cursor is not on a non-empty line.
- The table sub-toolbar shows as the three-element floating UI (top bar, row handle, bottom pill) around the table, identical to the current `table-toolbar` plugin behaviour.
- The image sub-toolbar shows as the floating popover above the image, identical to the current `image-toolbar` plugin behaviour.

All three share one `toolbarMode` / `sidebarSide` setting pair. A user setting of `"floating"` applies to all three sub-toolbars simultaneously.

### FR-4: Sidebar Mode Behaviour

When `toolbarMode === "sidebar"`:

- The markdown sub-toolbar and table sub-toolbar are eligible for sidebar docking (both supported sidebar mode individually).
- The image sub-toolbar is floating-only regardless of `toolbarMode`. When `toolbarMode === "sidebar"`, the image sub-toolbar continues to appear as a floating popover (preserving the existing `AD-5` decision from the image-toolbar spec).
- A single sidebar panel is registered under `id: "markdown-toolbar"`. Its content area switches dynamically: when cursor enters a table, the sidebar panel shows table controls; otherwise it shows markdown formatting buttons.
- The image popover is always a separate floating element and does not appear in the sidebar panel.

### FR-5: Unified Settings

A single settings object is persisted per the existing plugin settings pattern (`api.loadSettings()` / `api.saveSettings()`):

```typescript
interface UnifiedToolbarSettings {
  toolbarMode: "floating" | "sidebar";
  sidebarSide: "left" | "right";
}
```

Default: `{ toolbarMode: "floating", sidebarSide: "left" }`.

Settings migration: if a user previously had settings written by the old `markdown-toolbar`, `table-toolbar`, or `image-toolbar` plugins, the unified plugin reads the `markdown-toolbar` settings file. The `table-toolbar` and `image-toolbar` settings files are not read (they may exist on disk but are ignored). No migration of those old files is required.

### FR-6: Plugin Panel Detail View

The Plugins Panel detail view for the unified plugin shows:

- A three-way position toggle: **Left** | **Float** | **Right** (identical to the existing markdown-toolbar and table-toolbar `renderDetailExtra` controls).
- No separate controls for the image sub-toolbar's position (it is always floating).
- Changing position saves settings and calls `api.restartSelf()`, identical to current behaviour.

### FR-7: CSS Scoping

All CSS from the three existing plugins is retained verbatim but injected under a single `<style id="__markable_unified_toolbar_css__">` tag. The three existing `STYLE_ID` constants are merged. Existing class names (`.md-toolbar`, `.tbl-toolbar`, `.img-toolbar`) are preserved unchanged so layout and visual behaviour are identical to the existing plugins.

### FR-8: Build System Update

- Remove `["table-toolbar", ...]` and `["image-toolbar", ...]` entries from `build-plugins.mjs` `PLUGINS` array.
- Update the success log message from "All 8 core plugins" to "All 6 core plugins".
- No new `vite.plugins.config.ts` entry is required (the `markdown-toolbar` entry already exists).
- The two retired `.js` files (`table-toolbar.js`, `image-toolbar.js`) will be absent from the build output. Any code that loads them by name must be updated (see FR-9).

### FR-9: PluginManager / Settings Migration

The PluginManager loads plugins by filename. When `settings.plugins` contains `"table-toolbar": true` or `"image-toolbar": true` from a previous session, those keys are now for non-existent files. The PluginManager already handles `status: "missing"` for files no longer on disk — this is an existing code path (EC-7/EC-8 in `index.ts`). No new handling is required. The `"markdown-toolbar"` enabled state is preserved.

### FR-10: Test Coverage

All tests — migrated and new — live in a single file: `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts`. The old test files (`tests/plugins/table-toolbar/table-toolbar.test.ts` and `tests/plugins/image-toolbar/image-toolbar.test.ts`) are deleted after migration.

Each sub-toolbar's existing test suite is migrated to import from the unified plugin file. Test coverage for all existing edge cases is preserved. No test cases may be deleted; they are reorganised under the new import path within the single combined file. New integration tests are added for:
- Context switching (cursor moves from default → table → image → default).
- Overlap resolution (image inside table cell: image context wins).
- Sidebar panel content switching (sidebar mode: panel shows markdown buttons in default context, table buttons in table context).

---

## Non-Functional Requirements

### NFR-1: Single CM6 Extension Registration

The unified plugin registers exactly one CM6 `updateListener` extension via `api.addExtensions()`, not three. All context detection runs inside that single listener. This replaces the three separate listeners that existed across the three original plugins.

### NFR-2: Toggle Cycle Correctness

The unified plugin survives repeated enable/disable cycles without leaking DOM nodes, event listeners, or CM6 extensions. All three sub-toolbars' teardown logic (currently in their individual `onDisable` functions) is consolidated into the single `onDisable`. All module-level state is reset to initial values in `onDisable`.

### NFR-3: No Runtime Dependencies Added

No new npm packages or `@codemirror/*` value imports are added. CM6 APIs continue to be accessed via `window.__CM_VIEW__`. The three existing `import type` patterns are preserved.

### NFR-4: Identical Visual Behaviour

From the user's perspective, each sub-toolbar looks and behaves identically to the original standalone plugin. No visual regression is acceptable. Pixel-identical positioning logic is preserved.

### NFR-5: Performance

The single shared `updateListener` must complete context detection (image check + table check) in under 2 ms on a typical document. Detection order is: image first (cheapest — one line text check), then table (existing `detectTableContext` function). Short-circuit evaluation applies: if image context is detected, table context is not evaluated.

Context detection and the resulting show/hide DOM toggle run synchronously in the `updateListener` callback (no debounce, no `requestAnimationFrame` wrapper). Debounce (150 ms) is applied only to the "which buttons are active/highlighted" calculation — a cheap DOM class update — to avoid redundant work on fast cursor movement. The two operations must remain independent: hiding/showing a sub-toolbar never waits for the debounce window.

### NFR-6: Undo Atomicity Preserved

All document mutations in all sub-toolbars continue to dispatch exactly one CM6 transaction per user action, preserving single undo-step behaviour.

---

## Architectural Decisions

### AD-1: File Location and Name

The unified plugin lives at `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts`. The existing `table-toolbar/` and `image-toolbar/` directories are deleted after migration. The unified plugin is the only entry point.

### AD-2: Module Structure

The unified plugin file is organised in named sections (same convention as existing plugins):

1. Type-only imports
2. Settings types and defaults
3. Module-level state declarations (combined from all three originals)
4. CSS constant (merged from all three originals)
5. Format registry and detection (from markdown-toolbar)
6. Pure format functions — computeWrap / computeUnwrap / computeErase (from markdown-toolbar)
7. ImageContext types, detection, alignment (from image-toolbar)
8. TableContext type and detection (from table-toolbar)
9. Pure table operations (from table-toolbar)
10. DOM builders — markdown toolbar, image popover, table floating elements, sidebar panel
11. Positioning helpers (shared / per-sub-toolbar)
12. Context resolver — single function that returns `"image" | "table" | "default"`
13. Shared CM6 updateListener factory
14. Event handler consolidation
15. Plugin export object

### AD-3: Sidebar Panel Switching Strategy

In sidebar mode, a single sidebar panel container is registered. The panel's inner content is swapped by the context resolver on each `updateListener` invocation:
- In default context: the markdown formatting buttons are rendered inside the panel.
- In table context: the table sidebar controls are rendered inside the panel.
- The image sub-toolbar is never shown in the sidebar panel (AD-5 of the original image-toolbar spec is preserved).

Swapping is implemented by toggling `display: none` on two inner container divs (one for markdown controls, one for table controls) within the single sidebar panel element. No DOM nodes are created/destroyed on context switch — only visibility is toggled.

### AD-4: Retained Globals

`window.__TAURI_DIALOG__`, `window.__MARKABLE_CURRENT_FILE__`, `window.__MARKABLE_EDITOR_VIEW__`, and `window.__CM_VIEW__` are all retained as-is. No new globals are introduced.

### AD-5: Image Sub-Toolbar Remains Floating-Only

The image sub-toolbar retains its floating-only constraint regardless of the plugin's `toolbarMode` setting. This is consistent with `AD-5` from the original image-toolbar spec and avoids introducing a new sidebar layout for image operations.

---

## Out of Scope

- Alt text editing in the image sub-toolbar.
- Image resize controls (width/height).
- Delete image button.
- Caption support.
- Drag-and-drop image insert.
- Any modification to `live-preview.ts` or `ImageWidget.ignoreEvent()`.
- Changing the visual design of any sub-toolbar.
- Adding a fourth context (e.g. code block toolbar).
- Changing the Markdown format buttons set (remains 10 buttons).
- Persisting the "last active sub-toolbar" across sessions.
- Migrating settings from the old `table-toolbar` or `image-toolbar` settings files.

---

## Edge Case Inventory

All items below are mandatory test cases for the Code Reviewer.

| # | Scenario | Expected Behaviour |
|---|---|---|
| EC-1 | Cursor moves from default context into a table | Markdown sub-toolbar hides; table sub-toolbar shows. Single CM6 update cycle — no frame where both are visible simultaneously. |
| EC-2 | Cursor moves from a table into default context | Table sub-toolbar hides; markdown sub-toolbar shows (if selection is non-empty) or hides (if selection is empty). |
| EC-3 | Cursor moves onto an image line (edit mode) while inside a table | Image context wins (priority rule from FR-2). Image sub-toolbar shows; table sub-toolbar hides. |
| EC-4 | Cursor moves off an image line that is inside a table (back to a non-image cell) | Image sub-toolbar hides; table sub-toolbar shows (cursor is still in table). |
| EC-5 | User clicks rendered `<img class="cm-live-image">` inside a table cell (live preview mode) | Image sub-toolbar shows. Table sub-toolbar hides. Clicking outside dismisses image toolbar; table context resumes if cursor is still inside the table. |
| EC-6 | Plugin is disabled while the image popover is visible | `onDisable` removes the popover from `document.body` immediately. No dangling element. |
| EC-7 | Plugin is disabled while the table floating UI is visible | `onDisable` removes all three table floating elements (`_topBar`, `_rowHandle`, `_bottomPill`) from DOM. |
| EC-8 | Plugin is disabled while a markdown toolbar is visible (floating mode) | `onDisable` removes `_toolbarEl` from DOM. |
| EC-9 | Rapid enable/disable/enable cycle | No duplicate `<style>` tags, no orphaned DOM elements, no stale CM6 extensions, no duplicate document listeners. Single `__markable_unified_toolbar_css__` tag exists after re-enable. |
| EC-10 | `toolbarMode` changes from `"floating"` to `"sidebar"` mid-session | `api.restartSelf()` triggers a clean disable/enable cycle. After re-enable, the sidebar panel is registered; floating elements are not added to `document.body`. |
| EC-11 | `toolbarMode` changes from `"sidebar"` to `"floating"` mid-session | After re-enable, the sidebar panel is unregistered; floating elements are appended to `document.body`. |
| EC-12 | Sidebar mode — cursor enters a table | The sidebar panel's inner markdown buttons div is hidden; the table controls div is shown. No sidebar panel re-registration occurs. |
| EC-13 | Sidebar mode — cursor leaves a table | The sidebar panel's inner table controls div is hidden; the markdown buttons div is shown. |
| EC-14 | Sidebar mode — cursor moves onto an image line | Image popover appears (floating). Sidebar panel continues showing either markdown or table controls based on whether cursor is also in a table (table wins in sidebar panel, image wins for popover). |
| EC-15 | `loadSettings()` returns `null` (first run, no prior settings) | Plugin initialises with `{ toolbarMode: "floating", sidebarSide: "left" }`. No crash. |
| EC-16 | `loadSettings()` returns partial object (missing `sidebarSide`) | Missing key is filled from defaults. Plugin initialises correctly. |
| EC-17 | `loadSettings()` returns object with invalid `toolbarMode` value | Invalid value falls back to `"floating"`. No crash. |
| EC-18 | Old `table-toolbar` and `image-toolbar` settings files exist on disk | They are ignored. Unified plugin reads only the `markdown-toolbar` settings namespace. |
| EC-19 | `settings.plugins` contains `"table-toolbar": true` from a previous session | PluginManager marks `table-toolbar` as `status: "missing"` (existing behaviour). No crash. The unified `markdown-toolbar` plugin is enabled independently. |
| EC-20 | `settings.plugins` contains `"image-toolbar": true` from a previous session | Same as EC-19. PluginManager marks `image-toolbar` as `status: "missing"`. No crash. |
| EC-21 | Two images on the same line — cursor on that line in edit mode | First `Image` syntax node encountered on the line is used (existing image-toolbar behaviour preserved). |
| EC-22 | Image inside `<div align="center">...</div>` wrapper — alignment button dispatched | Full `<div>...</div>` span (both lines) replaced in a single dispatch. Existing behaviour preserved. |
| EC-23 | Table with only one row — delete-row is disabled | `deleteRow` button shows as disabled. Existing table-toolbar behaviour preserved. |
| EC-24 | Table with only one column — delete-column is disabled | `deleteColumn` button shows as disabled. Existing table-toolbar behaviour preserved. |
| EC-25 | Tab switch while image popover is open | `window.__MARKABLE_EDITOR_VIEW__` is updated on tab switch. On the next CM6 transaction, context is re-evaluated for the new tab. If the new tab's cursor is not on an image line, popover hides. |
| EC-26 | Tab switch while table floating UI is visible | Table floating UI hides (the next updateListener tick on the new view will detect non-table context and hide all table elements). |
| EC-27 | Tauri dialog cancelled (user clicks Cancel in image Select tab) | No dispatch emitted. Image popover remains open. Existing image-toolbar behaviour preserved. |
| EC-28 | `window.__TAURI_DIALOG__` is undefined (test environment) | Select tab button is a no-op. Warning logged. No crash. |
| EC-29 | CRLF document — image alignment adds `<div>` wrapper | `\r\n` line ending preserved in inserted string. No mixed line endings. |
| EC-30 | Row drag starts in table floating mode, then plugin is disabled | `_dragIndicator` is removed in `onDisable`. No orphaned drag indicator element in DOM. |
| EC-31 | Scroll while image popover is open | Popover may drift (by design — same behaviour as original plugin). Popover closes on next cursor move. |
| EC-32 | Sidebar mode — `sidebarSide` changes from `"left"` to `"right"` | `api.restartSelf()` triggers clean cycle. After re-enable, sidebar panel appears on the right slot. |
| EC-33 | Markdown toolbar is in sidebar mode and selection is empty | Markdown buttons are shown but in disabled state (greyed out). Existing markdown-toolbar behaviour preserved. |
| EC-34 | Cursor moves rapidly across context boundaries (default → table → image → default in quick succession) | Sub-toolbar show/hide toggles are applied immediately on each `updateListener` tick — no debounce delay. Only the active-button highlight recalculation is debounced at 150 ms; the debounce timer is reset on each new tick but the correct sub-toolbar is always visible before the debounce fires. |
| EC-35 | `build-plugins.mjs` still contains `table-toolbar` or `image-toolbar` entries after migration | Build would produce dead output files. This is caught by the code reviewer comparing the `PLUGINS` array to the requirement that exactly 6 entries remain. |
| EC-36 | Image toolbar popover positioning — would render above viewport top | Flips to render below. Existing image-toolbar behaviour preserved. |
| EC-37 | Image toolbar popover positioning — right edge overflows viewport | Clamped leftward. Existing image-toolbar behaviour preserved. |
| EC-38 | Keyboard-only navigation — Tab key moves focus through toolbar buttons in floating mode | Focus order follows DOM order within the active sub-toolbar. No focus trapped in hidden sub-toolbars. Hidden sub-toolbar elements carry `tabindex="-1"` or `display: none` to exclude them from the tab order. |
| EC-39 | All three existing test suites pass after migration | Every test case from the 679-line markdown-toolbar test, 1350-line table-toolbar test, and 1598-line image-toolbar test is migrated into `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts`, importing from the unified plugin. The two old test files are then deleted. Zero test case deletions. |

---

## Migration Checklist (for Architect)

The following files are affected by this consolidation:

- **Delete**: `src/plugins/table-toolbar/table-toolbar.plugin.ts`
- **Delete**: `src/plugins/image-toolbar/image-toolbar.plugin.ts`
- **Delete**: `src/plugins/table-toolbar/` (entire directory)
- **Delete**: `src/plugins/image-toolbar/` (entire directory)
- **Rewrite**: `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` — unified plugin
- **Update**: `scripts/build-plugins.mjs` — remove two entries, update count string
- **Update**: `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` — add migrated test cases
- **Delete**: `tests/plugins/table-toolbar/table-toolbar.test.ts` (after migration)
- **Delete**: `tests/plugins/image-toolbar/image-toolbar.test.ts` (after migration)
- **No changes required**: `src/plugins/markable-plugin-api.ts`, `src/plugins/index.ts`, `src/sidebar/`, `src/lib/settings.ts`, `main.ts`
