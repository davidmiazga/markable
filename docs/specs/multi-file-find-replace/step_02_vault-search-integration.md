---
title: Step 02 — Vault search integration (read-only)
last-updated: "2026-05-03"
review-cadence-days: 90
status: active
---

# Step 02 — Vault search integration (read-only)

## Objective

Add vault scope state to `FindWidget`, wire `searchVaultContent`, render grouped
results, and implement the scope toggle DOM. No replace operations in this step.
After this step the user can open the find widget with a vault active, switch to
"Vault" or "Folder" scope, type a query, and see grouped file results appear.

All existing single-file behaviour must remain identical (NFR-1, AC-1).

After this step `npm run test:run` must pass.

---

## Files to create/edit

- **Create**: `src/editor/vault-search-utils.ts`
- **Edit**: `src/lib/settings.ts`
- **Edit**: `src/editor/find-widget.ts`
- **Edit**: `src/editor/find-widget.css`
- **Create**: `tests/editor/find-widget-vault.test.ts` (started here; extended in later steps)

---

## Part A: Create `src/editor/vault-search-utils.ts`

This file contains pure utility functions with no DOM or Tauri dependencies.
All functions are exported so they can be tested in isolation.

```typescript
/**
 * vault-search-utils.ts
 *
 * Pure helper functions for multi-file find & replace.
 *
 * No DOM, no Tauri, no imports from bridge.ts — these functions operate only
 * on data structures so they can be unit-tested without mocks.
 */

import type { ContentSearchPayload, LineMatch } from "../lib/bridge";

export type FindScope = "file" | "vault" | "folder";

export interface PostFilterOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export interface FocusedMatch {
  filePath: string;
  lineNumber: number;
  columnStart: number;
}

export interface ReplaceResult {
  newContent: string;
  count: number;
}

/**
 * Escape all regex-special characters in a string so it can be used as a
 * literal pattern inside new RegExp(...).
 *
 * EC-11, EC-14: Required before constructing whole-word boundaries.
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a RegExp for whole-word matching of `find`.
 *
 * Uses \b word-boundary anchors around the escaped find term. The `g` flag
 * is always set so replace operations can replace all occurrences.
 *
 * @param find - The literal find term (will be regex-escaped internally).
 * @param caseSensitive - True for case-sensitive match.
 */
export function buildWholeWordRegex(find: string, caseSensitive: boolean): RegExp {
  const escaped = escapeRegex(find);
  const flags = caseSensitive ? "g" : "gi";
  return new RegExp(`\\b${escaped}\\b`, flags);
}

/**
 * Post-filter a ContentSearchPayload from searchVaultContent.
 *
 * The Rust command is always case-insensitive (FR-13 constraint). When
 * matchCase is true, discard LineMatches whose lineText does not contain the
 * exact-case query string. When wholeWord is true, discard LineMatches where
 * the match is not bounded by word boundaries.
 *
 * Files whose matches array becomes empty after filtering are removed from
 * results. capped and skippedCount pass through unchanged.
 *
 * @param payload - The raw payload from searchVaultContent.
 * @param query   - The exact query string from the find input.
 * @param opts    - Post-filtering options.
 */
export function postFilterResults(
  payload: ContentSearchPayload,
  query: string,
  opts: PostFilterOptions,
): ContentSearchPayload {
  if (!opts.matchCase && !opts.wholeWord) {
    // No post-filtering needed — return payload as-is.
    return payload;
  }

  const wholeWordRe = opts.wholeWord
    ? buildWholeWordRegex(query, opts.matchCase)
    : null;

  const filteredResults = payload.results
    .map((fileResult) => {
      const filteredMatches = fileResult.matches.filter((match: LineMatch) => {
        // Case-sensitive post-filter (FR-13).
        if (opts.matchCase && !match.lineText.includes(query)) {
          return false;
        }
        // Whole-word post-filter (FR-14).
        if (wholeWordRe) {
          // Reset lastIndex because the same regex object is reused across
          // multiple lineText values (g flag makes it stateful).
          wholeWordRe.lastIndex = 0;
          if (!wholeWordRe.test(match.lineText)) {
            return false;
          }
        }
        return true;
      });

      return { ...fileResult, matches: filteredMatches };
    })
    .filter((fileResult) => fileResult.matches.length > 0);

  return {
    results: filteredResults,
    capped: payload.capped,
    skippedCount: payload.skippedCount,
  };
}

/**
 * Apply a string replacement across all occurrences of `find` in `content`.
 *
 * Respects matchCase and wholeWord. Regex is never used as the search strategy
 * here (FR-15 — regex is out of scope for vault search). Returns the new
 * content string and the count of substitutions made.
 *
 * When count === 0, the caller must NOT write the file (EC-6: on-disk content
 * may have changed since the search snapshot; a no-op write is avoided).
 *
 * @param content - Current file content.
 * @param find    - The literal search term.
 * @param replace - The replacement string.
 * @param opts    - matchCase and wholeWord toggles.
 */
export function applyStringReplace(
  content: string,
  find: string,
  replace: string,
  opts: PostFilterOptions,
): ReplaceResult {
  if (!find) {
    return { newContent: content, count: 0 };
  }

  if (opts.wholeWord) {
    const re = buildWholeWordRegex(find, opts.matchCase);
    let count = 0;
    const newContent = content.replace(re, () => {
      count++;
      return replace;
    });
    return { newContent, count };
  }

  if (opts.matchCase) {
    // Case-sensitive literal replacement without whole-word restriction.
    // String.split + join is the canonical no-regex approach.
    const parts = content.split(find);
    const count = parts.length - 1;
    return { newContent: parts.join(replace), count };
  }

  // Case-insensitive literal replacement.
  const escaped = escapeRegex(find);
  const re = new RegExp(escaped, "gi");
  let count = 0;
  const newContent = content.replace(re, () => {
    count++;
    return replace;
  });
  return { newContent, count };
}
```

