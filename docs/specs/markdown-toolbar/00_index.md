---
title: "Markdown Toolbar Plugin — Master Blueprint"
last-updated: "2026-04-15"
review-cadence-days: 14
status: active
---

# Markdown Toolbar Plugin — Master Blueprint

**Requirements source:** `docs/requirements/active_task.md`
**Feature:** Markdown Toolbar Plugin v1.0

---

## Implementation Checklist

- [x] step_01 — Plugin skeleton, settings types, CSS injection, onEnable/onDisable scaffold
- [x] step_02 — Format detection engine (pure functions, no DOM, fully testable)
- [x] step_03 — Format toggle engine (wrap/unwrap/erase, pure functions, fully testable)
- [x] step_04 — Floating toolbar DOM construction and viewport-flip positioning
- [x] step_05 — Sidebar panel mode (register/unregister, disabled-state styling)
- [x] step_06 — CM6 updateListener wiring (debounced active-state, position update)
- [x] step_07 — Active state highlighting + button click dispatch integration

---

## Architecture Overview

### File to create

```
src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts
```

Compiled output:

```
src-tauri/plugins/core/markdown-toolbar.js
```

Test file:

```
tests/markdown-toolbar.test.ts
```

Build config entry: add to `vite.plugins.config.ts` (step_01).

### No new dependencies

All implementation uses vanilla TypeScript, DOM APIs, and CM6 accessed via `window.__CM_VIEW__`. No entries added to `package.json`.

---

## Tech Stack Decision

No stack research required — the project's plugin system, build pipeline, and runtime constraints are already fixed. This plugin must follow the identical pattern as `auto-toc.plugin.ts` (sidebar + CM6 listener) and `focus-mode.plugin.ts` (pure ViewPlugin). No new technology is introduced.

---

## High-Level Data Flow

```
User clicks toolbar button
         │
         ▼
  resolveUrl() [Link/Image only]
  ── clipboard check → window.prompt fallback
         │
         ▼
  toggleFormat() or eraseFormatting()
  ── pure function: computes ChangeSet + new SelectionRange
         │
         ▼
  view.dispatch({ changes, selection })  ← one atomic transaction
         │
         ▼
  CM6 updateListener fires (debounced 150 ms)
  ── detectFormats() pure function reads state.doc around selection.main
         │
         ▼
  updateActiveButtons()
  ── sets/removes .md-toolbar__btn--active on each button
         │                               │
         ▼                               ▼
  [floating mode]                 [sidebar mode]
  updatePosition()               updateDisabledState()
  ── coordsAtPos → fixed CSS     ── all buttons disabled when selection empty
```

---

## Component Map

### New files

| File | Purpose |
|---|---|
| `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` | Single plugin file (all logic, CSS, DOM, CM6 integration) |
| `tests/markdown-toolbar.test.ts` | Vitest unit tests for all pure-function exports |

### Modified files

| File | Change |
|---|---|
| `vite.plugins.config.ts` | Add `markdown-toolbar` entry to the config array |

No other files are modified. The plugin integrates exclusively through `api.addExtensions()`, `api.registerSidebarPanel()`, and `api.saveSettings()`/`api.loadSettings()` — the same contract used by all existing plugins.

---

## Module Structure (within `markdown-toolbar.plugin.ts`)

The file is divided into the following sections, in order:

```
1.  Type-only imports (erased by tsc)
2.  Settings types and defaults
3.  Module-level state declarations
4.  CSS constant (TOOLBAR_CSS)
5.  CSS lifecycle helpers (injectCSS, removeCSS)
6.  Pure: detectFormats(docText, from, to) → FormatFlags
7.  Pure: computeWrap(text, format) → { insert, selFrom, selTo }
8.  Pure: computeUnwrap(docText, from, to, format) → { from, to, insert, selFrom, selTo }
9.  Pure: computeErase(docText, from, to) → { insert, selFrom, selTo }
10. Async: resolveUrl() → string | null
11. DOM: buildToolbarDOM() → HTMLElement
12. DOM: updateActiveButtons(flags, buttons)
13. DOM: updateDisabledState(empty, buttons)
14. DOM: updatePosition(view, toolbarEl)
15. CM6 listener factory: buildUpdateListener(toolbarEl, buttons, settings)
16. Plugin export object (onEnable, onDisable)
```

