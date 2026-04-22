---
title: "Step 02 — Files Mode"
last-updated: "2026-04-22"
review-cadence-days: 7
status: active
---

# Step 02 — Files Mode

## Goal and Scope

Implement the Files mode result builder and integrate it into the bar's render pipeline. At the end of this step:

- Opening the bar via `Cmd-P` (or `openBar("files")`) shows Open Tabs immediately and workspace `.md` files asynchronously
- Open tabs are never duplicated in the Files section
- The 200-entry cap is enforced with a visible notice
- All error states (no file open, invoke failure, empty workspace) render appropriate notices
- The existing Commands mode behavior is unchanged

---

## Files to Create

### `src/plugins/command-bar/files-mode.ts`

This module is imported by `command-bar.plugin.ts` and bundled inline by Rollup. It must contain only pure functions — no window global access. All globals are passed in via dependency injection.

```typescript
// ── Types ──────────────────────────────────────────────────────────────────

/** A tab entry from __MARKABLE_TAB_MANAGER__.getAllTabs() */
export interface TabEntry {
  id: string;
  filePath: string | null;
  title: string;
}

/** Dependencies for buildFilesResults() */
export interface FilesModeBuilderDeps {
  tabs: TabEntry[];
  workspaceFiles: string[];          // absolute paths from list_md_files
  workspaceLoadState: "loading" | "loaded" | "error" | "no-workspace";
  workspaceError?: string;
  openTab: (tabId: string) => void;
  openFile: (path: string) => void;
}

/** Result category for files mode */
export type FilesResultCategory = "open-tabs" | "workspace-files";

/** A files-mode result row */
export interface FilesResult {
  id: string;
  category: FilesResultCategory;
  label: string;        // filename
  sublabel: string;     // abbreviated directory path
  filePath: string | null;
  isTab: boolean;
  tabId?: string;
  dimmed: boolean;
  action: () => void;
  _matchPositions?: number[];
}

// ── Constants ──────────────────────────────────────────────────────────────

export const FILES_CAP = 200;

export const FILES_SECTION_LABELS: Record<FilesResultCategory, string> = {
  "open-tabs":       "Open Tabs",
  "workspace-files": "Files",
};

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Abbreviate an absolute path for display:
 * /Users/<username>/foo/bar/ → ~/foo/bar/
 */
export function abbreviatePath(fullPath: string): string {
  return fullPath.replace(/^\/Users\/[^/]+\//, "~/");
}

/**
 * Extract the basename from an absolute path.
 */
export function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

/**
 * Extract the directory portion of a path (with trailing slash).
 */
export function dirname(path: string): string {
  const base = basename(path);
  return path.slice(0, path.length - base.length);
}

/**
 * Build the complete Files mode result set.
 *
 * Algorithm:
 * 1. Build Open Tabs section from tabs (all tabs with title, even untitled).
 * 2. Build workspace Files section from workspaceFiles, excluding any
 *    path that is already represented by an open tab (deduplication, EC-06).
 * 3. Cap workspace files at FILES_CAP.
 *
 * Returns a FilesResult[] array where tabs come first.
 * The caller is responsible for inserting section headers and notice rows.
 */
export function buildFilesResults(deps: FilesModeBuilderDeps): FilesResult[] {
  const { tabs, workspaceFiles, openTab, openFile } = deps;
  const results: FilesResult[] = [];

  // Build set of open tab file paths for deduplication
  const openPaths = new Set<string>(
    tabs.flatMap((t) => (t.filePath ? [t.filePath] : []))
  );

  // Open Tabs section
  for (const tab of tabs) {
    const label = tab.title || basename(tab.filePath ?? "") || "Untitled";
    const sublabel = tab.filePath ? abbreviatePath(dirname(tab.filePath)) : "";
    const tabId = tab.id;
    results.push({
      id: `tab:${tab.id}`,
      category: "open-tabs",
      label,
      sublabel,
      filePath: tab.filePath,
      isTab: true,
      tabId,
      dimmed: false,
      action: () => openTab(tabId),
    });
  }

  // Workspace Files section (deduplicated, capped)
  const dedupedFiles = workspaceFiles.filter((p) => !openPaths.has(p));
  const cappedFiles = dedupedFiles.slice(0, FILES_CAP);

  for (const filePath of cappedFiles) {
    const label = basename(filePath);
    const sublabel = abbreviatePath(dirname(filePath));
    const fp = filePath;
    results.push({
      id: `file:${filePath}`,
      category: "workspace-files",
      label,
      sublabel,
      filePath,
      isTab: false,
      dimmed: false,
      action: () => openFile(fp),
    });
  }

  return results;
}

/**
 * Returns the total count of workspace files before the cap (for the notice).
 * Caller: totalWorkspaceCount(workspaceFiles, openPaths) > FILES_CAP
 */
export function countWorkspaceBeforeCap(
  workspaceFiles: string[],
  openTabPaths: Set<string>,
): number {
  return workspaceFiles.filter((p) => !openTabPaths.has(p)).length;
}
```

