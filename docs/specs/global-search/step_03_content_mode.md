---
title: "Step 03 — Add 'content' BarMode, /prefix Switch, Result Renderer"
last-updated: "2026-04-28"
review-cadence-days: 14
status: active
---

# Step 03 — Add `"content"` BarMode, `/` Prefix Switch, Result Renderer

## Goal

Extend `command-bar.plugin.ts` to support a fourth operating mode: `"content"` (content
search). This step covers:

1. Extending the `BarMode` type and all `Record<BarMode, ...>` constants (FR-5, NFR-5).
2. Adding the `/` prefix switch in `onInput()` (FR-6, EC-15, EC-21).
3. Handling the Enter key in content mode to invoke `search_vault_content` (FR-9).
4. Rendering content search results grouped by file (FR-10, FR-11).
5. No-vault and empty-query guard states (FR-8, FR-16, EC-3).
6. All new CSS using CSS variables (NFR-6).
7. The Tab-key mode cycle order update (FR-5, AD-GS-07).

This step depends on step_01 (the `search_vault_content` Tauri command must exist) and
step_02 (vault globals integration pattern is established).

---

## Files to Change

| File | Change |
|------|--------|
| `src/plugins/command-bar/command-bar.plugin.ts` | All changes described below |

---

## 1. Extend `BarMode` type (line 66)

```typescript
// Before:
export type BarMode = "files" | "commands" | "keybindings";

// After:
export type BarMode = "files" | "commands" | "keybindings" | "content";
```

---

## 2. Extend all `Record<BarMode, ...>` constants

All four constants must gain a `"content"` entry. The TypeScript compiler enforces
exhaustiveness because the types are `Record<BarMode, string>`.

### `MODE_PLACEHOLDERS` (around line 214)

```typescript
const MODE_PLACEHOLDERS: Record<BarMode, string> = {
  files:       "Search vault files…",   // updated in step_02
  commands:    "Type a command or search headings…",
  keybindings: "Search actions to assign shortcut…",
  content:     "Search file contents…",
};
```

### `MODE_FOOTER_HINTS` (around line 224)

```typescript
const MODE_FOOTER_HINTS: Record<BarMode, string> = {
  files:       "Enter to open  ·  Esc to close",
  commands:    "Enter to run  ·  Esc to close",
  keybindings: "Enter to assign shortcut  ·  Esc to close",
  content:     "Enter to search  ·  Esc to close",
};
```

### `MODE_BADGE_LABELS` (around line 233)

```typescript
const MODE_BADGE_LABELS: Record<BarMode, string> = {
  files:       "Files",
  commands:    "Commands",
  keybindings: "Keybindings",
  content:     "Content",
};
```

### `MODE_CYCLE` (around line 243)

```typescript
// Before:
const MODE_CYCLE: BarMode[] = ["commands", "files", "keybindings"];

// After (AD-GS-07 — content appended at end):
const MODE_CYCLE: BarMode[] = ["commands", "files", "keybindings", "content"];
```

### `MODE_TAB_SHORTCUTS` (around line 250)

```typescript
const MODE_TAB_SHORTCUTS: Record<BarMode, string> = {
  files:       "⌘P",
  commands:    "⌘⇧P",
  keybindings: "⌘⇧K",
  content:     "",        // no dedicated shortcut — accessed via '/' prefix only (FR-5)
};
```

---

## 3. Add module-level state for content mode

Add these two module-level variables near the existing `_openGeneration` declaration.
Placement: immediately after the `let _openGeneration = 0;` line.

```typescript
/** Incremented each time a new content search is launched. Used to discard stale
 *  async results (EC-12, EC-13, EC-14). Separate from _openGeneration (AD-GS-03). */
let _contentSearchGeneration = 0;

/** True while a content search Rust call is in flight. Prevents duplicate launches. */
let _contentSearchInFlight = false;
```

---

## 4. Extend `onInput()` with `/` prefix handler (FR-6, EC-15, EC-21)

Location: inside `onInput()`, in the prefix-switching block (around line 3135).

