---
title: "Wiki-link hover preview popover"
last-updated: "2026-04-28"
review-cadence-days: 7
status: active
---

# Wiki-link Hover Preview Popover

## 1. Feature Summary

As a user I want to hover the mouse over any `[[wikilink]]` span in the editor and see a
small floating popover showing the linked document's title and a plain-text excerpt of its
content, so I can read the destination note without leaving the current document — the same
hover-preview behaviour present in Obsidian and Notion.

---

## 2. Where the Code Lives

**The hover popover is implemented inside the existing backlinks plugin
(`src/plugins/backlinks/backlinks.plugin.ts`), not as a separate plugin.**

Justification:

- The backlinks plugin already owns every piece of infrastructure this feature needs:
  the `cm-wiki-link` DOM class it applies to decorated spans, the `resolveWikiLinkPath`
  and `normalizeTarget` path-resolution helpers, the `invokeReadFile` Tauri bridge
  wrapper, and the `_enabled` guard used to make async callbacks no-ops after disable.
- A separate IIFE plugin would have to duplicate `resolveWikiLinkPath`,
  `normalizeTarget`, and `invokeReadFile` because IIFE plugins cannot import from one
  another at runtime.
- Splitting ownership of `cm-wiki-link` spans between two plugins would create a
  temporal coupling: the popover plugin would silently do nothing if the backlinks plugin
  were disabled (its spans would disappear), making its enable/disable semantics
  misleading.
- Adding the feature inside the existing plugin keeps all `cm-wiki-link` behaviour in one
  file and one `onEnable`/`onDisable` cycle, matching the established pattern for the
  click handler (`_wikiLinkClickHandler`).

The popover logic is added as a discrete, named group of functions and module-level
variables within the existing file, following the step-numbered section convention
already used (Step 10: Hover Popover).

---

## 3. Functional Requirements

### FR-1: Show delay

FR-1.1 — After the cursor enters a `.cm-wiki-link` span (`mouseenter` event), the system
waits a fixed delay of 180 ms before beginning the file fetch and showing the popover. This
prevents flicker on brief/accidental cursor passes.

FR-1.2 — If the cursor leaves the span (or the popover) before the 180 ms elapses, the
pending timer is cancelled and no fetch is issued.

### FR-2: File fetch

FR-2.1 — When the delay elapses, the system reads `window.__MARKABLE_CURRENT_FILE__` to
obtain the base path for resolution. If the value is null (untitled document, EC-07), the
popover is not shown and no fetch is issued.

FR-2.2 — The system calls `resolveWikiLinkPath(currentFile, target)` using the same
function already used by the click handler. The `target` is extracted from the hovered
element: the `data-wiki-target` attribute set on the span during decoration (see FR-7).

FR-2.3 — The file content is read via `window.__TAURI_INTERNALS__.invoke("read_file", {
path })`, following the `invokeReadFile` pattern already in the plugin. This is the
only Tauri call the feature makes.

FR-2.4 — At most one file fetch is in flight at any given moment (EC-04). If a second
hover fires while a fetch is already pending (not yet settled), the pending fetch's result
is discarded on arrival (the `_hoverPopoverFetchVersion` counter pattern: increment
before each fetch; on arrival check that the counter still matches).

FR-2.5 — File content is capped at the first 2 048 bytes before any processing (EC-03).
This cap is applied by slicing the raw UTF-8 string before the content extraction step,
not after, so large files never allocate large working strings.

### FR-3: Content extraction

FR-3.1 — **Title**: extracted by the following priority chain, stopping at the first match:
  1. YAML front matter `title:` field — scan the leading `---` block (if any) for a line
     matching `/^title:\s*["']?(.+?)["']?\s*$/`.
  2. First `# H1` heading — first line matching `/^#\s+(.+)/`.
  3. Filename stem — the path component after the last `/`, with the `.md` extension
     removed.