---

## Part B: Edit `src/lib/settings.ts`

### 1. Import `FindScope`

At the top of the file, add an import for the new type. Because `settings.ts`
is a regular ES module (not an IIFE), it can import from vault-search-utils:

```typescript
import type { FindScope } from "../editor/vault-search-utils";
```

### 2. Add `findWidgetScope` to `MarkableSettings` interface

After the existing `findWidget: FindWidgetPosition | null;` field (line 129),
add:

```typescript
/**
 * Last-used scope for the find widget ("file", "vault", or "folder").
 * Absent in settings files created before multi-file find was added —
 * FindWidget defaults to "file" when this field is absent (FR-11).
 */
findWidgetScope?: FindScope;
```

No change to `DEFAULT_SETTINGS` is needed — the absent field is handled by
`?? "file"` at read time in `FindWidget._restoreScope()`.

---

## Part C: Edit `src/editor/find-widget.ts`

### 1. New imports

Add at the top of the file, after existing imports:

```typescript
import type { FindScope, PostFilterOptions } from "../editor/vault-search-utils";
import { postFilterResults } from "../editor/vault-search-utils";
import { searchVaultContent } from "../lib/bridge";
import type { ContentSearchPayload, FileContentResult, LineMatch } from "../lib/bridge";
```

### 2. New state fields on `FindWidget`

Add to the class body, after the existing `_regexp: boolean = false;` field
(around line 96):

```typescript
// ---- Vault scope state ----

/** Current find scope: "file", "vault", or "folder". */
private _scope: FindScope = "file";

/** Latest vault search results (null when no search has been run). */
private _vaultResults: ContentSearchPayload | null = null;

/**
 * The file path of the currently focused file group in the results panel.
 * null when no group is focused.
 */
private _focusedFilePath: string | null = null;

/**
 * The currently focused individual match (for single-match replace).
 * null when no individual match row is focused.
 */
private _focusedMatch: { filePath: string; lineNumber: number; columnStart: number } | null = null;

/** Timer handle for the 150 ms search debounce (NFR-2). */
private _vaultDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Monotonically-increasing counter used to discard stale async search
 * results (EC-18). Incremented on every new search. The async callback
 * compares its captured generation to the current value before applying
 * results to the DOM.
 */
private _searchGeneration: number = 0;

/** True while the confirmation panel (FR-7) is visible. */
private _confirmationVisible: boolean = false;
```

### 3. New DOM element references

Add to the class body, after the existing `closeBtn` reference (around line 83):

```typescript
// ---- Vault extension DOM references (set in _buildDom) ----

/** Row containing the scope toggle buttons (File / Vault / Folder). */
private scopeRow!: HTMLDivElement;

/** Scrollable panel containing grouped vault search results. */
private vaultResultsPanel!: HTMLDivElement;

/** Confirmation/progress panel for Replace All (FR-7). */
private confirmationPanel!: HTMLDivElement;

/** Overlay span that visually disables the regexp toggle in vault scope (FR-15, EC-9). */
private regexpDisabledMsg!: HTMLSpanElement;

/** "In File" replace button (vault scope only). */
private replaceInFileBtn!: HTMLButtonElement;
```

### 4. Extend `_buildDom()`

After `root.appendChild(replaceRow)` (the last line before storing element
refs, around line 382), insert three new sections:

#### 4a. Scope toggle row

```typescript
// ---- Scope toggle row (inserted between find row and replace row) ----
// Inserted before replaceRow is appended.  Re-order: scope row comes
// second, replace row comes third.
const scopeRow = document.createElement("div");
scopeRow.className = "find-widget-scope-row";
scopeRow.style.display = "none"; // Hidden when no vault is active (EC-1)

const scopeFile = document.createElement("button");
scopeFile.className = "find-widget-scope-btn active";
scopeFile.setAttribute("data-scope", "file");
scopeFile.setAttribute("aria-pressed", "true");
scopeFile.textContent = "File";

const scopeVault = document.createElement("button");
scopeVault.className = "find-widget-scope-btn";
scopeVault.setAttribute("data-scope", "vault");
scopeVault.setAttribute("aria-pressed", "false");
scopeVault.textContent = "Vault";

// Folder button is created but hidden by default; shown by _updateFolderScopeOption()
const scopeFolder = document.createElement("button");
scopeFolder.className = "find-widget-scope-btn";
scopeFolder.setAttribute("data-scope", "folder");
scopeFolder.setAttribute("aria-pressed", "false");
scopeFolder.style.display = "none";
scopeFolder.textContent = "Folder";

scopeRow.appendChild(scopeFile);
scopeRow.appendChild(scopeVault);
scopeRow.appendChild(scopeFolder);
root.appendChild(scopeRow);
```