Insert the following block immediately after the `#` keybindings prefix handler and before
the final `filterAndRender(raw.trim())` call:

```typescript
  // FR-6: '/' as the sole character in files mode → switch to content mode.
  // EC-21: once already in content mode, '/' is a normal search character.
  // EC-15: '/' within a longer query (e.g. "design/") does NOT switch modes.
  if (_mode === "files" && raw === "/") {
    setMode("content");
    this.value = "";
    _contentSearchGeneration++; // reset any in-flight from previous mode
    _contentSearchInFlight = false;
    renderContentResults(null, "");
    return;
  }
```

Note: `renderContentResults(null, "")` renders the initial empty state for content mode
(the footer hint is shown; no results list). The `null` first argument signals "no results
yet" to the renderer (see section 6 below).

---

## 5. Handle Enter in content mode

Location: `onOverlayKeydown()`, inside the `case "Enter":` branch (around line 3263).

The existing Enter handler calls `activateSelected()`, which works for files and commands
mode. Content mode intercepts Enter before `activateSelected()` and performs the search
instead.

Replace the existing `case "Enter":` block with:

```typescript
    case "Enter":
      e.preventDefault();
      e.stopPropagation();
      if (_mode === "content") {
        void handleContentSearchEnter();
      } else {
        activateSelected();
      }
      break;
```

---

## 6. Add `handleContentSearchEnter()` function

Add this function as a module-level function, near `fetchWorkspaceFiles()` (around line 2567),
in the "Files mode helpers" section. It is logically separate from files mode but uses the
same globals pattern.

```typescript
/**
 * Called when the user presses Enter in content mode.
 *
 * Guards:
 *   - EC-16: empty/whitespace query → show hint, no Rust call.
 *   - EC-3:  no active vault → show notice, no Rust call.
 *   - EC-1:  vault active but index null → show "index still building" notice.
 *   - EC-12: a search is already in flight → no-op (generation counter prevents stale results).
 *
 * On success: renders grouped results via renderContentResults().
 * On error:   renders an inline error notice.
 */
async function handleContentSearchEnter(): Promise<void> {
  if (!_inputEl || !_resultsEl) return;

  const query = _inputEl.value.trim();

  // FR-16: empty query guard.
  if (!query) {
    renderContentNotice("Enter a search term");
    return;
  }

  // EC-3: no vault open.
  const vm = (window as any).__MARKABLE_VAULT_MANAGER__;
  const activeVault = (vm && typeof vm.getActiveVault === "function")
    ? vm.getActiveVault()
    : null;
  if (!activeVault) {
    renderContentNotice("No vault open — content search requires a vault");
    return;
  }

  // EC-1: vault active but index still building — root_paths come from activeVault.
  const rootPaths: string[] = activeVault.rootPaths ?? [];
  const excludePatterns: string[] = activeVault.excludePatterns ?? [];

  // EC-12: prevent duplicate in-flight calls.
  if (_contentSearchInFlight) return;

  // Capture generation before the await.
  _contentSearchGeneration++;
  const gen = _contentSearchGeneration;
  _contentSearchInFlight = true;

  // Show loading state.
  renderContentLoading();

  let payload: any;
  try {
    payload = await (window as any).__TAURI_INTERNALS__.invoke(
      "search_vault_content",
      {
        root_paths: rootPaths,
        exclude_patterns: excludePatterns,
        query,
        max_results: 50,
      },
    );
  } catch (err) {
    // Only update UI if this generation is still current (EC-13, EC-14).
    if (_contentSearchGeneration !== gen || !_isOpen || _mode !== "content") {
      _contentSearchInFlight = false;
      return;
    }
    _contentSearchInFlight = false;
    renderContentNotice(`Search failed: ${String(err)}`);
    return;
  }

  _contentSearchInFlight = false;

  // EC-12 / EC-13 / EC-14: discard stale results.
  if (_contentSearchGeneration !== gen || !_isOpen || _mode !== "content") return;

  renderContentResults(payload, query);
}
```