FR-3.2 — **Excerpt**: the first ~200 words of the document body after stripping:
  - YAML front matter block (everything between the opening `---` and the closing `---`
    or `...`).
  - Markdown syntax characters: heading `#` markers, bold/italic markers (`*`, `_`,
    `**`, `__`), link syntax `[text](url)`, image syntax `![alt](url)`, inline code
    backticks, horizontal rules.
  - Fenced code block contents (everything between triple-backtick or triple-tilde fences,
    inclusive of the fence lines themselves).
  - Blank lines collapsed to a single space.
  
  The word count is approximate (split on whitespace); truncation adds an ellipsis `…`
  if the excerpt was cut short.

FR-3.3 — **File path label**: the vault-relative path if a vault is active (obtained from
`window.__MARKABLE_VAULT_MANAGER__?.getActiveVault()?.rootPaths?.[0]`; strip that prefix
from the resolved path), otherwise the basename only.

### FR-4: Popover DOM

FR-4.1 — The popover is a single `<div>` element appended to `document.body` (not to the
`.cm-editor` scroll container, to avoid clipping by `overflow: hidden`).

FR-4.2 — The popover contains three child elements in order:
  - `.wl-popover-title` — the title text.
  - `.wl-popover-path` — the file path label.
  - `.wl-popover-excerpt` — the plain-text excerpt.

FR-4.3 — The popover element carries `data-markable-wiki-popover="true"` for idempotent
lookup and targeted CSS scoping.

FR-4.4 — Only one popover instance exists at a time. Before creating a new one, any
existing popover is removed from the DOM.

### FR-5: Positioning

FR-5.1 — The popover is positioned absolutely using `getBoundingClientRect()` on the
hovered `.cm-wiki-link` span. It appears below the span by default (top edge =
`spanRect.bottom + 8px`, left edge = `spanRect.left`).

FR-5.2 — If the computed left edge plus the popover's natural width (max-width 320 px)
would exceed `window.innerWidth - 16px`, the popover is right-aligned instead
(right edge = `window.innerWidth - spanRect.right` equivalent, clamped to `16px`
from the viewport edge).

FR-5.3 — If the computed bottom edge (top + natural height) would exceed
`window.innerHeight - 16px`, the popover flips to appear above the span instead
(bottom edge = `spanRect.top - 8px`).

FR-5.4 — Positioning is applied with `position: fixed` (not `absolute`) so the popover
stays anchored to the viewport regardless of document scroll.

### FR-6: Dismissal

FR-6.1 — The popover is dismissed (removed from DOM, pending timer cancelled, pending
fetch version incremented) when:
  - `mouseleave` fires on the hovered `.cm-wiki-link` span AND the cursor did not move
    into the popover itself (EC-08). A 60 ms grace-period timer is used: if the cursor
    enters the popover within 60 ms, the dismissal is cancelled.
  - `mouseleave` fires on the popover element itself AND the cursor did not move back into
    the originating span.
  - A `click` event fires anywhere in the document (the user is navigating away).
  - `onDisable` is called (plugin teardown).

FR-6.2 — The popover must NOT be dismissed when the cursor moves from the span directly
into the popover (EC-08). The grace-period timer in FR-6.1 handles this.

### FR-7: Decoration data attribute

FR-7.1 — The existing `buildWikiLinkDecorations` function currently marks spans with
`class: "cm-live-link cm-wiki-link"`. This must be augmented to also set
`data-wiki-target` to the raw (un-normalized) target string, so the hover handler can
read the target without reverse-parsing the span's text content.

FR-7.2 — For piped links `[[target|display]]`, `data-wiki-target` contains `target` (the
part before the pipe), not the display text (EC-11).

FR-7.3 — The `Decoration.mark` call in `buildWikiLinkDecorations` must include the
`attributes: { "data-wiki-target": match.target }` option. This is backward-compatible:
no existing code reads `data-wiki-target`.

### FR-8: Event listener lifecycle

FR-8.1 — `onEnable` attaches a single `mouseover` listener to `document` (capture phase,
`true`) to handle hover events on all current and future `.cm-wiki-link` spans without
needing to re-attach per span. A stored reference (`_wikiLinkHoverHandler`) is used for
cleanup.

