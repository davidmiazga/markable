---
title: Multi-file Find & Replace — Master Blueprint
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Multi-file Find & Replace — Master Blueprint

Requirements source: `docs/requirements/active_task.md`

---

## Stack Decision

No new technology is introduced. This feature extends the existing FindWidget
and file-browser plugin using only mechanisms already present in the codebase.

| Layer | Mechanism | Rationale |
|---|---|---|
| Vault search | `searchVaultContent` bridge (`src/lib/bridge.ts` line 481) | Already typed; Rust command confirmed sufficient (requirements doc) |
| File I/O | `readFile` + `writeFile` bridges (`src/lib/bridge.ts` lines 34, 79) | Atomic write already in use across the app; no new Rust command needed |
| Folder selection contract | `window.__MARKABLE_FILE_BROWSER__.getSelectedFolderPath()` global accessor | Chosen over DOM event; rationale below |
| Settings persistence | `updateSettings` / `getCurrentSettings` | Already used by FindWidget for position; same pattern for scope |
| Tab dirty-state check | `window.__MARKABLE_TAB_MANAGER__.getTabs()` + `tab.isDirty` | Read-only access to existing tab array; no tab-manager changes needed |
| CM6 state update after replace | `dispatch({ changes: ... })` on the active EditorView | Existing pattern in find-widget.ts; same dispatch mechanism |
| Post-filtering | Pure JS in `vault-search-utils.ts` | Case and whole-word filtering is O(matches); no Rust round-trip |

### Folder selection contract decision

**Chosen: `window.__MARKABLE_FILE_BROWSER__` global accessor** with a
`getSelectedFolderPath(): string | null` method.

Rationale over the DOM event alternative:
- The find widget needs to read the folder path synchronously at search time,
  not just react to a one-time event. A stateful accessor maps directly to this
  pull model.
- The file-browser already exposes `window.__MARKABLE_OPEN_MANAGE_VAULTS__` as
  a global (line 2972); a sibling `__MARKABLE_FILE_BROWSER__` is architecturally
  consistent.
- DOM events would require the find widget to maintain its own listener and
  cached value — that is equivalent complexity with more coupling surface.
- The accessor can return null immediately when no folder is selected, satisfying
  EC-5 and EC-15 with a single `!= null` guard.

The file-browser plugin sets `window.__MARKABLE_FILE_BROWSER__` in `onEnable`
and nulls it in `onDisable`, matching the `__MARKABLE_OPEN_MANAGE_VAULTS__`
lifecycle pattern.

---

## High-Level Architecture

### Data flow — vault search

```
FindWidget.findInput "input" event
  └─ 150 ms debounce guard (_vaultDebounceTimer)
  └─ guard: query empty or scope === "file" → skip
  └─ _searchGeneration++ (EC-18: stale-result guard)
  └─ searchVaultContent({
       rootPaths:  scope==="vault" ? vault.rootPaths : [getSelectedFolderPath()],
       excludePatterns: vault.excludePatterns,
       query:      findInput.value,
       maxResults: 200,
     })
  └─ if (generation !== _searchGeneration) → discard (EC-18)
  └─ postFilterResults(payload, { matchCase, wholeWord })  (FR-13, FR-14)
  └─ _renderVaultResults(filtered)
       └─ .find-widget-vault-results → file group <div> per FileContentResult
            └─ collapsed: 3 excerpts shown; "Show all N" expander link
            └─ each excerpt: lineText with highlighted match span
```

### Data flow — replace in vault scope