---

## Files to Modify

### `src/plugins/command-bar/command-bar.plugin.ts`

1. **Import `files-mode.ts`** at the top of the plugin file (bundled by Rollup, not a runtime import):
   ```typescript
   import {
     buildFilesResults,
     countWorkspaceBeforeCap,
     abbreviatePath,
     FILES_CAP,
     type FilesResult,
     type TabEntry,
     type FilesModeBuilderDeps,
   } from "./files-mode";
   ```

2. **Add async Files mode state variables** (module-level):
   ```typescript
   let _fileModeResults: FilesResult[] = [];
   let _fileListLoaded: boolean = false;
   let _fileListError: boolean = false;
   let _totalWorkspaceCount: number = 0;
   ```

3. **Add `fetchWorkspaceFiles()` async function**:
   ```typescript
   async function fetchWorkspaceFiles(generation: number): Promise<void> {
     const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

     if (!currentFile) {
       // EC-01/EC-02: no workspace directory available
       if (_openGeneration !== generation) return;
       _fileListLoaded = true;
       _fileListError = false;
       refreshFilesDisplay();
       return;
     }

     // Resolve workspace directory (absolute path, not ~/ abbreviated — EC-32)
     const parts = currentFile.split("/");
     parts.pop(); // remove filename
     const workspaceDir = parts.join("/") || "/";

     let workspaceFiles: string[] = [];
     try {
       workspaceFiles = await (window as any).__TAURI_INTERNALS__.invoke(
         "list_md_files",
         { dir: workspaceDir }
       );
     } catch (err) {
       // EC-03: invoke failed
       if (_openGeneration !== generation) return; // EC-28: stale
       _fileListLoaded = true;
       _fileListError = true;
       refreshFilesDisplay();
       return;
     }

     // EC-28: check generation after await — bar may have been closed/mode-switched
     if (_openGeneration !== generation) return;

     const tabs = getOpenTabs();
     const openPaths = new Set<string>(tabs.flatMap((t) => (t.filePath ? [t.filePath] : [])));
     _totalWorkspaceCount = countWorkspaceBeforeCap(workspaceFiles, openPaths);

     _fileModeResults = buildFilesResults({
       tabs,
       workspaceFiles,
       workspaceLoadState: "loaded",
       openTab: switchToTab,
       openFile: openFileInTab,
     });

     _fileListLoaded = true;
     _fileListError = false;

     if (_mode === "files" && _isOpen) {
       refreshFilesDisplay();
     }
   }
   ```

4. **Add `getOpenTabs()` helper** (reads from global):
   ```typescript
   function getOpenTabs(): TabEntry[] {
     const tm = (window as any).__MARKABLE_TAB_MANAGER__;
     if (!tm || typeof tm.getAllTabs !== "function") return [];
     return tm.getAllTabs() as TabEntry[];
   }
   ```

5. **Add `switchToTab()` and `openFileInTab()` helpers** (close bar then delegate):
   ```typescript
   function switchToTab(tabId: string): void {
     const tm = (window as any).__MARKABLE_TAB_MANAGER__;
     if (tm && typeof tm.switchToTab === "function") tm.switchToTab(tabId);
   }

   function openFileInTab(filePath: string): void {
     const tm = (window as any).__MARKABLE_TAB_MANAGER__;
     if (tm && typeof tm.openFile === "function") void tm.openFile(filePath);
     else if (tm && typeof tm.openFileInTab === "function") void tm.openFileInTab(filePath);
   }
   ```