---

## Settings Contract

```typescript
interface ToolbarSettings {
  toolbarMode: "floating" | "sidebar";
  sidebarSide: "left" | "right";
}

const DEFAULT_SETTINGS: ToolbarSettings = {
  toolbarMode: "floating",
  sidebarSide: "left",
};
```

Stored at: `~/Library/Application Support/com.markable.app/plugins/markdown-toolbar/settings.json`

---

## Format Registry

The canonical format table drives detection, wrapping, and active state. Defined as a const array at module scope; each entry is a `FormatDef`.

```typescript
type FormatId =
  | "bold" | "italic" | "underline" | "strikethrough"
  | "highlight" | "inlineCode" | "superscript"
  | "link" | "image" | "erase";

interface FormatDef {
  id: FormatId;
  label: string;        // accessible button label / tooltip
  // Markers used for wrap and for detection. Absent on "erase".
  open?: string;        // opening marker, e.g. "**"
  close?: string;       // closing marker, e.g. "**"  (defaults to open if omitted)
  isHtml?: boolean;     // true for <u>…</u>
  isLink?: boolean;     // true for [text](url) — special wrap logic
  isImage?: boolean;    // true for ![alt](url)  — special wrap logic
}
```

| id | open | close | notes |
|---|---|---|---|
| bold | `**` | `**` | |
| italic | `*` | `*` | |
| underline | `<u>` | `</u>` | isHtml: true |
| strikethrough | `~~` | `~~` | |
| highlight | `==` | `==` | |
| inlineCode | `` ` `` | `` ` `` | |
| superscript | `^` | `^` | |
| link | `[` | `](url)` | isLink: true — URL resolved by resolveUrl() |
| image | `![` | `](url)` | isImage: true — URL resolved by resolveUrl() |
| erase | — | — | special: strips all formats |

---

## Detection Algorithm

`detectFormats(docText: string, from: number, to: number): FormatFlags`

`FormatFlags` is a `Record<FormatId, boolean>` where `true` means "the selection is currently inside / overlapping this format".

Detection strategy:
- Extract a context window: `docText.slice(Math.max(0, from - 64), to + 64)`. Offset `from` and `to` into the window.
- For each format (except `erase`), test whether `open` marker appears before `from` and `close` marker appears after `to` within the window (accounting for the adjusted offsets).
- Special cases: `<u>...</u>` detection uses regex `/<u>([\s\S]*?)<\/u>/`. Link detection uses `/\[([^\]]*)\]\([^)]*\)/`. Image uses `/!\[([^\]]*)\]\([^)]*\)/`.
- Returns the flags object. `erase` flag is always `false` (it is an action, not a detectable state).

This is a pure function with no CM6 or DOM dependency — fully testable with plain strings.

---

## Wrap / Unwrap Algorithm

### computeWrap

`computeWrap(selectedText: string, fmt: FormatDef, url?: string): WrapResult`

```typescript
interface WrapResult {
  insert: string;     // text to replace the selection
  selFrom: number;    // new selection anchor (relative to start of insert)
  selTo: number;      // new selection head   (relative to start of insert)
}
```

- For standard formats: `insert = fmt.open + selectedText + fmt.close`. `selFrom = fmt.open.length`, `selTo = fmt.open.length + selectedText.length`.
- For link: `insert = "[" + selectedText + "](" + url + ")"`. Selection covers only `selectedText`.
- For image: `insert = "![" + selectedText + "](" + url + ")"`. Selection covers only `selectedText`.

### computeUnwrap

`computeUnwrap(docText: string, from: number, to: number, fmt: FormatDef): UnwrapResult | null`

Returns `null` if the markers are not found (caller treats as no-op).

```typescript
interface UnwrapResult {
  changeFrom: number;   // absolute doc position where replacement starts
  changeTo: number;     // absolute doc position where replacement ends
  insert: string;       // the inner text (markers removed)
  selFrom: number;      // absolute selection anchor after unwrap
  selTo: number;        // absolute selection head after unwrap
}
```