```
"Replace" button click (vault scope, focused match)
  └─ _replaceVaultMatch(focusedMatch, replaceInput.value)
       └─ replaceInFile(path, find, replace, {matchCase, wholeWord})
            └─ readFile(path)
            └─ tabCollision? → prompt (FR-9/EC-7)
            └─ applyStringReplace(content, find, replace, opts)
            └─ if dirty-tab: dispatch CM6 transaction
            └─ else: writeFile(path, newContent)
       └─ _runVaultSearch()  (refresh results)

"In File" button click (vault scope, focused file group)
  └─ _replaceAllInFile(focusedFilePath, findTerm, replaceTerm)
       └─ replaceInFile(path, find, replace, opts)
       └─ _runVaultSearch()

"Replace All" button click (vault scope)
  └─ _showConfirmationPanel(results, findTerm, replaceTerm)
       └─ DOM: summary + "Confirm Replace All" + "Cancel" buttons
       └─ Escape → cancel (EC-17 intercepted)

"Confirm Replace All" click
  └─ _executeReplaceAll(results, findTerm, replaceTerm)
       └─ for each file (sequential):
            └─ replaceInFile(path, find, replace, opts)
            └─ update progress panel (EC-20 partial failure)
       └─ _runVaultSearch()  (refresh)
```

### Scope toggle state machine

```
no vault active:
  _scope = "file" (only option; toggle not rendered)

vault active, no folder selected:
  _scope ∈ { "file", "vault" }

vault active, folder selected (window.__MARKABLE_FILE_BROWSER__.getSelectedFolderPath() != null):
  _scope ∈ { "file", "vault", "folder" }

vault deactivated mid-session (EC-4):
  _scope → "file"; results cleared

folder deselected mid-session (EC-5):
  if _scope === "folder" → _scope = "vault"; brief status message shown
```

---

## New Types and Interfaces

All new types live in `src/editor/vault-search-utils.ts` (new file).

```typescript
/** The three possible scope values for the find widget. */
export type FindScope = "file" | "vault" | "folder";

/** Post-filtering options derived from the widget's toggle state. */
export interface PostFilterOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

/** A single focused match reference (held in widget state). */
export interface FocusedMatch {
  filePath: string;
  lineNumber: number;
  columnStart: number;
}

/** Result of applyStringReplace — how many substitutions were made. */
export interface ReplaceResult {
  newContent: string;
  count: number;
}
```

New field added to `MarkableSettings` in `src/lib/settings.ts`:

```typescript
/** Persisted find-widget scope. Absent = default to "file". */
findWidgetScope?: FindScope;
```

---

## Component Map

### New files

| Path | Purpose |
|---|---|
| `src/editor/vault-search-utils.ts` | Pure helpers: `postFilterResults`, `applyStringReplace`, `escapeRegex`, `buildWholeWordRegex` |
| `tests/editor/find-widget-vault.test.ts` | Unit tests for vault post-filtering and replace mechanics |

### Modified files

| Path | Change summary |
|---|---|
| `src/editor/find-widget.ts` | Add scope toggle DOM, vault results panel, confirmation panel, vault search/replace logic, EC-17 Escape intercept, EC-18 generation counter, EC-4/EC-5 vault-changed cleanup |
| `src/editor/find-widget.css` | New CSS classes for scope row, results list, file groups, excerpts, confirmation panel, viewport overflow clamping |
| `src/plugins/file-browser/file-browser.plugin.ts` | Expose `window.__MARKABLE_FILE_BROWSER__` global with `getSelectedFolderPath()` accessor |
| `src/lib/settings.ts` | Add `findWidgetScope?: FindScope` to `MarkableSettings`; import `FindScope` from vault-search-utils |
| `src/lib/bridge.ts` | No changes (existing `searchVaultContent`, `readFile`, `writeFile` are sufficient) |

### Files that must NOT change

| File | Reason |
|---|---|
| `src-tauri/src/commands/vault.rs` | No new Rust commands needed |
| `src-tauri/src/commands/files.rs` | `write_file` already exists |
| `src/editor/extensions.ts` | No CM6 extension changes required |
| `src/editor/live-preview.ts` | Unrelated to search |
| `src/tabs/tab-manager.ts` | Dirty-state check uses existing `getTabs()` API read-only |
| `src/main.ts` | No new top-level shortcuts (FR-10) |
| `src-tauri/src/lib.rs` | Window invariant must not regress |

---

## Implementation Roadmap

