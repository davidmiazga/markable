---
title: Multi-file Find & Replace
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Multi-file Find & Replace

## Feature Summary

As a PKM user with an active vault, I want the existing Find & Replace floating
widget to grow a "Vault" scope toggle so I can search and replace text across
every file in my vault (or just the files under a selected folder) — without
leaving the familiar single-file widget interaction I already know. When vault
scope is off the widget behaves exactly as it does today; when vault scope is on
the widget expands downward into a grouped file-results list, and replace
operates at three levels of granularity: this match, all in file, all in vault,
with a confirmation summary before a destructive "all in vault" replace commits.

---

## Codebase Context Findings

### `src/editor/find-widget.ts` — existing widget

`FindWidget` is a class instantiated once by `createFindWidget(view: EditorView)`
and appended to `document.body` as `position:fixed`. Relevant state fields:

- `_isOpen: boolean` — whether the widget is visible (line 88)
- `_replaceVisible: boolean` — whether the replace row is expanded (line 90)
- `_matchCase`, `_wholeWord`, `_regexp: boolean` — toggle state (lines 94–96)
- `root: HTMLDivElement` — the root container (line 56); DOM is built in
  `_buildDom()` at construction time, not lazily

Current DOM tree (built in `_buildDom()`, lines 262–403):
```
.find-widget
  .find-widget-find-row
    .find-widget-chevron   (›, toggles replace row)
    .find-widget-input     (find text)
    .find-widget-toggle    (Aa / ab / .*)  ×3
    .find-widget-count     (N of M label)
    .find-widget-prev  ↑
    .find-widget-next  ↓
    .find-widget-close ×
  .find-widget-replace-row  (hidden by default)
    .find-widget-replace-input
    .find-widget-replace-one  "Replace"
    .find-widget-replace-all  "All"
```

Width is clamped `min-width: 320px; max-width: 480px` (find-widget.css line 29).
z-index is 200 (find-widget.css line 27). Position is `right: 16px; top: 54px`
by default, converted to absolute `left/top` on first drag (line 779).

The `replaceAll` button (line 576) currently dispatches `replaceAll(this.view)` —
a CM6 command that operates on the single active EditorView. This remains
unchanged when vault scope is off.

`open(mode)` (line 146) accepts `'find' | 'replace'`. There is no `'vault'` mode
yet. Keybinding wiring is in `src/main.ts` (not read, but confirmed by reference
at line 30 importing `getCurrentSettings`).

### `src/editor/find-widget.css`

The widget has a `border-top: 1px solid var(--search-panel-border)` rule on
`.find-widget-replace-row` (line 253). A new vault-results row must follow the
same pattern. The `@media (max-width: 400px)` rule (line 287) collapses the
widget to `calc(100vw - 32px)` — the vault results panel must reflow gracefully
at this breakpoint.

### `src/lib/bridge.ts` — existing search and write bridges

`searchVaultContent(params)` (line 481) — fully typed bridge for the Rust
`search_vault_content` command. Parameters:
- `rootPaths: string[]` — vault root directories
- `excludePatterns: string[]` — glob patterns to skip
- `query: string` — substring (the command itself is case-insensitive; case
  sensitivity is handled client-side or passed as a flag — see note on Rust
  command below)
- `maxResults: number` — file cap

Returns `FileResult<ContentSearchPayload>`.

`ContentSearchPayload` (line 453):
```typescript
{ results: FileContentResult[]; capped: boolean; skippedCount: number }
```

`FileContentResult` (line 440):
```typescript
{ path: string; title: string; matches: LineMatch[] }
```

`LineMatch` (line 422):
```typescript
{ lineNumber: number; lineText: string; columnStart: number }
```

`writeFile(path, content)` (line 79) — atomic write via temp-file-swap.
Returns `FileResult<void>`. This is the bridge that replace-in-file operations
will use.

`readFile(path)` (line 34) — reads file as UTF-8 string. Returns
`FileResult<string>`. Replace operations must read the current file content
before writing.