#### 4b. Vault results panel

```typescript
// ---- Vault results panel ----
const vaultResultsPanel = document.createElement("div");
vaultResultsPanel.className = "find-widget-vault-results";
vaultResultsPanel.style.display = "none";
vaultResultsPanel.setAttribute("role", "list");
vaultResultsPanel.setAttribute("aria-label", "Vault search results");
root.appendChild(vaultResultsPanel);
```

#### 4c. Confirmation panel (created hidden; populated in step_04)

```typescript
// ---- Confirmation panel (Replace All) ----
const confirmationPanel = document.createElement("div");
confirmationPanel.className = "find-widget-confirmation";
confirmationPanel.style.display = "none";
root.appendChild(confirmationPanel);
```

#### 4d. Regexp disabled overlay

In the find row section, after `findRow.appendChild(toggleRegexp)`, add:

```typescript
// Disabled-state indicator for regexp toggle when vault scope is active (FR-15, EC-9)
const regexpDisabledMsg = document.createElement("span");
regexpDisabledMsg.className = "find-widget-regexp-disabled";
regexpDisabledMsg.textContent = "Regex not supported in vault search";
regexpDisabledMsg.style.display = "none";
// Not appended to findRow — it floats as a tooltip via CSS absolute positioning.
root.appendChild(regexpDisabledMsg);
```

#### 4e. "In File" button in replace row

In the replace row section, after `replaceRow.appendChild(replaceOneBtn)` but
before `replaceRow.appendChild(replaceAllBtn)`:

```typescript
const replaceInFileBtn = document.createElement("button");
replaceInFileBtn.className = "find-widget-replace-in-file";
replaceInFileBtn.setAttribute("aria-label", "Replace in File");
replaceInFileBtn.setAttribute("title", "Replace all matches in this file");
replaceInFileBtn.textContent = "In File";
replaceInFileBtn.style.display = "none"; // Shown only when vault scope is active
replaceRow.appendChild(replaceInFileBtn);
```

#### 4f. Store new refs in the class-field assignment block

After the existing `this.closeBtn = closeBtn;` assignment, add:

```typescript
this.scopeRow = scopeRow;
this.vaultResultsPanel = vaultResultsPanel;
this.confirmationPanel = confirmationPanel;
this.regexpDisabledMsg = regexpDisabledMsg;
this.replaceInFileBtn = replaceInFileBtn;
// Store the individual scope buttons for _updateScopeButtons()
this._scopeBtnFile = scopeFile;
this._scopeBtnVault = scopeVault;
this._scopeBtnFolder = scopeFolder;
```

Also add three more private field declarations at the top of the class:

```typescript
private _scopeBtnFile!: HTMLButtonElement;
private _scopeBtnVault!: HTMLButtonElement;
private _scopeBtnFolder!: HTMLButtonElement;
```

### 5. Extend `_attachEvents()`

At the end of `_attachEvents()`, after the closeBtn handler:

```typescript
// ---- Scope toggle buttons ----
[this._scopeBtnFile, this._scopeBtnVault, this._scopeBtnFolder].forEach((btn) => {
  btn.addEventListener("click", () => {
    const newScope = btn.getAttribute("data-scope") as FindScope;
    this._setScope(newScope);
  });
});
```

### 6. Extend `open()`

At the start of `open()`, after the `if (this._isOpen)` early-return block and
before `this._restorePosition()`, add:

```typescript
// Restore persisted scope and check vault state.
this._restoreScope();
this._syncVaultState();
```

### 7. Extend `close()`

At the start of `close()`, after the `if (!this._isOpen) return;` guard:

```typescript
// Clear debounce timer so pending vault searches don't complete after close.
if (this._vaultDebounceTimer !== null) {
  clearTimeout(this._vaultDebounceTimer);
  this._vaultDebounceTimer = null;
}
```

### 8. Extend `clearQuery()`

After the existing `this.view.dispatch({ effects: setSearchQuery.of(...) })`,
add:

```typescript
// Clear vault results when the query is cleared.
this._vaultResults = null;
this._focusedFilePath = null;
this._focusedMatch = null;
this.vaultResultsPanel.innerHTML = "";
this.vaultResultsPanel.style.display = "none";
```

### 9. Extend `_dispatchQuery()`

The existing `_dispatchQuery()` method handles CM6 single-file search. Add vault
search after the existing CM6 dispatch:

