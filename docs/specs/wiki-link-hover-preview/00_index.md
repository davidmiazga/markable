---
title: "Wiki-link Hover Preview — Master Blueprint"
last-updated: "2026-04-28"
review-cadence-days: 14
status: reference
---

# Wiki-link Hover Preview — Master Blueprint

## 1. Purpose

Implement a mouse-hover popover for `[[wikilink]]` spans that shows the linked
document's title and a plain-text excerpt without leaving the current document.
All changes are contained in one file:
`src/plugins/backlinks/backlinks.plugin.ts`.

Requirements source: `docs/requirements/active_task.md`

---

## 2. Stack Decision

No new stack decisions are required. All technology is already established:

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Event handling | Native DOM `addEventListener` (document-level capture) | Consistent with `_wikiLinkClickHandler` pattern already in the file. No CM6 involvement needed for mouse events. |
| DOM construction | Plain `document.createElement` | The popover is a single floating element appended to `document.body`; no framework needed. |
| CSS injection | `<style>` tag with `data-` attribute sentinel | Identical to `injectWikiLinkStyles` / `injectBacklinksCSS` patterns already present. |
| File reading | `invokeReadFile` (existing wrapper) | Already in the file; reuses the established `__TAURI_INTERNALS__.invoke` pattern. |
| Path resolution | `resolveWikiLinkPath` / `normalizeTarget` (existing) | Already in the file; identical to `handleWikiLinkClick` path. |

No web research was required: the project's architecture is fixed (Tauri v2 +
CodeMirror 6 + TypeScript IIFE plugins) and the pattern for all component types
is already established in the same file.

---

## 3. EC-13 Z-index Audit

The requirements flag EC-13 as requiring architect verification of the settings
panel z-index. Audit findings:

| UI element | z-index |
|-----------|---------|
| Settings panel (`settings-panel.css`) | **1000** |
| Tab drag overlay (`tabs.css`) | 9999 |
| File browser context menu | 9999 |
| Command bar | 9999 / 10000 |
| Markdown toolbar | 10000 / 10002 |
| Daily note modal overlay | 10001 |
| Export overlay | 10000 |
| Go-to-line overlay (`styles.css`) | 200 |
| **Wiki-hover popover (new)** | **10000** |

Decision: use z-index 10000 as specified in FR-10.4. The settings panel at 1000
will be rendered below the popover. This is acceptable because FR-6.1 specifies
that any `click` event dismisses the popover; opening settings requires a click
on the settings icon, which fires the click event and dismisses the popover
before settings opens. No z-index conflict is possible.

The daily-note modal overlay at 10001 is higher than the popover (10000). This
is correct: a full-screen modal should occlude the popover. The popover's
`click`-anywhere dismissal also applies since clicking to open the modal fires a
click first.

---

## 4. Architecture Overview

### 4.1 Data Flow

```
User hovers .cm-wiki-link span
    |
    v
document mouseover (capture) listener (_wikiLinkHoverHandler)
    |
    +--> reads data-wiki-target from the span DOM attribute
    +--> starts _hoverShowTimer (180 ms)
    |
    v  (after 180 ms, if cursor still over span)
reads window.__MARKABLE_CURRENT_FILE__  [EC-07: null → abort]
    |
    v
resolveWikiLinkPath(currentFile, target)
    |
    v
invokeReadFile(resolvedPath)  [EC-01: ok:false → abort]
    |
    +--> increments _hoverFetchVersion before fetch
    +--> captures version at fetch-start
    +--> on settle: checks captured === current [EC-04: stale → discard]
    |
    v
extractPopoverContent(rawContent, resolvedPath)
    |
    +--> slices to 2048 bytes [EC-03]
    +--> extracts title (YAML front matter → H1 → filename stem) [FR-3.1]
    +--> strips fenced blocks + markdown syntax chars [FR-3.2]
    +--> computes vault-relative path label [FR-3.3]
    +--> returns { title, pathLabel, excerpt }
    |
    v
positionPopover(spanElement, popoverEl)
    |
    +--> getBoundingClientRect on span
    +--> default: below span (top = rect.bottom + 8, left = rect.left)
    +--> right-clamp if left + 320 > window.innerWidth - 16 [FR-5.2]
    +--> flip above if top + height > window.innerHeight - 16 [FR-5.3]
    |
    v
popover shown (display: block → CSS fade-in via opacity transition)

User leaves span
    |
    v
mouseleave on span → starts _hoverDismissTimer (60 ms grace period) [FR-6.1/EC-08]
    |
    +--> mouseenter on popover → cancel dismiss timer [EC-08]
    +--> mouseleave on popover → restart 60 ms dismiss timer
    +--> click anywhere → immediate dismissWikiPopover()
```