---

## 7. Add `renderContentResults()`, `renderContentNotice()`, and `renderContentLoading()`

Add these three functions as module-level functions immediately after `renderFilesResults()`
(which currently ends around line 2750 in the file). They all write to `_resultsEl` directly.

### 7a. `renderContentNotice()`

```typescript
/**
 * Render a single informational notice row in the content mode results area.
 * Used for: no-vault state, empty query, error state, no-results state.
 */
function renderContentNotice(message: string): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "cb-content-notice";
  row.textContent = message;
  _resultsEl.appendChild(row);
  _visibleResults = [];
  _selectedId = null;
}
```

### 7b. `renderContentLoading()`

```typescript
/**
 * Render a loading indicator in the content mode results area.
 * Replaces any previous results while the Rust search call is in progress.
 */
function renderContentLoading(): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  const row = document.createElement("div");
  row.className = "cb-content-notice";
  row.textContent = "Searching…";
  _resultsEl.appendChild(row);
  _visibleResults = [];
  _selectedId = null;
}
```

### 7c. `renderContentResults()`

```typescript
/**
 * Render content search results grouped by file.
 *
 * @param payload - The ContentSearchPayload from search_vault_content, or null to
 *                  render the initial empty state (footer hint, no rows).
 * @param query   - The query string used for match highlighting.
 *
 * Layout per FileContentResult (FR-10):
 *   1. Clickable file-header row  (.cb-result.cb-result--content-header)
 *      Shows the file title; data-id set for click routing.
 *   2. Up to 3 excerpt rows (.cb-result.cb-result--content-excerpt)
 *      Each shows "line_number: line_text" with the matched substring bolded.
 *      data-id set so clicks open the same file (FR-11).
 *   3. "N more matches" non-clickable row (.cb-result--content-more) when
 *      matches.length > 3.
 *
 * Notices prepended when relevant (EC-7, EC-8):
 *   - capped === true: "Showing matches in the first N files — refine your query to see more"
 *   - skipped_count > 0: "N files could not be searched"
 *
 * EC-6 (no results): "No results for 'query'" shown as a notice row.
 * EC-5 (empty vault): same as EC-6.
 */
function renderContentResults(payload: any | null, query: string): void {
  if (!_resultsEl) return;
  _resultsEl.innerHTML = "";
  _visibleResults = [];
  _selectedId = null;

  // Initial empty state (null payload = just switched into content mode).
  if (payload === null) return;

  const results: any[] = payload.results ?? [];
  const capped: boolean = payload.capped ?? false;
  const skippedCount: number = payload.skippedCount ?? 0;

  // EC-7: cap notice.
  if (capped) {
    const capRow = document.createElement("div");
    capRow.className = "cb-content-notice cb-content-notice--warning";
    capRow.textContent = `Showing matches in the first ${results.length} files — refine your query to see more`;
    _resultsEl.appendChild(capRow);
  }

  // EC-8: skipped files notice.
  if (skippedCount > 0) {
    const skipRow = document.createElement("div");
    skipRow.className = "cb-content-notice cb-content-notice--warning";
    skipRow.textContent = `${skippedCount} file${skippedCount === 1 ? "" : "s"} could not be searched`;
    _resultsEl.appendChild(skipRow);
  }

  // EC-5 / EC-6: no results.
  if (results.length === 0) {
    const emptyRow = document.createElement("div");
    emptyRow.className = "cb-content-notice";
    emptyRow.textContent = `No results for "${query}"`;
    _resultsEl.appendChild(emptyRow);
    return;
  }

  // Render one group per FileContentResult.
  for (const fileResult of results) {
    const filePath: string = fileResult.path ?? "";
    const title: string = fileResult.title || filePath.split("/").pop() || "(untitled)";
    const matches: any[] = fileResult.matches ?? [];

    // Unique id for this file group (header + excerpts share the same action).
    const fileId = `content-file:${filePath}`;

    // Action: open the file and close the bar (FR-11).
    const fp = filePath;
    const openAction = (): void => {
      openFileInTab(fp);
      closeBar();
    };

    // 1. File header row.
    const headerRow = document.createElement("div");
    headerRow.className = "cb-result cb-result--content-header";
    headerRow.dataset.id = fileId;
    headerRow.setAttribute("role", "option");
    headerRow.textContent = title;
    headerRow.addEventListener("click", openAction);
    _resultsEl.appendChild(headerRow);

    // Register in _visibleResults so arrow-key navigation works.
    _visibleResults.push({
      id: fileId,
      category: "recent" as any, // reuse existing type; content mode ignores category
      label: title,
      dimmed: false,
      action: openAction,
    });

    // 2. Up to 3 excerpt rows.
    const excerptCount = Math.min(matches.length, 3);
    for (let i = 0; i < excerptCount; i++) {
      const match = matches[i];
      const lineNum: number = match.lineNumber ?? 0;
      const lineText: string = match.lineText ?? "";
      const colStart: number = match.columnStart ?? 0;
      const queryLen = query.length;

      const excerptId = `content-excerpt:${filePath}:${lineNum}`;

      const excerptRow = document.createElement("div");
      excerptRow.className = "cb-result cb-result--content-excerpt";
      excerptRow.dataset.id = excerptId;
      excerptRow.setAttribute("role", "option");
      excerptRow.addEventListener("click", openAction);

      // Build highlighted line text: text before match + <strong>match</strong> + rest.
      const before = lineText.slice(0, colStart);
      const matched = lineText.slice(colStart, colStart + queryLen);
      const after = lineText.slice(colStart + queryLen);

      const lineNumSpan = document.createElement("span");
      lineNumSpan.className = "cb-content-excerpt-linenum";
      lineNumSpan.textContent = `${lineNum}: `;

      const textSpan = document.createElement("span");
      textSpan.className = "cb-content-excerpt-text";
      // Construct DOM nodes to avoid innerHTML XSS risk.
      textSpan.appendChild(document.createTextNode(before));
      const strong = document.createElement("strong");
      strong.textContent = matched;
      textSpan.appendChild(strong);
      textSpan.appendChild(document.createTextNode(after));

      excerptRow.appendChild(lineNumSpan);
      excerptRow.appendChild(textSpan);
      _resultsEl.appendChild(excerptRow);

      _visibleResults.push({
        id: excerptId,
        category: "recent" as any,
        label: lineText,
        dimmed: false,
        action: openAction,
      });
    }

    // 3. "N more matches" row (non-clickable, no data-id).
    if (matches.length > 3) {
      const moreRow = document.createElement("div");
      moreRow.className = "cb-result--content-more";
      moreRow.textContent = `${matches.length - 3} more match${matches.length - 3 === 1 ? "" : "es"}`;
      _resultsEl.appendChild(moreRow);
    }
  }

  // Set initial selection to the first result.
  if (_visibleResults.length > 0 && _inputEl) {
    _selectedId = _visibleResults[0].id;
    updateAriaActiveDescendant(_inputEl, _selectedId);
  }
}
```