```typescript
private _dispatchQuery(): void {
  const query = this._buildSearchQuery();
  this.view.dispatch({ effects: setSearchQuery.of(query) });
  this._updateCount(query);

  // Vault search: only when scope is not "file".
  if (this._scope !== "file") {
    this._scheduleVaultSearch();
  }
}
```

### 10. New private methods

Add these methods to the class body.

#### `_restoreScope()`

```typescript
private _restoreScope(): void {
  const saved = getCurrentSettings().findWidgetScope;
  this._scope = saved ?? "file";
}
```

#### `_saveScope()`

```typescript
private _saveScope(): void {
  updateSettings((s) => ({ ...s, findWidgetScope: this._scope })).catch((err) => {
    console.error("FindWidget: failed to save scope:", err);
  });
}
```

#### `_syncVaultState()`

Called on open and when the vault changes. Checks whether a vault is currently
active and shows/hides the scope toggle row accordingly.

```typescript
private _syncVaultState(): void {
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vault = vm?.getActiveVault?.() ?? null;

  if (!vault) {
    // EC-1: No vault active — hide scope row, force to file scope.
    this.scopeRow.style.display = "none";
    if (this._scope !== "file") {
      this._scope = "file";
      this._clearVaultResults();
    }
    return;
  }

  // Vault is active — show scope row.
  this.scopeRow.style.display = "flex";
  this._updateFolderScopeOption();
  this._updateScopeButtons();

  // Subscribe to vault changes so we can react if vault becomes inactive (EC-4).
  this._attachVaultChangedListener();
}
```

#### `_attachVaultChangedListener()`

```typescript
// Guard: only subscribe once per open() call.
private _vaultChangedAttached: boolean = false;
private _vaultChangedCb: ((vault: unknown) => void) | null = null;

private _attachVaultChangedListener(): void {
  if (this._vaultChangedAttached) return;
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  if (!vm?.onVaultChanged) return;

  this._vaultChangedCb = (vault: unknown) => {
    if (!vault) {
      // EC-4: Vault became inactive mid-session.
      this._scope = "file";
      this.scopeRow.style.display = "none";
      this._clearVaultResults();
      this._updateScopeButtons();
    } else {
      this._updateFolderScopeOption();
    }
  };
  vm.onVaultChanged(this._vaultChangedCb);
  this._vaultChangedAttached = true;
}
```

Also add a `_detachVaultChangedListener()` that is called from `destroy()`:

```typescript
private _detachVaultChangedListener(): void {
  if (!this._vaultChangedCb) return;
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  vm?.offVaultChanged?.(this._vaultChangedCb);
  this._vaultChangedCb = null;
  this._vaultChangedAttached = false;
}
```

And in `destroy()`, add before `this.root.remove()`:

```typescript
this._detachVaultChangedListener();
if (this._vaultDebounceTimer !== null) clearTimeout(this._vaultDebounceTimer);
```

Also add `private _vaultChangedAttached: boolean = false;` and
`private _vaultChangedCb: ((v: unknown) => void) | null = null;` to the class
field declarations.

#### `_updateFolderScopeOption()`

```typescript
private _updateFolderScopeOption(): void {
  const fb = (window as any).__MARKABLE_FILE_BROWSER__;
  const folderPath = fb?.getSelectedFolderPath?.() ?? null;
  const show = folderPath !== null;
  this._scopeBtnFolder.style.display = show ? "" : "none";

  if (!show && this._scope === "folder") {
    // EC-5: Folder selection lost — fall back to vault scope.
    this._scope = "vault";
    this._updateScopeButtons();
    this._showFolderLostMessage();
    this._scheduleVaultSearch();
  }
}
```

#### `_showFolderLostMessage()`

```typescript
private _showFolderLostMessage(): void {
  // Briefly show a status message inside the vault results panel.
  const msg = document.createElement("div");
  msg.className = "find-widget-vault-status";
  msg.textContent = "Folder selection lost. Showing vault results.";
  this.vaultResultsPanel.innerHTML = "";
  this.vaultResultsPanel.appendChild(msg);
  this.vaultResultsPanel.style.display = "block";
  setTimeout(() => {
    if (msg.parentNode === this.vaultResultsPanel) {
      msg.remove();
    }
  }, 3000);
}
```

#### `_setScope(scope: FindScope)`

```typescript
private _setScope(scope: FindScope): void {
  if (scope === this._scope) return;

  // EC-9: If switching to vault/folder while regexp is on, visually disable it.
  this._scope = scope;
  this._updateScopeButtons();
  this._updateRegexpToggleState();
  this._saveScope();

  if (scope === "file") {
    // AC-7: Switch back to file scope — clear vault results.
    this._clearVaultResults();
  } else {
    // Run a vault search immediately if there is an existing query.
    if (this.findInput.value) {
      this._scheduleVaultSearch();
    }
  }
}
```

#### `_updateScopeButtons()`

```typescript
private _updateScopeButtons(): void {
  [this._scopeBtnFile, this._scopeBtnVault, this._scopeBtnFolder].forEach((btn) => {
    const isActive = btn.getAttribute("data-scope") === this._scope;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-pressed", String(isActive));
  });

  // Show/hide "In File" button in replace row.
  const vaultActive = this._scope !== "file";
  this.replaceInFileBtn.style.display = vaultActive ? "" : "none";
}
```