6. **Add `refreshFilesDisplay()` function** — merges Open Tabs + loaded workspace files into `_allResults` and re-renders:
   ```typescript
   function refreshFilesDisplay(): void {
     if (!_isOpen || _mode !== "files" || !_resultsEl || !_inputEl) return;

     const tabs = getOpenTabs();
     const currentFile: string | null = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;

     if (_fileListLoaded && !_fileListError) {
       _allResults = _fileModeResults.length > 0 || tabs.length > 0
         ? (_fileModeResults as any as CommandBarResult[])
         : [];
     } else {
       // Show only tabs while loading or on error
       _allResults = buildFilesResults({
         tabs,
         workspaceFiles: [],
         workspaceLoadState: _fileListError ? "error" : (_fileListLoaded ? "no-workspace" : "loading"),
         openTab: switchToTab,
         openFile: openFileInTab,
       }) as any as CommandBarResult[];
     }

     filterAndRender(_inputEl.value.trim());
   }
   ```

7. **Update `openBar()` to initialize and trigger Files mode fetch**:
   ```typescript
   // In openBar(), after setMode(targetMode) and openCommandBar():
   if (targetMode === "files") {
     _fileListLoaded = false;
     _fileListError = false;
     _fileModeResults = [];
     _totalWorkspaceCount = 0;

     // Show tabs immediately (phase 1)
     const tabs = getOpenTabs();
     _allResults = buildFilesResults({
       tabs,
       workspaceFiles: [],
       workspaceLoadState: "loading",
       openTab: switchToTab,
       openFile: openFileInTab,
     }) as any as CommandBarResult[];

     // Start async file scan (phase 2)
     void fetchWorkspaceFiles(_openGeneration);
   }
   ```

8. **Update `renderResults()` to render Files mode notices and section headers**:

   The existing `renderResults()` uses `CATEGORY_LABELS` keyed on `ResultCategory`. Files mode results use `FilesResultCategory` which is different. The cleanest approach is to add an overloaded rendering path triggered when `_mode === "files"`:

   Add `renderFilesResults()` as a separate function that handles the `FilesResult[]` type, including the loading notice, error notice, workspace-empty notice, and cap notice. The main `renderResults()` is unchanged (it handles commands/headings/recent categories only).

   ```typescript
   export function renderFilesResults(
     container: HTMLElement,
     results: FilesResult[],
     query: string,
     selectedId: string | null,
     loadState: "loading" | "loaded" | "error" | "no-workspace",
     totalWorkspaceCount: number,
     noFileOpen: boolean,
   ): void {
     container.innerHTML = "";

     // Loading state (phase 1 while async fetch is in-flight)
     // Note: Open Tabs results are included even during loading

     let lastCat: FilesResultCategory | null = null;
     let resultIndex = 0;

     for (const result of results) {
       if (result.category !== lastCat) {
         lastCat = result.category;
         const header = document.createElement("div");
         header.className = "cb-section-header";
         header.textContent = FILES_SECTION_LABELS[result.category];
         container.appendChild(header);
       }
       // ... row construction (same pattern as renderResults) ...
     }

     // After results: add status notices
     if (loadState === "loading") {
       const notice = document.createElement("div");
       notice.className = "cb-loading";
       notice.textContent = "Loading…";
       container.appendChild(notice);
     } else if (loadState === "error") {
       const notice = makeNotice("Could not load workspace files");
       container.appendChild(notice);
     } else if (noFileOpen && results.filter(r => r.category === "workspace-files").length === 0) {
       const notice = makeNotice("No workspace — open a file first");
       container.appendChild(notice);
     } else if (results.filter(r => r.category === "workspace-files").length === 0 && loadState === "loaded") {
       const notice = makeNotice("No markdown files in workspace");
       container.appendChild(notice);
     }

     // Cap notice (EC-05)
     if (totalWorkspaceCount > FILES_CAP && loadState === "loaded") {
       const notice = makeNotice(`Showing ${FILES_CAP} of ${totalWorkspaceCount} files — type to filter`);
       container.appendChild(notice);
     }
   }

   function makeNotice(text: string): HTMLElement {
     const el = document.createElement("div");
     el.className = "cb-notice";
     el.textContent = text;
     return el;
   }
   ```