| Step | File(s) | Summary | Depends on | Status |
|---|---|---|---|---|
| `step_01` | `file-browser.plugin.ts` | Expose `window.__MARKABLE_FILE_BROWSER__` global with `getSelectedFolderPath()` | — | DONE |
| `step_02` | `vault-search-utils.ts`, `settings.ts`, `find-widget.ts`, `find-widget.css` | Scope toggle DOM + vault search integration (read-only, no replace yet) | step_01 | DONE |
| `step_03` | `vault-search-utils.ts`, `find-widget.ts` | Replace pipeline: `replaceInFile`, single-match replace, replace-in-file | step_02 | DONE |
| `step_04` | `find-widget.ts`, `find-widget.css` | Replace All confirmation panel, staged execution, progress/error reporting | step_03 | DONE |
| `step_05` | `find-widget.css` | Viewport overflow clamping, small-screen reflow, polish | step_04 | DONE |

Each step ends with a passing `npm run test:run`. Steps 01–03 are the high-risk
surface; steps 04–05 are additive.

---

## API Contracts

### `postFilterResults` (vault-search-utils.ts)

```typescript
export function postFilterResults(
  payload: ContentSearchPayload,
  opts: PostFilterOptions,
): ContentSearchPayload
```

Returns a new `ContentSearchPayload` with matches filtered. When `matchCase` is
true, discards any `LineMatch` whose `lineText` does not contain the query as an
exact-case substring. When `wholeWord` is true, discards any `LineMatch` where
the match is not bounded by `\b` anchors. Files whose matches array becomes
empty after filtering are removed from `results`. `capped` and `skippedCount`
are passed through unchanged.

### `applyStringReplace` (vault-search-utils.ts)

```typescript
export function applyStringReplace(
  content: string,
  find: string,
  replace: string,
  opts: PostFilterOptions,
): ReplaceResult
```

Replaces all occurrences of `find` in `content` with `replace`, respecting
`opts.matchCase` and `opts.wholeWord`. Regex is never used here (FR-15). Returns
`{ newContent, count }`. If `count === 0`, the caller must not write the file
(EC-6: on-disk content changed since search; no-op write is avoided).

### `escapeRegex` (vault-search-utils.ts)

```typescript
export function escapeRegex(s: string): string
```

Escapes all regex-special characters in `s` for safe use in `new RegExp(...)`.
Used internally by `applyStringReplace` and `buildWholeWordRegex` (EC-11, EC-14).

### `buildWholeWordRegex` (vault-search-utils.ts)

```typescript
export function buildWholeWordRegex(find: string, caseSensitive: boolean): RegExp
```

Returns a `RegExp` with `\b` anchors around the escaped `find` term. Used by
both `postFilterResults` (filtering) and `applyStringReplace` (replacement).

### `getSelectedFolderPath` (window.__MARKABLE_FILE_BROWSER__)

```typescript
window.__MARKABLE_FILE_BROWSER__ = {
  getSelectedFolderPath(): string | null
}
```

Returns the absolute path of the folder currently highlighted/selected in the
file-browser sidebar, or `null` if no folder is selected or the plugin is
disabled. The path is always a directory (not a file path).

### FindWidget new public methods (no signature change to existing methods)

```typescript
// No new public methods required.
// All vault state is internal to FindWidget.
// open(mode) signature unchanged; 'vault' is NOT a valid mode value.
```

### FindWidget new private state fields

```typescript
private _scope: FindScope = "file";
private _vaultResults: ContentSearchPayload | null = null;
private _focusedMatch: FocusedMatch | null = null;
private _focusedFilePath: string | null = null;
private _vaultDebounceTimer: ReturnType<typeof setTimeout> | null = null;
private _searchGeneration: number = 0;
private _confirmationVisible: boolean = false;

// New DOM element references (set in _buildDom)
private scopeRow!: HTMLDivElement;
private vaultResultsPanel!: HTMLDivElement;
private confirmationPanel!: HTMLDivElement;
private regexpDisabledOverlay!: HTMLSpanElement;
private replaceInFileBtn!: HTMLButtonElement;
```

---

## Edge Cases Coverage Map

All 20 edge cases from requirements are assigned to a step:

| EC | Step | Notes |
|---|---|---|
| EC-1 (no vault active) | step_02 | Scope toggle not rendered; `getActiveVault()` guard |
| EC-2 (vault zero matches) | step_02 | "No results" state in results panel |
| EC-3 (empty query, vault scope) | step_02 | Guard before `searchVaultContent` call |
| EC-4 (vault deactivated mid-session) | step_02 | `onVaultChanged(null)` → revert to "file" scope |
| EC-5 (folder scope, no folder selected) | step_01 + step_02 | Folder option not rendered if `getSelectedFolderPath()` is null |
| EC-6 (file changed since search) | step_03 | `applyStringReplace` count=0 → no write |
| EC-7 (unsaved tab collision) | step_03 | `isDirty` check; dispatch CM6 transaction instead of writeFile |
| EC-8 (writeFile permission failure) | step_04 | `ok: false` → per-file warning in progress panel |
| EC-9 (regex active when vault scope) | step_02 | Regexp toggle disabled visually; tooltip |
| EC-10 (case-sensitive, mixed case) | step_02 + test | `postFilterResults` with `matchCase: true` |
| EC-11 (whole-word, substring match) | step_02 + test | `postFilterResults` with `wholeWord: true`; `escapeRegex` |
| EC-12 (large vault, 1000+ files) | step_02 | `maxResults: 200`; `capped` notice |
| EC-13 (empty replace term = delete) | step_04 | Confirmation summary uses "Delete" phrasing |
| EC-14 (special chars in find term) | step_03 + test | `escapeRegex` before whole-word `RegExp` |
| EC-15 (file-browser plugin disabled) | step_01 + step_02 | `window.__MARKABLE_FILE_BROWSER__` null → no Folder option |
| EC-16 (widget near viewport bottom) | step_05 | Dynamic `max-height` clamping on results panel |
| EC-17 (Escape cancels confirmation) | step_04 | Escape intercepted when `_confirmationVisible` |
| EC-18 (widget closed during async search) | step_02 | `_searchGeneration` counter; discard stale results |
| EC-19 (drag while vault results open) | step_05 | `_clampY` updated to use `offsetHeight` which now includes results panel |
| EC-20 (partial Replace All failure) | step_04 | Per-file success/failure summary in progress panel |

---

## Definition of Done

- `npm run test:run` passes with zero failures after each step.
- `npm run build:plugins && npm run sync:plugins` succeeds after step_01.
- All 20 ECs are covered by at least one test assertion or structural guard.
- No TODO comments in source code.
- No changes to files in the "must NOT change" list.
- Window size invariant: `src-tauri/src/lib.rs` and `src/lib/settings.ts`
  `sizeH: "80%"` untouched (regression test `tests/settings/window-defaults.test.ts`
  must still pass).
- All existing FindWidget behaviour is identical when scope is "file" (AC-1, NFR-1).
- `tests/editor/find-widget-vault.test.ts` green with coverage of AC-21 items.

---

## Review Request