#### `_updateRegexpToggleState()`

```typescript
private _updateRegexpToggleState(): void {
  const inVault = this._scope !== "file";
  if (inVault) {
    this.toggleRegexp.style.pointerEvents = "none";
    this.toggleRegexp.style.opacity = "0.4";
    this.toggleRegexp.setAttribute("title", "Regex not supported in vault search");
    this.toggleRegexp.setAttribute("aria-disabled", "true");
  } else {
    this.toggleRegexp.style.pointerEvents = "";
    this.toggleRegexp.style.opacity = "";
    this.toggleRegexp.setAttribute("title", "Use Regular Expression");
    this.toggleRegexp.removeAttribute("aria-disabled");
  }
}
```

#### `_clearVaultResults()`

```typescript
private _clearVaultResults(): void {
  this._vaultResults = null;
  this._focusedFilePath = null;
  this._focusedMatch = null;
  this.vaultResultsPanel.innerHTML = "";
  this.vaultResultsPanel.style.display = "none";
  if (this._vaultDebounceTimer !== null) {
    clearTimeout(this._vaultDebounceTimer);
    this._vaultDebounceTimer = null;
  }
}
```

#### `_scheduleVaultSearch()`

```typescript
private _scheduleVaultSearch(): void {
  if (this._vaultDebounceTimer !== null) {
    clearTimeout(this._vaultDebounceTimer);
  }
  this._vaultDebounceTimer = setTimeout(() => {
    this._vaultDebounceTimer = null;
    void this._runVaultSearch();
  }, 150); // NFR-2: 150 ms debounce
}
```

#### `_runVaultSearch()`

```typescript
private async _runVaultSearch(): Promise<void> {
  const query = this.findInput.value;

  // EC-3: Skip empty query.
  if (!query) {
    this._clearVaultResults();
    return;
  }

  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const vault = vm?.getActiveVault?.();
  if (!vault) {
    this._clearVaultResults();
    return;
  }

  // EC-18: Capture generation before await.
  this._searchGeneration++;
  const myGeneration = this._searchGeneration;

  let rootPaths: string[];
  if (this._scope === "folder") {
    const fb = (window as any).__MARKABLE_FILE_BROWSER__;
    const folderPath = fb?.getSelectedFolderPath?.() ?? null;
    if (!folderPath) {
      // EC-5: Folder was deselected; fall back to vault scope silently.
      this._scope = "vault";
      this._updateScopeButtons();
      rootPaths = vault.rootPaths;
    } else {
      rootPaths = [folderPath];
    }
  } else {
    rootPaths = vault.rootPaths;
  }

  const result = await searchVaultContent({
    rootPaths,
    excludePatterns: vault.excludePatterns ?? [],
    query,
    maxResults: 200, // FR-12
  });

  // EC-18: Discard stale results.
  if (myGeneration !== this._searchGeneration) return;

  // EC-18: Also discard if widget was closed during the search.
  if (!this._isOpen) return;

  if (!result.ok) {
    this._renderVaultError(result.error.message);
    return;
  }

  // FR-13, FR-14: Client-side post-filtering.
  const filtered = postFilterResults(result.value, query, {
    matchCase: this._matchCase,
    wholeWord: this._wholeWord,
  });

  this._vaultResults = filtered;
  this._renderVaultResults(filtered, query);
}
```

#### `_renderVaultResults(payload, query)`

```typescript
private _renderVaultResults(payload: ContentSearchPayload, query: string): void {
  const panel = this.vaultResultsPanel;
  panel.innerHTML = "";
  panel.style.display = "block";

  // FR-5: No results state.
  if (payload.results.length === 0) {
    const noResults = document.createElement("div");
    noResults.className = "find-widget-vault-no-results";
    const scopeLabel = this._scope === "folder" ? "folder" : "vault";
    noResults.textContent = `No results in ${scopeLabel}.`;
    panel.appendChild(noResults);
    return;
  }

  // FR-4: Render one group per file.
  for (const fileResult of payload.results) {
    panel.appendChild(this._buildFileGroup(fileResult, query));
  }

  // FR-4: Capped notice.
  if (payload.capped) {
    const notice = document.createElement("div");
    notice.className = "find-widget-vault-notice";
    notice.textContent = `Results limited to the first 200 files. Refine your query to see more.`;
    panel.appendChild(notice);
  }

  // FR-4: Skipped notice.
  if (payload.skippedCount > 0) {
    const notice = document.createElement("div");
    notice.className = "find-widget-vault-notice find-widget-vault-notice-warn";
    notice.textContent = `${payload.skippedCount} file(s) could not be read.`;
    panel.appendChild(notice);
  }
}
```

#### `_buildFileGroup(fileResult, query)`

