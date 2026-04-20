---
title: "Command Bar — Master Blueprint"
last-updated: "2026-04-19"
review-cadence-days: 7
status: active
---

# Command Bar (FC2 #11) — Master Blueprint

## Summary

A floating modal command palette activated with Cmd-Shift-P. Fuzzy-searches three
result categories (commands, headings, recent files) and executes the selection.
Implemented as a core IIFE plugin consistent with all FC2 features.

---

## Architecture Decisions

### AD-01: COMMANDS array — window global vs. TypeScript export

**Decision: `window.__MARKABLE_COMMANDS__` global (registered in `main.ts` at startup).**

Rationale: The IIFE plugin cannot import TypeScript modules at runtime. A TypeScript
`export` of `COMMANDS` would only be available at build time for other TypeScript files,
not for IIFE sandbox evaluation. The existing pattern for all inter-boundary communication
is window globals (`__MARKABLE_TAB_MANAGER__`, `__MARKABLE_TEMPLATES__`, etc.). Adding
`export const COMMANDS` to `keybindings-panel.ts` and then assigning
`window.__MARKABLE_COMMANDS__ = COMMANDS` in `main.ts` is the cleanest path: the
TypeScript export satisfies the type-checker and avoids circular imports; the window
assignment satisfies the IIFE boundary.

Both things are done:
1. Add `export const COMMANDS` to `keybindings-panel.ts` (the array was `const`, not
   `export const`).
2. In `main.ts` `initApp()`, after `createKeybindingsPanel()`, assign
   `window.__MARKABLE_COMMANDS__ = COMMANDS`.

### AD-02: PluginManager global

**Decision: `window.__MARKABLE_PLUGIN_MANAGER__` (registered in `main.ts` at startup).**

`pluginManager` is the module-level singleton in `src/plugins/index.ts`. The Command
Bar plugin needs `pluginManager.getStates()` to determine current plugin enabled/disabled
status for building dual-result entries. This is the same pattern used by the Templates
plugin (`__MARKABLE_TEMPLATES__`) and the Tab Manager (`__MARKABLE_TAB_MANAGER__`).

Assignment in `main.ts` `initApp()` after `pluginManager.loadPlugins()` returns:
`window.__MARKABLE_PLUGIN_MANAGER__ = pluginManager`.

### AD-03: handleAction dispatch

**Decision: `handleAction("command-bar-open")` calls `window.__MARKABLE_COMMAND_BAR_OPEN__()`.**

The plugin registers `window.__MARKABLE_COMMAND_BAR_OPEN__` as a `() => void` function
at enable time (sets it to `null` at disable time). `handleAction()` in `main.ts` adds a
case `"command-bar-open"` that checks if the global is a function and calls it. This
mirrors the Templates plugin pattern exactly.

### AD-04: Keybinding resolution

**Decision: The plugin does NOT hard-code Cmd-Shift-P.**

The plugin's `keydown` listener calls `resolveAction(e, getCurrentSettings().keybindings)`
(via `window.__MARKABLE_RESOLVE_ACTION__` — see step 01) and checks whether the returned
action id is `"command-bar-open"`. This correctly respects user remaps (EC-14).

However, since `main.ts` already has a `document` keydown listener that calls
`resolveAction` and dispatches to `handleAction`, and since `handleAction` will call the
plugin's open function, **a second keydown listener in the plugin is redundant**. The
correct design is:
- `main.ts` keydown handler (already exists) resolves `"command-bar-open"` and calls
  `handleAction("command-bar-open")`.
- `handleAction` calls `window.__MARKABLE_COMMAND_BAR_OPEN__()`.
- The plugin registers/unregisters that global at enable/disable time.
- No second keydown listener needed in the plugin.

If the plugin is disabled, `window.__MARKABLE_COMMAND_BAR_OPEN__` is null, so
`handleAction` silently no-ops (EC-19).

### AD-05: Recent files source

**Decision: `window.__MARKABLE_TAB_MANAGER__.getRecentFiles()` is NOT the right accessor.**