Algorithm:
1. Walk backward from `from` to find the `open` marker in the doc.
2. Walk forward from `to` to find the `close` marker.
3. `changeFrom = openMarkerStart`, `changeTo = closeMarkerEnd`.
4. `insert = docText.slice(openMarkerStart + open.length, closeMarkerStart)`.
5. `selFrom = changeFrom`, `selTo = changeFrom + insert.length`.
6. Special handling for `<u>`, `[text](url)`, `![alt](url)` — strip full HTML or link syntax.

### computeErase

`computeErase(docText: string, from: number, to: number): EraseResult`

```typescript
interface EraseResult {
  insert: string;     // selected text with all format wrappers stripped
  changed: boolean;   // false if no wrappers were found (caller skips dispatch)
}
```

Algorithm: extract `text = docText.slice(from, to)`. Apply stripping passes in a loop until stable:
1. Bold: `text.replace(/\*\*([\s\S]*?)\*\*/g, "$1")`
2. Italic: `text.replace(/\*([\s\S]*?)\*/g, "$1")`
3. Underline: `text.replace(/<u>([\s\S]*?)<\/u>/g, "$1")`
4. Strikethrough: `text.replace(/~~([\s\S]*?)~~/g, "$1")`
5. Highlight: `text.replace(/==([\s\S]*?)==/g, "$1")`
6. Inline code: `` text.replace(/`([\s\S]*?)`/g, "$1") ``
7. Superscript: `text.replace(/\^([\s\S]*?)\^/g, "$1")`
8. Link: `text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")`
9. Image: `text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")`

`changed = (text !== original)`. Iterates until no change in one full pass (handles nested formats, EC-12).

---

## Toolbar DOM Structure

```html
<div class="md-toolbar" id="__markable_md_toolbar__" role="toolbar" aria-label="Formatting">
  <button class="md-toolbar__btn" data-format="bold"          title="Bold (Cmd+B)">B</button>
  <button class="md-toolbar__btn" data-format="italic"        title="Italic (Cmd+I)">I</button>
  <button class="md-toolbar__btn" data-format="underline"     title="Underline">U̲</button>
  <button class="md-toolbar__btn" data-format="strikethrough" title="Strikethrough">S̶</button>
  <button class="md-toolbar__btn" data-format="highlight"     title="Highlight">H</button>
  <button class="md-toolbar__btn" data-format="inlineCode"    title="Inline Code">`·`</button>
  <button class="md-toolbar__btn" data-format="superscript"   title="Superscript">x²</button>
  <button class="md-toolbar__btn" data-format="link"          title="Link">🔗</button>
  <button class="md-toolbar__btn" data-format="image"         title="Image">🖼</button>
  <button class="md-toolbar__btn" data-format="erase"         title="Erase Formatting">✕</button>
</div>
```

`buildToolbarDOM()` creates this element once. The element is appended to `document.body` (floating mode) or passed to the sidebar `render()` callback (sidebar mode). The same DOM construction function is used in both modes; only the mount point differs.

The button NodeList is stored in module-level `_buttons: NodeListOf<HTMLButtonElement> | null` for O(1) access in the update path.

---

## Floating Mode Positioning

`updatePosition(view: EditorViewType, toolbarEl: HTMLElement): void`

1. `const sel = view.state.selection.main`
2. If `sel.empty` → `toolbarEl.style.display = "none"` and return.
3. `const coords = view.coordsAtPos(sel.from)`
4. If `coords === null` → return (selection outside viewport).
5. `const toolbarHeight = toolbarEl.offsetHeight || 36` (fallback for first call before paint).
6. `const OFFSET = 8`
7. Preferred position: `top = coords.top - toolbarHeight - OFFSET`
8. Flip check: if `top < 0` → `top = coords.bottom + OFFSET` (toolbar below selection).
9. `left = coords.left` — clamped so toolbar stays within `window.innerWidth` minus toolbar width.
10. Apply `toolbarEl.style.top = top + "px"` and `toolbarEl.style.left = left + "px"`.
11. `toolbarEl.style.display = "flex"`.