FR-8.2 — `onDisable` removes the `mouseover` listener, cancels any pending show timer,
removes the popover from the DOM, and nulls all stored references. This follows the exact
pattern of `_wikiLinkClickHandler` already in `onDisable`.

### FR-9: CSS styling

FR-9.1 — Popover styles are injected via an additional `<style>` tag identified by
`data-markable-wiki-popover-styles="true"`. The tag is created by
`injectWikiPopoverStyles()` and removed by `removeWikiPopoverStyles()`, both called from
`onEnable`/`onDisable`.

FR-9.2 — Popover appearance uses existing CSS variables only:

| CSS variable       | Used for                         |
|--------------------|----------------------------------|
| `--bg-primary`     | popover background                |
| `--border-color`   | 1px solid border                 |
| `--text-primary`   | title text colour                 |
| `--text-secondary` | excerpt and path label colour     |
| `--ui-font`        | all text in the popover           |
| `--link-color`     | title text colour (accent)        |

FR-9.3 — Fixed popover dimensions: max-width 320 px, max-height 240 px, overflow hidden.
Font size 13 px for title, 11 px for path label, 12 px for excerpt. Padding 12 px.
Box-shadow `0 4px 16px rgba(0,0,0,0.18)` (provides depth on both light and dark themes).
Border-radius 6 px. `z-index: 10000` (above all other UI including sidebar and settings).

FR-9.4 — A CSS fade-in transition of 100 ms is applied using `opacity` from 0 to 1 and a
`translate(0, 4px)` to `translate(0, 0)` transform. No JS animation frame is needed.

### FR-10: Non-functional requirements

FR-10.1 — No flicker: the 180 ms show delay (FR-1.1) and 60 ms grace-period (FR-6.1)
together prevent the popover from flashing on rapid cursor movements over multiple links.

FR-10.2 — At most one `read_file` Tauri call is in flight at any moment (FR-2.4).

FR-10.3 — The popover does not appear during keyboard editing. The hover popover is
mouse-only. When the cursor moves to a link line in the editor, the raw syntax is shown
(existing behavior) and no popover fires because no `mouseover` event fires on a DOM span
during cursor-key navigation (EC-10).

FR-10.4 — z-index must be 10000 or higher, above the autocomplete dropdown (which is
typically in the 1000–9999 range).

FR-10.5 — The popover must not be selectable (`user-select: none`) to avoid accidentally
selecting its text when the user means to click a link or continue editing.

FR-10.6 — The feature must not regress any existing backlinks tests. All new logic is
additive; no existing functions are modified except `buildWikiLinkDecorations` (FR-7.3)
and `onEnable`/`onDisable` (FR-8).

---

## 4. Edge Case Inventory

**EC-01: Target file does not exist on disk.**
`invokeReadFile` returns `{ ok: false, ... }`. The popover is not shown. No alert is
displayed. A `console.debug` log is emitted. The fetch version counter is reset so the
next hover can proceed normally.

**EC-02: Target file is in a subdirectory (vault context).**
`resolveWikiLinkPath` resolves from the current file's directory. For a link like
`[[subfolder/note]]`, `normalizeTarget` will produce `subfolder/note.md` and the
resolved path will be `<currentDir>/subfolder/note.md`. This is correct for vault
subdirectory navigation. No special-casing is needed; the existing helpers handle it.

**EC-03: Target file is very large.**
Content is sliced to the first 2 048 bytes before any other processing (FR-2.5). This
bounds memory and processing time regardless of file size.

**EC-04: Multiple rapid hovers (debounce / version counter).**
Each new hover increments the `_hoverFetchVersion` counter. On fetch completion, if the
local version captured at fetch-start no longer matches the module-level counter, the
result is silently discarded. No stale popover appears.

**EC-05: Backlinks plugin is disabled.**
The `mouseover` listener is not attached when the plugin is disabled. No popover can
appear. The `cm-wiki-link` spans are also absent (plugin removed its decorations), so
even if a stale listener somehow fired, the event target would never match
`.cm-wiki-link`.