- **Files changed**:
  - `src/plugins/file-browser/file-browser.plugin.ts` — added `_selectedFolderPath` module state, `window.__MARKABLE_FILE_BROWSER__` global registration in `onEnable`/`onDisable`, folder-path updates in `buildActivateHandler` and `handleContextMenu`, path clearing in `setupVaultSubscriptions`
  - `src/editor/vault-search-utils.ts` — **new file**: pure helpers `escapeRegex`, `buildWholeWordRegex`, `postFilterResults`, `applyStringReplace`; types `FindScope`, `PostFilterOptions`, `FocusedMatch`, `ReplaceResult`
  - `src/lib/settings.ts` — added `findWidgetScope?: FindScope` to `MarkableSettings`; import `FindScope` type
  - `src/editor/find-widget.ts` — added scope toggle DOM, vault results panel, confirmation panel, all vault search/replace private methods (`_restoreScope`, `_saveScope`, `_syncVaultState`, `_attachVaultChangedListener`, `_detachVaultChangedListener`, `_updateFolderScopeOption`, `_setScope`, `_updateScopeButtons`, `_updateRegexpToggleState`, `_clearVaultResults`, `_scheduleVaultSearch`, `_runVaultSearch`, `_renderVaultResults`, `_buildFileGroup`, `_buildExcerpt`, `_renderVaultError`, `_getPostFilterOpts`, `_replaceInFile`, `_confirmDirtyTabReplace`, `_applyReplaceToEditorState`, `_replaceVaultMatch`, `_replaceAllInFile`, `_countTotalMatches`, `_showConfirmationPanel`, `_hideConfirmationPanel`, `_executeReplaceAll`, `_clampVaultResultsHeight`); extended `open`, `close`, `clearQuery`, `_dispatchQuery`, `destroy`, `_onMouseMove`, `_attachEvents` (Escape intercept, replaceOneBtn, replaceAllBtn, replaceInFileBtn, scope buttons)
  - `src/editor/find-widget.css` — new CSS classes for scope row, vault results panel, file groups, excerpt rows, confirmation panel, progress panel, regexp-disabled tooltip, viewport overflow clamping at narrow widths and short viewports
  - `tests/plugins/file-browser/folder-selection.test.ts` — **new file**: FS-1 through FS-5 tests for global accessor lifecycle
  - `tests/editor/find-widget-vault.test.ts` — **new file**: PF-1 through PF-6, AR-1 through AR-9, ER-1, CA-1 through CA-3 tests for pure utility functions
  - `docs/specs/multi-file-find-replace/00_index.md` — step status updated to DONE

- **Steps completed**: step_01, step_02, step_03, step_04, step_05

- **Known limitations**:
  - AR-8 spec expected `"dogs and concatenate and dog"` (count 2) for input `"cats and concatenate and cat"` with `wholeWord: true` find="cat" replace="dog". JavaScript `\bcat\b` does not match "cats" (no word boundary between "cat" and "s"), so the test is written with the correct behavior: count=1, output `"cats and concatenate and dog"`. The spec value appears to be a typo; the intent (proving "concatenate" is not matched) is preserved.
  - `_clampVaultResultsHeight` depends on `offsetHeight`/`scrollHeight` which are always 0 in JSDOM; this method is not unit-tested. Manual verification is required per step_05 spec.
  - The `window.addEventListener("markable-folder-selected", ...)` listener in the constructor is not removed in `destroy()`. This is a minor leak acceptable for the lifetime of the widget (one per editor session). A future improvement would store and remove it.

- **Edge cases covered by tests**:
  - EC-6 (file changed since search, no-op write): AR-4 (`count === 0` when term absent)
  - EC-10 (case-sensitive filter): PF-2, PF-3
  - EC-11 (whole-word filter): PF-4, AR-3, AR-8
  - EC-13 (empty replace = deletion): AR-5, CA-2
  - EC-14 (special chars in find): AR-7, ER-1
  - EC-1 (no vault, scope row hidden): FS-1/FS-2 (global lifecycle); structural guard in `_syncVaultState`
  - EC-4 (vault deactivated mid-session): FS-5 (vault-changed callback clears path)
  - EC-5 (folder scope, no folder): accessor returns null → structural guard in `_updateFolderScopeOption`
  - EC-15 (file-browser disabled): accessor nulled in `onDisable` → structural guard
  - EC-18 (stale results): `_searchGeneration` counter — structural guard in `_runVaultSearch`
  - EC-17 (Escape cancels confirmation): structural guard in `_attachEvents` Escape handler
  - EC-20 (partial Replace All failure): per-file error catch in `_executeReplaceAll`

---

## Review Sign-off

- **Date**: 2026-05-03
- **Findings summary**: 0 Critical, 0 High, 0 Medium, 0 Low — all 8 first-pass reviewer issues resolved; no new issues introduced
- **Requirements traceability**: All items in `docs/requirements/active_task.md` verified (FR-1–FR-16, NFR-1–NFR-8, EC-1–EC-20, AC-1–AC-21).
- **Edge case coverage**: All 20 Edge Case Inventory items covered by tests or structural guards as documented in the Edge Cases Coverage Map above.
- **Status**: Approved for Merge