### `src-tauri/src/commands/vault.rs` — Rust `search_vault_content`

Signature (line 1143):
```rust
pub async fn search_vault_content(
    root_paths: Vec<String>,
    exclude_patterns: Vec<String>,
    query: String,
    max_results: u32,
) -> Result<ContentSearchPayload, String>
```

The Rust implementation (line 1153) performs `query.trim().to_lowercase()` and
matches against each line's `.to_lowercase()` — the search is always
**case-insensitive** at the Rust level. There is no `case_sensitive` flag exposed
on the Rust command. The existing case-sensitivity toggle in the widget (`_matchCase`)
currently controls the CM6 `SearchQuery` only.

Implication for multi-file search: the Rust command always returns
case-insensitive matches. The client side must post-filter results when
`_matchCase` is on to discard false positives returned by the Rust command.
This is a known constraint the architect must address.

The command also does not accept a `regex` flag. Regex matching across files
must be implemented client-side if it is in scope, or explicitly called out of
scope. (See Out of Scope below — regex is out of scope for vault search.)

File size cap: files larger than `SEARCH_MAX_FILE_BYTES` (1 MB, confirmed by
test at vault.rs line 2137) are read only up to the cap; matches beyond 1 MB
are not returned but `skipped_count` is not incremented.

### `src/plugins/file-browser/file-browser.plugin.ts` — folder selection state

The file-browser plugin does **not** currently expose a "selected folder path"
global or event. Module-level folder state is tracked only implicitly through
context menu target resolution — the `showContextMenu()` function (line 2017)
is called inline with the path of the right-clicked node and does not persist
the selection beyond the menu's lifetime. There is no `_selectedFolderPath` or
equivalent module-level variable.

The plugin exposes one window global on enable: `window.__MARKABLE_OPEN_MANAGE_VAULTS__`
(line 2972). The vault manager is accessed via `window.__MARKABLE_VAULT_MANAGER__`.
The current open file is read from `window.__MARKABLE_CURRENT_FILE__` (line 2992).

Consequence for folder scope: the "Folder" scope option requires the architect
to design a mechanism by which the file-browser plugin exposes the currently
selected/highlighted folder path so the find widget can read it. Two candidate
approaches exist:
1. A new `window.__MARKABLE_FILE_BROWSER__` global exposing a `getSelectedFolderPath(): string | null` accessor.
2. A custom DOM event `markable-folder-selected` dispatched by the file-browser
   on right-click or single-click selection.

The architect must choose one. Neither exists today — this is a new contract to
be designed.

---

## Functional Requirements

### FR-1 — Vault scope toggle (conditional visibility)

The widget gains a scope-toggle control group with two or three options:
- "File" (always shown) — current single-file behaviour, unchanged
- "Vault" (shown when a vault is active) — searches all `.md` files in the vault
- "Folder" (shown when a vault is active AND a folder is currently selected in
  the File Browser sidebar) — searches only `.md` files under the selected folder
  path (non-recursive is incorrect — the scope IS recursive under the folder)

When no vault is active (vault manager returns null for `getActiveVault()`), the
scope toggle is not rendered and the widget behaves exactly as today.

### FR-2 — Scope toggle placement and widget expansion

The scope toggle sits between the find row and the existing replace row.
When "File" scope is active: widget renders exactly as today (no change to
existing DOM layout).
When "Vault" or "Folder" scope is selected: the widget expands downward to show
a vault-results panel below the scope toggle row, still above the replace row.
The replace row remains accessible via the chevron when vault scope is active.

### FR-3 — Live results as you type (vault/folder scope)

When vault or folder scope is active, results update as the user types in the
find input with a **150 ms debounce**. Each debounce tick calls
`searchVaultContent` via `bridge.ts`. The query string, `rootPaths`, and
`excludePatterns` are derived from the active vault's configuration via
`window.__MARKABLE_VAULT_MANAGER__`.

When folder scope is active, `rootPaths` is set to `[selectedFolderPath]` (a
single-element array containing the folder path exposed by the file-browser).