The toolbar element carries `position: fixed` from CSS (set once), so top/left are viewport-relative.

---

## CM6 Extension Architecture

Only one CM6 extension is registered: an `EditorView.updateListener` built by the factory `buildUpdateListener()`.

The listener does two distinct things at different rates:

| Concern | Timing |
|---|---|
| Active state detection (`detectFormats` + `updateActiveButtons`) | Debounced 150 ms |
| Floating toolbar position (`updatePosition`) | Synchronous on each selection change |

```
updateListener.of((update) => {
  if (!_enabled) return;
  _view = update.view;

  const docChanged = update.docChanged;
  const selChanged = update.selectionSet;
  if (!docChanged && !selChanged) return;

  // Synchronous: reposition floating toolbar immediately
  if (_settings.toolbarMode === "floating" && _toolbarEl) {
    updatePosition(update.view, _toolbarEl);
  }

  // Debounced: active state + disabled state
  if (_debounceTimer) clearTimeout(_debounceTimer);
  const docText = update.state.doc.toString();
  const sel = update.state.selection.main;
  const isEmpty = sel.empty;
  _debounceTimer = setTimeout(() => {
    if (!_enabled) return;
    const flags = detectFormats(docText, sel.from, sel.to);
    updateActiveButtons(flags, _buttons);
    if (_settings.toolbarMode === "sidebar") {
      updateDisabledState(isEmpty, _buttons);
    }
  }, DEBOUNCE_MS);
});
```

---

## Module-Level State

All variables are reset in `onDisable`.

```typescript
let _enabled: boolean = false;
let _settings: ToolbarSettings = { ...DEFAULT_SETTINGS };
let _view: EditorViewType | null = null;
let _toolbarEl: HTMLElement | null = null;
let _buttons: NodeListOf<HTMLButtonElement> | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _sidebarPanelRegistered: boolean = false;
```

`_sidebarPanelRegistered` tracks whether `api.registerSidebarPanel()` was called in the current `onEnable` cycle, so `onDisable` can call `api.unregisterSidebarPanel()` if and only if the panel was registered (NFR-3, EC-17).

---

## onEnable Sequence

```
1. _enabled = true
2. raw = await api.loadSettings()
3. _settings = mergeWithDefaults(raw)          // EC-18, EC-19
4. injectCSS()                                  // idempotent, guarded by style id
5. _toolbarEl = buildToolbarDOM()               // creates buttons, attaches click handlers
6. _buttons = _toolbarEl.querySelectorAll(".md-toolbar__btn")
7. api.addExtensions([buildUpdateListener()])
8. if _settings.toolbarMode === "floating":
     document.body.appendChild(_toolbarEl)
     _toolbarEl.style.display = "none"         // hidden until selection
   else (sidebar):
     api.registerSidebarPanel({ ... })          // render() mounts _toolbarEl into container
     _sidebarPanelRegistered = true
```

---

## onDisable Sequence

```
1.  _enabled = false
2.  if _debounceTimer: clearTimeout; _debounceTimer = null
3.  api.removeExtensions()
4.  if _settings.toolbarMode === "floating" && _toolbarEl:
      _toolbarEl.remove()                        // EC-16
5.  if _sidebarPanelRegistered:
      api.unregisterSidebarPanel("markdown-toolbar")  // EC-17
      _sidebarPanelRegistered = false
6.  removeCSS()
7.  Reset: _toolbarEl = null; _buttons = null; _view = null
8.  _settings = { ...DEFAULT_SETTINGS }
```

---

## CSS Design

Style id: `__markable_md_toolbar_css__`

Key classes:

| Class | Purpose |
|---|---|
| `.md-toolbar` | Container — `position: fixed`, `display: flex`, `flex-direction: row`, `gap: 4px`, `padding: 6px 8px`, `border-radius: 6px`, `z-index: 10000`, `box-shadow: 0 2px 8px rgba(0,0,0,0.25)` |
| `.md-toolbar__btn` | Each button — `width: 28px`, `height: 28px`, `border: none`, `border-radius: 4px`, `cursor: pointer`, `font-size: 13px` |
| `.md-toolbar__btn--active` | Active state — `background: var(--link-color)`, `color: var(--bg-primary)` |
| `.md-toolbar__btn--disabled` | Disabled state (sidebar mode, empty selection) — `opacity: 0.35`, `pointer-events: none`, `cursor: default` |

