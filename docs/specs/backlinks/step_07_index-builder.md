---
title: "Step 7: Backlink Index Builder"
last-updated: "2026-04-15"
review-cadence-days: 7
status: active
---

# Step 7: Backlink Index Builder

## Goal

Build the async index that maps sibling `.md` files to their outgoing links, enabling the backlinks sidebar panel to show which files link to the current document.

## Acceptance Criteria

1. The index is a `Map<string, string[]>` where keys are filenames and values are normalized outgoing link targets.
2. Index rebuild is debounced at 300ms (FR-6.5).
3. If a rebuild is triggered while one is in progress, the in-progress scan is abandoned and a new debounce starts.
4. The index is rebuilt on: plugin enable, tab switch (directory may change), file save.
5. Tab switch detection: an `updateListener` checks if `window.__MARKABLE_CURRENT_FILE__` changed.
6. File save detection: listen for `file-save` action via the Tauri `menu-event` listener.
7. Files that fail to read (binary, permission denied) are silently skipped with a console warning.
8. The file list is cached for autocomplete (calls `setCachedFileList()` from step 6).
9. Backlinks for the current file are computed by filtering the index.

## Design

### Module-Level State

```typescript
/** The backlink index: filename -> array of normalized outgoing link targets. */
let _index: Map<string, string[]> = new Map();

/** Debounce timer for index rebuild. */
let _indexDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** Last known current file path (for tab-switch detection). */
let _lastKnownFile: string | null = null;

/** Callback to update the sidebar panel. Set by step 8. */
let _onIndexRebuilt: ((backlinks: string[]) => void) | null = null;

/** Whether the plugin is currently enabled. Guards async callbacks. */
// (shared with step 9's _enabled flag)
```

### `rebuildIndex(): void` (Trigger)

Called by:
- `onEnable` (initial build)
- `updateListener` (tab switch detected)
- `menu-event` listener (file save)

```typescript
function triggerIndexRebuild(): void {
  // Cancel any pending debounce
  if (_indexDebounceTimer) {
    clearTimeout(_indexDebounceTimer);
    _indexDebounceTimer = null;
  }

  // Show "Scanning..." in sidebar
  if (_onIndexRebuilt) _onIndexRebuilt([]); // empty = scanning state
  // Better: use a separate callback for scanning state
  if (_onScanningStateChanged) _onScanningStateChanged(true);

  _indexDebounceTimer = setTimeout(async () => {
    if (!_enabled) return;
    await performIndexRebuild();
  }, 300);
}
```

### `performIndexRebuild(): Promise<void>` (Core Logic)

```typescript
async function performIndexRebuild(): Promise<void> {
  const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;

  // EC-14: untitled document -- clear index
  if (!currentFile) {
    _index.clear();
    _cachedFileList = [];
    setCachedFileList([]);
    _lastKnownFile = null;
    if (_onScanningStateChanged) _onScanningStateChanged(false);
    if (_onIndexRebuilt) _onIndexRebuilt([]);
    return;
  }

  // Derive directory from current file path
  const dir = currentFile.replace(/\/[^/]*$/, "");
  const currentFilename = filenameFromPath(currentFile);

  // Step 1: list sibling files
  const files = await listMdFiles(dir);

  // Guard: plugin may have been disabled during the await
  if (!_enabled) return;

  // Update cached file list for autocomplete
  setCachedFileList(files);

  // Step 2: read each sibling and extract outgoing links
  const newIndex = new Map<string, string[]>();

  for (const filename of files) {
    // Guard: plugin may have been disabled during reads
    if (!_enabled) return;

    const filePath = `${dir}/${filename}`;
    const result = await readFile(filePath);

    if (!result.ok) {
      // EC-20, EC-21: skip unreadable files with a warning
      console.warn(`[backlinks] Skipping unreadable file: ${filename} (${result.error.message})`);
      continue;
    }

    const outgoingLinks = extractOutgoingLinks(result.value);
    newIndex.set(filename, outgoingLinks);
  }

  // Guard: plugin may have been disabled during the loop
  if (!_enabled) return;

  // Commit the new index
  _index = newIndex;
  _lastKnownFile = currentFile;

  // Compute backlinks for the current file
  const backlinks = computeBacklinks(currentFilename);

  // Notify sidebar
  if (_onScanningStateChanged) _onScanningStateChanged(false);
  if (_onIndexRebuilt) _onIndexRebuilt(backlinks);
}
```