```typescript
private _buildFileGroup(fileResult: FileContentResult, query: string): HTMLDivElement {
  const INITIAL_SHOWN = 3; // FR-4: default collapsed to 3 excerpts

  const group = document.createElement("div");
  group.className = "find-widget-file-group";
  group.setAttribute("role", "listitem");
  group.setAttribute("data-file-path", fileResult.path);
  group.setAttribute("tabindex", "0");
  group.setAttribute("aria-label", `${fileResult.title}, ${fileResult.matches.length} matches`);

  // File header: title + match count
  const header = document.createElement("div");
  header.className = "find-widget-file-header";

  const titleSpan = document.createElement("span");
  titleSpan.className = "find-widget-file-title";
  titleSpan.textContent = fileResult.title;

  const countSpan = document.createElement("span");
  countSpan.className = "find-widget-file-match-count";
  countSpan.textContent = `${fileResult.matches.length}`;

  header.appendChild(titleSpan);
  header.appendChild(countSpan);
  group.appendChild(header);

  // Excerpt list
  const excerptList = document.createElement("div");
  excerptList.className = "find-widget-excerpt-list";

  const totalMatches = fileResult.matches.length;
  const showAll = totalMatches <= INITIAL_SHOWN;
  const visibleMatches = showAll
    ? fileResult.matches
    : fileResult.matches.slice(0, INITIAL_SHOWN);

  for (const match of visibleMatches) {
    excerptList.appendChild(
      this._buildExcerpt(match, query, fileResult.path)
    );
  }

  group.appendChild(excerptList);

  // "Show all N" expander (only when more than INITIAL_SHOWN matches)
  if (!showAll) {
    const expander = document.createElement("button");
    expander.className = "find-widget-show-all";
    expander.textContent = `Show all ${totalMatches}`;
    expander.addEventListener("click", (e) => {
      e.stopPropagation();
      // Append the hidden matches.
      for (const match of fileResult.matches.slice(INITIAL_SHOWN)) {
        excerptList.appendChild(this._buildExcerpt(match, query, fileResult.path));
      }
      expander.remove();
    });
    group.appendChild(expander);
  }

  // Focus tracking for replace operations.
  group.addEventListener("focus", () => {
    this._focusedFilePath = fileResult.path;
  });
  group.addEventListener("blur", () => {
    // Clear only if focus moved outside this group.
    // Use setTimeout to yield so the new focused element is known.
    setTimeout(() => {
      if (!group.contains(document.activeElement)) {
        if (this._focusedFilePath === fileResult.path) {
          this._focusedFilePath = null;
        }
      }
    }, 0);
  });

  return group;
}
```

#### `_buildExcerpt(match, query, filePath)`

```typescript
private _buildExcerpt(
  match: LineMatch,
  query: string,
  filePath: string,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "find-widget-excerpt";
  row.setAttribute("tabindex", "0");
  row.setAttribute(
    "aria-label",
    `Line ${match.lineNumber}: ${match.lineText}`
  );
  row.setAttribute("data-line", String(match.lineNumber));
  row.setAttribute("data-col", String(match.columnStart));
  row.setAttribute("data-file", filePath);

  // Build highlighted line text.
  // columnStart is 0-based; query.length gives the highlighted region.
  const before = match.lineText.slice(0, match.columnStart);
  const matched = match.lineText.slice(
    match.columnStart,
    match.columnStart + query.length
  );
  const after = match.lineText.slice(match.columnStart + query.length);

  const lineNum = document.createElement("span");
  lineNum.className = "find-widget-excerpt-linenum";
  lineNum.textContent = `${match.lineNumber}`;

  const text = document.createElement("span");
  text.className = "find-widget-excerpt-text";

  const beforeSpan = document.createTextNode(before);
  const matchSpan = document.createElement("mark");
  matchSpan.className = "find-widget-match-highlight";
  matchSpan.textContent = matched;
  const afterSpan = document.createTextNode(after);

  text.appendChild(beforeSpan);
  text.appendChild(matchSpan);
  text.appendChild(afterSpan);

  row.appendChild(lineNum);
  row.appendChild(text);

  // Focus tracking.
  row.addEventListener("focus", () => {
    this._focusedMatch = {
      filePath,
      lineNumber: match.lineNumber,
      columnStart: match.columnStart,
    };
    this._focusedFilePath = filePath;
  });

  return row;
}
```

#### `_renderVaultError(message)`

```typescript
private _renderVaultError(message: string): void {
  const panel = this.vaultResultsPanel;
  panel.innerHTML = "";
  panel.style.display = "block";
  const err = document.createElement("div");
  err.className = "find-widget-vault-no-results";
  err.textContent = `Search error: ${message}`;
  panel.appendChild(err);
}
```

### 10. Wire vault-changed listener to `_updateFolderScopeOption`

The `markable-folder-selected` DOM event from step_01 should update the Folder
scope option visibility. Add a listener on `window` when the widget is first
constructed (in the constructor, after `this._attachDrag()`):

```typescript
// Update the Folder scope option whenever the file-browser signals a folder change.
window.addEventListener("markable-folder-selected", () => {
  if (this._isOpen && this._scope !== "file") {
    this._updateFolderScopeOption();
  }
});
```

