---
title: Outline Panel — Live Heading Tree with Bidirectional Fold Sync
last-updated: "2026-05-02"
review-cadence-days: 90
status: active
---

# Outline Panel — Live Heading Tree with Bidirectional Fold Sync

## Feature Summary

As a writer using Markable, I want a sidebar panel that shows a live H1–H6
heading tree for the active document, so that I can navigate long documents
quickly and collapse sections both from the panel and from the editor, with
both views always staying in sync.

---

## Codebase Context Findings

### Finding 1 — Auto-TOC plugin is the closest existing precedent

`src/plugins/auto-toc/auto-toc.plugin.ts` already implements:
- `scanHeadings()` — a pure function that extracts ATX headings (H1–H6) from
  raw document text, skipping fenced code blocks.
- `findActiveIndex()` — finds the heading whose section contains the cursor.
- A CM6 `updateListener` extension debounced at 150 ms that re-renders on
  doc/selection changes.
- A sidebar panel registered via `api.registerSidebarPanel()`.

The Outline Panel can reuse the `HeadingEntry` type and the `scanHeadings`
logic verbatim, but is a separate plugin with distinct fold state management
not present in auto-toc.

### Finding 2 — No folding infrastructure exists yet

The app has NO fold gutter, NO `foldEffect` / `unfoldEffect` in any extension,
and NO `foldedRanges` usage anywhere in the codebase. This plugin introduces
section folding as the first and only fold mechanism in Markable. CM6 provides
the building blocks:

- `@codemirror/language`: `foldEffect`, `unfoldEffect`, `foldedRanges`,
  `foldService`, `codeFolding`.
- These are already exposed as window globals via `src/lib/cm-globals.ts` (the
  `@codemirror/language` window global must be verified as exported there;
  if absent, it must be added as a prerequisite step before plugin implementation).

### Finding 3 — `pluginCompartment` is the correct extension injection point

Plugins add CM6 extensions via `api.addExtensions(extensions[])`. These are
merged into `pluginCompartment` in `extensions.ts`. The Outline plugin's fold
listener and gutter (if any) must use this path — no direct mutation of
`buildExtensions()`.

### Finding 4 — Single shared EditorView; fold state is per EditorState

TabManager manages one EditorView. Tab switches call `view.setState(newState)`,
replacing the entire EditorState. Each tab's EditorState is independent:
`foldedRanges` is stored inside the state, so fold state is naturally per-tab.
No explicit per-tab fold state storage is required at the plugin layer.

### Finding 5 — `window.__MARKABLE_EDITOR__` is the live EditorView reference

Plugins access the editor as
`(window as any).__MARKABLE_EDITOR__ as EditorView`. The same pattern is
used by auto-toc. The value is always current because TabManager updates it
via `setEditorView` on init.

### Finding 6 — Tab-change events are not yet a formal plugin API

Auto-toc detects tab changes through the CM6 `updateListener` — when the
document changes (docChanged flag), the panel re-scans. This is the correct
approach for the Outline Panel too. The listener receives every `ViewUpdate`
including those caused by `setState()` on a tab switch (docChanged = true when
the new state has a different document).

### Finding 7 — `window.__CM_LANGUAGE__` global must exist for fold effects