---

## 8. Add CSS for content mode rows

Append the following CSS to the `CSS_TEXT` constant string, inside the backtick template
literal, before the closing backtick. All values use CSS variables (NFR-6).

```css
/* ── Content mode rows ───────────────────────────────── */

.cb-result--content-header {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--text-primary);
  border-top: 1px solid var(--border-color);
  margin-top: 4px;
  padding-top: 8px;
}

.cb-result--content-header:first-child {
  border-top: none;
  margin-top: 0;
}

.cb-result--content-excerpt {
  padding-left: 24px;
  font-size: 12.5px;
  color: var(--text-secondary);
}

.cb-result--content-excerpt strong {
  color: var(--accent-color);
  font-weight: 600;
}

.cb-content-excerpt-linenum {
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
  margin-right: 4px;
  opacity: 0.6;
  flex-shrink: 0;
}

.cb-content-excerpt-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cb-result--content-more {
  padding: 2px 24px 6px;
  font-size: 11.5px;
  color: var(--text-secondary);
  opacity: 0.7;
  cursor: default;
  user-select: none;
}

.cb-content-notice {
  padding: 10px 14px;
  font-size: 13px;
  color: var(--text-secondary);
}

.cb-content-notice--warning {
  color: var(--accent-color);
  font-size: 12px;
}
```