Inspection of `tab-manager.ts` shows the tab manager calls `addRecentFile()` which
persists to `settings.recentFiles`. The canonical source for recent files is
`getCurrentSettings().recentFiles` (an array of absolute path strings). The Command Bar
plugin accesses this via `window.__MARKABLE_CURRENT_SETTINGS__` — a new global registered
in `main.ts` — or alternatively via calling a wrapper exposed on the tab manager global.

**Revised decision**: Register `window.__MARKABLE_GET_SETTINGS__` as a function that
returns `getCurrentSettings()`. This is the minimum surface needed. The Command Bar calls
`window.__MARKABLE_GET_SETTINGS__().recentFiles` to get the recent files array.

This avoids exposing the full `getCurrentSettings` module and keeps the IIFE boundary clean.

### AD-06: Fuzzy ranker algorithm

Four-tier ranking (FR-02.3):
- **Tier 1 (exact prefix)**: `label.toLowerCase().startsWith(query.toLowerCase())`
- **Tier 2 (word-boundary prefix)**: any word in label (split on `\s+`, `-`, `_`)
  starts with the query string (case-insensitive)
- **Tier 3 (substring)**: `label.toLowerCase().includes(query.toLowerCase())`
- **Tier 4 (subsequence)**: every character of query appears in label in order (the
  standard O(n) subsequence algorithm)

Within each tier, results sort alphabetically by label (case-insensitive).

For empty query: no ranking, original order preserved (FR-02.5).

Character positions returned by the ranker are used to render `<mark>` spans (FR-02.4).
For Tiers 1-3, matched positions are contiguous. For Tier 4, positions are the
greedy-first match positions of each query character.

### AD-07: Focus trap

On open: `inputEl.focus()`. On Tab/Shift-Tab keydown inside the overlay: `preventDefault()`
and cycle selection through non-dimmed results (Tab = Down, Shift-Tab = Up). Focus never
leaves the overlay while it is open (NFR-05). On close: `window.__CM_VIEW__.focus()`.

### AD-08: Backdrop behavior on window blur (EC-26)

**Decision: Do NOT close on window blur.** The bar stays open when the user Cmd-Tabs to
another app and returns. This avoids jarring close behavior during accidental focus loss.
The `window.focus` event listener in `main.ts` returns focus to the CM6 editor — the
Command Bar must prevent this by checking `document.contains(commandBarOverlay)` and
skipping the CM6 focus restoration when the overlay is visible.

This requires a new window global `window.__MARKABLE_COMMAND_BAR_IS_OPEN__` (boolean)
that the plugin sets at open/close time. The `window.focus` handler in `main.ts` skips
`editor.focus()` when this flag is true.

### AD-09: Plugin toggle dual-result labels (FR-04.1)

The label convention: when plugin is ENABLED (currently on), the action result says
"[Name] Disabled" (clicking will disable it). When plugin is DISABLED, it says "[Name]
Enabled" (clicking will enable it). The navigate result always says "[Name]" with no
qualifier.