9. **Update `filterAndRender()`** to branch on `_mode`:
   ```typescript
   function filterAndRender(query: string): void {
     if (!_resultsEl || !_inputEl) return;

     if (_mode === "files") {
       filterAndRenderFiles(query);
       return;
     }

     // existing commands/keybindings path ...
   }

   function filterAndRenderFiles(query: string): void {
     if (!_resultsEl) return;
     const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ ?? null;
     const noFileOpen = currentFile === null;

     let results = _fileModeResults;

     // Add open-tab results for phase 1 (tabs are always present)
     // _fileModeResults is rebuilt by refreshFilesDisplay; query filtering done here

     if (query === "") {
       _visibleResults = results as any;
       _selectedId = firstSelectableId(_visibleResults);
     } else {
       // Apply fuzzy ranker to both sections independently
       // ... same fuzzy-match pipeline as filterAndRender ...
     }

     const loadState = !_fileListLoaded ? "loading" : _fileListError ? "error" : "loaded";
     renderFilesResults(
       _resultsEl,
       _visibleResults as any,
       query,
       _selectedId,
       noFileOpen && !_fileListLoaded ? "no-workspace" : loadState,
       _totalWorkspaceCount,
       noFileOpen,
     );
     if (_inputEl) updateAriaActiveDescendant(_inputEl, _selectedId);
     scrollSelectedIntoView(_resultsEl);
   }
   ```

### CSS additions to `CSS_TEXT`

```css
.cb-loading {
  padding: 16px 14px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary);
  user-select: none;
  font-style: italic;
}

.cb-notice {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--text-secondary);
  user-select: none;
  border-top: 1px solid var(--border-color);
}
```

---

## Interfaces and Types to Export

```typescript
// From files-mode.ts (all exported for testing)
export type FilesResultCategory = "open-tabs" | "workspace-files";
export interface TabEntry { id: string; filePath: string | null; title: string; }
export interface FilesResult { ... }
export interface FilesModeBuilderDeps { ... }
export function buildFilesResults(deps: FilesModeBuilderDeps): FilesResult[];
export function countWorkspaceBeforeCap(...): number;
export function abbreviatePath(fullPath: string): string;
export function basename(path: string): string;
export const FILES_CAP: number;
export const FILES_SECTION_LABELS: Record<FilesResultCategory, string>;

// From command-bar.plugin.ts (for testing)
export function renderFilesResults(...): void;
```

---

## TDD Anchors

New describe block: `"Step 02 — Files Mode"`:

```
// buildFilesResults pure function tests
it("returns open tabs in 'open-tabs' category")
it("returns workspace files in 'workspace-files' category")
it("EC-06: a file already open as a tab does not appear in workspace-files section")
it("caps workspace files at FILES_CAP (200)")
it("EC-05: countWorkspaceBeforeCap returns the count before the cap")
it("EC-02: returns empty array when tabs is empty and workspaceFiles is empty")
it("EC-01: returns only open-tabs results when workspaceFiles is empty")
it("abbreviatePath abbreviates /Users/foo/bar to ~/bar")
it("abbreviatePath does not modify paths not starting with /Users/")
it("basename extracts final path component")

// renderFilesResults DOM tests
it("renders 'Open Tabs' section header")
it("renders 'Files' section header")
it("renders 'Loading…' notice when loadState is 'loading'")
it("renders 'Could not load workspace files' notice when loadState is 'error' (EC-03)")
it("renders 'No workspace — open a file first' when noFileOpen=true and no workspace files (EC-01)")
it("renders 'No markdown files in workspace' when workspace is empty (EC-04)")
it("renders cap notice when totalWorkspaceCount > FILES_CAP (EC-05)")
it("does not render cap notice when totalWorkspaceCount <= FILES_CAP")
it("EC-04: does not crash when workspaceFiles is empty")

// Integration: EC-28 (stale generation)
it("EC-28: fetchWorkspaceFiles does not update DOM if generation has changed")
```

---

## Definition of Done

- [ ] `src/plugins/command-bar/files-mode.ts` exists with all exported pure functions
- [ ] `buildFilesResults()` correctly separates open tabs from workspace files
- [ ] Deduplication of open-tab paths from workspace files is correct (EC-06)
- [ ] 200-entry cap is enforced; notice is shown when cap is exceeded (EC-05)
- [ ] Opening in Files mode shows Open Tabs immediately
- [ ] Async fetch triggers after bar opens; results update when fetch resolves
- [ ] EC-01, EC-02, EC-03, EC-04, EC-07 all render correct notices without crashing
- [ ] EC-28: stale-generation guard prevents DOM updates after bar closes or mode switches
- [ ] EC-32: workspace dir is resolved to absolute path (no `~/` passed to invoke)
- [ ] All Files mode EC notices are tested
- [ ] All 84 existing tests still pass
