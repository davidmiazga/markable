---
title: "Tabs Step 07 — main.ts Full Integration"
last-updated: "2026-04-13"
review-cadence-days: 14
status: active
---

# Step 07 — main.ts Full Integration

**Goal:** Replace all single-document file operations in `main.ts` with tab-aware equivalents. After this step, Markable is a fully functional multi-document tabbed editor.

**App state after this step:** Opening a file creates a new tab. Opening a file that is already open activates the existing tab. Save/Save As operate on the active tab. Drag-and-drop opens files in new tabs. "Open Recent" opens in new tabs.

---

## Overview of Changes

The following functions in `main.ts` are **replaced or removed**:

| Old function | New behavior |
|---|---|
| `newFile()` | **Removed** — replaced by `tabManager.openNewTab()` (step_06 already redirects `file-new`) |
| `openFile()` | **Replaced** — opens file dialog, calls `tabManager.openFileInTab(path)` |
| `openFileByPath(path)` | **Replaced** — calls `tabManager.openFileInTab(path)` |
| `openRecentFileByPath(path)` | **Replaced** — calls `tabManager.openFileInTab(path)`, handles "not found" via tab skip |
| `saveFile()` | **Replaced** — calls `tabManager.saveActiveTab()` |
| `saveFileAs()` | **Replaced** — calls `tabManager.saveActiveTabAs()` |

The `currentFilePath`, `isDirty`, `setDirty()`, `setCurrentFile()`, `isReadOnly` module-level variables become **unused** and are **removed**.

---

## Functions Removed from `main.ts`

Remove entirely:
- `let currentFilePath: string | null`
- `let isDirty: boolean`
- `let isReadOnly: boolean`
- `function setDirty(dirty: boolean)`
- `function setCurrentFile(path: string | null)`
- `function newFile()`
- `function openHelpFile(filename, title)` — replaced with tab-aware version (see below)

`updateTitleBar()` is removed from `main.ts` — `TabManager._updateTitleBar()` owns the title bar now.

---

## Functions Rewritten in `main.ts`

### `async function openFile(): Promise<void>`

```typescript
async function openFile(): Promise<void> {
  const result = await openFileDialog();
  if (result.cancelled) return;
  await tabManager.openFileInTab(result.path);
  await refreshRecentFilesMenu();
}
```

`openFileInTab` handles: file read, duplicate detection, state swap, `addRecentFile`, `setLivePreviewFilePath`, view mode, dirty=false. `openFile` only needs to call the dialog and delegate.

### `async function openFileByPath(path: string): Promise<void>`

```typescript
async function openFileByPath(path: string): Promise<void> {
  await tabManager.openFileInTab(path);
  await refreshRecentFilesMenu();
}
```

Used by: `menu-event` with `action === "open-file-path"`, and drag-and-drop handler.

### `async function openRecentFileByPath(path: string): Promise<void>`

```typescript
async function openRecentFileByPath(path: string): Promise<void> {
  const opened = await tabManager.openFileInTab(path);
  if (!opened) {
    // File was either already open (activated) or failed to read.
    // If it failed, tabManager.openFileInTab already showed alert.
    // Remove from recent if it failed (check by presence in tabs).
    const isOpen = tabManager.getTabs().some(t => t.filePath === path);
    if (!isOpen) {
      await removeRecentFile(path);
      await refreshRecentFilesMenu();
    }
  } else {
    await refreshRecentFilesMenu();
  }
}
```

**Note:** `tabManager.openFileInTab()` returns `false` for two cases: (a) file already open (duplicate activated), and (b) file read failed (alert shown). To distinguish: check if the path appears in tabs. If it does, it was already open (case a) — no need to remove from recent. If it doesn't, read failed (case b) — remove from recent.

### `async function saveFile(): Promise<void>`

```typescript
async function saveFile(): Promise<void> {
  await tabManager.saveActiveTab();
  await refreshRecentFilesMenu();
}
```

### `async function saveFileAs(): Promise<void>`

```typescript
async function saveFileAs(): Promise<void> {
  await tabManager.saveActiveTabAs();
  await refreshRecentFilesMenu();
}
```

### `openHelpFile` — tab-aware version

Help files (Quickstart, Help, Cheatsheet) are opened as read-only tabs. Implement `openHelpFileInTab`:

```typescript
async function openHelpFileInTab(filename: string, title: string): Promise<void> {
  if (!editor) return;
  try {
    const content = await readResourceFile(filename);
    // Open as a tab with null filePath (untitled but named)
    // Reuse openFileInTab pattern but with synthetic content
    // Since TabManager.openFileInTab reads from disk, we need a different path.
    // Solution: create a special "help tab" via TabManager internal method.
    // Deferred approach: create tab manually using TabManager's createTabFromContent.
    tabManager.openContentTab(title, content, { readOnly: true });
  } catch (e) {
    console.error("openHelpFile error:", e);
    alert(`Could not open help file: ${filename}\n\n${String(e)}`);
  }
}
```

Add `openContentTab(title: string, content: string, opts?: { readOnly?: boolean }): void` to `TabManager`:

```typescript
openContentTab(title: string, content: string, opts?: { readOnly?: boolean }): void {
  this._captureActiveTab();
  const state = EditorState.create({ doc: content });
  const tab: TabEntry = {
    id: crypto.randomUUID(),
    filePath: null,
    title,
    isDirty: false,
    editorState: state,
    scrollTop: 0,
  };
  this.tabs.push(tab);
  this.activeIndex = this.tabs.length - 1;
  this._applyActiveTab();
  // If readOnly, dispatch editable=false effect after setState
  if (opts?.readOnly && this.editorView) {
    this.editorView.dispatch({
      effects: editableCompartment.reconfigure(EditorView.editable.of(false)),
    });
  }
  this._notifyRenderer();
  // Don't save session for content tabs (no filePath)
}
```