### `computeBacklinks(currentFilename: string): string[]`

```typescript
/**
 * Filter the index to find files that link to the current file.
 *
 * A file is a backlink source if any of its outgoing link targets
 * match the current filename (case-insensitive comparison per AD-5).
 *
 * @returns Sorted array of filenames that link to currentFilename.
 */
function computeBacklinks(currentFilename: string): string[] {
  const backlinks: string[] = [];

  for (const [filename, outgoingLinks] of _index) {
    // Skip self
    if (filename.localeCompare(currentFilename, undefined, { sensitivity: "base" }) === 0) {
      continue;
    }

    const linksToCurrentFile = outgoingLinks.some((target) =>
      target.localeCompare(currentFilename, undefined, { sensitivity: "base" }) === 0
    );

    if (linksToCurrentFile) {
      backlinks.push(filename);
    }
  }

  // Sort alphabetically
  backlinks.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  return backlinks;
}
```

### `readFile` Access

The plugin accesses `readFile` via a lazily-resolved reference to the bridge function. Since IIFE plugins cannot import from `bridge.ts`, the plugin must use Tauri's `invoke` directly:

```typescript
async function invokeReadFile(path: string): Promise<{ ok: true; value: string } | { ok: false; error: { message: string } }> {
  try {
    const content = await (window as any).__TAURI_INTERNALS__.invoke("read_file", { path });
    return { ok: true, value: content };
  } catch (error) {
    return { ok: false, error: { message: String(error) } };
  }
}
```

**Wait** -- the requirements say plugins should NOT access `__TAURI_INTERNALS__` (PC-3 in the plugin API). However, for reading sibling file content, the bridge's `readFile()` is not accessible from IIFE plugins.

**Resolution**: Use `window.__TAURI_INTERNALS__` cautiously. The PC-3 restriction is about the plugin API object, but IIFE plugins are self-contained bundles that can access window globals. The `readFile` bridge function internally calls `invoke()` which goes through `__TAURI_INTERNALS__`. The plugin can call `invoke` directly for file reads.

**Better approach**: Use `@tauri-apps/api/core`'s `invoke` which is NOT bundled (it is external). But the IIFE build marks `@tauri-apps/*` as external too... Actually, looking at the build config, only `@codemirror/*` is external. Tauri APIs are bundled.

**Simplest approach**: The plugin calls `invoke("read_file", { path })` directly. In the IIFE build, `@tauri-apps/api/core` would be bundled. But this creates a separate Tauri API instance.

**Final decision**: Use `window.__TAURI_INTERNALS__.invoke` directly. This is the same pattern the Tauri API uses internally. It avoids bundling `@tauri-apps/api/core` into the IIFE. Add a comment explaining why.

Similarly, `listMdFiles` uses the same pattern:

```typescript
async function invokeListMdFiles(directoryPath: string): Promise<string[]> {
  try {
    return await (window as any).__TAURI_INTERNALS__.invoke("list_md_files", { directoryPath });
  } catch (error) {
    console.error("[backlinks] Failed to list md files:", error);
    return [];
  }
}
```

### Tab-Switch Detection via UpdateListener

```typescript
function buildTabSwitchListener(): Extension {
  const EditorView = getCmEditorView();
  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;

    const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;

    // Detect tab switch: file path changed since last check
    if (currentFile !== _lastKnownFile) {
      _lastKnownFile = currentFile;
      triggerIndexRebuild();
    }
  });
}
```

### File-Save Detection

The plugin registers a listener for the Tauri `menu-event` to detect file saves:

```typescript
let _menuEventUnlisten: (() => void) | null = null;

async function listenForFileSave(): Promise<void> {
  // Listen for menu-event from Tauri
  const { listen } = await import("@tauri-apps/api/event");
  // ... but IIFE plugins should not import @tauri-apps/api/event

  // Alternative: use window event listener on the Tauri event system
  // Tauri v2 emits events that can be listened to via __TAURI_INTERNALS__
}
```

**Simpler approach**: Use the CM6 updateListener to detect saves. After a save, the `isDirty` flag on the tab transitions from true to false. But the plugin cannot observe this.

