# Active Task: Find / Find & Replace — Custom Floating Widget

**Status:** Requirements Validated
**Date:** 2026-04-09
**Revision:** 2 (replaces original CM6 built-in panel spec)
**Depends on:** Phase 2B Menu System (complete), Phase 2C Settings & Persistence (complete)
**Feature Checkpoint:** 1 — Base Features (Edit Menu items 11 & 12: Find, Find and Replace)

---

## Revision Summary

The original requirements (Revision 1) specified the CM6 built-in search panel styled via `EditorView.theme`. That implementation has been built and visually rejected:

- Buttons render white text on a white background in both themes.
- The bottom-of-editor position is not desirable for a focused writing tool.

This revision replaces the CM6 panel entirely with a **custom floating DOM widget** modeled after the VS Code find widget. The CM6 search engine (`@codemirror/search` `SearchQuery`, `findNext`, `findPrevious`, `replaceNext`, `replaceAll`, `selectMatches`) is kept — only the visual panel layer is replaced.

---

## Executive Summary

As a user, I want a compact floating find/replace widget that appears in the upper-right of the editor, can be dragged anywhere on screen, and remembers its last position, so that I can search and replace text without the panel obscuring my work or fighting with the app's visual theme.

---

## Feature Scope

### In Scope

- Remove or bypass CM6's built-in search panel DOM injection entirely. The `search()` extension is removed from `buildExtensions()` and replaced with only the state machinery needed by the custom widget (see FR-2).
- A custom HTML `<div>` widget is created and appended to `document.body` (or the `#app` container), positioned with `position: fixed`.
- The widget is positioned in the **upper-right of the editor area** by default, offset from the window edge by a fixed margin (16px from top, 16px from right).
- The widget is **draggable** via a drag handle (the widget header/title bar area). Dragging is implemented with `mousedown`/`mousemove`/`mouseup` on the `document`.
- The widget **floats above editor content** — it does not push text down or alter the editor layout in any way.
- The last dragged position (x, y as pixel offsets from the viewport top-left) is **persisted in settings** and restored on next open.
- If the persisted position would place the widget partially or fully off-screen, it is **clamped to the visible viewport** on restore.
- **Find mode**: text field + match case / whole word / regexp toggles + previous/next navigation + match count label + close button.
- **Find & Replace mode**: same as find mode, plus a collapsible replace row with a replace-one and replace-all button. A chevron (`›`/`v`) in the widget toggles the replace row open/closed.
- Cmd-F opens the widget in Find mode (replace row collapsed). If text is selected, it is pre-filled as the search query.
- Cmd-Shift-F opens the widget in Find & Replace mode (replace row expanded). Same pre-fill behavior.
- Cmd-G / Cmd-Shift-G navigate next/previous match while the widget is open.
- Escape closes the widget and returns focus to the editor.
- Match highlights in the document (`.cm-searchMatch`, `.cm-searchMatch-selected`) continue to use CSS custom properties from `styles.css`.
- The existing `src/editor/search-theme.ts` is updated: `.cm-panels` and `.cm-search` rules are removed (no CM6 panel DOM will exist); match highlight rules are retained.

### Out of Scope

- Multi-file / workspace-wide search — deferred to Phase 3 (PKM).
- Search history (persisted across sessions) — deferred.
- Custom keyboard shortcut configuration — deferred to keybinding editor.
- Search result gutter markers or minimap highlighting — not planned.
- Replace All confirmation dialog — immediate replace, undoable via Cmd-Z.
- Animated open/close transitions — plain show/hide via `display` toggle is sufficient.
- Touch or stylus drag support — macOS desktop only.

---

## Functional Requirements

### FR-1: Enable Menu Items (unchanged from Revision 1)

- FR-1.1: `edit-find` in `menu.rs` is already enabled. Confirm accelerator `CmdOrCtrl+F` is present and active.
- FR-1.2: `edit-find-replace` in `menu.rs` is already enabled. Confirm accelerator `CmdOrCtrl+Shift+F` is present and active.

### FR-2: CM6 Extension Registration (revised)

The CM6 `search()` panel factory is no longer needed. However, the search state field and commands must remain functional.