### 4.2 Module-Level State Added (Step 10)

Six new module-level variables placed after the existing Step 9 flags block:

| Variable | Type | Purpose |
|----------|------|---------|
| `_wikiLinkHoverHandler` | `((e: MouseEvent) => void) \| null` | document mouseover listener reference for cleanup |
| `_wikiLinkHoverLeaveHandler` | `((e: MouseEvent) => void) \| null` | document mouseleave/click listener reference for cleanup |
| `_hoverShowTimer` | `ReturnType<typeof setTimeout> \| null` | 180 ms show-delay timer |
| `_hoverDismissTimer` | `ReturnType<typeof setTimeout> \| null` | 60 ms grace-period dismiss timer |
| `_hoverFetchVersion` | `number` | monotonically incrementing counter for race safety |
| `_activePopoverEl` | `HTMLElement \| null` | current popover DOM element (null when hidden) |

### 4.3 New Functions Added (Step 10)

All functions are named exports for testability:

| Function | Pure? | Purpose |
|----------|-------|---------|
| `extractPopoverContent(raw, resolvedPath)` | Yes | Slice to 2048 bytes, extract title/excerpt/pathLabel |
| `positionPopover(spanEl, popoverEl)` | No (reads DOM) | Apply position:fixed coordinates to popover |
| `injectWikiPopoverStyles()` | No (DOM) | Inject `<style data-markable-wiki-popover-styles>` |
| `removeWikiPopoverStyles()` | No (DOM) | Remove the style tag |
| `showWikiPopover(spanEl, target)` | No (async) | Orchestrate fetch → extract → position → show |
| `dismissWikiPopover()` | No (DOM) | Remove popover, cancel timers, increment version |

### 4.4 Modified Functions

| Function | Change | Reason |
|----------|--------|--------|
| `buildWikiLinkDecorations` (line ~559–604) | Add `attributes: { "data-wiki-target": match.target }` to the `Decoration.mark` call | Hover handler needs to read the target from the DOM without reverse-parsing text content (FR-7.3) |
| `onEnable` | Call `injectWikiPopoverStyles()`, attach `_wikiLinkHoverHandler` and `_wikiLinkHoverLeaveHandler` | FR-8.1 |
| `onDisable` | Call `removeWikiPopoverStyles()`, remove listeners, call `dismissWikiPopover()` | FR-8.2 |

---

## 5. Component Map

### Files Modified

- `src/plugins/backlinks/backlinks.plugin.ts` — primary implementation

### Files Created

- `tests/plugins/backlinks/hover-popover.test.ts` — new test file (sibling to `backlinks.test.ts`)

### Files Not Modified

- `src/styles.css` — no changes; all popover CSS is injected at runtime via `<style>` tag
- `src/lib/bridge.ts` — no changes; `invokeReadFile` already exists in the plugin
- Any Rust file — no new Tauri commands
- `src/editor/live-preview.ts` — no changes
- `src/editor/extensions.ts` — no changes

---

## 6. Implementation Phases

| Step | File | Description |
|------|------|-------------|
| `step_01_data_attribute.md` | `backlinks.plugin.ts` | Add `data-wiki-target` attribute to `Decoration.mark` in `buildWikiLinkDecorations` |
| `step_02_popover_dom_css.md` | `backlinks.plugin.ts` | Create popover DOM element + inject/remove CSS functions |
| `step_03_hover_logic.md` | `backlinks.plugin.ts` | Module-level state, `extractPopoverContent`, `positionPopover`, `showWikiPopover`, `dismissWikiPopover` |
| `step_04_lifecycle.md` | `backlinks.plugin.ts` | Wire up in `onEnable` / `onDisable` |
| `step_05_tests.md` | `hover-popover.test.ts` | Full test plan for all 19 edge cases |

Each step is independently implementable. Steps must be done in order (step_01
is a prerequisite for step_05 decoration assertions; step_02 and step_03 are
prerequisites for step_04 wiring).

---

## 7. Key Invariants