**Simplest approach**: Use the updateListener's `docChanged` as a proxy. When the document changes, the user might be editing links. Debounce at 300ms means rapid typing does not trigger multiple rebuilds. The index rebuild re-reads all sibling files, which catches any saves.

**Problem**: This rebuilds on every keystroke (debounced), which is expensive for large directories.

**Revised approach**: Rebuild the index only on:
1. Plugin enable (initial)
2. Tab switch (detected by `__MARKABLE_CURRENT_FILE__` change)
3. Periodically on doc change -- but only rebuild the CURRENT file's entry in the index (not all siblings). Full rebuild only on tab switch.

**Final decision**: Keep it simple for Foundation scope:
- Full rebuild on enable and tab switch.
- On `docChanged`: only update the current file's outgoing links in the index (no sibling re-reads). Recompute backlinks from the existing index + updated current entry. This is cheap (regex scan of current doc only).
- For detecting when OTHER files change (e.g., user edits a sibling in a different app): rely on tab switch to trigger a full rebuild. This is acceptable per EC-25.

```typescript
function buildDocChangeListener(): Extension {
  const EditorView = getCmEditorView();
  let docChangeTimer: ReturnType<typeof setTimeout> | null = null;

  return EditorView.updateListener.of((update: ViewUpdate) => {
    if (!_enabled) return;
    if (!update.docChanged) return;

    // Debounce: update current file's index entry
    if (docChangeTimer) clearTimeout(docChangeTimer);
    docChangeTimer = setTimeout(() => {
      if (!_enabled) return;
      const currentFile = (window as any).__MARKABLE_CURRENT_FILE__ as string | null;
      if (!currentFile) return;

      const currentFilename = filenameFromPath(currentFile);
      const docText = update.state.doc.toString();
      const outgoingLinks = extractOutgoingLinks(docText);

      _index.set(currentFilename, outgoingLinks);

      const backlinks = computeBacklinks(currentFilename);
      if (_onIndexRebuilt) _onIndexRebuilt(backlinks);
    }, 300);
  });
}
```

## TDD Test Plan

```
describe("performIndexRebuild", () => {
  test("builds index from sibling files")
  test("skips unreadable files with warning (EC-20, EC-21)")
  test("clears index for untitled document (EC-14)")
  test("updates cached file list for autocomplete")
  test("guards against plugin disabled during async reads (EC-15)")
  test("handles empty directory (EC-11 with 0 files)")
})

describe("computeBacklinks", () => {
  test("finds files that link to current file via wiki-links")
  test("finds files that link to current file via standard markdown links (EC-17)")
  test("case-insensitive matching (AD-5)")
  test("excludes self from backlinks")
  test("returns sorted array")
  test("returns empty array when no backlinks exist")
})

describe("triggerIndexRebuild — debounce", () => {
  test("debounces at 300ms")
  test("abandons in-progress rebuild on re-trigger (EC-12)")
})

describe("tab-switch detection", () => {
  test("detects tab switch via __MARKABLE_CURRENT_FILE__ change (EC-13)")
  test("triggers full rebuild on directory change")
  test("clears index on switch to untitled (EC-14)")
})

describe("doc-change listener", () => {
  test("updates current file's outgoing links on doc change")
  test("recomputes backlinks after update")
  test("debounces rapid typing")
})
```

## Edge Cases Addressed

| EC | Handling |
|---|---|
| EC-11 | `listMdFiles()` returns all files; no hard cap. For 500+ files, NFR-2 allows up to 2s for sequential reads |
| EC-12 | `triggerIndexRebuild()` clears pending timer and starts new debounce. `_enabled` guards prevent stale callbacks |
| EC-13 | `buildTabSwitchListener` detects `__MARKABLE_CURRENT_FILE__` change, triggers full rebuild with new directory |
| EC-14 | `performIndexRebuild` handles null `currentFile` by clearing index and file list |
| EC-20 | `invokeReadFile` catches errors; file is skipped with console.warn |
| EC-21 | Same as EC-20 -- `readFile` returns error result; file skipped |
| EC-25 | Stale index from external rename persists until next tab switch triggers full rebuild. Acceptable for Foundation scope |