Results are displayed in a scrollable list inside the widget. Maximum height of
the results list: 320px with `overflow-y: auto`. Width follows the widget's
existing `min-width: 320px; max-width: 480px` constraint.

### FR-4 — Results list rendering

Each file with one or more matches is shown as a collapsible group:
```
[file-title]  (N matches)
  [line excerpt, match term highlighted]
  [line excerpt, match term highlighted]
  ...
```
File groups are sorted by match count descending (the Rust command already
returns them in this order).

Each excerpt shows the full `lineText` from the `LineMatch` struct, with the
matched substring visually highlighted (bold or background tint). The
`columnStart` field from `LineMatch` identifies the start of the highlight
region; the length of the match term is known from the find input value.

File groups are collapsed by default showing a maximum of 3 excerpts. A "Show
all N" link expands the group to show all matches within that file.

When `capped: true` in the payload, show a notice below the results list:
"Results limited to the first N files. Refine your query to see more."
(where N = the `maxResults` value passed to the search).

When `skippedCount > 0`, show a secondary notice: "N file(s) could not be read."

### FR-5 — "No results" state

When a query returns zero `FileContentResult` entries (non-empty `results` array
with zero files OR the command returns an error), display: "No results in vault."
(or "No results in folder." for folder scope). Use the same red tint styling as
the existing single-file no-results state (`find-widget-no-results` class
pattern).

### FR-6 — Replace levels in vault scope

When vault or folder scope is active and the replace row is open, three replace
actions are available:

- **Replace** (existing button, repurposed): replaces the single match whose
  excerpt is currently focused/highlighted in the results list, then advances
  to the next match. If no match is focused in the results list, falls back
  to replacing in the active CM6 editor (same as today).
- **Replace in File**: replaces all matches in the file whose group is currently
  focused, then re-runs the search to update the results list.
- **Replace All in Vault/Folder**: see FR-7 (confirmation step required).

The "Replace in File" button appears only when vault or folder scope is active.
Its label reads "In File" to fit the widget's horizontal constraints.

### FR-7 — Staged "Replace All" confirmation

When the user activates "Replace All" with vault or folder scope active, the
replace does NOT commit immediately. Instead:

1. A confirmation summary replaces the results list inside the widget:
   "Replace '[find term]' with '[replace term]' in [N] files ([M] matches)?"
2. Two buttons appear: "Confirm Replace All" and "Cancel".
3. Clicking "Confirm Replace All" performs the replace sequentially across all
   matched files (read → string-replace → writeFile via bridge). A progress
   indicator ("Replacing N of M files…") replaces the summary during execution.
4. Clicking "Cancel" returns to the normal results list without any writes.
5. After completion, the results list refreshes automatically (a new search runs
   against the now-modified files).

### FR-8 — Replace mechanics (file I/O)

For each file targeted by a replace operation:
1. Call `readFile(path)` from bridge.ts to get current content.
2. Perform the string replacement in JavaScript (respecting `_matchCase`,
   `_wholeWord`, and — for single-file scope only — `_regexp` toggle state).
3. Call `writeFile(path, newContent)` from bridge.ts (atomic temp-file-swap).
4. If the file is currently open in a tab, update the tab's CM6 editor state
   to reflect the new content so the user does not see stale content.

### FR-9 — Unsaved tab collision

Before writing to any file that is currently open in a tab, check whether the
tab has unsaved changes (dirty state). If the tab is dirty:
- Do not silently overwrite. Prompt the user: "The file '[name]' has unsaved
  changes. Replace anyway and discard unsaved changes?"
- If the user confirms, apply the replacement to the CM6 editor state (not
  via writeFile) so the file remains dirty and the user can still undo.
- If the user cancels that individual file, skip it and continue with the
  remaining files in a "Replace All" operation.

### FR-10 — Keyboard shortcut

No new top-level keyboard shortcut is introduced. The widget is opened via the
existing Cmd-F (find) and Cmd-Shift-F (replace) shortcuts. The scope toggle is
toggled by clicking only (not keyboard-driven in this iteration).