- FR-2.1: Remove `search({ top: false })` from `buildExtensions()` in `src/editor/extensions.ts`.
- FR-2.2: Import and register only the search state machinery without the panel UI. The Architect must determine the correct minimal import from `@codemirror/search` — either `searchState` if exported standalone, or a `search({ createPanel: () => null })` override, or a custom `StateEffect`/`StateField` pattern. **The goal is: `SearchQuery`, `findNext`, `findPrevious`, `replaceNext`, `replaceAll`, `selectMatches`, and `setSearchQuery` commands must function; the CM6 panel DOM must never be injected.**
- FR-2.3: `Prec.high(keymap.of(searchKeymap))` stays registered so Cmd-G / Cmd-Shift-G / Escape continue to function as keyboard shortcuts even without the CM6 panel open.
- FR-2.4: The import of `openSearchPanel` and `closeSearchPanel` in `src/main.ts` must be replaced with calls to the custom widget's own `open()` and `close()` API. These CM6 commands are only meaningful when the CM6 panel factory is registered; without it they are no-ops at best and will throw at worst.

### FR-3: Custom Widget Construction

The widget is a plain TypeScript module: `src/editor/find-widget.ts`.

- FR-3.1: The widget exports a factory function or class: `createFindWidget(view: EditorView): FindWidget`. The returned object exposes at minimum: `open(mode: 'find' | 'replace'): void`, `close(): void`, `isOpen(): boolean`.
- FR-3.2: The widget DOM structure (from outer to inner):
  ```
  div.find-widget                    ← root, position:fixed, z-index above editor
    div.find-widget-header           ← drag handle + optional label
    div.find-widget-find-row         ← always visible when widget is open
      input.find-widget-input        ← search text field
      button.find-widget-toggle[data-name="matchCase"]   ← Aa
      button.find-widget-toggle[data-name="wholeWord"]   ← ab
      button.find-widget-toggle[data-name="regexp"]      ← .*
      span.find-widget-count         ← "3 of 12" or "No results"
      button.find-widget-prev        ← ↑
      button.find-widget-next        ← ↓
      button.find-widget-close       ← ×
    div.find-widget-replace-row      ← collapsed by default
      input.find-widget-replace-input ← replace text field
      button.find-widget-replace-one  ← replace current
      button.find-widget-replace-all  ← replace all
  ```