In sidebar mode, `.md-toolbar` has `position: static`, `flex-wrap: wrap`, `padding: 12px 8px` (set via a modifier class `.md-toolbar--sidebar` added by `buildToolbarDOM()` when constructed for sidebar).

Wait — the toolbar element is built once; it can be in either mode. Instead of a modifier class, apply sidebar layout overrides via a CSS rule scoped to the sidebar container. The sidebar container has a predictable class from `SidebarManager`; use `.sidebar-panel-content .md-toolbar { position: static; flex-wrap: wrap; }`.

All colour values use CSS variables from the active theme for automatic adoption.

---

## Edge Case Coverage Map

Every EC from `active_task.md` is addressed by a specific step and test.

| EC | Addressed in | Mechanism |
|---|---|---|
| EC-1 | step_04, step_06 | `sel.empty` check in `updatePosition`; toolbar stays `display:none` |
| EC-2 | step_05, step_06 | `updateDisabledState(isEmpty=true)` adds `--disabled` class |
| EC-3 | step_02, step_07 | `detectFormats` returns both bold+italic; `updateActiveButtons` sets both |
| EC-4 | step_02, step_07 | Same as EC-3 — detectFormats context window catches nested markers |
| EC-5 | step_03, step_07 | `computeUnwrap` removes markers; single dispatch; new sel covers text only |
| EC-6 | step_03 | Single `view.dispatch` call per button — one undo step |
| EC-7 | step_03 | `resolveUrl`: clipboard check first; no prompt if URL found |
| EC-8 | step_03 | `resolveUrl`: clipboard non-URL → `window.prompt` |
| EC-9 | step_03 | `resolveUrl`: `window.prompt` returns null → abort, no dispatch |
| EC-10 | step_04 (floating) / step_05 (sidebar) | Empty selection guard fires before URL resolution |
| EC-11 | step_03 | `computeErase` returns `changed: false` → no dispatch |
| EC-12 | step_03 | Iterative stripping loop; single dispatch |
| EC-13 | step_03 | Link regex strips `[text](url)` → `text` |
| EC-14 | step_04 | Flip logic: `top < 0` → position below selection |
| EC-15 | step_01 | CSS guard on style id; `_toolbarEl.remove()` in `onDisable`; `api.removeExtensions()` |
| EC-16 | step_01 (onDisable) | `_toolbarEl.remove()` called before returning |
| EC-17 | step_01 (onDisable) | `_sidebarPanelRegistered` flag guards `unregisterSidebarPanel` call |
| EC-18 | step_01 | `mergeWithDefaults(null)` returns `DEFAULT_SETTINGS` |
| EC-19 | step_01 | `mergeWithDefaults(partial)` fills missing keys from defaults |
| EC-20 | step_02, step_06 | `detectFormats` operates on raw string; multi-line selection is valid |
| EC-21 | step_03 | `computeWrap` wraps verbatim — no escaping of content |
| EC-22 | step_06 | updateListener guard: only fires if editor view global is defined |
| EC-23 | step_06 | `__MARKABLE_EDITOR_VIEW__` checked before dispatch; CM6 listener targets live view |

---

## Exported Pure Functions (for testing)

```typescript
export type { FormatId, FormatDef, FormatFlags, WrapResult, UnwrapResult, EraseResult, ToolbarSettings }
export { FORMATS }                             // canonical FormatDef array
export { detectFormats }                       // step_02
export { computeWrap, computeUnwrap, computeErase }  // step_03
export { mergeWithDefaults }                   // step_01
export { isUrlLike }                           // used by resolveUrl, testable
```

All CM6-dependent and DOM-dependent code is NOT exported — it lives in factory functions (`buildUpdateListener`, `buildToolbarDOM`) called only inside `onEnable`.