### FR-11 — Scope toggle persistence

The last-used scope selection ("File", "Vault", or "Folder") is persisted to
settings via `updateSettings()` so reopening the widget restores the last scope.
Persisted key: `findWidget.scope` (a new field on the existing `FindWidgetPosition`
settings shape, or a sibling key `findWidget` object extension).

### FR-12 — maxResults cap

The `maxResults` parameter passed to `searchVaultContent` is 200 files. This
provides a practical upper bound without blocking the UI for very large vaults.
When `capped: true` is returned, the notice described in FR-4 is displayed.

### FR-13 — Case sensitivity in vault search

Because the Rust `search_vault_content` command is always case-insensitive, the
client must post-filter results when `_matchCase` is `true`: any `LineMatch`
whose `lineText` does not contain the exact-case query string is removed. Files
where all matches are filtered out are removed from the results list entirely.

### FR-14 — Whole-word matching in vault search

When `_wholeWord` is `true`, the client post-filters results: a `LineMatch` is
kept only when the matched substring is bounded by non-word characters (or
string boundaries) on both sides. Implementation uses a JavaScript regex with
`\b` word-boundary anchors constructed from the (escaped) query string.

### FR-15 — Regex in vault scope is out of scope

Regex (`_regexp` toggle) applies only to single-file (CM6) search. When vault
or folder scope is active and `_regexp` is on, the regex toggle is visually
disabled (greyed out) and a tooltip reads "Regex not supported in vault search."
The find input still accepts the text literally for vault search purposes.

### FR-16 — Widget size constraint with results panel open

When vault scope is active and results are shown, `max-width` remains 480px.
The widget's height is unconstrained (grows as needed) up to a practical limit:
the results list has `max-height: 320px`. The confirmation panel (FR-7) also
has `max-height: 320px`. The widget must not overflow the viewport vertically;
if the expanded widget would overflow, the results list shrinks to fit.

---

## Non-Functional Requirements

### NFR-1 — No regression on single-file behaviour

When no vault is active, or when "File" scope is selected, every existing
FindWidget behaviour is identical to today. This is a hard constraint. The
architect must design the vault extension as additive DOM/state layered on top
of the existing structure, not as a refactor of existing code paths.

### NFR-2 — Search debounce 150 ms

Vault search must not fire on every keystroke. 150 ms debounce measured from the
last keypress before the `searchVaultContent` call is issued.

### NFR-3 — Replace is non-destructive for open tabs

Writes to open tabs go through the CM6 editor state transaction layer, not
directly via `writeFile`, so the user retains undo history for in-memory changes.
Writes to files not currently open use `writeFile` directly (atomic swap on disk).

### NFR-4 — Performance ceiling

For a vault of up to 200 files matching the query (the `maxResults` cap), the
results list must render within 300 ms of receiving the `ContentSearchPayload`.
The `searchVaultContent` Rust command itself is expected to complete within 2 s
for a 1 000-file vault on consumer hardware (this is an existing command with
established performance — not a new constraint).

### NFR-5 — CM6 state consistency after replace

After a replace operation touches a file that is currently open in a tab, the
CM6 editor document state must match the on-disk content. Any mismatch (e.g.,
stale highlights from the now-superseded CM6 `SearchQuery`) must be cleared by
dispatching an updated query after the replace.

### NFR-6 — Error handling

All `readFile` and `writeFile` calls return `FileResult<T>` (never throw). Any
`ok: false` result during a "Replace All" operation must be surfaced to the user
as a per-file warning without aborting the rest of the batch.

### NFR-7 — Accessibility

The results list must be keyboard-navigable: Tab / arrow keys move focus between
file groups and match excerpts. Each excerpt has an accessible label
(file title + line number). The confirmation dialog (FR-7) must trap focus
between its two buttons until dismissed.

### NFR-8 — Tests

