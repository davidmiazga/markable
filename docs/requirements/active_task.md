---
title: "Command Bar"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Command Bar (FC2 #11) Requirements Spec

## Summary

As a user, I want to open a floating palette with Cmd-Shift-P that lets me fuzzy-search commands, heading jumps, and recent files — then execute the selected result — so that I can navigate and trigger actions without lifting my hands from the keyboard.

---

## Background and Motivation

FEATURES.md item 11 is labeled "Command Bar." This is a floating command palette overlaid on the editor window. It mirrors the pattern established by VS Code, Obsidian, and similar tools: a single modal input that provides access to multiple categories of results through one unified search surface.

### What Already Exists

The following infrastructure is available and must be used by this feature:

- **`COMMANDS` list in `src/keybindings/keybindings-panel.ts`** — an authoritative array of `CommandDef` objects (id, label, defaultKey, section). The Command Bar sources its command results from this same list. Commands are executed via the existing `handleAction()` / `resolveAction()` pattern in `main.ts`.
- **`resolveAction()` / `eventMatchesKey()`** — The keybinding resolution layer used by the document keydown handler. The Command Bar must register `"command-bar-open"` as a standard command in the `COMMANDS` array so its binding (default: Cmd-Shift-P) can be remapped in the Keybindings panel.
- **Plugin system** — The Command Bar is implemented as a core plugin, consistent with focus-mode, word-count, and all other FC2 features.
- **Plugin settings API** — `api.loadSettings()` / `api.saveSettings()` for persisting category-visibility preferences.
- **Sidebar panel system** — Not used by the Command Bar (it is a modal overlay, not a sidebar panel).
- **`window.__MARKABLE_TAB_MANAGER__`** — Provides access to recent files for category C results.
- **`window.__MARKABLE_CURRENT_FILE__`** — Used for heading scan: the scanner reads the current document's content.
- **`window.__CM_VIEW__`** / `window.__CM_STATE__`** — Used for heading jump (scroll + cursor placement) and for scanning headings from the live CM6 document state.

---

## Functional Requirements

### FR-01: Activation and Deactivation

**FR-01.1** The Command Bar opens via Cmd-Shift-P (default). This binding must be registered in the `COMMANDS` array in `keybindings-panel.ts` as a first-class remappable command (id: `"command-bar-open"`).

**FR-01.2** The Command Bar closes on any of the following:
- Pressing Escape.
- Clicking outside the palette overlay.
- Activating any result (after execution).
- The active tab closing while the bar is open (the bar must close defensively).

**FR-01.3** On open, the input field receives keyboard focus immediately.

**FR-01.4** The bar always opens with an empty input field. No query is persisted between opens.

**FR-01.5** On open, the result list is populated with the full unfiltered result set from all enabled categories (see FR-03 for category definitions). The full set is shown before the user has typed anything.

**FR-01.6** Cmd-Shift-P while the bar is already open closes the bar (toggle behavior). This prevents a second open from stacking an overlay on top.

### FR-02: Fuzzy Matching

**FR-02.1** Matching is substring-based fuzzy search: a result is shown if every character of the query string appears in the result label in order (not necessarily consecutively). Example: query `"fmd"` matches `"Focus Mode"` (f...m...d via "Fo**c**us **M**o**d**e" — no, this specific example depends on the algorithm; the Architect chooses the algorithm, but it must be character-order subsequence matching, not a word-prefix filter).

**FR-02.2** Matching is case-insensitive.

**FR-02.3** Results are ranked. The ranking algorithm must prioritize, in descending order:
1. Exact prefix match on the label (e.g., query `"fo"` ranks `"Focus Mode"` above `"Toggle Focus"`).
2. Word-boundary match (query starts a word in the label).
3. Substring match (query appears consecutively anywhere in the label).
4. Non-consecutive subsequence match.

Within the same ranking tier, results are sorted alphabetically by label.

**FR-02.4** The matched characters within each result label are highlighted (e.g., wrapped in `<mark>` or a `cm-match` span) to show the user which characters caused the match. The rendering must handle overlapping annotations gracefully (the Architect chooses the highlight strategy).

**FR-02.5** When the query is empty, all results from all enabled categories are shown, unfiltered, in category order (A then B then C). No ranking is applied to an empty query — results appear in their natural order within each category.

**FR-02.6** There is no minimum query length. A single character triggers filtering.

### FR-03: Result Categories

Three categories of results are shown in the Command Bar. Each category is independently toggleable via plugin settings (see FR-07). Categories always appear in the order A → B → C, with a visible section header separating each group.

**FR-03.A: Commands (Category A)**

**FR-03.A.1** Category A provides one result per entry in the `COMMANDS` array in `keybindings-panel.ts`. Each result displays:
- The command label (e.g., `"Focus Mode Enabled"` or `"Focus Mode"`). See FR-04 for the two-result pattern for plugin toggles.
- The currently assigned keybinding (custom binding if set, otherwise default). Displayed right-aligned in the result row, styled as a keyboard shortcut badge.
- No keybinding badge is shown if the command has no default key and no custom binding (e.g., `view-toggle-statusbar` which has `defaultKey: ""`).

**FR-03.A.2** The command list is rebuilt on every open. This ensures that current plugin states are reflected (e.g., if Focus Mode was just enabled, its label changes from "Focus Mode" to "Focus Mode Enabled").

**FR-03.A.3** The section header reads "Commands."

**FR-03.B: Heading Jumps (Category B)**

**FR-03.B.1** Category B scans the current open document for ATX headings (lines beginning with one to six `#` characters followed by a space and heading text). Each heading produces one result.

**FR-03.B.2** Results display:
- The heading text (stripped of leading `#` characters and the space).
- A visual indicator of heading level (e.g., an H1/H2/H3... badge, or indentation proportional to level).
- No keybinding badge.

**FR-03.B.3** Results are shown in document order (top to bottom), not sorted alphabetically. The fuzzy filter applies to the heading text.

**FR-03.B.4** Activating a heading result moves the CM6 cursor to the first character of that heading line AND scrolls it into view. The bar closes after activation (FR-01.2).

**FR-03.B.5** The heading scan reads from the live CM6 document state (`window.__CM_STATE__`) to ensure it reflects unsaved edits. It is NOT a file-system scan.

**FR-03.B.6** If the current document has no headings, category B shows no results and no section header is rendered for that category (the section collapses entirely).

**FR-03.B.7** The section header reads "Headings."

**FR-03.C: Recent Files (Category C)**

**FR-03.C.1** Category C lists recently opened files sourced from `window.__MARKABLE_TAB_MANAGER__`'s recent-files list (same source as the "Open Recent" native submenu). Each file produces one result.

**FR-03.C.2** Results display:
- The filename (basename only, e.g., `"my-note.md"`).
- The abbreviated directory path (e.g., `"~/Documents/Notes/"`), displayed as secondary text below or beside the filename.
- No keybinding badge.

**FR-03.C.3** Results are shown in recency order (most recently accessed first).

**FR-03.C.4** Activating a recent-file result opens that file in a new tab (using the same mechanism as "Open Recent" in the File menu). The bar closes after activation.

**FR-03.C.5** If no recent files exist, category C shows no results and its section header collapses.

**FR-03.C.6** The section header reads "Recent Files."

### FR-04: Plugin Toggle Dual-Result Pattern

**FR-04.1** For each plugin that is currently registered and available, the Command Bar generates TWO command entries in Category A:

- **Action result**: Label reads `"[Plugin Name] Enabled"` when the plugin is currently disabled (activating it will enable it), or `"[Plugin Name] Disabled"` when the plugin is currently enabled (activating it will disable it). This result executes the enable/disable toggle action.
- **Navigate result**: Label reads `"[Plugin Name]"` (the plugin name alone, no qualifier). Activating this result opens the Plugins Panel and scrolls/focuses the plugin's detail entry. It does not toggle the plugin state.

**FR-04.2** The two results are adjacent in the result list (the action result appears first, the navigate result second).

**FR-04.3** The "navigate" result is always available, even when no file is open (it navigates to the Plugins Panel, which is UI — not file-dependent). The "action" result follows the context-invalid rule in FR-05 if toggling requires an active editor context, but for most plugins it does not (plugin enable/disable does not require a file to be open).

**FR-04.4** This pattern applies to plugins in the `COMMANDS` array that correspond to plugin toggles (e.g., `view-toggle-focus`, `view-toggle-typewriter`). The Architect must enumerate the complete set of eligible plugins and define the label mapping.

### FR-05: Context-Invalid Actions

**FR-05.1** Some commands are only meaningful when a file is open (e.g., `"Save"`, heading jumps). When no file is open (all tabs are untitled or no tabs exist), such commands are shown in the result list but rendered as dimmed/disabled. They cannot be activated while dimmed.

**FR-05.2** Dimmed results are skipped when navigating with arrow keys (they are not selectable via keyboard).

**FR-05.3** The set of context-invalid commands (when no file is open) includes at minimum:
- All format commands (bold, italic, etc.).
- File-related commands that require a file path: Save, Save As, Export.
- All Category B results (heading jumps require an open document).

**FR-05.4** Commands that are always valid regardless of file context include: New, Open, Open Recent, Close All, and all plugin navigate-results (FR-04.1).

### FR-06: Keyboard Navigation and Execution

**FR-06.1** Arrow keys (Up / Down) navigate through the visible, non-dimmed results. Navigation wraps: pressing Down on the last result moves to the first; pressing Up on the first result moves to the last.

**FR-06.2** Enter activates the currently selected result. The bar closes immediately after activation.

**FR-06.3** On open, the first non-dimmed result in the list is pre-selected.

**FR-06.4** Tab may optionally advance selection (the Architect decides). If implemented, Tab and Shift-Tab navigate forward/backward respectively.

**FR-06.5** Mouse hover highlights a result. Mouse click activates the result. The bar closes immediately.

**FR-06.6** There is no "multi-select" or "batch execute." One result is activated per open.

### FR-07: Settings

**FR-07.1** The plugin exposes three boolean settings controlling which result categories are shown:

| Setting Key | Default | Description |
|---|---|---|
| `showCommands` | `true` | Show Category A (Commands) in results |
| `showHeadings` | `true` | Show Category B (Heading jumps) in results |
| `showRecentFiles` | `true` | Show Category C (Recent files) in results |

**FR-07.2** Settings are loaded via `api.loadSettings()` in `onEnable` and saved via `api.saveSettings()` when changed via settings UI.

**FR-07.3** A disabled category is entirely absent from the result list (not dimmed — truly absent). If all three categories are disabled, the bar opens with an empty list and displays a "No results" placeholder.

**FR-07.4** Settings UI is provided in the plugin detail view (toggle checkboxes for each category).

### FR-08: Visual Design

**FR-08.1** The Command Bar is a floating modal overlay, centered horizontally and positioned in the upper third of the window vertically. It is not attached to any sidebar, toolbar, or status bar.

**FR-08.2** Maximum result list height is capped (e.g., 8–12 visible rows). When results exceed the cap, the list scrolls. The Architect chooses the exact cap value.

**FR-08.3** The overlay has a backdrop (semi-transparent dark scrim) covering the editor area. Clicking the backdrop closes the bar.

**FR-08.4** The input field is styled consistently with the app's existing UI variables (`--ui-font`, `--accent-color`, etc.). No hardcoded font stacks.

**FR-08.5** Section headers (category labels) are visually distinct from result rows (e.g., smaller text, muted color, non-selectable).

**FR-08.6** The selected result row is highlighted with `--accent-color` or a theme-compatible highlight variable.

**FR-08.7** Keybinding badges in command results use `--key-font` (already defined in `:root`).

### FR-09: Plugin Lifecycle

**FR-09.1** The plugin file is: `src/plugins/command-bar/command-bar.plugin.ts`.

**FR-09.2** Plugin metadata:
- `id`: `"command-bar"`
- `name`: `"Command Bar"`
- `version`: `"1.0.0"`
- `description`: `"Fuzzy command palette for commands, headings, and recent files"`

**FR-09.3** `onEnable` sequence:
1. Inject plugin CSS as a `<style>` tag (idempotent, guarded by element id).
2. Build the overlay DOM and attach to `document.body` (hidden initially).
3. Register the `keydown` listener that responds to Cmd-Shift-P (or the user's remapped key).

**FR-09.4** `onDisable` sequence:
1. Remove the overlay DOM from `document.body`.
2. Remove the `keydown` listener.
3. Remove injected CSS `<style>` tag.

**FR-09.5** The `"command-bar-open"` entry must be added to the `COMMANDS` array in `src/keybindings/keybindings-panel.ts` as part of this feature. Default key: `"Cmd-Shift-P"`. Section: `"View"`.

**FR-09.6** The `handleAction()` dispatch in `main.ts` must handle `"command-bar-open"` by calling the plugin's open function (or a global the plugin registers at enable time).

---

## Non-Functional Requirements

**NFR-01: Open Latency** — From Cmd-Shift-P keydown to the overlay being visible and focused must be under 80ms. Command list rebuild (reading `COMMANDS` array + plugin states + heading scan + recent files) must complete synchronously within this budget for documents up to 500 headings.

**NFR-02: Fuzzy Filter Latency** — From last keystroke to updated result list render must be under 50ms for result sets up to 300 items. Debounce is not required (synchronous update is preferred for responsiveness at this scale).

**NFR-03: IIFE Self-Containment** — All IIFE plugin rules apply: no app-internal module imports at runtime, CM6 accessed via window globals only, CSS injected via `<style>` tag.

**NFR-04: Theme Compatibility** — All colors, fonts, and spacing use CSS variables from `:root`. No hardcoded hex values or font names.

**NFR-05: Accessibility Basics** — The overlay must:
- Trap focus while open (Tab/Shift-Tab must not escape to the editor or browser chrome).
- Return focus to the editor's CM6 view when closed.
- The input element carries `role="combobox"` and `aria-expanded`; the result list carries `role="listbox"`; each result row carries `role="option"` and `aria-selected`.
- The backdrop does not receive focus.

**NFR-06: No External Dependencies** — The fuzzy-match algorithm is implemented inline (no third-party fuzzy library). At this scale (< 300 items), a hand-written subsequence ranker is sufficient and avoids bundle bloat.

**NFR-07: Single Instance** — Only one Command Bar overlay may exist in the DOM at any time. Re-opening while already open toggles it closed (FR-01.6), not stacks a second instance.

---

## Architecture Decisions (Resolved)

**AD-01: Plugin vs. core feature** — The Command Bar is a core plugin (like focus-mode, templates). It is toggleable from the Plugins Panel. This is consistent with all FC2 features.

**AD-02: Keybinding registration** — `"command-bar-open"` is added to the `COMMANDS` array in `keybindings-panel.ts`. The document `keydown` handler in `main.ts` calls `resolveAction()`, which already checks the full `COMMANDS` array. The plugin hooks into this by handling `"command-bar-open"` in `handleAction()`. No separate event listener on `document` is needed beyond what already exists — however, since the plugin must add/remove its handler on enable/disable, it may register a supplementary keydown listener that checks the `command-bar-open` action id resolved from `resolveAction()`.

**AD-03: Command list source** — Category A reads directly from the exported `COMMANDS` array in `keybindings-panel.ts`. The Architect must ensure this array is exported (it currently is not exported — this is new work). Alternatively, the plugin can receive the command list via a global registered by the app at startup (`window.__MARKABLE_COMMANDS__`). The Architect chooses the cleanest approach.

**AD-04: Heading scan** — Reads from `window.__CM_STATE__` (the live CM6 document state) using a line-by-line scan for `# ` prefixes. The lezer AST is not required for this scan — a simple regex per line (`/^(#{1,6})\s+(.+)$/`) on `state.doc.iterLines()` is sufficient and simpler.

**AD-05: Recent files source** — Sourced from `window.__MARKABLE_TAB_MANAGER__`'s existing recent-files array (same array used by the "Open Recent" native submenu). The Architect must identify the exact accessor.

**AD-06: Category section collapse** — When a category produces zero results after filtering, its section header is hidden (not rendered). This is a render-time decision, not a settings-level decision.

**AD-07: Fuzzy algorithm** — Implement a character-order subsequence ranker inline. The ranking tiers defined in FR-02.3 are the specification. The Architect proposes the implementation; the Lead Developer follows it.

---

## Out of Scope

1. **Command preview pane** — A secondary panel showing a description or preview of the selected command. Deferred.
2. **Recent searches / search history** — Persisting the last N queries. The bar always opens empty (FR-01.4).
3. **Command aliases** — Alternate names or abbreviations for commands. Not supported in this iteration.
4. **Snippet insertion via Command Bar** — Templates are accessed via the File menu / Templates plugin. The Command Bar does not insert content snippets.
5. **Plugin installation from Command Bar** — The bar navigates to the Plugins Panel (FR-04.1 navigate result) but does not itself install or download plugins.
6. **File creation from Command Bar** — Typing a filename and pressing Enter to create a new file. This is a "new file" shortcut; use Cmd-N or the File menu instead.
7. **Cross-vault / multi-workspace search** — The bar operates on the current open window only.
8. **Inline calculator or URL launcher** — No "smart" result types beyond the three categories.
9. **Result count badge** — A total count of results is not required in the UI.
10. **Persistent window state** — The bar always opens fresh. No memory of scroll position in the result list.

---

## Edge Case Inventory

**EC-01: No file open, heading jump requested** — Category B results are shown dimmed when no file is open (FR-05.3). If the user somehow activates one (e.g., via a race condition), nothing happens — the handler must guard against a null `__CM_STATE__`.

**EC-02: No file open, format command selected** — Format commands are dimmed (FR-05.3) and cannot be activated via keyboard (FR-05.2). Mouse click on a dimmed result must be a no-op.

**EC-03: Document with no headings** — Category B produces zero results. Its section header is not rendered (AD-06). The bar opens showing only Categories A and C (if enabled).

**EC-04: Query matches zero results across all categories** — The result list is empty. A "No results" placeholder is shown in place of the list (no empty whitespace). The placeholder is not selectable.

**EC-05: Cmd-Shift-P pressed while bar is already open** — Bar closes. Focus returns to the CM6 editor. No second overlay is created.

**EC-06: Escape pressed while input is empty** — Bar closes. This must be consistent: Escape always closes, regardless of input content.

**EC-07: Very long command label** — A label that overflows the result row width. Expected: the row clips or truncates with an ellipsis. The row height does not expand. The full label is visible on hover via `title` attribute or tooltip.

**EC-08: Very long heading text** — Same treatment as EC-07.

**EC-09: Heading text contains Markdown syntax** — `## **Bold Heading**`. The scan produces the raw heading text including Markdown tokens. The result displays `**Bold Heading**` as plain text (no rendering of bold). This is acceptable.

**EC-10: Fuzzy match highlight on a label with special HTML characters** — A label containing `<`, `>`, or `&` (unlikely but possible in future command names). The highlight rendering must not inject raw HTML. Use `textContent` or escape the label before inserting match highlights.

**EC-11: Arrow key navigation skips all results (all dimmed)** — When no file is open and all Category A format commands are dimmed, and Categories B and C are empty or disabled, arrow key navigation has nothing to land on. The bar should handle gracefully: no selection, Enter does nothing.

**EC-12: Tab closes while bar is open** — The active tab closes (Cmd-W). The bar must close defensively and return focus cleanly. No stale reference to the now-closed tab's state.

**EC-13: Plugin toggled off while bar is open** — A race scenario: the user triggers plugin disable from another path (unlikely in practice, but the bar must not crash if the plugin list changes mid-session). On next open the list rebuilds fresh (FR-03.A.2).

**EC-14: Cmd-Shift-P is remapped** — The user remaps `"command-bar-open"` to a different key in the Keybindings panel. The new key must open the bar. The old key (Cmd-Shift-P) must not. The plugin's keydown handler must read the current resolved keybinding, not hard-code `"Cmd-Shift-P"`.

**EC-15: Cmd-Shift-P conflicts with another command** — The user remaps another command to Cmd-Shift-P, creating a conflict. The Keybindings panel's existing conflict detection system handles this (it already highlights conflicts). The Command Bar itself has no special behavior here — it follows the standard resolution order (`resolveAction`: custom bindings first, then defaults).

**EC-16: Recent files list is empty (first launch)** — Category C produces zero results. Its section header collapses (AD-06). The bar opens with only Categories A and B visible.

**EC-17: Recent file no longer exists on disk** — A file in the recent list has been deleted. The result is shown in the bar. Activating it triggers the same error path as "Open Recent" on a missing file (error dialog or notification). The Command Bar does not pre-validate file existence.

**EC-18: All three categories disabled in settings** — The bar opens with an empty list and the "No results" placeholder. The bar is still functional (the user can type a query and see the placeholder, then re-enable categories in plugin settings).

**EC-19: Command Bar plugin disabled via Plugins Panel** — The overlay is removed from the DOM. Pressing Cmd-Shift-P does nothing (the keydown listener is removed). The `"command-bar-open"` entry remains in the `COMMANDS` array (it is still remappable in the Keybindings panel), but the action handler is a no-op when the plugin is disabled.

**EC-20: Rapid open/close toggles** — User presses Cmd-Shift-P multiple times quickly. Expected: no duplicate overlays, no focus trapping errors, no stale event listeners. Each open/close cycle must be idempotent.

**EC-21: Input field receives a paste of a long string** — The user pastes a 500-character string. Expected: the query is used as-is for fuzzy matching. Performance must stay within NFR-02 bounds. Result: likely zero matches; "No results" placeholder shown.

**EC-22: Document is very large (500+ headings)** — Category B scan must complete within NFR-01's 80ms budget. A line-by-line regex scan (AD-04) is O(n) in document length; 500 headings in a 50,000-line document should complete well within budget. The Architect must verify.

**EC-23: Highlight rendering with non-consecutive match characters** — A query like `"fcs"` matches `"Focus Mode"` at positions 0, 2, 4. The highlight must mark exactly those three characters, not a contiguous run. The implementation must not accidentally highlight a superset or produce malformed DOM.

**EC-24: Focus Mode "action" result label accuracy** — When Focus Mode is currently ON, the action result label must read `"Focus Mode Disabled"` (activating will disable it). When OFF, `"Focus Mode Enabled"` (activating will enable it). The label reflects the action that will occur, not the current state. The Command Bar must read the current plugin enabled/disabled state at rebuild time.

**EC-25: Plugin with no keybinding (defaultKey: "")** — Several commands (`view-toggle-statusbar`, `view-toggle-focus`, `view-toggle-typewriter`) have `defaultKey: ""`. Their result rows must not display a keybinding badge. No empty badge or phantom whitespace should appear.

**EC-26: Window loses focus while bar is open** — The user Cmd-Tabs to another app. On return, the overlay is still open and the input field should regain focus. The bar does not auto-close on window blur (this would be jarring). The Architect may choose to close on blur; this must be specified in the architecture doc.

**EC-27: Screen reader interaction** — With `role="combobox"` on the input and `role="listbox"` on the results (NFR-05), a screen reader must announce the selected result as the user navigates. `aria-activedescendant` on the input must point to the currently selected `role="option"` element.

**EC-28: Heading at line 1 of document** — No special case. The heading scan is position-agnostic. Activating this result scrolls to line 1 and positions the cursor there.

**EC-29: Duplicate heading text** — Two headings with identical text (e.g., two `## Notes` sections). Both appear as separate results. Activating the first jumps to the first occurrence; activating the second jumps to the second. They are distinguished by their document position, not their text.

**EC-30: Category A rebuilds reflect mid-session plugin installs** — If the user installs a new user plugin while the app is open (hot-loaded), the next Command Bar open should include that plugin's toggle entries. Since the list is rebuilt on every open (FR-03.A.2), this is handled automatically provided the plugin manager's list is current at rebuild time.

---

## New Work Required

| Component | Target File | Notes |
|---|---|---|
| Command Bar plugin | `src/plugins/command-bar/command-bar.plugin.ts` (new) | IIFE plugin: overlay DOM, fuzzy ranker, category builders, keyboard navigation, focus trap, CSS injection |
| Plugin build registration | `scripts/build-plugins.mjs` | Add `["command-bar", "src/plugins/command-bar/command-bar.plugin.ts"]` to PLUGINS array |
| `"command-bar-open"` command entry | `src/keybindings/keybindings-panel.ts` | Add to `COMMANDS` array (id: `"command-bar-open"`, defaultKey: `"Cmd-Shift-P"`, section: `"View"`) |
| `COMMANDS` array export | `src/keybindings/keybindings-panel.ts` | Export `COMMANDS` (or expose via a new window global) so the plugin can read command labels and default keys |
| `handleAction()` dispatch | `src/main.ts` | Add `"command-bar-open"` case that calls the plugin's open function |
| Plugin open function global | `window` | Plugin registers `window.__MARKABLE_COMMAND_BAR_OPEN__` (or equivalent) at enable time; `handleAction` calls it |
| Command Bar tests | `tests/plugins/command-bar/command-bar.test.ts` (new) | Unit tests: fuzzy ranker tiers (FR-02.3), match highlight (FR-02.4), heading scan (FR-03.B), context-invalid dimming (FR-05), EC-04 empty results, EC-10 HTML escape, EC-23 non-consecutive highlight, EC-24 plugin label accuracy |