Plugins eligible for the dual-result pattern: all plugins registered in `pluginManager`
that have a corresponding toggle action id. The plugin derives the toggle action id from
the plugin id using the mapping table below (hard-coded in the plugin, same as
`keybindings-panel.ts`'s existing `view-toggle-*` entries):

| Plugin id         | Toggle action id          |
|-------------------|---------------------------|
| `status-bar`      | `view-toggle-statusbar`   |
| `focus-mode`      | `view-toggle-focus`       |
| `typewriter-mode` | `view-toggle-typewriter`  |

For all other plugins, no corresponding entry exists in `COMMANDS`; the dual-result is
still generated but the action result calls `pluginManager.toggle(id, !current)` directly
rather than going through `handleAction`.

**Revised decision**: For simplicity and forward-compatibility, ALL plugins registered
with `pluginManager` get dual-result entries. The action result uses
`window.__MARKABLE_PLUGIN_MANAGER__.toggle(id, !currentEnabled)` directly. This covers
both the legacy `view-toggle-*` COMMANDS entries and newer plugins (backlinks, templates,
etc.) that do not have `COMMANDS` entries.

### AD-10: Context-invalid command set

Commands that require an open file (`__MARKABLE_CURRENT_FILE__` is not null) are dimmed
when no file is open. The plugin defines a static set of format command id prefixes and
explicitly listed command ids that require a file context:

```
REQUIRES_FILE_IDS = new Set([
  "file-save", "file-save-as", "file-export", "file-print",
  "edit-paste-plain", "edit-paste-link", "edit-copy-plain", "edit-copy-html",
  "edit-duplicate-line", "edit-delete-line", "edit-goto-line", "edit-find",
  "edit-find-replace",
]);
REQUIRES_FILE_PREFIXES = ["format-"];
```

Category B (headings) is always context-invalid when no file is open.

---

## Component Map

### New files

| File | Purpose |
|------|---------|
| `src/plugins/command-bar/command-bar.plugin.ts` | Core IIFE plugin: overlay, fuzzy ranker, category builders, navigation, CSS injection |
| `tests/plugins/command-bar/command-bar.test.ts` | Unit tests for fuzzy ranker, builders, DOM behavior |

### Modified files

| File | Changes |
|------|---------|
| `src/keybindings/keybindings-panel.ts` | Add `export` to `COMMANDS` constant; add `"command-bar-open"` entry |
| `src/main.ts` | Register `window.__MARKABLE_COMMANDS__`, `window.__MARKABLE_PLUGIN_MANAGER__`, `window.__MARKABLE_GET_SETTINGS__`, `window.__MARKABLE_COMMAND_BAR_IS_OPEN__`; add `"command-bar-open"` to `handleAction()`; update `window.focus` handler to skip editor focus when command bar is open |
| `scripts/build-plugins.mjs` | Add `["command-bar", "src/plugins/command-bar/command-bar.plugin.ts"]` to `PLUGINS` array |

---

## Window Globals Summary

| Global | Type | Set by | Read by |
|--------|------|--------|---------|
| `__MARKABLE_COMMANDS__` | `CommandDef[]` | `main.ts` initApp | plugin (category A builder) |
| `__MARKABLE_PLUGIN_MANAGER__` | `PluginManager` | `main.ts` initApp | plugin (dual-result builder, toggle action) |
| `__MARKABLE_GET_SETTINGS__` | `() => MarkableSettings` | `main.ts` initApp | plugin (recent files, keybindings) |
| `__MARKABLE_COMMAND_BAR_OPEN__` | `(() => void) \| null` | plugin onEnable/onDisable | `handleAction()` in main.ts |
| `__MARKABLE_COMMAND_BAR_IS_OPEN__` | `boolean` | plugin (set on open/close) | `window.focus` handler in main.ts |

---

## Data Types (Internal to Plugin)

```typescript
// Result categories
type ResultCategory = "commands" | "headings" | "recent";

// A single result item (internal representation)
interface CommandBarResult {
  id: string;              // unique per result (e.g. "cmd:file-save", "heading:3:42", "recent:0")
  category: ResultCategory;
  label: string;           // display text (used for fuzzy matching)
  sublabel?: string;       // secondary text (e.g. path for recent files)
  keybinding?: string;     // formatted key string (Category A only, if present)
  headingLevel?: number;   // 1-6 (Category B only)
  dimmed: boolean;         // true if no file is open and command requires one
  action: () => void;      // closure executed on activation
}

// Fuzzy match result
interface FuzzyMatch {
  tier: 1 | 2 | 3 | 4;    // lower = better
  positions: number[];     // matched character positions in label
}

// Result with match information
interface MatchedResult {
  result: CommandBarResult;
  match: FuzzyMatch;
}

// Plugin settings
interface CommandBarSettings {
  showCommands: boolean;    // default: true
  showHeadings: boolean;    // default: true
  showRecentFiles: boolean; // default: true
}
```

---

## Implementation Roadmap

### Step checklist

- [x] **step_01** — Infrastructure: export `COMMANDS`, add new `COMMANDS` entry, register window globals, add `handleAction` case, update window-focus handler
- [x] **step_02** — Fuzzy ranker: pure function, 4-tier ranking, match position extraction, fully unit-testable
- [x] **step_03** — Result builders: category A (commands + plugin dual-results), category B (headings), category C (recent files)
- [x] **step_04** — Overlay DOM + CSS: structure, styles, section headers, result rows with highlight rendering, empty state
- [x] **step_05** — Keyboard navigation + focus trap: arrow keys, Enter, Escape, Tab, mouse interaction, wrap-around, dimmed-skip
- [x] **step_06** — Plugin settings UI: checkboxes for showCommands / showHeadings / showRecentFiles in renderDetailExtra
- [x] **step_07** — Integration + build registration: plugin object, onEnable/onDisable lifecycle, build-plugins.mjs entry, copy-core-plugins cleanup

---

## Requirement Coverage Matrix

| Requirement | Step |
|---|---|
| FR-01.1 Cmd-Shift-P activation | step_01 (COMMANDS entry), step_07 (plugin lifecycle) |
| FR-01.2 Close on Escape/click-outside/result-activation/tab-close | step_05 |
| FR-01.3 Input focus on open | step_05 |
| FR-01.4 Empty input on open | step_05 |
| FR-01.5 Full result set on open | step_03, step_05 |
| FR-01.6 Toggle behavior (open while open = close) | step_05 |
| FR-02.1 Subsequence fuzzy matching | step_02 |
| FR-02.2 Case-insensitive | step_02 |
| FR-02.3 4-tier ranking | step_02 |
| FR-02.4 Character highlight | step_04 |
| FR-02.5 Empty query = full unfiltered set | step_05 |
| FR-02.6 Single character triggers filter | step_05 |
| FR-03.A Category A commands | step_03 |
| FR-03.B Category B headings | step_03 |
| FR-03.C Category C recent files | step_03 |
| FR-04 Plugin toggle dual-result | step_03 |
| FR-05 Context-invalid dimming | step_03 |
| FR-06 Keyboard navigation | step_05 |
| FR-07 Settings | step_06 |
| FR-08 Visual design | step_04 |
| FR-09 Plugin lifecycle | step_07 |
| NFR-01 Open latency <80ms | step_03, step_07 (sync builders) |
| NFR-02 Filter latency <50ms | step_02 (sync ranker) |
| NFR-03 IIFE self-containment | all steps |
| NFR-04 Theme compatibility | step_04 (CSS variables only) |
| NFR-05 Accessibility basics | step_04 (ARIA), step_05 (focus trap, aria-activedescendant) |
| NFR-06 No external dependencies | step_02 (inline ranker) |
| NFR-07 Single instance | step_05 |
| EC-01..EC-30 | see individual step files |

---

## Step Files

- `docs/specs/command-bar/step_01_infrastructure.md`
- `docs/specs/command-bar/step_02_fuzzy_ranker.md`
- `docs/specs/command-bar/step_03_result_builders.md`
- `docs/specs/command-bar/step_04_overlay_dom.md`
- `docs/specs/command-bar/step_05_keyboard_navigation.md`
- `docs/specs/command-bar/step_06_settings_ui.md`
- `docs/specs/command-bar/step_07_integration.md`

---

## Review Sign-off

- **Date**: 2026-04-19
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all prior findings resolved; one pre-existing Low (detachListeners scope) accepted as-is with documented rationale
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified against implementation and tests.
- **Edge case coverage**: All 30 Edge Case Inventory items covered by tests or documented as runtime-only with explicit justification.
- **Status**: Approved for Merge

---

## Open Implementation Notes

- **Scroll-to-plugin in Plugins Panel**: The navigate result for a plugin opens
  the Plugins Panel but does not scroll to the specific plugin. Deferred because
  the Plugins Panel does not currently expose a `scrollToPlugin(id)` API.
  Tracked here per project convention (no TODO comments in source).

---

## Review Request

- **Files changed**:
  - `src/keybindings/keybindings-panel.ts` — exported `CommandDef` interface and `COMMANDS` array; added `command-bar-open` entry
  - `src/main.ts` — added COMMANDS/PluginManager/settings/handleAction/command-bar window globals; added `command-bar-open` case to `handleAction()`; updated `window.focus` handler to respect `__MARKABLE_COMMAND_BAR_IS_OPEN__`
  - `src/tabs/tab-manager.ts` — dispatches `markable-tab-closed` CustomEvent after a tab is closed (EC-12)
  - `scripts/build-plugins.mjs` — added `command-bar` entry to PLUGINS array
  - `src/plugins/command-bar/fuzzy-ranker.ts` — pure fuzzy ranker module (fuzzyMatch, renderHighlightedLabel); removed position 0 from wordBoundaryMatch starts array to match comment (Finding 007)
  - `src/plugins/command-bar/command-bar.plugin.ts` — complete IIFE plugin; fixed `onDisable` parameter name from `_api` to `_unusedApi` (Finding 001); removed `&& pm` guard in `buildAllResults` (Finding 003); added 30-line justification comments to 5 functions (Finding 005)
  - `tests/plugins/command-bar/command-bar.test.ts` — 84 unit tests (added EC-05, EC-06, EC-12, EC-18, EC-02 tests from Finding 002)
  - `docs/requirements/active_task.md` — corrected EC-23 positions from [0,2,3] to [0,2,4] (Finding 004)
  - `docs/specs/command-bar/step_02_fuzzy_ranker.md` — corrected EC-23 positions from [0,2,3] to [0,2,4] throughout (Finding 004)

- **Steps completed**: step_01, step_02, step_03, step_04, step_05, step_06, step_07 (plus code-reviewer fix pass)

- **Known limitations**:
  - Scroll-to-plugin in Plugins Panel not implemented (see Open Implementation Notes above)
  - No Rust `copy_core_plugins` changes needed; the existing cleanup logic handles new .js files automatically

- **Edge cases covered by tests**:
  - EC-01 (heading jump, no file): `buildHeadingResults` sets `dimmed: true` when `currentFile === null`; tested in "EC-01: all headings are dimmed when no file is open"
  - EC-02 (dimmed result mouse click): `onResultClick` JS guard returns early when `result.dimmed`; tested in "EC-02: clicking a dimmed result does NOT call its action handler"
  - EC-03 (no headings): `buildHeadingResults` returns empty array; tested in "EC-03: returns empty array when document has no headings"
  - EC-04 (zero results): `renderResults` shows "No results" placeholder; tested in "EC-04: shows No results placeholder when results is empty"
  - EC-05 (Cmd-Shift-P while open): `openBar()` calls `closeBar()` when `_isOpen === true`; tested in "EC-05: calling openBar() twice closes the bar (toggle behavior)"
  - EC-06 (Escape with any input): `onOverlayKeydown` dispatches `closeBar()` for Escape regardless of input; tested in "EC-06: pressing Escape closes the bar regardless of input content"
  - EC-09 (heading with Markdown syntax): label preserves raw text; tested in "EC-09: heading label preserves raw Markdown syntax inside"
  - EC-10 (HTML injection): `renderHighlightedLabel` uses textContent/createTextNode; tested in "EC-10: HTML injection safety"
  - EC-11 (all dimmed): `firstSelectableId` returns null; tested in "EC-11: returns null when all results are dimmed"
  - EC-12 (tab closes while bar open): `onTabClosed` listener calls `closeBar()`; tested in "EC-12: markable-tab-closed event on document closes the bar"
  - EC-16 (no recent files): `buildRecentFileResults` returns empty array; tested in "EC-16: returns empty array for empty recentFiles"
  - EC-18 (all categories disabled): plugin enabled with all-false settings renders "No results"; tested in "EC-18: all categories disabled in settings renders No results placeholder"
  - EC-19 (plugin disabled): `__MARKABLE_COMMAND_BAR_OPEN__` is null after `onDisable`; tested in "onDisable sets window.__MARKABLE_COMMAND_BAR_OPEN__ to null"
  - EC-23 (non-consecutive match positions): greedy subsequence returns correct positions [0,2,4]; tested in "Tier 4 EC-23: non-consecutive positions are correct"
  - EC-24 (plugin toggle label): action result shows "Enabled"/"Disabled" based on current state; tested in "EC-24: when plugin is ENABLED, action label says Disabled"
  - EC-25 (empty defaultKey): command with empty key has no keybinding badge; tested in "EC-25: no keybinding badge when keybinding is undefined"
  - EC-27 (screen reader): selected result has `aria-selected="true"`; tested in "EC-27: selected result has aria-selected=true"
  - EC-28 (heading at line 1): `buildHeadingResults` scans from line 1; tested in "EC-28: heading at line 1 (first line) is parsed correctly"
  - EC-29 (duplicate headings): distinct ids via `heading:lineNum:from` composite; tested in "EC-29: duplicate headings with same text have distinct ids"