The vault-search client-side post-filtering (FR-13, FR-14) and the replace
mechanics (FR-8, FR-9) must have unit tests in the `tests/` directory. The
existing `tests/plugins/file-browser/` structure is the reference pattern.
No integration test that launches Tauri is required for this feature.

---

## Files That Must Change

| File | Change type | Reason |
|---|---|---|
| `src/editor/find-widget.ts` | Extend | Add vault scope toggle, results panel, vault replace logic, FR-8/FR-9 collision handling |
| `src/editor/find-widget.css` | Extend | New CSS classes for scope row, results list, file groups, excerpts, confirmation panel |
| `src/lib/bridge.ts` | Extend | Possibly add a `replaceInFileBatch` helper or confirm `readFile`+`writeFile` is sufficient; no new Rust command needed |
| `src/plugins/file-browser/file-browser.plugin.ts` | Extend | Expose selected folder path via `window.__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()` (or custom event) |
| `src/lib/settings.ts` | Extend | Add `findWidget.scope` field to `FindWidgetSettings` shape; update `DEFAULT_SETTINGS` |
| `tests/editor/find-widget-vault.test.ts` | Create | Unit tests for vault post-filtering and replace mechanics |

## Files That Must NOT Change

| File | Reason |
|---|---|
| `src-tauri/src/commands/vault.rs` | The `search_vault_content` command already satisfies all search needs; no new Rust commands are required |
| `src-tauri/src/commands/files.rs` | `write_file` already exists; no new write commands needed |
| `src/editor/extensions.ts` | No CM6 extension changes required |
| `src/editor/live-preview.ts` | Unrelated to search |
| `src/tabs/tab-manager.ts` | Tab dirty-state check must use the existing tab manager API, not modify it |
| `src/main.ts` keybinding wiring | No new top-level shortcuts (FR-10) |

---

## Out of Scope

- Glob / file-pattern filters (e.g., `*.md` only, exclude `archive/**`): the
  vault is the unit of scope; glob filters are not in this iteration.
- Regex vault search: regex applies only to single-file (CM6) scope (FR-15).
- Search history / recent queries: not in this iteration.
- Preview-before-replace diff view: the confirmation summary (FR-7) shows file
  count and match count only, not a full diff.
- New keyboard shortcuts for scope selection (FR-10).
- Non-Markdown file search (`.txt`, `.html`, etc.): the Rust command already
  restricts to `.md` files; this scope is inherited.
- Undo across files for "Replace All in Vault": each file's replace is its own
  `writeFile` atomic swap. Cross-file undo is not supported. Users should use
  git for recovery.

---

## Edge Case Inventory

**EC-1 — No vault active.**
The scope toggle is not rendered. The widget behaves exactly as today. No search
is triggered. The "Vault" and "Folder" options are absent from the toggle.

**EC-2 — Vault with zero matches.**
`searchVaultContent` returns `results: []`. The results list shows "No results in
vault." (FR-5). The replace buttons are disabled / non-interactive. No crash.

**EC-3 — Query is empty when vault scope is active.**
No search call is made (guard on empty string, mirroring the Rust guard at
vault.rs line 1154). The results list shows nothing (blank state, not "No results").

**EC-4 — Vault scope selected but vault becomes inactive mid-session.**
If the user switches away from a vault (via vault manager) while the widget is
open in Vault scope, the scope reverts to "File" automatically and the results
list is cleared. The vault-changed event from `window.__MARKABLE_VAULT_MANAGER__`
triggers this cleanup.

**EC-5 — Folder scope selected but no folder is currently highlighted in the
File Browser.**
The "Folder" toggle option is not rendered at all when no folder is selected
(FR-1). If the folder selection is cleared after the user has already switched
to Folder scope, the widget gracefully falls back to "Vault" scope with a brief
status message: "Folder selection lost. Showing vault results."

**EC-6 — Replace in a file that has been modified on disk since the search ran.**
The `readFile` call in FR-8 step 1 fetches the current on-disk content at
replace time. If the content has changed since the search snapshot, the string
replacement runs against the current content. If the find term no longer exists
in the current content, the replacement is a no-op; the file is not written.
The results list refreshes after the replace batch to reflect current state.