**EC-06: Wiki-link target is a self-link (link to the currently open file).**
`invokeReadFile` succeeds; the popover shows the current file's own content. This is
correct and expected behavior (the user may want to preview a section of the current
document via a self-reference).

**EC-07: Untitled document (no current file path).**
`window.__MARKABLE_CURRENT_FILE__` is null. After the 180 ms delay fires, the handler
checks this value, finds null, cancels quietly, and shows nothing. No error is thrown.

**EC-08: Cursor moves from the span directly into the popover.**
A 60 ms grace-period timer is used (FR-6.1). If `mouseleave` fires on the span and
then `mouseenter` fires on the popover within 60 ms, the dismissal timer is cancelled
and the popover remains visible. The cursor is then tracked on the popover itself for
dismissal.

**EC-09: Wiki-link with pipe syntax `[[target|display]]`.**
`data-wiki-target` is set to `target` (FR-7.2). The popover fetches and shows the
content of `target`, not `display`. The popover title is derived from `target`'s file
content via FR-3.1, not from the display text in the wikilink.

**EC-10: Keyboard navigation (cursor moves to a link line).**
No `mouseover` event fires during keyboard cursor movement. The popover is never shown.
This is a non-issue by design; the feature is mouse-only.

**EC-11: Wiki-link with pipe and multiple `|` characters `[[target|text|more]]`.**
`data-wiki-target` is set to `target` only (the part before the first pipe), consistent
with `parseWikiLinks` behavior. The popover resolves and shows `target`.

**EC-12: Empty wiki-link `[[]]`.**
`data-wiki-target` would be an empty string. In `resolveWikiLinkPath("", ...)`,
`normalizeTarget("")` produces `.md`. The resulting path is invalid. `invokeReadFile`
returns `{ ok: false }` and the popover is silently suppressed. No crash.

**EC-13: Popover is visible when user opens settings or a modal.**
The popover has `z-index: 10000`. If a modal opens on top, the modal should have a higher
z-index. The settings panel must be confirmed to use a z-index higher than 10000 (or the
popover must be explicitly dismissed on any `click` event, which FR-6.1 already specifies).
This is a cross-cutting concern; the architect must verify the settings panel z-index.

**EC-14: Vault is active and file is in a different vault subdirectory.**
`resolveWikiLinkPath` resolves relative to the current file's directory, not the vault
root. For a vault-wide link like `[[notes/project]]`, if the current file is in
`vault/docs/current.md`, the resolved path is `vault/docs/notes/project.md`, which may
not exist. This is a known limitation of the directory-relative resolution strategy
inherited from the click handler. The popover falls back gracefully: `invokeReadFile`
returns `{ ok: false }` and nothing is shown (EC-01). Vault-wide fuzzy resolution is
out of scope (see Section 5).

**EC-15: Two `.cm-wiki-link` spans are very close together (rapid hover transitions).**
The version counter (EC-04) ensures only the most recently hovered link's fetch result
is used. The old popover is removed before the new one is shown (FR-4.4).

**EC-16: `window.__TAURI_INTERNALS__` is absent (unit test environment).**
The `invokeReadFile` function already guards against this with a try/catch and returns
`{ ok: false }`. No popover is shown. Tests that exercise popover DOM logic must mock the
global.

**EC-17: The `.cm-wiki-link` span scrolls out of view while the popover is visible.**
The popover is positioned `fixed` (FR-5.4), so it does not move with document scroll.
When the user scrolls the span away, the popover remains at its original screen position
until a `mouseleave` on the span (which fires before scroll in most cases) or a `click`
dismisses it. If scroll happens without a `mouseleave` (e.g., trackpad inertia scroll
after moving the cursor away), the popover is dismissed by the `click` guard or by the
next hover elsewhere. This is acceptable behavior; scroll-based dismissal is out of scope.