The fold API (`foldEffect`, `unfoldEffect`, `foldedRanges`, `foldService`,
`codeFolding`) lives in `@codemirror/language`. `src/lib/cm-globals.ts` must
expose this package as `window.__CM_LANGUAGE__`. If it is not yet exposed, that
is a prerequisite code change (outside the plugin's IIFE boundary) that must
be added before the plugin can use fold effects.

---

## Functional Requirements

### FR-1 — Plugin registration and lifecycle

The Outline Panel is a single IIFE plugin file compiled from
`src/plugins/outline-panel/outline-panel.plugin.ts`. It exports
`{ onEnable, onDisable }`.

On `onEnable`:
- Inject plugin CSS (`<style id="__markable_outline_panel_css__">`).
- Register a sidebar panel via `api.registerSidebarPanel({ id: "outline-panel",
  title: "Outline", side: "left", render, destroy })`.
- Register CM6 extensions via `api.addExtensions([...])`. Extensions must
  include: (a) the `updateListener` for doc/fold-state changes, and (b) the
  `foldService` needed for CM6 to know how to fold Markdown sections.

On `onDisable`:
- Call `api.unregisterSidebarPanel("outline-panel")`.
- Call `api.removeExtensions()`.
- Remove the `<style>` tag.
- Null all module-level state variables (same cleanup pattern as auto-toc).

### FR-2 — Heading tree rendering

The panel lists all ATX headings (H1–H6) extracted from the active document
in document order. The same `scanHeadings()` logic used by auto-toc applies
(see Finding 1). Headings inside fenced code blocks are excluded.

Each heading row in the panel displays:
- A collapse/expand toggle chevron (visible for any heading that has "section
  body" content — see FR-5 for the definition of section body).
- The heading text, indented by level (H1 = 0 extra indent, each subsequent
  level adds a fixed pixel increment, e.g. 12 px per level).

Empty headings (e.g. `# ` with no text) are displayed as a non-breaking space
so the row remains visible and clickable.

### FR-3 — Heading navigation (click to scroll)

Clicking the heading text row (not the chevron) in the outline panel:
1. Moves the editor cursor to the first character of the heading line
   (`lineFrom` from the `HeadingEntry`).
2. Scrolls the heading into the vertical centre of the editor viewport using
   `EditorView.scrollIntoView(lineFrom, { y: "center" })`.
3. Focuses the editor (`view.focus()`).

If the target section is currently folded in the editor, the click must first
unfold it, then navigate. Navigating into a folded range without unfolding
would leave the cursor invisible inside a collapsed block, which violates
expected editor behaviour.

### FR-4 — Active heading highlight

The panel continuously highlights the heading whose section contains the
cursor. The active heading is the last heading in document order whose
`lineFrom` is less than or equal to the current cursor position
(`findActiveIndex()` logic from auto-toc). This updates on every cursor move
(via the updateListener debounce at 150 ms).

### FR-5 — Definition of a collapsible section

A "section" for heading H at line L consists of all lines from L+1 up to
(but not including) the next heading of the same or higher level (i.e. same
or fewer `#` characters), or to end of document if no such heading exists.

A section is "collapsible" only if it contains at least one non-empty,
non-whitespace-only line after the heading line itself. A heading with no
body content below it (or only blank lines before the next heading) is not
collapsible; its chevron is hidden or replaced with a neutral glyph.

The fold range for a heading is:
- `from`: the end of the heading line (the character position immediately
  after the last character on the heading line, exclusive of the newline).
- `to`: the end of the last non-blank line of the section body (exclusive of
  the trailing newline), or the end of the document if the section extends to
  EOF.

This range definition must be implemented as a CM6 `foldService` so that CM6's
native fold/unfold commands operate consistently with the panel's own collapse
actions (FR-6, FR-7).

### FR-6 — Outline panel collapse folds the editor section

When the user clicks the collapse chevron in the outline panel for heading H:
1. Compute the fold range for H (FR-5).
2. Dispatch `foldEffect.of({ from, to })` on the EditorView.
3. CM6 applies the fold, hiding the section body in the editor.
4. The panel re-renders (via the updateListener) showing H's chevron in
   collapsed state.

If the section is already folded (the `foldedRanges` RangeSet already covers
`from`), the click acts as a toggle — dispatch `unfoldEffect.of({ from })` to
expand it.

### FR-7 — Editor fold gutter collapses section and syncs panel

The plugin adds a `codeFolding()` extension (CM6's built-in fold gutter widget)
via `api.addExtensions`. This places a fold widget in the gutter on heading
lines. When the user clicks the fold widget in the editor gutter:
1. CM6 dispatches `foldEffect` internally.
2. The plugin's `updateListener` receives the `ViewUpdate`.
3. The listener reads `foldedRanges(update.state)` to determine which sections
   are now folded.
4. The panel re-renders with the correct chevron states for all headings.

No additional wiring is needed because the updateListener already fires on any
state change, including fold state changes.

### FR-8 — Fold state is per-tab

Because CM6 fold state is stored inside `EditorState` and TabManager uses
`view.setState()` on tab switches, fold state is automatically preserved
per-tab without any explicit plugin-level bookkeeping. When the user switches
tabs, the updateListener fires with the new document and its fold state; the
panel re-renders accordingly.

### FR-9 — Collapsed section rows in the panel

A heading whose section is folded in the editor is shown in the panel with:
- A right-pointing chevron (collapsed indicator).
- The heading text styled identically to non-collapsed headings (no strike-
  through, no dimming — collapsed is a navigational state, not a disabled one).

All headings inside a collapsed parent section remain visible in the panel
(the outline always shows the full flat list regardless of editor fold state).
Only the chevron state of the directly-folded heading changes.

### FR-10 — Panel "collapse all" / "expand all" (optional, out of scope for v1)

Per-heading collapse is the required v1 behaviour. A global "collapse all" or
"expand all" button is deferred to a future iteration. It must NOT be
implemented in this task.

### FR-11 — Empty document and no-headings state

When the active document has no ATX headings (including the empty-tab
"untitled" state), the panel displays a centred "No headings" message. This
matches the auto-toc plugin's behaviour and provides a clear empty state.

### FR-12 — Live update on document change

The panel re-renders within 150 ms of any document edit. The debounce timer is
reset on each `ViewUpdate` where `update.docChanged || foldStateChanged`. Fold
state changes (FR-7) must also trigger a re-render without requiring a document
edit.

Determining `foldStateChanged`: compare `foldedRanges(update.state)` against
`foldedRanges(update.startState)` using the `RangeSet` identity check or
`eq()` method to avoid unnecessary re-renders on cursor-only moves.

### FR-13 — Plugin on/off toggle

Disabling the plugin from the plugins panel:
1. Calls `onDisable`, which unregisters the sidebar panel and removes CM6
   extensions.
2. The sidebar slot hides automatically (SidebarManager handles this).
3. All fold effects applied while the plugin was active persist in the editor
   state (the fold state is part of EditorState, not owned by the plugin).
   This is acceptable and expected — disabling the panel does not unfold the
   document.

Re-enabling restores the panel with the current document's heading tree
immediately (the updateListener fires on the first update after registration).

---

## Non-Functional Requirements

**NFR-1 — IIFE plugin boundary compliance**
No ES module imports from app-internal modules (`bridge.ts`, `settings.ts`,
`main.ts`, `extensions.ts`) at runtime. CM6 globals are accessed via window
globals only (`window.__CM_VIEW__`, `window.__CM_LANGUAGE__`, etc.).
`import type` annotations are permitted (erased by tsc).

**NFR-2 — Performance: 100+ headings**
`scanHeadings()` is O(lines). `rebuildOutline()` (the DOM rebuild equivalent
of `rebuildTOC`) replaces `.innerHTML` on every call. Profiling the auto-toc
plugin shows this is acceptable for up to 200+ headings per the existing EC-9
note in auto-toc. The same threshold applies here: up to 200 headings must
render without perceptible lag.

**NFR-3 — Performance: fold state check**
Reading `foldedRanges(state)` on every `ViewUpdate` is O(1) for the getter
call. Comparing fold state between `update.startState` and `update.state`
must use `RangeSet` reference equality or the `.eq()` method (not serialization)
to remain O(1).

**NFR-4 — No fold regression on plugin disable**
`removeExtensions()` reconfigures `pluginCompartment` to remove the plugin's
extensions, including `codeFolding()`. Existing fold ranges in the editor
state remain intact (they live in the state's range set, which is unaffected
by extension removal). This is acceptable — it matches CodeMirror's design.

**NFR-5 — CSS scoping**
All CSS class names are prefixed `outline-` to avoid collisions with auto-toc
(`.toc-*` prefix) and other plugins.

**NFR-6 — Plugin build step**
After any change to `src/plugins/outline-panel/`:
`npm run build:plugins && npm run sync:plugins`.

**NFR-7 — No TODO comments in source**
Deferred work is logged in `docs/specs/outline-panel/00_index.md`.

**NFR-8 — Window size invariant unchanged**
No changes to `src-tauri/src/lib.rs` or `src/lib/settings.ts`.

**NFR-9 — `window.__CM_LANGUAGE__` prerequisite**
Before the plugin can use `foldEffect`, `unfoldEffect`, `foldedRanges`, and
`codeFolding`, `src/lib/cm-globals.ts` must export the `@codemirror/language`
package as a window global. The Architect must verify this during codebase
analysis. If missing, adding it is a prerequisite step for the Lead Developer
before the plugin implementation begins.

---

## Files That Must Change

| File | Change |
|------|--------|
| `src/lib/cm-globals.ts` | Add `window.__CM_LANGUAGE__` export (prerequisite — only if not already present) |
| `src/plugins/outline-panel/outline-panel.plugin.ts` | New file — the IIFE plugin |
| `src/plugins/outline-panel/outline-panel.ts` | New file — pure logic (scanHeadings reuse or fork, foldRange computation, rebuildOutline) |
| `src-tauri/plugins/core/outline-panel.js` | Built output — generated by `npm run build:plugins`, not hand-edited |

### Files that must NOT change

| File | Reason |
|------|--------|
| `src/plugins/auto-toc/auto-toc.plugin.ts` | Auto-toc is a separate plugin; do not merge concerns |
| `src/editor/extensions.ts` | Plugin extensions go through `pluginCompartment` via `api.addExtensions`, not `buildExtensions` |
| `src/editor/live-preview.ts` | No live-preview interaction required |
| `src-tauri/src/lib.rs` | Window size invariant |
| `src/lib/settings.ts` | Window size invariant |

---

## Out of Scope

- **Global "collapse all" / "expand all" button** — deferred (FR-10).
- **Drag-to-reorder headings** — the outline is read-only for navigation.
- **Inline editing of heading text from the panel** — click navigates, does not
  open an edit field.
- **Setext headings** (`====` underline style) — ATX headings only, matching
  the existing auto-toc behaviour.
- **Folding non-heading constructs** (code blocks, blockquotes) — this plugin
  folds Markdown sections delimited by headings only.
- **Persisting fold state across app restarts** — fold state is in-memory only
  (part of EditorState). Session restore does not re-apply folds.
- **Custom fold keybindings** (e.g. Cmd-Shift-[ to fold at cursor) — the plugin
  adds the fold gutter widget but does not register keyboard shortcuts.

---

## Edge Case Inventory

**EC-1 — Document with no headings**
`scanHeadings()` returns `[]`. The panel shows "No headings". No chevrons, no
fold interactions possible.

**EC-2 — Document with a single heading and no body**
The heading has no collapsible section (FR-5 — empty body). The chevron is
hidden. The heading is still clickable for navigation.

**EC-3 — Cursor above all headings (before the first heading)**
`findActiveIndex()` returns -1. No heading is highlighted in the panel. No
regression; this matches auto-toc behaviour (EC-3 in auto-toc).

**EC-4 — Cursor inside a folded section**
The cursor may be inside the fold range (CM6 allows this). When folded, the
cursor is hidden from view but the outline panel still shows the active heading
(the fold's parent heading is highlighted). Navigating away via the panel
first unfolds the target section before scrolling (FR-3).

**EC-5 — Click-to-navigate into a currently folded section**
FR-3 specifies: dispatch `unfoldEffect` for the section containing the target
heading, then dispatch the cursor selection and scroll. This prevents the
cursor landing inside a hidden range.

**EC-6 — Heading at the very end of the document (no trailing newline)**
`scanHeadings()` handles the last line correctly (the existing auto-toc
implementation is already verified for this case). The fold range `to` is
`doc.length` (end of document). CM6 foldEffect accepts this.

**EC-7 — Two headings of different levels with no content between them**
Example: `## Foo\n### Bar`. The section for `## Foo` has no non-blank body
lines before `### Bar`. Per FR-5, this section is not collapsible; the chevron
for `## Foo` is hidden. `### Bar` is separately evaluated.

**EC-8 — Heading immediately preceded by a fenced code block containing `#` lines**
`scanHeadings()` skips headings inside code fences. The fold panel renders only
real document headings. No interaction with code-block `#` lines.

**EC-9 — Document with 200+ headings**
The entire `rebuildOutline()` call must complete without visible lag (NFR-2).
All 200+ heading rows are built in a single `innerHTML`-clear pass. The
`foldedRanges` check is O(1). Acceptable per auto-toc precedent.

**EC-10 — Tab switch while a section is folded**
`view.setState(newTabState)` replaces the entire EditorState. The new state's
`foldedRanges` reflects the new tab's fold state (which may be empty on first
visit). The `updateListener` fires with `docChanged = true`. The panel re-
renders for the new document. Old fold state is preserved in the previous tab's
EditorState (held by TabManager's `TabEntry`).

**EC-11 — Rapid toggle: plugin disabled and re-enabled before the debounce fires**
`onDisable` clears the debounce timer and nulls `_enabled`. `onEnable` resets
all state. The updateListener registered in `onEnable` is a fresh closure. No
stale callbacks execute.

**EC-12 — `foldEffect` dispatched on a section with no body**
FR-5 ensures the plugin never dispatches `foldEffect` on a non-collapsible
section (the chevron is hidden). If somehow a zero-length fold range is
computed, CM6 silently ignores it (dispatching an effect with `from === to` is
a no-op in CM6's fold system). Defensive guard recommended in the implementation.

**EC-13 — `window.__CM_LANGUAGE__` is not yet exposed**
If the prerequisite step (NFR-9) is skipped, the plugin IIFE will throw a
TypeError when accessing `(window as any).__CM_LANGUAGE__.foldEffect`. The
plugin's `onEnable` must access this global inside a try/catch and log a clear
error: `"Outline Panel: @codemirror/language not available as window global.
Ensure cm-globals.ts exports __CM_LANGUAGE__."`. The plugin must not partially
enable in this state.

**EC-14 — Fold gutter widget shown for non-heading lines**
`codeFolding()` uses the registered `foldService` to decide which lines get a
fold widget. The plugin's `foldService` must return `null` for non-heading
lines so the gutter widget appears only on collapsible heading lines (FR-5).

**EC-15 — Live-preview mode (Typora-style hide-syntax)**
In live-preview mode, `live-preview.ts` applies decorations that hide Markdown
syntax (e.g. the `##` prefix characters). The heading lines are still present
in the document; `lineFrom` values are still valid. The fold gutter renders on
the same line regardless of decoration state. No special interaction required.
The two extensions are independent.

**EC-16 — User edits a heading so the fold range shifts**
After the edit, `docChanged = true` triggers the debounce. On fire, the plugin
re-scans headings and re-reads `foldedRanges`. Existing folds are anchored to
character positions. If the heading was edited (its `lineFrom` changed), the
old fold range may no longer align with the heading. The plugin does NOT attempt
to migrate folds on edit — this is standard CM6 fold behaviour (fold ranges are
not automatically relocated on document changes). The user must re-fold if
desired.

**EC-17 — Untitled / empty new document**
The editor has no file content. `scanHeadings("")` returns `[]`. Panel shows
"No headings". No crash.

**EC-18 — Outline panel registered but sidebar is closed (not visible)**
The updateListener still fires. The panel re-renders in the background (the
container is in the DOM but not displayed). This matches auto-toc behaviour
and is the correct approach — no visibility check is needed.

**EC-19 — Fold state changed by a future keyboard shortcut or another plugin**
If another plugin or a future keybinding dispatches `foldEffect`/`unfoldEffect`,
the updateListener receives the `ViewUpdate`. The fold-state change check
(FR-12) detects the change and triggers a panel re-render. The outline panel
stays in sync regardless of the source of the fold dispatch.

**EC-20 — `codeFolding()` extension added twice (rapid double enable)**
`api.addExtensions` replaces any prior registration for this plugin id
(idempotent per markable-plugin-api.ts). CM6 will not have duplicate
`codeFolding()` extensions for this plugin. The `_enabled` guard in `onEnable`
also prevents double-registration.

---

## Acceptance Criteria

**AC-1** — With the plugin enabled, opening a document that has H1–H6 headings
causes the outline panel to show all headings within 150 ms.

**AC-2** — Clicking a heading row in the outline panel moves the cursor to that
heading's line and scrolls it to the centre of the editor viewport.

**AC-3** — Clicking the collapse chevron for a heading in the outline panel folds
the corresponding section in the editor (the body lines become hidden behind a
fold marker). The chevron updates to the collapsed state.

**AC-4** — Clicking the collapse chevron again (when already collapsed) unfolds
the section in the editor. The chevron returns to the expanded state.

**AC-5** — Clicking the fold widget in the editor gutter on a heading line folds
the section. The outline panel's chevron for that heading updates to collapsed
within 150 ms.

**AC-6** — Clicking the fold widget in the editor gutter on an already-folded
heading unfolds the section. The outline panel's chevron returns to expanded.

**AC-7** — Switching tabs updates the outline panel to show the new document's
headings and correctly reflects that document's fold state.

**AC-8** — With a section folded, switching away from the tab and back again
preserves the fold state in the editor and in the panel.

**AC-9** — A document with no headings shows a "No headings" message in the panel.
No errors are thrown.

**AC-10** — Disabling the plugin from the plugins panel removes the sidebar panel
and the fold gutter. No console errors. Re-enabling restores both.

**AC-11** — A heading that has no body content (nothing before the next same-or-
higher-level heading) shows no collapse chevron. Clicking its text row still
navigates correctly.

**AC-12** — With the plugin enabled, a document with 200 headings renders in the
outline panel without perceptible lag (< 200 ms total).

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory (EC-1 through EC-20)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