**EC-7 — Replace collides with unsaved tab content.**
Covered by FR-9. The user is prompted. Confirming applies the replacement to
the CM6 editor state (marking the tab dirty). Cancelling skips that file.

**EC-8 — "Replace All in Vault" targets a file the app cannot write (permissions).**
`writeFile` returns `ok: false`. The per-file error is surfaced as a warning in
the confirmation/progress panel (NFR-6). Remaining files in the batch continue
to be processed.

**EC-9 — Regex toggle is active when user switches to vault scope.**
The regex toggle is visually disabled (greyed, pointer-events: none) while vault
or folder scope is active (FR-15). The toggle state `_regexp` is not cleared —
if the user switches back to file scope, the regex toggle resumes its prior state.

**EC-10 — Case-sensitive search with a mixed-case query, vault scope.**
The Rust command returns case-insensitive matches. The client post-filter
(FR-13) discards matches where `lineText` does not contain the exact-case
substring. If post-filtering empties all matches for a file, that file is
removed from the display. Performance: post-filtering is O(total matches) in
JavaScript, not a Rust round-trip.

**EC-11 — Whole-word search with a query that is a substring of another word.**
The client post-filter (FR-14) uses `\b` boundary matching. A match like "cat"
in "concatenate" is discarded. The regex is built from the escaped query string
(special characters in the query are escaped via `escapeRegex()` before
constructing the word-boundary pattern).

**EC-12 — Very large vault (1 000+ files).**
The `maxResults` cap of 200 (FR-12) limits `ContentSearchPayload.results` to 200
files. The UI renders a "Results limited to the first 200 files" notice when
`capped: true`. The results list is virtualised (or at minimum rendered lazily
with a `max-height: 320px` scrollable container) so 200 file groups do not
freeze the DOM.

**EC-13 — Replace term is empty string.**
An empty replace term performs a deletion (removes the find term). This is valid
behaviour consistent with the existing single-file "Replace All" (the CM6
`replaceAll` command allows empty replacement strings). The confirmation summary
(FR-7) must show: "Delete '[find term]' in N files (M matches)?" to make the
destructive intent clear.

**EC-14 — Find term contains characters that are special in the Rust command.**
The Rust `search_vault_content` command uses substring (not regex) matching, so
special characters in the query are treated literally (confirmed by vault.rs
test D-3, line 2113). No escaping is needed for the Rust call. JavaScript
post-filters for whole-word mode must still escape the term before constructing
the `RegExp`.

**EC-15 — File browser plugin is disabled when the Find widget is opened in
vault scope.**
`window.__MARKABLE_FILE_BROWSER__` would be null/absent. The "Folder" scope
option must not render. If vault scope is selected and the file-browser plugin
is subsequently disabled, the widget falls back gracefully to "Vault" scope
(same cleanup path as EC-5).

**EC-16 — The widget is positioned near the bottom of the viewport when vault
scope is activated.**
The results list expands the widget downward. Viewport overflow is handled by
the `_clampY` mechanism already present for drag positioning, but the expanded
widget height is not dragged — it grows in place. The architect must decide
whether to cap the results list height more aggressively (e.g., `max-height:
200px`) when the widget's top position is near the bottom of the viewport, or
to always anchor the widget to a scroll-friendly position when vault scope is
engaged.

**EC-17 — User presses Escape while the confirmation panel (FR-7) is open.**
Escape cancels the confirmation and returns to the results list (same as clicking
"Cancel"). The Escape handler in `_attachEvents` (line 427) currently closes the
widget entirely; this must be intercepted when the confirmation panel is visible
so Escape cancels the confirmation instead of closing the widget.

**EC-18 — Search completes but the widget has been closed before results render.**
If the user closes the widget during the 150 ms debounce or during the async
`searchVaultContent` call, the results must be discarded (not rendered into a
hidden widget). A cancellation flag or "generation counter" pattern guards
against stale async results updating the DOM after close.