---

## Review Request

- **Files changed**:
  - `src/plugins/markdown-toolbar/markdown-toolbar.plugin.ts` (created)
  - `tests/plugins/markdown-toolbar/markdown-toolbar.test.ts` (created)
  - `vite.plugins.config.ts` (modified — added `markdown-toolbar` entry)
  - `scripts/build-plugins.mjs` (modified — added `markdown-toolbar` to PLUGINS array, updated success message)
  - `docs/specs/markdown-toolbar/00_index.md` (this file — steps checked off)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07 (all in a single file per the spec's module structure)

- **Known limitations**:
  - Visual-only acceptance criteria (AC-4.x floating mode, AC-5.x sidebar mode, AC-6.x listener behaviour) require manual verification in the running Tauri app — they cannot be exercised by Vitest.
  - The `detectFormats` context window (64 chars) may produce false-negatives for link/image URLs longer than 64 characters. This is explicitly accepted in the spec.
  - The `_view` module-level variable is written by the updateListener but the click handler primarily reads `window.__MARKABLE_EDITOR_VIEW__`. `_view` is wired as a fallback in `handleButtonClick` to satisfy the TypeScript compiler and provide resilience for edge cases.
  - `api.saveSettings()` is not called in v1.0 because there is no settings UI. The `_settings` object is populated from disk on `onEnable` but is never written back. When a settings UI is added, `api.saveSettings({ toolbarMode: ..., sidebarSide: ... })` must be called after each user change (H-3).

- **Edge cases covered by tests**:

  | Edge Case | Test(s) |
  |---|---|
  | EC-1 (empty selection, floating toolbar hidden) | Visual only (AC-4.1/4.2); `handleButtonClick` guard tested indirectly |
  | EC-2 (sidebar disabled state on empty selection) | Visual only (AC-5.3) |
  | EC-3 (bold+italic simultaneously active) | `detectFormats AC-2.5`; `updateActiveButtons AC-7.3` |
  | EC-4 (nested inline formats detected) | `detectFormats AC-2.6` |
  | EC-5 (unwrap removes markers, selection covers text) | `computeUnwrap AC-3.6` |
  | EC-6 (single undo step) | Visual only (one `view.dispatch` per click) |
  | EC-7 (clipboard URL used silently) | `resolveUrl AC-3.15` |
  | EC-8 (clipboard non-URL → prompt) | `resolveUrl AC-3.16` |
  | EC-9 (user cancels prompt → abort) | `resolveUrl AC-3.17` |
  | EC-10 (empty selection guard before URL resolution) | Covered by `sel.empty` guard in `handleButtonClick` |
  | EC-11 (erase on plain text → no dispatch) | `computeErase AC-3.13` |
  | EC-12 (nested formats iterative stripping) | `computeErase AC-3.10, AC-3.14` |
  | EC-13 (link stripped to text by erase) | `computeErase AC-3.11` |
  | EC-14 (viewport flip) | Visual only (AC-4.11) |
  | EC-15 (no duplicate style tags on rapid toggle) | `injectCSS` idempotent guard (CSS lifecycle) |
  | EC-16 (toolbar removed on disable) | Visual only (AC-4.10); `onDisable` sequence verified |
  | EC-17 (unregister guard via `_sidebarPanelRegistered`) | Code path covered; `onDisable` is complete |
  | EC-18 (null settings → defaults) | `mergeWithDefaults AC-1.2` |
  | EC-19 (partial settings → fill from defaults) | `mergeWithDefaults AC-1.3, AC-1.4` |
  | EC-20 (multi-line selection detection) | `detectFormats AC-2.16` |
  | EC-21 (no escaping in computeWrap) | `computeWrap AC-3.3` |
  | EC-22 (guard on undefined editor view in sidebar render) | Code path in `sidebarDescriptor.render()` |
  | EC-23 (live view via `__MARKABLE_EDITOR_VIEW__`) | Code path in `handleButtonClick` |
  | EC-24 (italic false-positive on `*` bullet list — H-1 regression) | `detectFormats H-1 regression` suite (5 tests) |