**EC-18: File content is entirely YAML front matter with no body.**
FR-3.1 extracts the title from front matter. FR-3.2 excerpt extraction finds no body
content. The excerpt is shown as empty or as a single line after front matter removal.
The popover still appears with the title and path label; the excerpt section is omitted
if it would be empty.

**EC-19: File is a binary file accidentally named `.md`.**
`invokeReadFile` will either fail (Rust `read_file` may reject non-UTF-8) or return
garbled text. If it fails, the popover is suppressed (EC-01). If it succeeds with garbled
content, the content extraction strips most characters via the markdown-stripping pass,
likely leaving the excerpt empty or near-empty. The popover shows the filename stem as
title and an empty excerpt. This is acceptable.

---

## 5. Out of Scope

- **Vault-wide fuzzy link resolution**: resolving `[[note]]` to any `.md` file anywhere in
  the vault by filename stem match. The current feature uses the same directory-relative
  resolution as the click handler.
- **Click to navigate from the popover**: the popover is read-only. Clicking within it
  dismisses it via the click-anywhere rule (FR-6.1). Navigation is done by clicking the
  decorated span itself, as before.
- **Markdown rendering inside the popover**: the excerpt is plain text only. No HTML
  rendering via `marked`.
- **Images or embedded media in the popover**: not shown.
- **Scroll-based dismissal**: scroll events do not dismiss the popover.
- **Touch / pointer events**: hover is mouse-only. Touch devices are out of scope for
  Markable (macOS native app).
- **Keyboard shortcut to trigger the popover**: hover-only trigger.
- **Popover for standard Markdown links `[text](url.md)`**: only `cm-wiki-link` spans are
  targeted. Standard links are not in scope.
- **Moving the feature to a separate plugin**: explicitly rejected (see Section 2).
- **Persisting popover on click**: the click rule dismisses the popover. Pin-to-stay is
  out of scope.

---

## 6. Affected Code Locations

| Location | Nature of change |
|---|---|
| `src/plugins/backlinks/backlinks.plugin.ts` | Primary implementation file. All new code lives here. |
| `buildWikiLinkDecorations` (existing function) | Add `attributes: { "data-wiki-target": match.target }` to `Decoration.mark` call (FR-7.3). This is the only change to an existing function. |
| `onEnable` | Attach `mouseover` listener; call `injectWikiPopoverStyles()`. |
| `onDisable` | Remove listener; dismiss popover; call `removeWikiPopoverStyles()`. |
| New functions to add | `injectWikiPopoverStyles`, `removeWikiPopoverStyles`, `extractPopoverContent`, `positionPopover`, `showWikiPopover`, `dismissWikiPopover`. |
| New module-level state | `_wikiLinkHoverHandler`, `_wikiLinkHoverLeaveHandler`, `_hoverShowTimer`, `_hoverDismissTimer`, `_hoverFetchVersion`, `_activePopoverEl`. |

No changes to `live-preview.ts`, `bridge.ts`, `styles.css`, or any Rust command.

---

## 7. Test Surface

The following test cases must be added to
`tests/plugins/backlinks/backlinks.test.ts` (or a new sibling file
`tests/plugins/backlinks/hover-popover.test.ts`):

- `extractPopoverContent` with: normal file, front-matter-only file, H1-heading file,
  no-title file (uses stem), file longer than 2 048 bytes (truncated), empty file.
- `positionPopover` with: span near right edge (right-aligns), span near bottom edge
  (flips above), span in middle (default position).
- `buildWikiLinkDecorations` — verify that `data-wiki-target` attribute is present on
  produced mark decorations (requires updating the existing decoration tests).
- Fetch-version counter: two overlapping hover events — first result is discarded.
- Dismissal grace period: mouseleave from span + immediate mouseenter on popover cancels
  dismissal.
- EC-01: file not found — popover not shown, no error thrown.
- EC-07: null `__MARKABLE_CURRENT_FILE__` — popover not shown.
- EC-12: empty target string — popover not shown.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 19 items in Edge Case Inventory (EC-01 through EC-19)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