---

## 9. Guard `onResultHover` and `onResultClick` for content mode

The existing `onResultHover` function (around line 3317) has an explicit branch for
`_mode === "keybindings"` and `_mode === "files"`, with a fallback to `renderResults()`.
Content mode result rows use `_visibleResults` in the same generic shape (with `action`
closures), so `renderResults()` would be called for content mode. However, content mode
renders custom DOM (not the standard `.cb-result` template), so calling `renderResults()`
on hover would wipe the content-mode DOM.

Add a content mode branch immediately before the final `else` in `onResultHover`:

```typescript
  } else if (_mode === "content") {
    // Content mode: update selection highlight only; do not re-render full DOM.
    const prevSelected = _resultsEl?.querySelector(".cb-result--selected");
    prevSelected?.classList.remove("cb-result--selected");
    const newSelected = _resultsEl?.querySelector(`[data-id="${_selectedId}"]`);
    newSelected?.classList.add("cb-result--selected");
    updateAriaActiveDescendant(_inputEl, _selectedId);
  } else {
    renderResults(_resultsEl, _visibleResults, _inputEl.value, _selectedId);
  }
```

The same defensive guard is needed in `onResultClick` for content mode. Review the existing
`onResultClick` function (around line 3289): it calls `closeBar()` when
`_mode !== "keybindings"`. This is correct for content mode — content results do call
`closeBar()` already inside their `openAction` closure. However, to prevent double-close,
guard the outer `closeBar()` call:

```typescript
// Before:
  if (_mode !== "keybindings") closeBar();
  result.action();

// After:
  if (_mode !== "keybindings" && _mode !== "content") closeBar();
  result.action();
```

This is safe because `openAction` already calls `closeBar()` explicitly for content results.

---

## 10. Reset content mode state in `closeBar()`

Add these two resets inside `closeBar()`, alongside the existing `_mode = "files"` reset
(around line 3090):

```typescript
  _contentSearchGeneration++; // invalidate any in-flight content search (EC-12, EC-13)
  _contentSearchInFlight = false;
```

---

## Acceptance Criteria

- [ ] TypeScript compiler reports no errors. The `Record<BarMode, string>` types are
      exhaustive with the new `"content"` key.
- [ ] Typing `/` in files mode switches to content mode and clears the input.
- [ ] Typing `design/` in files mode does NOT switch to content mode (EC-15).
- [ ] Once in content mode, typing `/` is treated as a normal search character (EC-21).
- [ ] Pressing Backspace on an empty input in content mode returns to files mode (FR-7).
- [ ] With no vault active, pressing Enter in content mode shows the notice message
      "No vault open — content search requires a vault" (EC-3).
- [ ] With an empty query, pressing Enter shows "Enter a search term" (FR-16).
- [ ] With a vault active and a non-empty query, pressing Enter shows "Searching…" then
      results grouped by file.
- [ ] Each file group shows: title header, up to 3 excerpt rows, "N more matches" row.
- [ ] Matched substrings are visually highlighted in excerpt rows.
- [ ] Clicking any row (header or excerpt) opens the file and closes the bar (FR-11).
- [ ] Pressing Enter while a previous search is in flight does nothing (EC-12).
- [ ] `closeBar()` resets content mode state and increments `_contentSearchGeneration`.
- [ ] All new CSS classes use `var(--...)` CSS variables; no hardcoded hex values (NFR-6).
- [ ] The Tab-key mode cycle includes `"content"` at the end.
- [ ] `npm run test:run` passes.

---

## Test Requirements

Tests for this step are specified in `step_04_tests.md` under "Group C: content mode".