Import `editableCompartment` from `../editor/extensions` in `tab-manager.ts`.

---

## `handleAction()` — Final Tab-Aware State

After step_07, the action cases for file operations become:

```typescript
case "file-new":      tabManager.openNewTab();          break;  // AD-7
case "file-open":     void openFile();                  break;  // now tab-aware
case "file-save":     void saveFile();                  break;  // delegates to tabManager
case "file-save-as":  void saveFileAs();                break;  // delegates to tabManager
case "file-close-all":
  // Close all tabs — iterate and close each
  void (async () => {
    const ids = tabManager.getTabs().map(t => t.id);
    for (const id of ids) {
      // closeTab handles dirty check and window close
      await tabManager.closeTab(id);
      if (tabManager.getTabCount() === 0) break;
    }
  })();
  break;
case "file-import":   void openFile();                  break;
case "file-export":
  void exportAsHtml(editor, tabManager.getActiveFilePath());
  break;
// help-* cases: use openHelpFileInTab
case "help-quickstart": void openHelpFileInTab("quickstart.md", "Quickstart"); break;
case "help-help":       void openHelpFileInTab("help.md", "Help");             break;
case "help-cheatsheet": void openHelpFileInTab("markdown-cheatsheet.md", "Markdown Cheatsheet"); break;
```

Note: `file-export` now uses `tabManager.getActiveFilePath()` instead of the old `currentFilePath` variable.

---

## Drag-and-Drop Handler

Replace the existing drag-and-drop handler in `initApp()`:

```typescript
await getCurrentWebviewWindow().onDragDropEvent(async (event) => {
  if (event.payload.type !== "drop") return;
  const paths = event.payload.paths.filter(
    (p) => p.endsWith(".md") || p.endsWith(".txt")
  );
  if (paths.length === 0) return;
  // EC-14: open in new tab; duplicate check applies via openFileInTab
  await tabManager.openFileInTab(paths[0]);
  await refreshRecentFilesMenu();
});
```

If multiple files are dropped (`paths.length > 1`), open them all:
```typescript
for (const path of paths) {
  await tabManager.openFileInTab(path);
}
await refreshRecentFilesMenu();
```

---

## "Open Recent" menu handler

The `recent-file-*` branch already calls `openRecentFileByPath`. Since `openRecentFileByPath` is rewritten above, no additional change is needed.

---

## Dirty State Listener Finalization

The dirty-state listener was updated in step_02 to call `tabManager.markActiveTabDirty()`. Confirm in step_07 that no remnants of the old `isDirty` / `setDirty()` variables remain.

Also remove the `window.addEventListener("focus")` handler that called `editor.focus()` and guarded on `findWidget?.isOpen()`. This logic should move to `TabManager._applyActiveTab()` — after `setState()`, call `editor.focus()` only if no overlay is open. Alternatively, keep the existing `window.addEventListener("focus")` but remove the `isDirty` reference — it was not related to dirty state anyway.

---

## `updateTitleBar()` Removal

Remove the top-level `updateTitleBar()` function from `main.ts`. The call at the end of `initApp()` (`updateTitleBar()` before `showWindow()`) is replaced by `tabManager._updateTitleBar(tabManager.getActiveTab())` — but since `_applyActiveTab()` calls `_updateTitleBar()`, this happens automatically. Remove the standalone call.

---

## Variables to Remove from `main.ts`

After step_07, these module-level variables and functions are no longer referenced and must be deleted:

- `let currentFilePath: string | null`
- `let isDirty: boolean`
- `let isReadOnly: boolean`
- `function setDirty(dirty: boolean)`
- `function setCurrentFile(path: string | null)`
- `function newFile()`
- `function openHelpFile(filename, title)` (replaced by `openHelpFileInTab`)
- `function updateTitleBar(override?)` (replaced by TabManager)

---

## Tests to Write (`tests/tabs/main-integration.test.ts`)

Integration tests using mocked Tauri commands.

| Test | Covers |
|---|---|
| `openFile` dialog → new tab created | FR-5.5 |
| `openFile` with already-open path → existing tab activated, count unchanged | EC-4 |
| `openFileByPath` with drag-drop → tab opened | EC-14 |
| `openRecentFileByPath` with missing file → removed from recent, no crash | FR-5.5 |
| `saveFile` → `tabManager.saveActiveTab()` called | FR-5.6 |
| `saveFileAs` → `tabManager.saveActiveTabAs()` called | FR-5.6 |
| `file-export` uses `tabManager.getActiveFilePath()` | FR-5.6 |
| Multiple drag-drop files → each opens in new tab | EC-14 |
| `file-close-all` closes all tabs (no dirty tabs) | FR-5.2 |

---

## Verification

After implementing step_07 (full integration):
1. Open a file via Cmd-O — opens in a new tab, title bar shows filename.
2. Open the same file again via Cmd-O — the existing tab is activated; no duplicate.
3. Open another file via Cmd-O — two tabs visible.
4. Edit a file — dirty indicator appears (• in title bar, dot on tab).
5. Cmd-S — saves, dirty indicator cleared.
6. Cmd-Shift-S — Save As dialog, file renamed in tab title.
7. Cmd-W — closes tab; adjacent tab activated.
8. Close last tab — confirmation if dirty, then window closes.
9. Open Recent submenu — file opens in new tab.
10. Drag a .md file onto the window — opens in new tab.
11. All 20 edge cases from the requirements EC inventory can be manually exercised.