---

## Part D: Edit `src/editor/find-widget.css`

Add the following rules at the end of the file:

```css
/* ---- Scope toggle row ---- */

.find-widget-scope-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid var(--search-panel-border);
}

.find-widget-scope-btn {
  flex-shrink: 0;
  padding: 2px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-family: inherit;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  border: 1px solid var(--border-color);
  background-color: transparent;
  color: var(--text-secondary);
  transition: background-color 0.1s ease, color 0.1s ease;
}

.find-widget-scope-btn:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
  color: var(--text-primary);
}

.find-widget-scope-btn.active {
  background-color: color-mix(in srgb, var(--link-color) 15%, var(--bg-primary));
  color: var(--link-color);
  border-color: color-mix(in srgb, var(--link-color) 35%, transparent);
}

/* ---- Vault results panel ---- */

.find-widget-vault-results {
  /* max-height constrains the scrollable area (FR-3, FR-16). */
  max-height: 320px;
  overflow-y: auto;
  border-top: 1px solid var(--search-panel-border);
}

/* ---- File group ---- */

.find-widget-file-group {
  padding: 4px 8px;
  border-bottom: 1px solid color-mix(in srgb, var(--search-panel-border) 50%, transparent);
  outline: none;
}

.find-widget-file-group:focus-visible {
  box-shadow: inset 0 0 0 1px var(--link-color);
}

.find-widget-file-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  cursor: default;
}

.find-widget-file-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.find-widget-file-match-count {
  font-size: 10px;
  color: var(--text-secondary);
  background-color: color-mix(in srgb, var(--text-primary) 8%, transparent);
  border-radius: 10px;
  padding: 0 6px;
  flex-shrink: 0;
}

/* ---- Excerpt rows ---- */

.find-widget-excerpt-list {
  margin-top: 2px;
}

.find-widget-excerpt {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 4px;
  border-radius: 3px;
  cursor: pointer;
  outline: none;
  font-size: 11px;
  overflow: hidden;
}

.find-widget-excerpt:hover {
  background-color: color-mix(in srgb, var(--text-primary) 6%, transparent);
}

.find-widget-excerpt:focus-visible {
  box-shadow: inset 0 0 0 1px var(--link-color);
}

.find-widget-excerpt-linenum {
  color: var(--text-secondary);
  font-size: 10px;
  min-width: 24px;
  text-align: right;
  flex-shrink: 0;
}

.find-widget-excerpt-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
}

.find-widget-match-highlight {
  /* Bold + background tint for matched substring (FR-4). */
  background-color: color-mix(in srgb, hsl(45, 90%, 55%) 30%, transparent);
  color: inherit;
  font-weight: 600;
  border-radius: 2px;
  padding: 0 1px;
}

/* ---- "Show all N" expander ---- */

.find-widget-show-all {
  font-size: 11px;
  color: var(--link-color);
  background: none;
  border: none;
  padding: 2px 4px;
  cursor: pointer;
  font-family: inherit;
}

.find-widget-show-all:hover {
  text-decoration: underline;
}

/* ---- No-results / status / notice ---- */

.find-widget-vault-no-results {
  padding: 10px 12px;
  font-size: 12px;
  color: hsl(0, 72%, 51%);
  text-align: center;
}

.find-widget-vault-status {
  padding: 8px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  font-style: italic;
}

.find-widget-vault-notice {
  padding: 6px 12px;
  font-size: 11px;
  color: var(--text-secondary);
  border-top: 1px solid var(--search-panel-border);
}

.find-widget-vault-notice-warn {
  color: hsl(30, 90%, 50%);
}

/* ---- "In File" replace button (vault scope only) ---- */

.find-widget-replace-in-file {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 12px;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  background-color: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  transition: background-color 0.1s ease;
}

.find-widget-replace-in-file:hover {
  background-color: color-mix(in srgb, var(--text-primary) 8%, var(--bg-primary));
}

/* ---- Narrow viewport reflow (same breakpoint as existing rule) ---- */

@media (max-width: 400px) {
  .find-widget-scope-row {
    flex-wrap: wrap;
  }
  .find-widget-vault-results {
    max-height: 200px;
  }
}
```

---

## Tests to write: `tests/editor/find-widget-vault.test.ts`

Create this file in step_02. Extend it in later steps.

### Boilerplate

```typescript
import { describe, it, expect, vi } from "vitest";
import {
  postFilterResults,
  applyStringReplace,
  escapeRegex,
  buildWholeWordRegex,
} from "../../../src/editor/vault-search-utils";
import type { ContentSearchPayload } from "../../../src/lib/bridge";

// Helper: build a minimal ContentSearchPayload
function makePayload(
  matches: Array<{ path: string; title: string; lines: Array<{ lineText: string; lineNumber: number; columnStart: number }> }>
): ContentSearchPayload {
  return {
    results: matches.map((m) => ({
      path: m.path,
      title: m.title,
      matches: m.lines.map((l) => ({
        lineText: l.lineText,
        lineNumber: l.lineNumber,
        columnStart: l.columnStart,
      })),
    })),
    capped: false,
    skippedCount: 0,
  };
}
```