**EC-19 — Widget drag while vault results are open.**
The existing drag implementation (lines 759–826) moves the entire `.find-widget`
element including the results panel. This is correct and no special handling is
needed. The existing viewport-clamp logic in `_clampX`/`_clampY` must account
for the increased height of the widget.

**EC-20 — Replace All partially fails (some files succeed, some fail).**
After a partial failure, the progress panel shows a per-file summary: green
checkmark for succeeded files, red X for failed files with the error message
from `FileResult.error.message`. The "done" state is reached even if some files
failed; the user can retry the failed files individually.

---

## Acceptance Criteria

**AC-1** — When no vault is active, the widget opens via Cmd-F / Cmd-Shift-F
with no scope toggle visible and behaves identically to the current
implementation in all respects.

**AC-2** — When a vault is active, the widget displays a scope toggle with "File"
and "Vault" options. "File" is the default unless a prior session persisted
"Vault" or "Folder".

**AC-3** — Selecting "Vault" scope and typing a query of at least one character
triggers a search with the 150 ms debounce. Results appear as a grouped file
list within the widget.

**AC-4** — Each file group in the results list shows the file title, match count,
and up to 3 excerpt lines. Match substrings are visually highlighted within
excerpts. A "Show all N" control expands the group to show all matches.

**AC-5** — When `capped: true` is returned, the notice "Results limited to the
first 200 files" appears below the results list.

**AC-6** — When a folder is selected in the File Browser and a vault is active,
a "Folder" scope option appears in the toggle. Selecting it limits search to
files under that folder.

**AC-7** — When "File" scope is selected after having used "Vault" scope, the
results panel is hidden and the widget returns to its normal single-file state.

**AC-8** — The "Replace" button with vault scope active replaces the focused match
in the results list. With no focused match, it falls back to replacing in the
active CM6 editor.

**AC-9** — The "In File" button (vault scope only) replaces all matches in the
file whose group is focused, then refreshes the results list.

**AC-10** — Clicking "Replace All" with vault scope active shows the confirmation
summary ("Replace '...' with '...' in N files (M matches)?") without committing
any writes.

**AC-11** — Clicking "Confirm Replace All" processes all matched files sequentially,
showing a progress indicator. After completion the results list refreshes.

**AC-12** — Clicking "Cancel" in the confirmation panel returns to the results
list without any file writes.

**AC-13** — When `_matchCase` is active in vault scope, the results list shows
only exact-case matches (post-filter FR-13 is applied).

**AC-14** — When `_wholeWord` is active in vault scope, the results list shows
only word-boundary matches (post-filter FR-14 is applied).

**AC-15** — When `_regexp` is active and vault scope is selected, the regexp
toggle is visually disabled and the search proceeds as a literal-string vault
search.

**AC-16** — If a file in the "Replace All" batch is currently open in a tab with
unsaved changes, a per-file prompt appears before that file is written. The user
can confirm (apply to editor state, keep dirty) or skip (no write, continue batch).

**AC-17** — If a file write fails (`writeFile` returns `ok: false`), the progress
panel marks that file as failed and continues with the remaining files.

**AC-18** — Pressing Escape while the confirmation panel is visible cancels the
confirmation and returns to the results list without closing the widget.

**AC-19** — The scope selection is persisted to settings and restored on the next
`open()` call.

**AC-20** — All existing FindWidget tests pass without modification.

**AC-21** — Unit tests cover: (a) case-sensitive post-filter correctly discards
case-mismatched results, (b) whole-word post-filter discards partial-word matches,
(c) replace mechanics correctly read/modify/write file content.

---

## Handoff Summary

- Artifact: `docs/requirements/active_task.md`
- Status: Requirements Validated
- Edge cases to verify in tests: 20 items in Edge Case Inventory (EC-1 through EC-20)

Next step: Activate @software-architect and provide `docs/requirements/active_task.md` as context.