- FR-3.3: The widget root uses `position: fixed`. Default position: `top: 16px; right: 16px` relative to viewport. The Architect must decide whether to position relative to `#editor` (using `position: absolute` within the editor container) or relative to the viewport (`position: fixed`). **The requirement is that the widget visually overlaps the editor content and does not affect document flow.** Either approach satisfies this, but the chosen approach must handle the `#titlebar` height so the widget does not overlap the title bar at its default position.
- FR-3.4: The widget `z-index` must be high enough to float above the CM6 editor content and the settings panel (if open simultaneously). The Architect assigns a concrete value; recommend `z-index: 100` as baseline (above the editor's own stacking context).
- FR-3.5: The replace row is hidden by default (`display: none`). The chevron button in the find row toggles it. When open in `'replace'` mode, the replace row is shown immediately and the replace input receives focus.
- FR-3.6: When `open('find')` is called: show the widget, focus the find input, select all text in it, collapse the replace row.
- FR-3.7: When `open('replace')` is called: show the widget, expand the replace row, focus the find input (not replace input — user types search term first), select all text in the find input.
- FR-3.8: If the widget is already open and `open()` is called again (e.g., Cmd-F while widget is visible): do not re-initialize position; just focus the find input and select its contents.

### FR-4: Search Logic Integration

The custom widget drives the CM6 search engine by dispatching effects.

- FR-4.1: On every keystroke in the find input, dispatch `setSearchQuery` (from `@codemirror/search`) with a new `SearchQuery` built from the current field values (term, matchCase, wholeWord, regexp).
- FR-4.2: The "next" button and Cmd-G dispatch `findNext` to the editor view.
- FR-4.3: The "previous" button and Cmd-Shift-G dispatch `findPrevious`.
- FR-4.4: The "replace one" button dispatches `replaceNext`.
- FR-4.5: The "replace all" button dispatches `replaceAll`.
- FR-4.6: After each dispatch of `findNext` / `findPrevious` / `replaceNext`, scroll the current match into view. CM6 handles this natively when the cursor is moved to the match — verify the default behavior is sufficient.
- FR-4.7: The match count label is updated after each state change. The count is read from CM6's search state field. The Architect must identify the correct API to read the number of matches and the current match index from `view.state` (e.g., via `getSearchQuery`, state field inspection, or a decoration count scan). The chosen approach must be documented in the step file.
- FR-4.8: When the find input is empty, `setSearchQuery` is dispatched with an empty term. All match highlights are cleared. The count label shows nothing.

### FR-5: Pre-fill Behavior

- FR-5.1: When Cmd-F or Cmd-Shift-F is pressed and the editor has a non-empty text selection, that selection is used as the initial value of the find input.
- FR-5.2: The selection text is extracted from `view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)` before the widget is shown.
- FR-5.3: If the selection spans multiple lines, only the first line (up to the first `\n`) is used as the pre-fill value. The behavior is documented in a comment referencing EC-13.

### FR-6: Keyboard Shortcuts

- FR-6.1: Cmd-F — open widget in find mode (via menu event and direct key).
- FR-6.2: Cmd-Shift-F — open widget in replace mode.
- FR-6.3: Cmd-G — next match (works when widget is open; when widget is closed, no-op).
- FR-6.4: Cmd-Shift-G — previous match.
- FR-6.5: Escape — close the widget and return focus to the editor. This must be handled by a `keydown` listener on the widget itself (not via CM6's keymap, since the widget is not a CM6 panel).
- FR-6.6: Enter in the find input — advance to next match (same as Cmd-G).
- FR-6.7: Shift-Enter in the find input — go to previous match.
- FR-6.8: Tab in the find input — if replace row is visible, move focus to replace input; otherwise, advance to the next toggle button.
- FR-6.9: No new shortcuts may conflict with `formatKeymap` in `src/editor/format.ts`. The Architect verifies before writing step files.

### FR-7: Drag Behavior

- FR-7.1: The drag handle is the `div.find-widget-header` element (full width, cursor: move).
- FR-7.2: Dragging is implemented by listening to `mousedown` on the header, then `mousemove` and `mouseup` on `document` (so drag continues even if the pointer leaves the widget boundary).
- FR-7.3: During a drag, the widget position is updated in real time by setting `widget.style.left` and `widget.style.top`. The `right` CSS property must be cleared (set to `auto`) when drag starts so that `left` takes effect correctly.
- FR-7.4: On `mouseup`, the drag ends. The final `(x, y)` position is saved to settings (see FR-8).
- FR-7.5: While dragging, `user-select: none` is applied to `document.body` to prevent text selection in the editor underneath. It is removed on `mouseup`.
- FR-7.6: The widget must be clamped to the visible viewport during dragging — it must not be draggable off-screen. Clamping: `x` in `[0, window.innerWidth - widget.offsetWidth]`, `y` in `[0, window.innerHeight - widget.offsetHeight]`.

### FR-8: Position Persistence

- FR-8.1: The settings schema gains a new optional field: `findWidget: { x: number; y: number } | null`. Default value: `null` (use default position).
- FR-8.2: When the widget is closed after a drag (position has changed from default), the `(x, y)` is written to `settings.findWidget` via `updateSettings`.
- FR-8.3: On the next `open()` call, if `settings.findWidget` is non-null, the widget is positioned at the stored `(x, y)` after clamping to the current viewport dimensions.
- FR-8.4: If the stored position would place the widget fully off-screen (e.g., the window was resized to be smaller, or the user moved to a lower-resolution display), the widget falls back to the default position (upper-right, 16px from each edge).
- FR-8.5: Position is saved at drag-end, not on every mousemove, to avoid flooding the settings write path.

### FR-9: Theming

The widget is a plain HTML element in `document.body`. It inherits CSS custom properties from the active theme automatically since those are defined on `:root` / `[data-theme]` on `<html>`.

- FR-9.1: The widget background uses `var(--search-panel-bg)`.
- FR-9.2: The widget border uses `1px solid var(--search-panel-border)`.
- FR-9.3: Input fields use `var(--bg-primary)` background, `var(--text-primary)` text, `var(--border-color)` border — same tokens as existing inputs in the settings panel.
- FR-9.4: Buttons use the same token set as other action buttons in the app. The Architect inspects the settings panel's button styles as a reference.
- FR-9.5: Toggle buttons (match case, whole word, regexp) show an "active" state when toggled on — a visually distinct background such as `color-mix(in srgb, var(--link-color) 15%, var(--bg-primary))` or similar.
- FR-9.6: The widget styles are written in a new dedicated CSS file: `src/editor/find-widget.css`, imported inside `find-widget.ts` (Vite handles CSS-in-TS imports). Alternatively, styles may be added to `src/styles.css` under a `.find-widget` namespace — Architect decides. Either way, no styles are hardcoded as inline `style` strings on DOM elements (except the dynamic `top`/`left`/`right` position values which must be inline).
- FR-9.7: The existing `src/editor/search-theme.ts` is updated to remove `.cm-panels` and `.cm-search` rules (no CM6 panel DOM will be injected). The `.cm-searchMatch` and `.cm-searchMatch-selected` rules remain intact — they style document highlights, not the widget itself.
- FR-9.8: The `--search-panel-bg`, `--search-panel-border`, `--search-match-bg`, `--search-match-selected-bg` CSS variables in `styles.css` remain unchanged and continue to serve their roles.

### FR-10: Widget Visibility and Focus Management

- FR-10.1: The widget starts hidden (`display: none` or `visibility: hidden`). It is shown on `open()` and hidden on `close()`.
- FR-10.2: On `open()`, focus is placed in the find input. Editor text is not deselected.
- FR-10.3: On `close()`, focus is returned to the CM6 editor via `view.focus()`.
- FR-10.4: When the window regains focus (`window.addEventListener("focus", ...)`), if the widget is open, focus goes to the find input (not the editor). The existing focus-return handler in `main.ts` must be updated to check `findWidget.isOpen()` before calling `editor.focus()`.
- FR-10.5: The widget must not steal focus from the settings panel if the settings panel is open. Both panels may coexist simultaneously; each panel manages its own focus state.

### FR-11: Document Load Behavior

- FR-11.1: When a new file is opened (File > Open, recent file, File > New), the widget is closed and the find/replace inputs are cleared. The search query dispatched to CM6 is cleared (empty `SearchQuery`).
- FR-11.2: This replaces the existing `closeSearchPanel(editor)` calls in `newFile()`, `openFile()`, and `openRecentFileByPath()` in `main.ts`. Those calls must be replaced with `findWidget.close()`.

### FR-12: Match Count Display

- FR-12.1: The count label displays "N of M" when M > 0 (e.g., "3 of 12").
- FR-12.2: When M is 0 and the search term is non-empty, the label displays "No results" and the find input receives a visual error state (red tint on border and background — same treatment as the existing `.cm-not-found` rule in `search-theme.ts`, but applied as a CSS class on the widget input).
- FR-12.3: When the search term is empty, the label is hidden (empty string or `display: none`).
- FR-12.4: The count updates after every keystroke in the find input and after every `findNext` / `findPrevious` navigation.

---

## Edge Case Inventory

> Every item below must be covered by a test or explicit inline handling with a comment referencing the EC number. This list is the Code Reviewer's mandatory test checklist.

| # | Edge Case | Expected Behavior |
|---|---|---|
| EC-1 | Cmd-F pressed when editor is null (before init completes) | No-op. Guard: `if (!editor) return` in the menu-event handler. |
| EC-2 | Cmd-F pressed when widget is already open | Widget stays open; find input receives focus and its contents are selected. Do not re-initialize position. |
| EC-3 | Search term not found in document | Zero matches. Find input shows error state (red tint). Count label shows "No results". No crash. |
| EC-4 | Search term is an empty string | All match highlights cleared. Count label hidden. No navigation occurs. |
| EC-5 | Search term matches the entire document (very large match set) | All lines highlighted. Count label correct. No performance regression on a 50,000-character document. |
| EC-6 | RegExp toggle enabled with an invalid regular expression | CM6's `SearchQuery` constructor handles this gracefully (no matches, no throw). The widget must catch any exception from `new SearchQuery({ regexp: true, ... })` and display an error state rather than crashing. |
| EC-7 | RegExp toggle enabled with a zero-width match pattern (e.g., `.*`) | CM6 behavior: matches every position; match count may be very large. Widget must not hang. Display count as returned by CM6 state, capped at display of "999+" if needed (Architect decides cap value). |
| EC-8 | Replace All on a document with 1000+ matches | Single undoable CM6 transaction. Must complete in under 2 seconds on a 50,000-character document. |
| EC-9 | Undo (Cmd-Z) after Replace All | Entire Replace All reversed in one undo step. Document restored exactly. |
| EC-10 | Widget open, user switches theme | Widget background, border, and input colors update immediately (CSS variable change propagates automatically since widget lives in DOM). No explicit JS update needed — verify. |
| EC-11 | Widget open when Cmd-E (Toggle Preview) is invoked | Preview toggling must not close the widget or lose the current search query. |
| EC-12 | Widget open when a new file is loaded (File > Open, File > New, or recent file) | Widget closes, inputs clear, CM6 search state clears. |
| EC-13 | Multi-line selection pre-filled into find input | Only the first line (up to first `\n`) is used. The truncation is documented in a comment referencing EC-13. |
| EC-14 | Search term is very long (10,000+ characters pasted into find input) | No crash. Input accepts text. Match count may be 0. No performance regression. |
| EC-15 | Document is empty (zero characters) | Widget opens. Zero matches. No error. Count label hidden (empty term) or shows "No results" (non-empty term with zero matches). |
| EC-16 | Cmd-Shift-F menu event fires but editor is null | No-op. Same null guard as EC-1. |
| EC-17 | Escape pressed when widget is NOT open | Must not affect editor state. The Escape keydown listener on the widget element is only active when the widget is visible. |
| EC-18 | Match on last line; user presses Cmd-G (next match) | Wraps to first match. CM6 `findNext` default behavior — verify and document. |
| EC-19 | Case-sensitive toggle switched while matches are highlighted | `setSearchQuery` dispatched immediately with updated flags. Highlights update. Count updates. |
| EC-20 | Whole-word toggle switched while matches are highlighted | Same as EC-19. |
| EC-21 | Window resized to very small width (400px) while widget is open | Widget is clamped to viewport. Widget must not overflow the visible area. If the widget is wider than the viewport, it is clamped to `left: 0`. |
| EC-22 | Widget dragged partially off-screen (e.g., dragged to x = -50) | Clamping in `mousemove` handler prevents position going out of `[0, window.innerWidth - widget.offsetWidth]` range. Widget stays fully visible. |
| EC-23 | Stored position is off-screen on next launch (window moved to smaller display) | On `open()`, stored position is clamped to current viewport. If fully off-screen, default position (upper-right, 16px margin) is used. |
| EC-24 | Widget open, settings panel also open simultaneously | Both panels coexist. Each manages its own focus. No z-index conflict. Widget appears above editor content; settings panel appears above widget (or at same z-level — Architect assigns z-index values to prevent overlap ambiguity). |
| EC-25 | Regexp toggle enabled; user types an incomplete regex (e.g., `[abc`) | Same as EC-6. Treat as invalid regex — no matches, error state on input, no uncaught exception. |
| EC-26 | User drags widget to new position, then switches to a different file | Widget closes on file switch (FR-11.1). The position from the last drag-end save is retained. On next open, the saved position is restored (not reset to default). |
| EC-27 | Replace input is focused and user presses Escape | Widget closes, focus returns to editor. Escape is handled at the widget level, not per-input. |
| EC-28 | `findNext` dispatched when there are zero matches | No-op or CM6 no-match behavior. Must not throw. Verify CM6 `findNext` behavior when `SearchQuery` returns zero results. |
| EC-29 | Window `focus` event fires while widget is open | Focus is directed to the find input (not the editor). The `main.ts` focus handler must check `findWidget.isOpen()` before calling `editor.focus()`. |

---

## Acceptance Criteria

All of the following must be true before this task is considered complete. User visual verification is required for each UI item.

### Menu and Wiring
- [ ] AC-1: `Edit > Find...` menu item is enabled and responds to Cmd-F.
- [ ] AC-2: `Edit > Find and Replace...` menu item is enabled and responds to Cmd-Shift-F.
- [ ] AC-3: Cmd-F opens the custom widget in find mode (replace row hidden).
- [ ] AC-4: Cmd-Shift-F opens the widget with the replace row expanded.
- [ ] AC-5: `"edit-find"` and `"edit-find-replace"` cases in the `menu-event` listener call the custom widget, not `openSearchPanel`.

### Widget Appearance and Position
- [ ] AC-6: Widget floats in the upper-right of the editor by default (16px from top, 16px from right).
- [ ] AC-7: Widget does not push editor content down — it overlaps the editor.
- [ ] AC-8: Widget does not overlap the custom title bar at its default position.
- [ ] AC-9: Widget background, border, and text colors match the active theme on both light and dark themes.
- [ ] AC-10: Custom themes (e.g., nord.css) also style the widget correctly via CSS variables.

### Find Behavior
- [ ] AC-11: Typing in the find input highlights all matches in real time.
- [ ] AC-12: Count label shows "N of M" while there are matches; "No results" when term is non-empty and match count is zero.
- [ ] AC-13: Cmd-G / Enter in find input advances to next match; Cmd-Shift-G / Shift-Enter goes to previous match.
- [ ] AC-14: Navigating to a match scrolls the editor so the match is visible.
- [ ] AC-15: Active match highlight is visually distinct from passive match highlights.
- [ ] AC-16: Zero matches shows an error state on the find input (no crash).
- [ ] AC-17: Escape closes the widget and editor regains focus.

### Toggle Buttons
- [ ] AC-18: Match Case toggle (Aa) changes search behavior immediately and shows active state when on.
- [ ] AC-19: Whole Word toggle (ab) changes search behavior immediately.
- [ ] AC-20: RegExp toggle (.*) changes search behavior immediately. Invalid regex shows error state without crash.

### Replace Behavior
- [ ] AC-21: Replace One button replaces the current match and advances to the next.
- [ ] AC-22: Replace All button replaces all matches in one undoable transaction.
- [ ] AC-23: Cmd-Z after Replace All restores the original document in one undo step.

### Drag Behavior
- [ ] AC-24: Widget is draggable by its header. Position updates in real time during drag.
- [ ] AC-25: Widget cannot be dragged off-screen (clamped to viewport edges).
- [ ] AC-26: After dragging, the position persists across close/open cycles within the same session.
- [ ] AC-27: The position is restored on next app launch (read from settings).
- [ ] AC-28: If stored position is off-screen on launch, widget falls back to default position.

### Live Preview Compatibility
- [ ] AC-29: Opening the widget does not disable or reset the live preview.
- [ ] AC-30: Matches are found in raw Markdown text (including hidden syntax characters).
- [ ] AC-31: Navigating to a match correctly re-evaluates live preview on that line.

### Code Quality
- [ ] AC-32: All TypeScript passes `tsc --noEmit` with no errors.
- [ ] AC-33: No TODO comments in source files.
- [ ] AC-34: All 29 edge cases are covered by tests or explicit inline handling with a comment referencing the EC number.
- [ ] AC-35: Vitest test count increases (find-widget tests added to the frontend test suite).
- [ ] AC-36: No call to `openSearchPanel` or `closeSearchPanel` from `@codemirror/search` remains in `main.ts`.

---

## Technical Constraints

### TC-1: No New Rust Commands

This feature requires no new Tauri commands. The Rust change (enabling menu items) is already done.

### TC-2: CM6 Search State Without Panel Factory

The CM6 `search()` extension registers both the search `StateField` and a panel factory. The custom widget needs the `StateField` (for `setSearchQuery`, `findNext`, etc.) but must suppress the panel factory so CM6 does not inject its own DOM. The Architect must verify the exact approach:

Option A — `search({ createPanel: () => null })` if the `createPanel` option exists in the `@codemirror/search` API.
Option B — Import the state field and commands directly without the `search()` convenience function, if the package exports them individually.
Option C — Call `search()` but immediately intercept panel mounting via a `ViewPlugin` that removes the injected DOM node.

The chosen option must be documented in the architecture step file. Option A or B is strongly preferred over Option C.

### TC-3: Extension Registration Order

`Prec.high(keymap.of(searchKeymap))` must remain registered so Cmd-G / Cmd-Shift-G function. The search state field (whatever form it takes per TC-2) must be registered before `searchKeymap` in `buildExtensions()`.

### TC-4: No Solo Alt- Shortcuts

No `Alt-` only shortcuts may be introduced. All shortcuts use `Cmd-` or `Cmd-Shift-` prefixes.

### TC-5: Widget DOM Attachment Point

The widget root element should be appended to `document.body` (or `#app`) rather than inside the CM6 editor DOM. This ensures:
- The widget is not clipped by the editor's `overflow: hidden` container.
- The widget's `position: fixed` coordinate origin is the viewport, not a transformed ancestor.
- The widget survives editor re-renders and CM6 DOM reconciliation.

If appended to `#editor` with `position: absolute`, the Architect must verify that `#editor`'s CSS (`overflow: hidden`) does not clip the widget.

### TC-6: Settings Schema Migration

Adding `findWidget: { x: number; y: number } | null` to the settings schema requires a schema version bump or a backwards-compatible optional field. The Architect follows the existing settings migration pattern in `src/lib/settings.ts` (check how `recentFiles` and other optional fields are handled).

### TC-7: Keyboard Shortcut Conflict Verification

Before implementation, the Architect verifies that Cmd-F, Cmd-Shift-F, Cmd-G, and Cmd-Shift-G do not appear in `formatKeymap` in `src/editor/format.ts`. (This was verified in Revision 1 — re-confirm the format file has not changed since.)

### TC-8: Focus Model

The widget sits outside the CM6 editor DOM. Focus transitions between the widget inputs and the CM6 editor must be handled explicitly:
- `open()` calls `findInput.focus()` after making the widget visible.
- `close()` calls `view.focus()` after hiding the widget.
- The `window` focus listener in `main.ts` must be updated (FR-10.4).

---

## Impact Analysis

| Area | Impact |
|---|---|
| `src-tauri/src/menu.rs` | Already done (menu items enabled). Confirm only. |
| `src/editor/extensions.ts` | Remove `search({ top: false })`. Possibly replace with bare state registration (TC-2). `searchKeymap` stays. `searchTheme` import updated. |
| `src/editor/search-theme.ts` | Remove `.cm-panels` and `.cm-search` rules. Retain `.cm-searchMatch` and `.cm-searchMatch-selected`. |
| `src/editor/find-widget.ts` | New: custom widget module (substantial new file). |
| `src/editor/find-widget.css` | New (or added to `styles.css`): widget-specific styles. |
| `src/main.ts` | Replace `openSearchPanel`/`closeSearchPanel` calls with `findWidget.open()`/`findWidget.close()`. Update window focus handler. Update `newFile`, `openFile`, `openRecentFileByPath`. |
| `src/lib/settings.ts` | Add `findWidget` position field to settings schema. Handle migration/default. |
| `src/styles.css` | Existing `--search-*` variables retained unchanged. New widget CSS may be added here or in `find-widget.css`. |
| `package.json` | No new dependencies expected. `@codemirror/search` is already resolved transitively. |
| Live preview system | Must be verified as non-interfering. No changes to `live-preview.ts` expected. |
| Tests | New Vitest tests for `find-widget.ts` constructor, open/close, drag clamping, pre-fill, position persistence, and all 29 edge cases. |

---

## Files Expected to be Created or Modified

| File | Change Type | Summary |
|---|---|---|
| `src/editor/find-widget.ts` | New | Custom floating widget: DOM construction, drag logic, CM6 integration |
| `src/editor/find-widget.css` | New (or inline in `styles.css`) | Widget-specific styles using CSS custom properties |
| `src/editor/extensions.ts` | Modified | Remove `search()` panel factory; update search state registration |
| `src/editor/search-theme.ts` | Modified | Remove panel rules; retain match highlight rules |
| `src/main.ts` | Modified | Replace CM6 panel calls with widget API; update focus handler; update file-load handlers |
| `src/lib/settings.ts` | Modified | Add `findWidget` position field to schema and default |
| `tests/find-widget.test.ts` | New | Vitest tests for widget behavior and edge cases |

---

## Visual Verification Checklist (for user sign-off)

- [ ] Widget appears in upper-right of editor, not at the bottom
- [ ] Widget does not push editor text down
- [ ] Widget background and text color match the current theme
- [ ] Find input is focused when widget opens
- [ ] Typing in find input highlights matches in real time
- [ ] Count label shows "3 of 12" style; "No results" on zero matches
- [ ] Next/Previous buttons and Cmd-G / Cmd-Shift-G navigate matches
- [ ] Active match is highlighted more prominently than other matches
- [ ] Match Case / Whole Word / RegExp toggles show active state and update results immediately
- [ ] Escape closes the widget and editor regains focus
- [ ] Replace row is hidden by default; chevron expands it
- [ ] Replace One replaces current match and advances
- [ ] Replace All replaces everything; Cmd-Z reverses in one undo
- [ ] Widget is draggable by its header
- [ ] Widget cannot be dragged off-screen
- [ ] Dragged position persists after closing and reopening the widget
- [ ] Dragged position persists across app restarts
- [ ] Off-screen position falls back to default on launch
- [ ] Opening a new file closes the widget
- [ ] Toggling live preview (Cmd-E) while widget is open does not close the widget
- [ ] Widget and settings panel can be open simultaneously without z-index conflict

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 29 items in Edge Case Inventory

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