### Required test cases

**Test PF-1 — no post-filter options: payload returned as-is**
```
payload = makePayload([{ path: "/a.md", title: "A", lines: [{ lineText: "Hello World", lineNumber: 1, columnStart: 6 }] }])
result = postFilterResults(payload, "world", { matchCase: false, wholeWord: false })
assert result === payload  // same object reference
```

**Test PF-2 — matchCase: true discards case-mismatched results (FR-13, EC-10)**
```
payload = makePayload([
  { path: "/a.md", title: "A", lines: [
    { lineText: "Hello World", lineNumber: 1, columnStart: 6 },    // "World" ≠ "world"
    { lineText: "hello world", lineNumber: 2, columnStart: 6 },    // "world" matches
  ]},
])
result = postFilterResults(payload, "world", { matchCase: true, wholeWord: false })
assert result.results.length === 1
assert result.results[0].matches.length === 1
assert result.results[0].matches[0].lineNumber === 2
```

**Test PF-3 — matchCase: true removes file if all matches are filtered (EC-10)**
```
payload = makePayload([
  { path: "/a.md", title: "A", lines: [{ lineText: "Hello World", lineNumber: 1, columnStart: 6 }] },
])
result = postFilterResults(payload, "world", { matchCase: true, wholeWord: false })
assert result.results.length === 0
```

**Test PF-4 — wholeWord: true discards partial-word matches (FR-14, EC-11)**
```
payload = makePayload([
  { path: "/a.md", title: "A", lines: [
    { lineText: "concatenate the cat", lineNumber: 1, columnStart: 16 },  // "cat" in "cat" ✓
    { lineText: "concatenate this", lineNumber: 2, columnStart: 0 },       // "cat" inside "concatenate" ✗
  ]},
])
result = postFilterResults(payload, "cat", { matchCase: false, wholeWord: true })
assert result.results[0].matches.length === 1
assert result.results[0].matches[0].lineNumber === 1
```

**Test PF-5 — capped and skippedCount pass through unchanged**
```
payload = { results: [], capped: true, skippedCount: 3 }
result = postFilterResults(payload, "x", { matchCase: true, wholeWord: false })
assert result.capped === true
assert result.skippedCount === 3
```

**Test AR-1 — applyStringReplace replaces all occurrences (case-insensitive)**
```
result = applyStringReplace("hello world hello", "hello", "bye", { matchCase: false, wholeWord: false })
assert result.newContent === "bye world bye"
assert result.count === 2
```

**Test AR-2 — applyStringReplace respects matchCase: true**
```
result = applyStringReplace("Hello hello HELLO", "hello", "bye", { matchCase: true, wholeWord: false })
assert result.newContent === "Hello bye HELLO"
assert result.count === 1
```

**Test AR-3 — applyStringReplace respects wholeWord: true (EC-11)**
```
result = applyStringReplace("cat concatenate cat", "cat", "dog", { matchCase: false, wholeWord: true })
assert result.newContent === "dog concatenate dog"
assert result.count === 2
```

**Test AR-4 — applyStringReplace returns count 0 when find not present (EC-6)**
```
result = applyStringReplace("nothing here", "xyz", "abc", { matchCase: false, wholeWord: false })
assert result.count === 0
assert result.newContent === "nothing here"
```

**Test AR-5 — applyStringReplace with empty replace string performs deletion (EC-13)**
```
result = applyStringReplace("remove this word", "this ", "", { matchCase: false, wholeWord: false })
assert result.newContent === "remove word"
assert result.count === 1
```

**Test AR-6 — applyStringReplace with empty find string returns count 0**
```
result = applyStringReplace("content", "", "replace", { matchCase: false, wholeWord: false })
assert result.count === 0
assert result.newContent === "content"
```

**Test ER-1 — escapeRegex escapes all special regex characters (EC-14)**
```
assert escapeRegex("a.b*c?d+e^f$g(h)i[j]k{l}m|n\\o") ===
       "a\\.b\\*c\\?d\\+e\\^f\\$g\\(h\\)i\\[j\\]k\\{l\\}m\\|n\\\\o"
```

---

## Acceptance criteria for this step

- AC-S2-1: Opening the find widget with a vault active shows the scope toggle row.
- AC-S2-2: Selecting "Vault" scope and typing triggers a `searchVaultContent` call
  after the 150 ms debounce.
- AC-S2-3: Results appear as grouped file items in the results panel.
- AC-S2-4: Each file group shows title, match count, and up to 3 excerpts with
  highlighted matches.
- AC-S2-5: Switching back to "File" scope hides the results panel.
- AC-S2-6: No existing find-widget behaviour changes when scope is "file".
- AC-S2-7: All PF-* and AR-* and ER-* tests pass.
- AC-S2-8: Window size regression test still passes.

---

## After this step

```bash
npm run test:run -- tests/editor/find-widget-vault.test.ts
npm run test:run
```

All tests must pass. Proceed to step_03.