- The popover is created fresh on each `showWikiPopover` call; only one exists at a time (FR-4.4).
- `dismissWikiPopover` is always safe to call multiple times (idempotent).
- `_hoverFetchVersion` is incremented in two places: before each fetch in `showWikiPopover`, and inside `dismissWikiPopover`. This ensures a dismissed popover's pending fetch always discards on arrival.
- The `data-wiki-target` attribute is set on the inner mark span, not on the outer `cm-line` div. The hover handler must use `closest("[data-wiki-target]")` or check `event.target` directly.
- All new code is inside the guard `if (!_enabled) return` where it runs in async callbacks, matching the existing pattern.
- No existing exported functions are renamed or have their signatures changed. Only `buildWikiLinkDecorations` (internal shape of what it passes to `Decoration.mark`) and `onEnable`/`onDisable` are modified.

---

## 8. Implementation Checklist

- [x] step_01: `data-wiki-target` attribute on `Decoration.mark` (FR-7)
- [x] step_02: Popover DOM element created/removed + CSS injected/removed (FR-4, FR-9)
- [x] step_03: `extractPopoverContent`, `positionPopover`, `showWikiPopover`, `dismissWikiPopover`, module-level state (FR-2, FR-3, FR-5, FR-6)
- [x] step_04: `onEnable` and `onDisable` wiring (FR-8)
- [x] step_05: All tests pass (FR-10.6)

Acceptance: all existing backlinks tests continue to pass; new hover-popover
tests cover every item in Section 7 of `active_task.md`.

---

## Review Request

- **Files changed**:
  - `src/plugins/backlinks/backlinks.plugin.ts` — all Step 10 implementation plus code-reviewer fixes (HIGH-1, HIGH-2, HIGH-3, LOW-1, LOW-2, LOW-3)
  - `tests/plugins/backlinks/hover-popover.test.ts` — 31 tests (28 original + EC-08 grace-period + EC-04 race-discard)
  - `tests/plugins/backlinks/backlinks.test.ts` — updated 5 existing `toEqual` assertions to include the new `target` field on `"mark"` ranges

- **Steps completed**: step_01, step_02, step_03, step_04, step_05 (in order) + code-reviewer pass (CRITICAL-1, CRITICAL-2, HIGH-1, HIGH-2, HIGH-3, LOW-1, LOW-2, LOW-3)

- **Known limitations**: none. All acceptance criteria are met.

- **Reviewer fixes applied**:
  - HIGH-1: `buildHoverHandler()` and `buildDismissHandler()` extracted as named module-level exported builder functions; `onEnable` calls both builders.
  - HIGH-2: `createPopoverElement(title, pathLabel, excerpt)` extracted from `showWikiPopover` inline DOM block; exported.
  - HIGH-3: `stripFencedCodeBlocks(text)` and `stripMarkdownSyntax(text)` extracted from `extractPopoverContent` inline steps 5-6; both exported.
  - LOW-1: Comment added in `onDisable` explaining why `_hoverFetchVersion` is not reset.
  - LOW-2: Popover show sequence changed to imperative inline style assignments (WebKit fix); `wl-popover-visible` class rules removed from CSS.
  - LOW-3: "pure function" replaced with "deterministic function" in `extractPopoverContent` JSDoc.
  - CRITICAL-1: `_testing.setActivePopoverEl(el)` accessor added; EC-08a and EC-08b tests added.
  - CRITICAL-2: EC-04 fetch-race discard test added with deferred promise sequencing.

- **Edge cases covered by tests**:

  | Edge Case | Test |
  |-----------|------|
  | EC-01: file not found (ok: false) | "EC-01: shows nothing when invokeReadFile returns ok: false" |
  | EC-03: content byte-cap at 2048 | "caps content at 2048 characters before processing" |
  | EC-04: fetch-race discard (stale result dropped) | "EC-04: second overlapping fetch wins; first fetch result is discarded" (CRITICAL-2) |
  | EC-07: null __MARKABLE_CURRENT_FILE__ | "EC-07: shows nothing when __MARKABLE_CURRENT_FILE__ is null" |
  | EC-08a: mouseover on popover cancels dismiss timer | "EC-08a: mouseover on popover cancels dismiss timer and keeps popover alive" (CRITICAL-1) |
  | EC-08b: mouseleave on popover fires dismiss timer | "EC-08b: mouseleave on the popover starts the 60 ms dismiss timer which fires" (CRITICAL-1) |
  | EC-09: piped link target is before pipe | "mark range for [[target|display]] has target === 'target'" |
  | EC-11: multi-pipe target is first segment | "mark range for [[a|b|c]] has target === 'a' (EC-11)" |
  | EC-12: empty target string | "EC-12: empty target string does not crash" |
  | EC-18: front-matter-only file (empty excerpt) | "returns empty excerpt for front-matter-only file (EC-18)" |
